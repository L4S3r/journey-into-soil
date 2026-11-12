"""End-to-end analysis, following FIELD.PUA section 9:
validate -> season filter -> soil/water filter -> rotation rules -> sim-informed ranking -> explain uncertainty."""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone

from .. import knowledge
from ..schemas.request import AnalysisRequest
from ..services.climate import get_climate
from ..sim.runner import run_timeline
from ..sim.types import CropSeason, DayInput
from . import explain, filters, profile, scoring, strategies, uncertainty
from . import plan as planner
from .generator import Cand, Ctx, enumerate_candidates, existing_candidate, select_pool
from .validate import in_delta_box, infer_region, validate

SCHEMA_VERSION = "1.0.0"
MAX_DAYS = 900

NEEDS_LOCAL_REVIEW = ["review.irrigation_schedule", "review.variety", "review.pest_diagnosis", "review.market",
                      "review.soil_test"]


def request_id(req: AnalysisRequest) -> str:
    payload = req.model_dump_json() + "|" + knowledge.version_tag() + "|" + SCHEMA_VERSION
    return hashlib.sha256(payload.encode()).hexdigest()[:10]


def _schedule(cand: Cand, start: date) -> list[CropSeason]:
    out = []
    for season, crop, slot in zip(cand.seasons, cand.crops, cand.plan):
        if crop is None or slot is None:
            continue
        sow, harvest = slot
        out.append(CropSeason(crop, season, (sow - start).days, (harvest - start).days))
    return out


def _bare_periods(cand: Cand, dates: list[str]) -> list[dict]:
    tl = cand.sim
    last = max((s.harvest_idx for s in tl.seasons), default=-1)
    out, i = [], 0
    while i <= last:
        if tl.crop_idx[i] == -1:
            j = i
            while j + 1 <= last and tl.crop_idx[j + 1] == -1:
                j += 1
            out.append({"start": dates[i], "end": dates[j], "days": j - i + 1})
            i = j + 1
        else:
            i += 1
    return out


def _strategy_json(item: dict, cand: Cand, ctx: Ctx, existing: Cand, climate, input_status, dates, req, outside_delta, hist_len) -> dict:
    tl = cand.sim
    weights = scoring.weights_from(req.priorities)
    scores = dict(cand.scores)
    scores["total"] = round(scoring.total(cand.scores, weights), 3)
    seasons_json = []
    sched_i = 0
    for season, crop, slot in zip(cand.seasons, cand.crops, cand.plan):
        if crop is None or slot is None:
            seasons_json.append({"season": season, "crop": None, "sow_date": None, "harvest_date": None, "indicators": None})
            continue
        s = tl.seasons[sched_i]
        sched_i += 1
        seasons_json.append({
            "season": season, "crop": crop["id"], "sow_date": slot[0].isoformat(), "harvest_date": slot[1].isoformat(),
            "indicators": {"et_mm": s.et_mm, "rain_mm": s.rain_mm, "irrigation_mm": s.irrigation_mm,
                           "drainage_mm": s.drainage_mm, "water_stress": s.water_stress,
                           "salinity_stress": s.salinity_stress, "heat_days": s.heat_days},
        })
    text = explain.build(cand, item["id"], item["archetype"], existing, ctx, climate, input_status)
    return {
        "id": item["id"], "label_key": f"strategy.{item['id']}", "archetype": item["archetype"],
        "seasons": seasons_json,
        "bare_periods": _bare_periods(cand, dates),
        "scores": scores,
        "indicators": {"irrigation_mm": cand.metrics["irrigation_mm"], "et_mm": cand.metrics["et_mm"],
                       "bare_days": cand.metrics["bare_days"], "span_days": cand.metrics["span_days"]},
        **text,
        "confidence": uncertainty.confidence(cand, climate.source, climate.resolution_km, input_status, outside_delta, hist_len),
        "sim": {"moisture": tl.moisture, "ece": tl.ece, "root_cm": tl.root_cm, "canopy": tl.canopy, "ks": tl.ks,
                "irrigation_mm": tl.irrigation_mm, "crop_idx": tl.crop_idx},
    }


def _nasa_panel(climate) -> list[dict]:
    pack_products = set(getattr(climate, "products", []))
    if climate.source == "pack" and not pack_products:
        pack_products = {"power"}
    return [
        {"id": "power", "name_key": "nasa.power", "role_key": "nasa.power_role",
         "status": "pack" if "power" in pack_products else ("placeholder" if climate.source == "synthetic" else "planned"),
         "resolution_km": 50},
        {"id": "gpm", "name_key": "nasa.gpm", "role_key": "nasa.gpm_role",
         "status": "pack" if "gpm" in pack_products else "planned", "resolution_km": 10},
        {"id": "smap", "name_key": "nasa.smap", "role_key": "nasa.smap_role",
         "status": "pack" if "smap" in pack_products else "planned", "resolution_km": 9},
        {"id": "ndvi", "name_key": "nasa.ndvi", "role_key": "nasa.ndvi_role",
         "status": "pack" if "ndvi" in pack_products else "planned", "resolution_km": 0.03},
        {"id": "soilgrids", "name_key": "nasa.soilgrids", "role_key": "nasa.soilgrids_role",
         "status": "pack" if "soilgrids" in pack_products else "planned", "resolution_km": 0.25},
    ]


def run(req: AnalysisRequest) -> dict:
    ref = req.reference_date or date.today()
    flags, input_status, hist = validate(req)
    crops = knowledge.crops()
    hist_crops = [crops[h["crop"]] for h in hist]
    layers = profile.build_layers(req)
    ece_est = profile.estimate_ece(req)
    status = {cid: filters.soil_water_status(c, req, ece_est) for cid, c in crops.items()}
    pest_ex = {cid for cid, c in crops.items() if filters.pest_excluded(c, req)}
    seasons = planner.season_sequence(req.next_season, 3)
    ctx = Ctx(req=req, ref=ref, seasons=seasons, crops=crops, history=hist_crops, req_history=hist, status=status,
              pest_excluded=pest_ex, ece_est=ece_est)

    cands = enumerate_candidates(ctx)
    existing = existing_candidate(ctx)
    if not cands:
        flags.append({"field": "engine", "key": "flag.no_feasible_rotation", "severity": "error", "params": {}})
    pool = select_pool(cands, existing) if cands else [existing]

    first = planner.first_sow(req.next_season, ref)
    start = first[0]
    end = start + timedelta(days=30)
    for c in pool:
        for slot in c.plan:
            if slot:
                end = max(end, slot[1])
    end = min(end + timedelta(days=1), start + timedelta(days=MAX_DAYS))
    all_dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    climate = get_climate(req.lat, req.lon, all_dates, req.scenario.dT, req.scenario.dP)
    days = [DayInput(d, e, r, t) for d, e, r, t in zip(climate.dates, climate.et0, climate.rain, climate.tmax)]

    for c in pool:
        c.sim = run_timeline(layers, days, _schedule(c, start), req.irrigation, req.water_ec)
    scoring.score_pool(pool)

    picked = strategies.select(pool, existing, req.priorities)
    rank = strategies.existing_rank(pool, existing, req.priorities)
    outside = not in_delta_box(req)
    strategies_json = [
        _strategy_json(item, item["cand"], ctx, existing, climate, input_status, climate.dates, req, outside, len(hist))
        for item in picked
    ]
    disclaimers = ["disclaimer.main"] + (["disclaimer.preview_data"] if climate.source == "synthetic" else [])
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "request_id": request_id(req),
        "knowledge_version": knowledge.version_tag(),
        "input": req.model_dump(mode="json"),
        "field": {"lat": req.lat, "lon": req.lon, "area_feddan": req.area_feddan, "region": infer_region(req)},
        "flags": flags,
        "input_status": input_status,
        "nasa_data": _nasa_panel(climate),
        "layers": [profile.layer_json(layer) for layer in layers],
        "climate": {"dates": climate.dates, "tmax": climate.tmax, "tmin": climate.tmin, "rain": climate.rain,
                    "et0": climate.et0, "source": climate.source, "pack_id": climate.pack_id,
                    "scenario": {"dT": req.scenario.dT, "dP": req.scenario.dP}},
        "timeline": {"start": climate.dates[0], "end": climate.dates[-1], "days": len(climate.dates)},
        "candidates_evaluated": len(pool),
        "existing_rank": rank,
        "strategies": strategies_json,
        "needs_local_review": NEEDS_LOCAL_REVIEW,
        "disclaimers": disclaimers,
    }
