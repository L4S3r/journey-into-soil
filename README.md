# Journey Into the Soil

Decision-support web app for **NASA Space Apps: "Field Shift: Adapting Farms with NASA Data"** (team The Shifters).
A farmer clicks a field on a map, NASA Earth observations and local soil data are combined, at least three crop-rotation
strategies (including the existing one) are compared, and a Babylon.js scene dives into the soil to show the result.

> Support, not replacement, of farmer and agronomist judgment. Advisory estimates only.

## Quick start

Linux / macOS / WSL / Git Bash:

```bash
bash scripts/bootstrap.sh      # checks tools, creates .env, installs API + web, runs tests, builds the mock result
make dev-api                   # terminal 1: FastAPI on :8000  (docs at /docs)
make dev-web                   # terminal 2: Vite on :5173
```

Windows PowerShell / Command Prompt:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
# or run in CMD: scripts\bootstrap.bat
```

Docker (production-like, e.g. on the OCI Ampere instance, linux/arm64):

```bash
cp .env.example .env
docker compose up -d --build   # web on 127.0.0.1:8080, put your reverse proxy in front
```

## What exists today (walking skeleton)

| Area | State |
| --- | --- |
| `api/app/sim` | Tested cores: FAO-56 ET0, Saxton-Rawls pedotransfer, 4-layer water balance, salinity yield response |
| `api/app/engine` | Tested rotation engine: validate, season filter, soil/water filter, rotation rules, 3 strategies |
| `api/app/api/v1` | health, crops, knowledge, analyses (POST runs the real engine + sim on synthetic climate until real packs land) |
| `contracts/` | Result JSON schema, mock result generated from the real sim and engine, shared i18n keys |
| `web/` | React + Vite + TS, i18n with RTL, MapLibre click-to-select, Babylon scene driven by the mock result |
| `pipelines/` | Empty skeleton (POWER fetcher, Earthdata access check, NDVI, pack builders are backlog items B1-B6) |
| `data/packs/` | Empty: until packs exist the API uses a labelled synthetic climate and returns low confidence |

Everything else is in `docs/tasks/BACKLOG.md`. Agents start with `AGENTS.md` and `docs/BOOTSTRAP_PROMPT.md`.
