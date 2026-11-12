# Journey Into the Soil

Decision-support web application for **NASA Space Apps Challenge 2026: "Field Shift: Adapting Farms with NASA Data"** (Team: **The Shifters**).

A farmer or agronomist selects a field on a map (or picks from 27 pre-calibrated demo sites across Egypt), combines NASA Earth observations with local soil data, simulates physical agro-hydrological soil dynamics (FAO-56 ET0, Saxton-Rawls pedotransfer, 4-layer soil water balance, and salinity response), evaluates historical multi-year climate uncertainty across 15 analog years (2011–2025), and dives into the soil with a 3D Babylon.js root-zone visualization to compare 3 distinct crop rotation strategies.

> [!IMPORTANT]
> **Support, not replacement.** Advisory estimates only. The engine provides decision support and risk bounds, not definitive agricultural instructions or yield guarantees.
> 
> **Honesty about data.** All synthetic, unreviewed, or qualitative inputs surface explicitly as data gaps and lower overall confidence. Placeholders are never presented as NASA data.

---

## Current Architecture & Status

| Area | Component | State & Capabilities |
| :--- | :--- | :--- |
| **Physics Simulation** | [`api/app/sim`](journey-into-soil/api/app/sim) | FAO-56 Penman-Monteith daily reference evapotranspiration ($ET_0$), Saxton-Rawls 2006 pedotransfer soil hydraulics, 4-layer soil water balance (dynamic root growth, daily infiltration, percolation, evaporation, transpiration), and Maas-Hoffman salinity yield reduction. Includes high-efficiency headless simulation (`record_daily=False`) for fast historical sweeps. |
| **Rotation Engine** | [`api/app/engine`](journey-into-soil/api/app/engine) | Implementation of the FIELD.PUA Section 9 rotation pipeline: input validation, agronomic season windows, soil texture/drainage filters, crop rotation rules (family repetition, leguminous fixation, root depth alternations), sim-informed candidate ranking, and multi-objective scoring (water, soil health, income, risk). Generates 3 strategies: `existing`, `primary`, and `contrast`. |
| **Climate Uncertainty Engine** | [`api/app/engine/uncertainty.py`](journey-into-soil/api/app/engine/uncertainty.py) | **Schema 1.1.0 Multi-Year Simulation**: Evaluates candidate rotations across 15 historical analog years (2011–2025) under climate scenario shifts ($\Delta T, \Delta P$). Computes $p10, p50, p90$ distributions for irrigation ($mm$), water stress, salinity stress, heat stress days ($>35^\circ\text{C}$), and total rotation score. Computes strategy `rank_stability` and spread-adjusted confidence. Features bidirectional leap year (Feb 29) alignment. Benchmarked at **~3.7 s** per full analysis. |
| **Offline Demo Packs** | [`data/packs/demo_sites/`](journey-into-soil/data/packs/demo_sites) | **27 pre-built offline demo sites** across Egypt (Nile Delta, Upper Egypt, New Valley, Fayoum, Matrouh, Nubaria, Sinai) containing 25+ years (2000–2025) of daily NASA POWER agrometeorology (solar radiation, max/min temperature, precipitation, relative humidity, wind speed). Zero network dependency at demo runtime. |
| **Data Pipelines** | [`pipelines/`](journey-into-soil/pipelines) | NASA POWER agrometeorology fetcher, ISRIC SoilGrids extractor, and automated pack compiler ([`pipelines/build_demo_packs.py`](journey-into-soil/pipelines/build_demo_packs.py)). Covered by dedicated automated tests. |
| **Contract & Schema** | [`contracts/`](journey-into-soil/contracts) | JSON Schema `1.1.0` in [`contracts/result.schema.json`](journey-into-soil/contracts/result.schema.json). Generated and validated mock result in [`contracts/mock_result.json`](journey-into-soil/contracts/mock_result.json). Full bilingual i18n parity (English LTR and Arabic RTL) enforced by [`scripts/check_i18n.py`](journey-into-soil/scripts/check_i18n.py). |
| **3D Scene & Web UI** | [`web/`](journey-into-soil/web) | React 18 + Vite + TypeScript. Babylon.js 3D root-zone visualization decoupled cleanly through [`web/src/scene/SceneController.ts`](journey-into-soil/web/src/scene/SceneController.ts) (React never touches Babylon objects). Interactive MapLibre GL parcel selector. Complete RTL/LTR localization. |
| **Deployment & Infra** | [`infra/`](journey-into-soil/infra) | Docker & Docker Compose setup supporting Linux ARM64 (OCI Ampere A1) and AMD64 with built-in healthchecks and reverse proxy documentation. |

---

## Key Highlights

### 1. Multi-Year Historical Climate Uncertainty (Schema 1.1.0)
Rather than relying on a single analog weather year, the backend now runs rotational candidates across 15 historical years (2011–2025) from pre-built NASA POWER climate data packs:
- **Scenario Stress Testing**: Applies user-selected temperature shifts ($\Delta T$) and precipitation scaling ($\Delta P$) on top of historical daily series.
- **Risk Distribution ($p10 / p50 / p90$)**: Reports 10th, 50th (median), and 90th percentile bounds for seasonal irrigation needs, crop water stress, salinity-induced yield loss, extreme heat days, and composite rotation score.
- **Rank Stability**: Measures the fraction of historical years in which a recommended strategy maintains its superior rank, exposing climate vulnerability.
- **Spread-Aware Confidence**: High climate variance or unstable ranking penalizes engine confidence and surfaces advisory alerts (`conf.high_climate_variance`).
- **High Performance**: Optimized headless simulation mode evaluates 55 rotation candidates over 15 years in **~3.7 s**, staying comfortably within the 5.0 s ARM VM latency budget.

### 2. 27 Pre-Built Demo Sites Across Egypt
The app requires **no live network access** during demonstrations. 27 agricultural sites covering every major Egyptian agro-ecological zone are packaged locally in `data/packs/demo_sites/`:
- **Nile Delta**: Kafr El-Sheikh, Gharbia, Beheira, Dakahlia, Sharkia, Menofia, Qalyubia, Damietta, Alexandria.
- **Upper Egypt**: Minya, Beni Suef, Assiut, Sohag, Qena, Luxor, Aswan.
- **Reclaimed & Desert Soils**: Nubaria, Wadi El-Natrun, New Valley (Kharga, Dakhla, Farafra), East Oweinat, Toshka, Matrouh, Siwa.
- **Suez Canal & Sinai**: Ismailia, North Sinai.

### 3. Strict Contract-First & i18n Parity
- All engine outputs conform strictly to [`contracts/result.schema.json`](journey-into-soil/contracts/result.schema.json) (`schema_version: "1.1.0"`).
- All strings returned by the backend are structured internationalization keys (`{key, params}`).
- Arabic (MSA) and English catalogs maintain 100% key parity, verified in CI via [`scripts/check_i18n.py`](journey-into-soil/scripts/check_i18n.py).

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+ and npm
- (Optional) Docker & Docker Compose

### Linux / macOS / WSL / Git Bash

```bash
# 1. Bootstrap environment, virtualenv, dependencies, and build packs
bash scripts/bootstrap.sh

# 2. Run backend API (FastAPI on http://127.0.0.1:8000, docs at /docs)
make dev-api

# 3. Run frontend (Vite on http://127.0.0.1:5173)
make dev-web
```

### Windows (PowerShell / Command Prompt)

```powershell
# PowerShell:
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1

# Or in CMD:
scripts\bootstrap.bat
```

### Docker Deployment (OCI Ampere A1 arm64 / amd64)

```bash
cp .env.example .env
docker compose up -d --build
# Web frontend available on http://127.0.0.1:8080 (or through your reverse proxy)
# API available on http://127.0.0.1:8000
```

---

## Verification & Testing

Run all quality and verification checks before committing:

```bash
# Run API test suite (84+ tests including physics, engine, demo packs, uncertainty)
cd api
python -m pytest -q
ruff check .

# Run data pipeline tests (13 tests)
cd ..
python -m pytest pipelines/tests -q

# Verify Arabic and English i18n key parity
python scripts/check_i18n.py

# Benchmark multi-year simulation runtime (target < 5.0 s)
python scripts/benchmark_analysis.py

# Recompile demo site packs from raw NASA data
python pipelines/build_demo_packs.py

# Regenerate mock result from the live engine and validate schema
python scripts/make_mock_result.py
```

---

## Scientific Foundations & Data Sources

1. **NASA POWER Project**: Daily agrometeorology (solar radiation, $T_{max}$, $T_{min}$, precipitation, humidity, wind speed) from 2000 to 2025. Obtained from the NASA Langley Research Center POWER Project funded through the NASA Earth Science Directorate Applied Science Program.
2. **FAO-56 Irrigation and Drainage Paper**: Penman-Monteith method for standard reference crop evapotranspiration ($ET_0$) and dual crop coefficients ($K_c$).
3. **Saxton & Rawls (2006)**: Soil water characteristic equations (pedotransfer functions) estimating wilting point ($\theta_{wp}$), field capacity ($\theta_{fc}$), saturation ($\theta_{sat}$), and hydraulic conductivity ($K_{sat}$) from texture, organic matter, and compaction.
4. **FAO Irrigation and Drainage Papers 29 & 61 / Maas-Hoffman**: Salinity threshold and slope models for crop yield reduction under soil electrical conductivity ($EC_e$) and irrigation water salinity ($EC_w$).
5. **ISRIC SoilGrids 250m**: Global digital soil property maps used as secondary unconfirmed priors when user field measurements are not available.

---

## Project Structure

```text
journey-into-soil/
├── api/                       # FastAPI backend
│   ├── app/
│   │   ├── api/v1/            # Endpoints: /health, /demo-sites, /analyses
│   │   ├── engine/            # FIELD.PUA rotation engine & uncertainty evaluation
│   │   ├── services/          # NASA POWER pack loader, SoilGrids lookup
│   │   └── sim/               # Physics: ET0, Saxton-Rawls, 4-layer balance, salinity
│   └── tests/                 # Comprehensive pytest test suite (84+ tests)
├── contracts/                 # Contract-first interface definitions
│   ├── result.schema.json     # Single source of truth JSON Schema (v1.1.0)
│   ├── mock_result.json       # Validated mock result matching schema v1.1.0
│   └── i18n/                  # Bilingual engine translation keys (en.json, ar.json)
├── data/
│   ├── packs/demo_sites/      # 27 validated offline demo packs (NASA POWER 2000-2025)
│   └── raw/                   # Raw NASA POWER and SoilGrids source datasets
├── docs/                      # Documentation, schemas, deployment guides, pitch
├── knowledge/                 # Crop parameters, rotation rules, and Egyptian presets (YAML)
├── pipelines/                 # Offline NASA data acquisition & pack generation scripts
├── scripts/                   # Bootstrap, benchmark, i18n parity check, mock generation
└── web/                       # React + Vite + TypeScript frontend
    ├── src/
    │   ├── scene/             # Babylon.js 3D scene & SceneController
    │   ├── components/        # MapLibre map, strategy cards, uncertainty charts
    │   └── i18n/              # UI strings and engine translations (en, ar)
    └── public/                # Static assets and web mock result
```

---

## License & Team

Developed by **The Shifters** for the NASA Space Apps Challenge 2026.
Advisory output only. See [`AGENTS.md`](journey-into-soil/AGENTS.md) for project guidelines and non-negotiables.
