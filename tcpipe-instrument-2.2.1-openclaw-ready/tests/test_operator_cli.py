import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from .support import create_seeded_db
from tcpipe.operator_cli import main
from tcpipe.writer import artifact_set_hash, enqueue_job, finalize_fetch_attempt


class OperatorCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "operator.db"
        self.con = create_seeded_db(self.db)

    def tearDown(self):
        self.con.close()
        self.temp.cleanup()

    def run_cli(self, *args):
        output = io.StringIO()
        errors = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            status = main(list(args))
        return status, output.getvalue(), errors.getvalue()

    def create_observation(self):
        self.con.execute(
            """UPDATE source SET legal_review_state='approved',allowed_purpose='parser pilot',
                 last_legal_review_utc='2026-08-19T00:00:00Z' WHERE source_id='SRC-T'"""
        )
        self.con.execute(
            """UPDATE route SET policy_state='approved',robots_state='allowed',
                 robots_snapshot_sha=? WHERE route_id='RT-T'""",
            ("a" * 64,),
        )
        self.con.execute(
            """INSERT INTO source_policy_review
               (source_policy_review_id,source_id,decision,allowed_purpose,retention_period,
                reviewed_by,reviewed_at_utc) VALUES (?,?,?,?,?,?,?)""",
            ("SPR-OP", "SRC-T", "approved", "parser pilot", "90 days", "legal",
             "2026-08-19T00:00:00Z"),
        )
        self.con.execute(
            """INSERT INTO route_policy_review
               (route_policy_review_id,route_id,source_policy_review_id,decision,robots_state,
                robots_snapshot_sha,reviewed_by,reviewed_at_utc) VALUES (?,?,?,?,?,?,?,?)""",
            ("RPR-OP", "RT-T", "SPR-OP", "approved", "allowed", "a" * 64, "reviewer",
             "2026-08-19T00:00:00Z"),
        )
        self.con.execute(
            """INSERT INTO fetch_attempt
               (attempt_id,job_id,route_id,request_url,http_status,outcome,requested_at_utc,
                fetch_tier,fetcher_version,source_policy_review_id,route_policy_review_id,
                robots_snapshot_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("FA-OP", "J-1", "RT-T", "https://example.invalid/list", 200, "content_200",
             "2026-08-19T00:00:02Z", 1, "test", "SPR-OP", "RPR-OP", "a" * 64),
        )
        self.con.execute(
            "INSERT INTO fetch_attempt_artifact VALUES (?,?,?)",
            ("FA-OP", "a" * 64, "response_body"),
        )
        finalize_fetch_attempt(self.con, "FA-OP", finalized_at_utc="2026-08-19T00:00:03Z")
        self.con.execute(
            """INSERT INTO route_run
               (run_id,job_id,route_id,adapter_id,adapter_version,run_status,started_at_utc,
                count_quality) VALUES (?,?,?,?,?,?,?,?)""",
            ("RUN-OP", "J-1", "RT-T", "test__html", "1.0.0", "running",
             "2026-08-19T00:00:02Z", "not_published"),
        )
        self.con.execute("INSERT INTO route_run_fetch VALUES (?,?)", ("RUN-OP", "FA-OP"))
        input_hash = artifact_set_hash([("response_body", "a" * 64)])
        self.con.execute(
            "INSERT INTO parse_run VALUES (?,?,?,?,?,?,?,?,?)",
            ("PARSE-OP", "RUN-OP", "test__html", "1.0.0", input_hash, "test", "running",
             "2026-08-19T00:00:02Z", None),
        )
        self.con.execute(
            "INSERT INTO parse_run_artifact VALUES (?,?,?)",
            ("PARSE-OP", "a" * 64, "response_body"),
        )
        self.con.execute(
            "INSERT INTO source_record VALUES (?,?,?,?,?,?)",
            ("REC-OP", "PARSE-OP", "provider-op", 0, "css:.row", "2026-08-19T00:00:02Z"),
        )
        self.con.execute(
            "INSERT INTO field_observation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("OBS-OP", "REC-OP", "published_name", 0, "Wrong Nme", "Wrong Nme", "a" * 64,
             "css:.name", "Wrong Nme", "normalized", "accepted", "[]",
             "2026-08-19T00:00:02Z"),
        )

    def test_plain_instruction_is_idempotent_and_visible_in_status(self):
        args = (
            "enqueue", "--db", str(self.db), "--mission", "M-TEST", "--kind", "parse",
            "--instruction", "Parse the approved test route", "--route", "RT-T",
            "--acceptance", "one evidence-backed record", "--idempotency-key", "operator-test",
            "--git-commit", "abc", "--by", "operator", "--job-id", "J-OP",
        )
        status, output, _ = self.run_cli(*args)
        self.assertEqual(status, 0)
        self.assertTrue(json.loads(output)["created"])
        status, output, _ = self.run_cli(*args)
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output), {"created": False, "job_id": "J-OP"})
        status, output, _ = self.run_cli("status", "--db", str(self.db))
        self.assertEqual(status, 0)
        self.assertIn("attention", json.loads(output))

    def test_readiness_explains_policy_gate_without_mutation(self):
        before = self.con.total_changes
        status, output, errors = self.run_cli("readiness", "--db", str(self.db))
        self.assertEqual((status, errors), (0, ""))
        report = json.loads(output)
        self.assertEqual(report["route_count"], 1)
        self.assertEqual(report["policy_blocked_routes"], ["RT-T"])
        self.assertIn("approved_current_source_policy_review", report["routes"][0]["blockers"])
        self.assertEqual(self.con.total_changes, before)

    def test_fetch_claims_its_own_job_when_backlog_exists(self):
        self.create_observation()
        enqueue_job(
            self.con, job_id="J-BACKLOG", mission_id="M-TEST", kind="other",
            params={}, git_commit="abc", idempotency_key="backlog", priority=1,
        )
        artifacts = Path(self.temp.name) / "artifacts"
        with mock.patch("tcpipe.pipeline.fetch_route", return_value="FA-NEW"):
            status, output, errors = self.run_cli(
                "fetch", "--db", str(self.db), "--artifacts", str(artifacts),
                "--route", "RT-T", "--mission", "M-TEST", "--worker", "openclaw",
            )
        self.assertEqual((status, errors), (0, ""))
        job_id = json.loads(output)["job_id"]
        states = dict(self.con.execute(
            "SELECT job_id,status FROM job_queue WHERE job_id IN (?,?)",
            ("J-BACKLOG", job_id),
        ))
        self.assertEqual(states["J-BACKLOG"], "queued")
        self.assertEqual(states[job_id], "running")

    def test_manual_correction_preserves_source_and_opens_rule_review(self):
        self.create_observation()
        status, _, errors = self.run_cli(
            "correction-propose", "--db", str(self.db), "--observation", "OBS-OP",
            "--action", "replace_normalized", "--value", "Correct Name",
            "--scope", "route_template", "--reason", "Repeated source template typo confirmed",
            "--by", "operator", "--correction-id", "COR-OP",
        )
        self.assertEqual((status, errors), (0, ""))
        status, output, errors = self.run_cli(
            "correction-decide", "--db", str(self.db), "--correction", "COR-OP",
            "--decision", "accepted", "--by", "reviewer",
            "--rationale", "Checked linked official evidence", "--review-id", "REV-OP",
        )
        self.assertEqual((status, errors), (0, ""))
        self.assertEqual(json.loads(output)["rule_candidate_review_id"], "REV-OP")
        original = self.con.execute(
            "SELECT normalized_value FROM field_observation WHERE field_observation_id='OBS-OP'"
        ).fetchone()[0]
        effective = self.con.execute(
            """SELECT effective_normalized_value,effective_value_source,correction_id
                 FROM v_effective_field_observation WHERE field_observation_id='OBS-OP'"""
        ).fetchone()
        self.assertEqual(original, "Wrong Nme")
        self.assertEqual(tuple(effective), ("Correct Name", "manual_correction", "COR-OP"))
        review = self.con.execute(
            "SELECT review_kind,status FROM review_queue WHERE review_id='REV-OP'"
        ).fetchone()
        self.assertEqual(tuple(review), ("correction_rule_candidate", "pending"))
        status, _, _ = self.run_cli(
            "review-decide", "--db", str(self.db), "--review", "REV-OP",
            "--decision", "accepted", "--by", "adapter-reviewer",
            "--rationale", "No replay evidence supplied",
        )
        self.assertEqual(status, 2)
        self.assertEqual(
            self.con.execute("SELECT status FROM review_queue WHERE review_id='REV-OP'").fetchone()[0],
            "pending",
        )
        status, output, errors = self.run_cli(
            "review-decide", "--db", str(self.db), "--review", "REV-OP",
            "--decision", "accepted", "--by", "adapter-reviewer",
            "--rationale", "Golden fixture replay passed with stable row count",
            "--before-hash", "d" * 64, "--after-hash", "e" * 64,
            "--fixture-count", "1", "--affected", "1", "--row-delta", "0",
            "--rule-id", "CRULE-OP",
        )
        self.assertEqual((status, errors), (0, ""))
        self.assertEqual(json.loads(output)["correction_rule_id"], "CRULE-OP")
        self.con.execute(
            "INSERT INTO source_record VALUES (?,?,?,?,?,?)",
            ("REC-OP-2", "PARSE-OP", "provider-op-2", 1, "css:.row:nth(2)",
             "2026-08-19T00:00:02Z"),
        )
        self.con.execute(
            "INSERT INTO field_observation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("OBS-OP-2", "REC-OP-2", "published_name", 0, "Wrong Nme", "Wrong Nme",
             "a" * 64, "css:.name", "Wrong Nme", "normalized", "accepted", "[]",
             "2026-08-19T00:00:02Z"),
        )
        learned = self.con.execute(
            """SELECT effective_normalized_value,effective_value_source,correction_rule_id
                 FROM v_effective_field_observation WHERE field_observation_id='OBS-OP-2'"""
        ).fetchone()
        self.assertEqual(tuple(learned), ("Correct Name", "correction_rule", "CRULE-OP"))


if __name__ == "__main__":
    unittest.main()
