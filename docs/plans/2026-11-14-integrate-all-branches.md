# Implementation Plan: Integrate All Branches into Ahmed

**Date:** 2026-11-14  
**Task:** Multi-branch unification (nada-branch, ai-agent, jewidan's-branch into Ahmed)  
**Scope:** `api/`, `contracts/`, `data/packs/`, `knowledge/`, `pipelines/`, `web/`, `docs/`

## 1. Context & Objectives
Four branches were developed concurrently for NASA Space Apps 2026 "Field Shift: Adapting Farms with NASA Data":
- **`Ahmed` (Current)**: 3D agricultural and subterranean soil simulation in Babylon.js (sky-to-soil dive, 3D cattle, date palms, horizon textures, camera focus, clear sky).
- **`origin/nada-branch`**: Multi-year historical climate uncertainty engine (P10/P50/P90 distributions, rank stability), SoilGrids profile integration, and 27 governorate demo packs.
- **`origin/ai-agent`**: RAG and AI agronomy assistant agent, NASA SMAP/NDVI evidence processing pipelines, frontend `AgentPanel` and `NasaEvidence` panels, and expert review packet.
- **`origin/jewidan's-branch`**: Meta Astryx landing page overhaul, Unlabeled Relief Map of Egypt with 27 interactive governorate pins, Google sign-in modal, and email-gated simulation access.

Goal: Safely and systematically integrate all three feature branches into `Ahmed`, preserving every feature without regressions, resolving schema and code collisions cleanly, and passing all definition-of-done quality gates.

## 2. Integration Architecture & Phasing
To prevent complex multi-way conflict knots, we execute a staged, layered merge:

1. **Step 0: Safety & Preparation**
   - Create safety branch `backup/ahmed-pre-merge`.
   - Create working branch `integrate/all-branches` from `Ahmed`.

2. **Step 1: Merge `origin/nada-branch` (Backend Physics & Uncertainty)**
   - Merge `origin/nada-branch`.
   - Reconcile `contracts/result.schema.json`, `api/app/engine/pipeline.py`, `api/app/services/climate.py`.
   - Retain Ahmed's 3D scene files in `web/src/scene/`.
   - Gate 1: Run engine tests (`pytest api/tests/engine/`).

3. **Step 2: Merge `origin/ai-agent` (Agent, RAG & NASA Evidence)**
   - Merge `origin/ai-agent`.
   - Combine schema changes (`uncertainty` + `nasa_evidence`), attach `nasa.build` to `pipeline.py`.
   - Reconcile i18n catalogs (`contracts/i18n/`, `web/src/i18n/`).
   - Merge demo packs in `data/packs/demo_sites/` ensuring both SoilGrids data and SMAP/NDVI observations are preserved.
   - Gate 2: Run agent and evidence tests (`pytest api/tests/test_agent.py api/tests/test_nasa_evidence.py`).

4. **Step 3: Merge `origin/jewidan's-branch` (Landing Page, Egypt Map & Auth)**
   - Merge `origin/jewidan's-branch`.
   - Reconcile `web/src/App.tsx`, `web/src/styles/app.css`, and `web/src/state/store.ts`.
   - Preserve 3D models (`web/public/models/cow.glb`, textures) and `SceneController.ts`.
   - Check and maintain Arabic/English i18n parity (`python scripts/check_i18n.py`).
   - Gate 3: Web typecheck and production build (`npm run typecheck && npm run build`).

5. **Step 4: Global Verification & Finalization**
   - Run complete test suite: `pytest -q`, `ruff check .`, `python scripts/check_i18n.py`, `npm run build`.
   - Update `docs/tasks/BACKLOG.md`.
   - Merge `integrate/all-branches` cleanly into `Ahmed`.
