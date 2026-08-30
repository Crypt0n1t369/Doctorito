#!/usr/bin/env python3
"""Compatibility entry point for the governed SQLite connection helper.

Application code should import ``tcpipe.db``. This wrapper remains for handoff users and
for the original documented self-test command.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from tcpipe.db import (  # noqa: E402,F401
    DatabasePreconditionError,
    assert_db_integrity,
    open_db,
    self_test,
)


if __name__ == "__main__":
    raise SystemExit(self_test())
