# Backlog (status: [ ] todo, [~] doing, [x] done). Deadline 14 Nov 2026; NASA data ~12 Nov.

## P0 - must ship
- [ ] B1 (data-pipelines) POWER fetcher: daily T2M_MAX/MIN, PRECTOTCORR, ALLSKY_SFC_SW_DWN, RH2M, WS2M for each demo site, 2000-2025, no login. Output raw to `data/raw/power/`.
- [ ] B2 (data-pipelines) `pipelines/earthdata/check_access.py`: verify token works, list granules for SPL3SMP_E and GPM_3IMERGDF over a demo site. See `docs/earthdata-setup.md`.
- [x] B3 (data-pipelines) `pipelines/build_demo_packs.py` (done 12 Nov: 27 packs from POWER 2000-2025, 13 tests; run `make packs`). Original text: `build_demo_packs.py`: merge raw into `data/packs/demo_sites/<id>.json` (schema in `docs/data-sources.md`); engine already loads packs via `api/app/services/climate.py` (analog-year lookup). Add a test with a fixture.
- [x] B4 (rotation-engine) (already in the engine; covered by api/tests/engine/test_demo_sites_and_packs.py) When a pack is present: status "pack" per product in `nasa_data`, higher confidence, remove `gap.synthetic_climate`.
- [ ] B5 (rotation-engine + experts) Replace `reviewed:false` crop params after expert review (`docs/expert-review.md`). Add a source per value.
- [ ] B6 (frontend) Shareable link route `/a/:id`, copy button, load via GET /analyses/{id}.
- [ ] B7 (frontend) Demo-site picker on landing (from /demo-sites) + "use my own field" map click.
- [ ] B8 (devops) Deploy on OCI: check ports (`ss -tlnp`), Caddy vhost, HTTPS, `docker compose up -d --build` on arm64, smoke test.
- [ ] B9 (docs-pitch) Submission text, 30-60 s video script, AI-use disclosure (`docs/pitch/`).
- [ ] B10 (reviewer) Challenge checklist pass (`docs/challenge-checklist.md`).

## P1 - should
- [ ] B11 (data-pipelines) SMAP SPL3SMP_E root/surface moisture series into the pack; compare to simulated moisture in an evidence panel ("NASA vs model", labelled indicative).
- [ ] B12 (data-pipelines) NDVI (HLS or MOD13Q1, else AppEEARS) per site; show bare-field vs crop timeline check.
- [ ] B13 (data-pipelines) SoilGrids lookup cached into pack for demo sites; `services/soil.py` already parses it.
- [ ] B14 (frontend) Native Arabic review pass with a speaker; fix strings in `contracts/i18n/ar.json` + `web/src/i18n/ui.ar.json`.
- [ ] B15 (scene-3d) Lazy-load Babylon, measure FPS on a mid phone, tune tiers.
- [ ] B16 (frontend) Accessibility pass (focus order, contrast, aria for timeline).

## P2 - nice
- [ ] B17 Rice paddy ponding model. B18 Erosion/compaction indicators. B19 PDF/print summary of a result. B20 Per-region heat thresholds per crop.
