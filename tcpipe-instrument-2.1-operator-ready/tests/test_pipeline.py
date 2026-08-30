import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .pilot_support import PilotRoute
from .support import HAVE_PYPDF, ROOT
from tcpipe.adapter import load_rules
from tcpipe.audit import (
    AuditRequest,
    AuditError,
    clopper_pearson_lower,
    minimum_clean_sample,
    stratified_sample,
)
from tcpipe.materializer import MaterializationError, materialize_parse_run
from tcpipe.pipeline import run_route
from tcpipe.resources import adapter_path

CLEAN_AUDIT = AuditRequest(checker=lambda ids: 0, audited_by="pilot-qa")


class AuditMathTests(unittest.TestCase):
    def test_clopper_pearson_matches_known_values(self):
        self.assertAlmostEqual(clopper_pearson_lower(30, 0), 0.9050, places=3)
        self.assertAlmostEqual(clopper_pearson_lower(59, 0), 0.9505, places=3)
        self.assertAlmostEqual(clopper_pearson_lower(100, 1), 0.9534, places=3)
        self.assertEqual(clopper_pearson_lower(10, 10), 0.0)

    def test_small_clean_sample_cannot_buy_completion(self):
        # 30 of 30 correct feels conclusive and is not: the gate needs 0.95.
        self.assertLess(clopper_pearson_lower(30, 0), 0.95)
        self.assertEqual(minimum_clean_sample(), 59)

    def test_sampling_is_deterministic_across_replays(self):
        ids = [f"REC-{i:03d}" for i in range(200)]
        first = stratified_sample(ids, 60, seed="s")
        self.assertEqual(first, stratified_sample(ids, 60, seed="s"))
        self.assertNotEqual(first, stratified_sample(ids, 60, seed="other"))
        self.assertEqual(len(first), 60)

    def test_rejects_an_impossible_error_count(self):
        with self.assertRaises(AuditError):
            clopper_pearson_lower(10, 11)


class PipelineTestCase(unittest.TestCase):
    ADAPTER = "gwo__download"
    FIXTURE = ("gwo_providers.html", "text/html")
    ROUTE_KIND = "html_list"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = datetime.now(timezone.utc)
        self.pilot = PilotRoute(Path(self.temp.name), adapter_id=self.ADAPTER,
                                route_kind=self.ROUTE_KIND)
        self.sha = self.pilot.store_fixture(*self.FIXTURE)
        self.pilot.add_passing_fixture(self.sha)
        self.rules = load_rules(adapter_path(self.ADAPTER))
        self.sequence = 0

    def tearDown(self):
        self.pilot.close()
        self.temp.cleanup()

    def execute(self, *, shas=None, audit=CLEAN_AUDIT, rules=None, materialize=True):
        self.sequence += 1
        at = self.now - timedelta(minutes=30 - self.sequence)
        job = self.pilot.claim_job(f"J-{self.sequence}", at=at)
        attempt = self.pilot.record_stored_fetch(
            f"FA-{self.sequence}", job, shas or [self.sha], at=at
        )
        return run_route(self.pilot.con, self.pilot.store, self.pilot.context(job),
                         rules or self.rules, [attempt], route_kind=self.ROUTE_KIND,
                         base_url="https://assoc.invalid/", audit=audit,
                         materialize=materialize)

    def count(self, sql):
        return self.pilot.con.execute(sql).fetchone()[0]


class EndToEndTests(PipelineTestCase):
    def test_route_completes_with_evidence_for_every_materialized_field(self):
        report = self.execute()
        self.assertEqual(report.terminal_state, "complete_reconciled")
        self.assertEqual(report.extracted_count, 120)
        self.assertEqual(report.published_count, 120)
        self.assertEqual(report.audit["strategy"], "stratified_random")
        self.assertGreaterEqual(report.audit["accuracy_lower_cp"], 0.95)

        self.assertEqual(self.count("SELECT count(*) FROM centre"), 120)
        self.assertEqual(self.count("SELECT count(*) FROM centre_location"), 120)
        self.assertEqual(self.count("SELECT count(*) FROM accreditation"), 120)
        self.assertGreater(self.count("SELECT count(*) FROM offering"), 120)

        # the operator's actual question: location, courses, contact, all evidenced
        row = self.pilot.con.execute("""
            SELECT c.display_name, cl.locality, cl.country_iso2, cl.address_published,
                   (SELECT ct.contact_value FROM centre_contact ct
                     WHERE ct.centre_id=c.centre_id AND ct.contact_kind='org_phone' LIMIT 1) AS phone,
                   (SELECT count(*) FROM offering o WHERE o.centre_id=c.centre_id) AS courses
              FROM centre c JOIN centre_location cl ON cl.centre_id=c.centre_id
             ORDER BY c.display_name LIMIT 1""").fetchone()
        self.assertTrue(row["display_name"])
        self.assertTrue(row["locality"])
        self.assertTrue(row["phone"])
        self.assertGreaterEqual(row["courses"], 1)

        unlineaged = self.count("""
            SELECT count(*) FROM centre c WHERE NOT EXISTS (
              SELECT 1 FROM materialization_lineage ml
               WHERE ml.entity_kind='centre' AND ml.entity_id=c.centre_id)""")
        self.assertEqual(unlineaged, 0)

    def test_every_lineage_row_reaches_an_artifact_locator_and_quote(self):
        self.execute()
        weak = self.count("""
            SELECT count(*) FROM materialization_lineage ml
              JOIN field_observation fo ON fo.field_observation_id=ml.field_observation_id
             WHERE fo.artifact_sha256 IS NULL OR fo.field_locator='' OR fo.evidence_quote=''""")
        self.assertEqual(weak, 0)

    def test_unicode_survives_the_whole_pipeline(self):
        self.execute()
        localities = {r[0] for r in self.pilot.con.execute(
            "SELECT DISTINCT locality FROM centre_location")}
        self.assertIn("Rīga", localities)
        self.assertIn("Ålesund", localities)
        self.assertIn("Gdańsk", localities)

    def test_replay_of_unchanged_artifacts_creates_no_duplicates(self):
        first = self.execute()
        before = {t: self.count(f"SELECT count(*) FROM {t}") for t in
                  ("centre", "centre_location", "centre_contact", "accreditation",
                   "offering", "certificate", "artifact")}
        second = self.execute()
        after = {t: self.count(f"SELECT count(*) FROM {t}") for t in before}
        self.assertEqual(before, after, "replay must not duplicate governed entities")
        self.assertEqual(second.materialization.centres_created, 0)
        self.assertEqual(second.materialization.centres_matched, 120)
        self.assertEqual(first.terminal_state, second.terminal_state)

    def test_replay_still_records_the_new_evidence(self):
        self.execute()
        before = self.count("SELECT count(*) FROM materialization_lineage")
        self.execute()
        self.assertGreater(self.count("SELECT count(*) FROM materialization_lineage"), before,
                           "a second observation of the same field is corroboration, not noise")

    def test_default_contact_export_carries_only_lineaged_non_personal_rows(self):
        self.execute()
        exported = self.count("SELECT count(*) FROM v_export_centre_contact")
        self.assertEqual(exported, self.count(
            "SELECT count(*) FROM centre_contact WHERE is_personal_data=0"))
        self.assertGreater(exported, 0)


class DriftTests(PipelineTestCase):
    def _drifted_rules(self):
        rules = load_rules(adapter_path(self.ADAPTER))
        rules["fields"]["published_name"]["selector"] = {
            "primary": {"strategy": "css_text", "value": "td.renamed-by-the-site"},
            "fallback_policy": "required",
            "fallback_1": {"strategy": "css_text", "value": "td.provider-name"},
            "fallback_2": {"strategy": "xpath", "value": "./td[1]"}}
        return rules

    def test_selector_drift_quarantines_the_route_and_blocks_materialization(self):
        report = self.execute(rules=self._drifted_rules())
        self.assertEqual(report.parse_status, "quarantined_schema_drift")
        self.assertTrue(report.drift_detail)
        self.assertIsNone(report.materialization, "quarantined output must not be published")
        self.assertEqual(self.count("SELECT count(*) FROM centre"), 0)
        self.assertEqual(
            self.count("SELECT count(*) FROM escalation WHERE status='open'"), 1,
            "drift must raise an escalation for a human",
        )

    def test_quarantined_parse_cannot_be_materialized_directly(self):
        report = self.execute(rules=self._drifted_rules(), materialize=False)
        with self.assertRaises(MaterializationError):
            materialize_parse_run(self.pilot.con, report.parse_run_id, job_id="J-1")

    def test_drifted_data_is_still_captured_for_review(self):
        report = self.execute(rules=self._drifted_rules())
        self.assertGreater(self.count("SELECT count(*) FROM field_observation"), 0,
                           "drift preserves evidence; it only withholds publication")


class AuditGateTests(PipelineTestCase):
    def test_without_audit_evidence_a_run_cannot_complete(self):
        report = self.execute(audit=None)
        self.assertEqual(report.terminal_state, "unresolved")
        self.assertEqual(report.terminal_reason, "verification_gate_not_passed")

    def test_a_failing_audit_blocks_completion(self):
        noisy = AuditRequest(checker=lambda ids: len(ids) // 2, audited_by="pilot-qa")
        report = self.execute(audit=noisy)
        self.assertLess(report.audit["accuracy_lower_cp"], 0.95)
        self.assertEqual(report.terminal_state, "unresolved")

    def test_audit_evidence_is_immutable_once_written(self):
        report = self.execute()
        import sqlite3

        with self.assertRaises(sqlite3.IntegrityError):
            self.pilot.con.execute("UPDATE audit_sample SET n_errors=99 WHERE run_id=?",
                                   (report.run_id,))


class ArchetypeEndToEndTests(unittest.TestCase):
    """Every archetype must reach a terminal state through the real pipeline."""

    CASES = [
        ("osha__api", "osha_courses.json", "application/json", "json_api", 2),
        ("irata__html_paginated", "irata_members_p1.html", "text/html", "html_paginated", 2),
        ("iala__pdf", "iala_vts.pdf", "application/pdf", "pdf", 3),
        ("opito__js_app", "opito_centres.json", "application/json", "js_app", 2),
    ]

    def test_each_archetype_runs_end_to_end(self):
        for adapter_id, fixture, content_type, route_kind, expected in self.CASES:
            if adapter_id == "iala__pdf" and not HAVE_PYPDF:
                continue
            with self.subTest(adapter=adapter_id):
                with tempfile.TemporaryDirectory() as directory:
                    now = datetime.now(timezone.utc)
                    pilot = PilotRoute(Path(directory), adapter_id=adapter_id,
                                       route_kind=route_kind)
                    try:
                        sha = pilot.store_fixture(fixture, content_type)
                        pilot.add_passing_fixture(sha)
                        job = pilot.claim_job("J-1", at=now - timedelta(minutes=1))
                        attempt = pilot.record_stored_fetch(
                            "FA-1", job, [sha], at=now - timedelta(minutes=1)
                        )
                        report = run_route(
                            pilot.con, pilot.store, pilot.context(job),
                            load_rules(adapter_path(adapter_id)), [attempt],
                            route_kind=route_kind, base_url="https://assoc.invalid/",
                            audit=CLEAN_AUDIT,
                        )
                        self.assertEqual(report.parse_status, "parsed", report.drift_detail)
                        self.assertEqual(report.extracted_count, expected)
                        self.assertIsNotNone(report.materialization)
                        self.assertEqual(
                            pilot.con.execute("SELECT count(*) FROM centre").fetchone()[0],
                            expected,
                        )
                        # small samples cannot clear the accuracy gate, and must not pretend to
                        self.assertIn(report.terminal_state,
                                      ("complete_reconciled", "unresolved", "partial"))
                    finally:
                        pilot.close()


class OperatorCommandTests(PipelineTestCase):
    """The operator-facing path, driven exactly as a person would drive it."""

    def tcpipe(self, *args):
        return subprocess.run(
            [sys.executable, str(ROOT / "tcpipe"), *args],
            cwd=ROOT, capture_output=True, text=True,
            env={**os.environ, "PYTHONPATH": str(ROOT / "src"),
                 "PYTHONDONTWRITEBYTECODE": "1"},
        )

    def test_run_command_completes_a_route_and_reports_json(self):
        at = self.now - timedelta(minutes=5)
        job = self.pilot.claim_job("J-CLI", at=at)
        attempt = self.pilot.record_stored_fetch("FA-CLI", job, [self.sha], at=at)
        self.pilot.con.commit()

        result = self.tcpipe(
            "run", "--db", str(self.pilot.db_path),
            "--artifacts", str(self.pilot.store.root),
            "--route", "RT-P", "--attempt", attempt,
            "--mission", "M-PILOT", "--audit-errors", "0", "--audited-by", "cli-test",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["terminal_state"], "complete_reconciled")
        self.assertEqual(payload["extracted_count"], 120)
        self.assertEqual(payload["materialization"]["centres_created"], 120)

    def test_fetch_refuses_a_route_whose_policy_review_is_not_approved(self):
        # The seeded pilot universe is deliberately unapproved: G2 is an open gate. The
        # CLI must say so and stop BEFORE opening a socket.
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "seeded.db"
            subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "bootstrap.py"), "--db", str(db)],
                cwd=ROOT, check=True, stdout=subprocess.DEVNULL,
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
            )
            result = self.tcpipe("fetch", "--db", str(db), "--artifacts", directory,
                                 "--route", "RT-0001", "--mission", "M-120")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("G2", result.stderr + result.stdout)

    def test_run_refuses_attempts_that_do_not_exist(self):
        result = self.tcpipe("run", "--db", str(self.pilot.db_path),
                             "--artifacts", str(self.pilot.store.root),
                             "--route", "RT-P", "--attempt", "FA-NOPE")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no such fetch attempt", result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()
