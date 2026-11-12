import json
import sys
from datetime import date, timedelta

import pytest
import yaml

from app import knowledge
from app.config import ROOT, get_settings
from app.engine.pipeline import run
from app.schemas.request import AnalysisRequest
from app.services.climate import get_climate

sys.path.insert(0, str(ROOT / "pipelines"))
import build_demo_packs as builder  # noqa: E402

REF = date(2026, 11, 12)
SITES = yaml.safe_load((ROOT / "knowledge" / "demo_sites.yaml").read_text(encoding="utf-8"))["sites"]


def _request(site, **extra):
    return AnalysisRequest(lat=site["lat"], lon=site["lon"], area_feddan=3, reference_date=REF, **site["preset"], **extra)


@pytest.mark.parametrize("site", SITES, ids=[s["id"] for s in SITES])
def test_every_demo_preset_is_a_valid_request(site):
    """A preset the API rejects would break the demo-site picker (this once happened for 6 of 27 sites)."""
    _request(site)  # schema: texture, irrigation, ... enums
    unknown = [h["crop"] for h in site["preset"].get("history", []) if h["crop"] not in knowledge.crops()]
    assert not unknown, f"{site['id']}: history crops not in knowledge/crops.yaml: {unknown}"


@pytest.mark.parametrize("site_id", ["kafr_el_sheikh", "gharbia", "nubaria", "minya", "fayoum", "matrouh"])
def test_main_demo_sites_produce_three_strategies(site_id):
    site = next(s for s in SITES if s["id"] == site_id)
    result = run(_request(site))
    assert [s["id"] for s in result["strategies"]] == ["existing", "primary", "contrast"]


@pytest.fixture()
def pack_dir(tmp_path, monkeypatch):
    """A real pack built by the real builder from a small POWER-shaped fixture, placed where the engine looks."""
    sys.path.insert(0, str(ROOT / "pipelines" / "tests"))
    from test_build_demo_packs import make_raw  # noqa: E402

    site = {"id": "fixture_site", "name_en": "Fixture", "lat": 30.79, "lon": 31.0}  # the API's default location
    raw_dir, out_dir = tmp_path / "raw", tmp_path / "packs" / "demo_sites"
    raw_dir.mkdir()
    raw = make_raw(PRECTOTCORR={0: 5.0})
    (raw_dir / "fixture_site.json").write_text(json.dumps(raw), encoding="utf-8")
    res = builder.build([site], raw_dir, out_dir)
    assert res["built"] == ["fixture_site"]
    monkeypatch.setattr(get_settings(), "packs_dir", tmp_path / "packs")
    return out_dir


def test_pack_replaces_synthetic_climate(pack_dir):
    days = [REF + timedelta(days=i) for i in range(30)]
    climate = get_climate(30.79, 31.0, days)
    assert climate.source == "pack"
    assert climate.pack_id == "fixture_site"
    assert climate.resolution_km == 50
    assert all(t == 30.0 for t in climate.tmax)  # the fixture's constant tmax came through


def test_pack_changes_what_the_result_says_about_its_data(pack_dir):
    result = run(AnalysisRequest(reference_date=REF))
    assert result["climate"]["source"] == "pack"
    assert next(n for n in result["nasa_data"] if n["id"] == "power")["status"] == "pack"
    assert "disclaimer.preview_data" not in result["disclaimers"]
    for s in result["strategies"]:
        factors = [f["key"] for f in s["confidence"]["factors"]]
        assert "conf.synthetic_climate" not in factors
        assert all(g["key"] != "gap.synthetic_climate" for g in s["gaps"])
        assert any(e["source"] == "power" for e in s["evidence"])


def test_without_a_pack_the_result_is_labelled_synthetic():
    result = run(AnalysisRequest(reference_date=REF))  # conftest points PACKS_DIR at an empty folder
    assert result["climate"]["source"] == "synthetic"
    assert "disclaimer.preview_data" in result["disclaimers"]
