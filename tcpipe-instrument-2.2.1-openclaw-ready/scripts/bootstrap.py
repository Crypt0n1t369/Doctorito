#!/usr/bin/env python3
"""Repo-workflow wrapper around ``tcpipe.bootstrap``.

The real implementation lives in the package so that an installed ``tcpipe init`` works
without a source tree. This wrapper exists only for the in-repo verification flow.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tcpipe.bootstrap import bootstrap  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path)
    args = parser.parse_args()
    report = bootstrap(args.db, artifacts=args.artifacts)
    print(f"created {report['database']} with schema {report['schema_version']} "
          f"and validated seeds")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
