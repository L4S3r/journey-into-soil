# Data sources and pack format

Sources registry: `knowledge/sources.yaml`. Status per product is exposed in `result.nasa_data` (`pack` | `placeholder` | `planned`).

## Pack format `data/packs/demo_sites/<id>.json` (read by `api/app/services/climate.py`)
Check `climate.py` for the authoritative fields (daily arrays: date, tmax, tmin, rain, et0 or inputs to compute it, plus `source` / `pack_id`). Builders must follow what the loader expects, extend loader + tests together, and set `resolution_km` per product.

## Notes
- POWER ~50 km; IMERG ~10 km; SMAP ~9 km; HLS 30 m; SoilGrids ~250 m. Field-scale claims need a caveat.
- SoilGrids values are ISRIC 250 m machine-learning model predictions (not field measurements); in API responses they are strictly labelled "estimated" (never "measured"). When incorporated into demo packs, values reflect the topsoil (0-5 cm) layer only, and pack organic matter (OM) is capped at 3.5% in the engine. Currently, 7 of 27 demo sites have soil data (6 original sites sampled at 0.0 km offset plus Cairo sampled from a nearby point at 4.81 km offset), while 20 sites have none (`soil: null`, status `planned`) because the ISRIC API returned null values for their coordinates.
- Analog-year lookup: scenarios (dT, dP) shift a real year rather than inventing weather.
