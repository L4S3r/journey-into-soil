"""Daily climate for a list of dates.

Order of preference: a NASA data pack for a nearby demo site (data/packs/demo_sites/*.json) -> synthetic Nile Delta
climatology. The synthetic series is a LABELLED PLACEHOLDER: smooth seasonal cycles and seeded random rain. It exists so the
whole product runs before real NASA data arrives; results built on it are reported with low confidence.

Pack format (see docs/data-sources.md):
  {"meta": {"id","lat","lon","source","resolution_km","period"},
   "daily": {"date": ["YYYY-MM-DD"...], "tmax": [], "tmin": [], "rh": [], "u2": [], "rs": [], "rain": []}}
Planning uses an analog-year approach: each future date takes the value of the same month-day from the latest year in the pack.
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from datetime import date

from ..config import get_settings
from ..sim.et0 import extraterrestrial_radiation, fao56_et0


@dataclass
class Climate:
    dates: list[str]
    tmin: list[float]
    tmax: list[float]
    rain: list[float]
    et0: list[float]
    source: str  # "synthetic" | "pack"
    pack_id: str | None = None
    resolution_km: float | None = None
    notes: list[str] = field(default_factory=list)


def _seasonal(doy: int) -> float:
    return math.sin(2 * math.pi * (doy - 110) / 365)


def synthetic_day(lat: float, d: date) -> dict[str, float]:
    doy = d.timetuple().tm_yday
    south = max(0.0, 31.0 - lat)
    tmean = 20.7 + 7.4 * _seasonal(doy) + 0.9 * south
    dtr = 9.0 + 0.9 * south
    rh = 62.0 - 8.0 * _seasonal(doy) - 2.5 * south
    u2 = 2.3 + 0.5 * math.cos(2 * math.pi * (doy - 60) / 365)
    rs = 0.70 * extraterrestrial_radiation(lat, doy)
    month = d.month
    p_rain = {12: 0.09, 1: 0.09, 2: 0.08, 3: 0.05, 11: 0.05, 4: 0.02, 10: 0.02}.get(month, 0.0)
    rng = random.Random(f"{round(lat, 1)}-{d.isoformat()}")
    scale = max(0.3, min(1.2, (lat - 27.0) / 4.0))
    rain = rng.expovariate(1 / 5.0) * scale if rng.random() < p_rain * scale else 0.0
    return {"tmax": tmean + dtr / 2, "tmin": tmean - dtr / 2, "rh": rh, "u2": u2, "rs": rs, "rain": round(rain, 1)}


def _find_pack(lat: float, lon: float) -> dict | None:
    folder = get_settings().packs_dir / "demo_sites"
    if not folder.exists():
        return None
    best, best_dist = None, 0.15
    for path in folder.glob("*.json"):
        try:
            pack = json.loads(path.read_text(encoding="utf-8"))
            meta = pack["meta"]
            dist = math.hypot(meta["lat"] - lat, meta["lon"] - lon)
        except (ValueError, KeyError, OSError):
            continue
        if dist <= best_dist:
            best, best_dist = pack, dist
    return best


def _analog_lookup(pack: dict) -> dict[str, dict[str, float]]:
    daily = pack["daily"]
    table: dict[str, dict[str, float]] = {}
    for i, iso in enumerate(daily["date"]):  # later years overwrite earlier ones
        table[iso[5:]] = {k: daily[k][i] for k in ("tmax", "tmin", "rh", "u2", "rs", "rain")}
    return table


def get_climate(lat: float, lon: float, dates: list[date], d_t: float = 0.0, d_p: float = 0.0) -> Climate:
    pack = _find_pack(lat, lon)
    table = _analog_lookup(pack) if pack else {}
    rows: list[dict[str, float]] = []
    used_pack = 0
    for d in dates:
        row = table.get(d.isoformat()[5:])
        if row:
            used_pack += 1
        else:
            row = synthetic_day(lat, d)
        rows.append(row)

    source = "pack" if pack and used_pack >= 0.9 * len(dates) else "synthetic"
    tmin, tmax, rain, et0 = [], [], [], []
    for d, r in zip(dates, rows):
        t_min, t_max = r["tmin"] + d_t, r["tmax"] + d_t
        rr = max(0.0, r["rain"] * (1 + d_p / 100.0))
        tmin.append(round(t_min, 1))
        tmax.append(round(t_max, 1))
        rain.append(round(rr, 1))
        et0.append(round(fao56_et0(t_min, t_max, r["rh"], r["u2"], r["rs"], lat, d.timetuple().tm_yday), 2))
    notes = []
    if source == "synthetic":
        notes.append("synthetic_climate")
    return Climate(
        dates=[d.isoformat() for d in dates], tmin=tmin, tmax=tmax, rain=rain, et0=et0, source=source,
        pack_id=(pack or {}).get("meta", {}).get("id") if source == "pack" else None,
        resolution_km=(pack or {}).get("meta", {}).get("resolution_km") if source == "pack" else None,
        notes=notes,
    )
