import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["PACKS_DIR"] = f"{_tmp}/packs"  # no packs: forces the synthetic climate
