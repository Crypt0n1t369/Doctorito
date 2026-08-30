import contextlib
import csv
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from .support import ROOT

spec = importlib.util.spec_from_file_location("audit", ROOT / "audit_referential_integrity.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def write_csv(path, fieldnames, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def make_pack(root: Path, *, swap=False, malformed_counter=False):
    current = root / "current"
    historical = root / "historical"
    master_fields = ["canonical_training_centre_id", "relationship_count", "location_count",
                     "association_count", "association_ids"]
    write_csv(current / "canonical-training-centre-master.csv", master_fields, [{
        "canonical_training_centre_id": "P1", "relationship_count": "0", "location_count": "0",
        "association_count": "bad" if malformed_counter else "0", "association_ids": ""
    }])
    write_csv(historical / "old-canonical-training-centre-master.csv",
              ["canonical_training_centre_id"], [{"canonical_training_centre_id": "P1"}])
    first, second = ("M2", "M1") if swap else ("M1", "M2")
    write_csv(current / "canonical-training-centre-source-crosswalk.csv",
              ["canonical_training_centre_id"], [{"canonical_training_centre_id": first}])
    write_csv(current / "authoritative-candidate-ledger.csv",
              ["canonical_match_id"], [{"canonical_match_id": second}])
    write_csv(current / "association-training-centre-relationships.csv", ["training_centre_id"], [])
    write_csv(current / "training-centre-locations.csv", ["training_centre_id"], [])
    write_csv(current / "training-centre-certificate-offerings.csv", ["training_centre_id"], [])


def run_report(root: Path):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = audit.main([str(root)])
    return code, json.loads(output.getvalue())


class AuditTests(unittest.TestCase):
    def test_complete_findings_hash_changes_when_assignments_change(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "a", Path(directory) / "b"
            make_pack(a)
            make_pack(b, swap=True)
            code_a, report_a = run_report(a)
            code_b, report_b = run_report(b)
            self.assertEqual((code_a, code_b), (1, 1))
            self.assertEqual(report_a["total_dangling_rows"], report_b["total_dangling_rows"])
            self.assertEqual(report_a["union_missing_ids"], report_b["union_missing_ids"])
            self.assertNotEqual(report_a["findings_hash"], report_b["findings_hash"])

    def test_missing_required_input_is_fatal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_pack(root)
            (root / "current/training-centre-certificate-offerings.csv").unlink()
            with self.assertRaises(audit.FatalInput):
                audit.main([str(root)])

    def test_counter_error_makes_audit_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_pack(root, malformed_counter=True)
            code, report = run_report(root)
            self.assertEqual(code, 1)
            self.assertEqual(report["counter_error_count"], 1)

    def test_unknown_allow_missing_name_is_fatal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_pack(root)
            with self.assertRaises(audit.FatalInput):
                audit.main([str(root), "--allow-missing", "typo"])


if __name__ == "__main__":
    unittest.main()
