# Architecture
Browser (React/Vite/TS: MapLibre, Babylon via SceneController, i18next RTL) -> nginx (web container) -> `/api/v1` FastAPI.
POST /analyses: validate request -> engine pipeline (candidates -> sim -> scoring -> 3 strategies -> explanations) -> result JSON (schema 1.0.0) cached in SQLite by request hash -> GET /analyses/{id} serves share links.
Climate: pack for demo site if present, else labelled synthetic climatology. Knowledge: `knowledge/*.yaml` loaded by `api/app/knowledge.py`; version tag included in every result.
Deploy: Docker Compose (api + web), web on 127.0.0.1:8080, TLS via host reverse proxy. Target OCI Ampere A1 arm64 shared with Falqyn.
