from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # repo root locally, /srv in the container


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    values: dict[str, str] = {}
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()  # later lines win inside the file
    for k, v in values.items():
        os.environ.setdefault(k, v)  # real environment still wins


class Settings:
    def __init__(self) -> None:
        _load_dotenv()
        self.knowledge_dir = Path(os.environ.get("KNOWLEDGE_DIR", ROOT / "knowledge"))
        self.contracts_dir = Path(os.environ.get("CONTRACTS_DIR", ROOT / "contracts"))
        self.packs_dir = Path(os.environ.get("PACKS_DIR", ROOT / "data" / "packs"))
        db = os.environ.get("DATABASE_URL", f"sqlite:///{ROOT / 'data' / 'app.db'}")
        self.db_path = db.replace("sqlite:///", "", 1)
        self.cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
