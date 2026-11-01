"""Step 7: explain uncertainty. Confidence is derived from data provenance, not from model fit."""
from __future__ import annotations

from .filters import msg


def confidence(cand, climate_source: str, resolution_km: float | None, input_status: dict[str, str], outside_delta: bool,
               history_len: int) -> dict:
    score = 1.0
    factors: list[dict] = []

    def hit(delta: float, key: str, **params) -> None:
        nonlocal score
        score -= delta
        factors.append(msg(key, **params))

    if climate_source == "synthetic":
        hit(0.35, "conf.synthetic_climate")
    elif resolution_km and resolution_km > 5:
        hit(0.10, "conf.coarse_resolution", km=int(resolution_km))
    if input_status.get("texture") == "estimated":
        hit(0.10, "conf.texture_by_feel")
    if input_status.get("soil_ec") == "estimated":
        hit(0.10, "conf.ec_estimated")
    if input_status.get("organic_matter") == "estimated" or input_status.get("ph") == "estimated":
        hit(0.05, "conf.soil_estimated")
    if any(c and not c.get("reviewed", False) for c in cand.crops):
        hit(0.10, "conf.unreviewed_params")
    if history_len < 3:
        hit(0.05, "conf.history_short")
    if outside_delta:
        hit(0.10, "conf.outside_delta")
    if any(s != "ok" for s in cand.soil_status):
        hit(0.05, "conf.soil_flags")

    score = max(0.05, round(score, 2))
    level = "high" if score >= 0.7 else "medium" if score >= 0.5 else "low"
    return {"level": level, "score": score, "factors": factors}
