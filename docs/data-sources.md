# Data sources and pack format

Sources registry: `knowledge/sources.yaml`. Status per product is exposed in `result.nasa_data` (`pack` | `placeholder` | `planned`).

## Pack format `data/packs/demo_sites/<id>.json` (read by `api/app/services/climate.py`)
Check `climate.py` for the authoritative fields (daily arrays: date, tmax, tmin, rain, et0 or inputs to compute it, plus `source` / `pack_id`). Builders must follow what the loader expects, extend loader + tests together, and set `resolution_km` per product.

## Notes
- POWER ~50 km; IMERG ~10 km; SMAP ~9 km; HLS 30 m; SoilGrids ~250 m. Field-scale claims need a caveat.
- Analog-year lookup: scenarios (dT, dP) shift a real year rather than inventing weather.
