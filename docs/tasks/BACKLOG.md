# Backlog (status: [ ] todo, [~] doing, [x] done). Deadline 14 Nov 2026; NASA data ~12 Nov.

## P0 - must ship

- [ ] B1 (data-pipelines) POWER fetcher: daily T2M_MAX/MIN, PRECTOTCORR, ALLSKY_SFC_SW_DWN, RH2M, WS2M for each demo site, 2000-2025, no login. Output raw to `data/raw/power/`.
- [x] B2 (data-pipelines) `pipelines/earthdata/check_access.py`: verify token works, list granules for SPL3SMP_E and GPM_3IMERGDF over a demo site. See `docs/earthdata-setup.md`.
- [ ] B3 (data-pipelines) `build_demo_packs.py`: merge raw into `data/packs/demo_sites/<id>.json` (schema in `docs/data-sources.md`); engine already loads packs via `api/app/services/climate.py` (analog-year lookup). Add a test with a fixture.
- [ ] B4 (rotation-engine) When a pack is present: status "pack" per product in `nasa_data`, higher confidence, remove `gap.synthetic_climate`.
- [x] B5 (rotation-engine + experts) Review packet prepared (`knowledge/review/`); awaiting expert review and signoff before changing any `reviewed:false` crop params. Add a source per approved value.
- [ ] B6 (frontend) Shareable link route `/a/:id`, copy button, load via GET /analyses/{id}.
- [ ] B7 (frontend) Demo-site picker on landing (from /demo-sites) + "use my own field" map click.
- [ ] B8 (devops) Deploy on OCI: check ports (`ss -tlnp`), Caddy vhost, HTTPS, `docker compose up -d --build` on arm64, smoke test.
- [ ] B9 (docs-pitch) Submission text, 30-60 s video script, AI-use disclosure (`docs/pitch/`).
- [ ] B10 (reviewer) Challenge checklist pass (`docs/challenge-checklist.md`).

## P1 - should

- [x] B11 (data-pipelines) SMAP SPL3SMP_E **surface** moisture series into the pack (root zone documented as unavailable); "NASA vs model" evidence panel labelled indicative. `pipelines/smap/`, `api/app/services/nasa.py`, `web/src/features/results/NasaEvidence.tsx`.
- [x] B12 (data-pipelines) NDVI per site from `VNP13A1` v002 (500 m, 16-day) + bare-field/crop timeline check. Product choice and limits: `docs/ndvi-source.md`.
- [x] B21 (ai-agent) Deterministic agent orchestration over the real engine (`/agent/recommend`) with an optional LLM phrasing layer (`OPENAI_API_KEY`, never scoring).
- [x] B22 (rag) Source-grounded assistant (`/agent/ask`, `/knowledge/search`): BM25 over `knowledge/agronomy/*.md` + knowledge YAML, extractive answers with citations, explicit refusal when the corpus does not cover the question.
- [ ] B13 (data-pipelines) SoilGrids lookup cached into pack for demo sites; `services/soil.py` already parses it.
- [ ] B14 (frontend) Native Arabic review pass with a speaker; fix strings in `contracts/i18n/ar.json` + `web/src/i18n/ui.ar.json`.
- [ ] B15 (scene-3d) Lazy-load Babylon, measure FPS on a mid phone, tune tiers.
- [ ] B16 (frontend) Accessibility pass (focus order, contrast, aria for timeline).

## P2 - nice

- [ ] B17 Rice paddy ponding model. B18 Erosion/compaction indicators. B19 PDF/print summary of a result. B20 Per-region heat thresholds per crop.
