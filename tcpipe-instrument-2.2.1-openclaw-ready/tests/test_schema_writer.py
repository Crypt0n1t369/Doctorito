import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .support import create_seeded_db
from tcpipe.writer import (
    WriterConflict,
    artifact_set_hash,
    register_artifact,
    claim_job,
    claim_next_job,
    enqueue_job,
    finalize_fetch_attempt,
    finalize_parse_run,
    finalize_route_run,
    freeze_universe,
    heartbeat_job,
    recover_expired_jobs,
)


class SchemaWriterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.con = create_seeded_db(Path(self.temp.name) / "test.db")

    def tearDown(self):
        self.con.close()
        self.temp.cleanup()

    def test_bogus_mission_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            enqueue_job(self.con, job_id="J-X", mission_id="M-NOPE", kind="x", params={},
                        git_commit="abc", idempotency_key="bogus")

    def test_job_enqueue_is_idempotent(self):
        self.assertFalse(enqueue_job(
            self.con, job_id="J-DUP", mission_id="M-TEST", kind="parse", params={},
            git_commit="abc", idempotency_key="test-job",
        ))

    def test_named_claim_does_not_steal_an_older_backlog_job(self):
        enqueue_job(
            self.con, job_id="J-OLDER", mission_id="M-TEST", kind="queued",
            params={}, git_commit="abc", idempotency_key="older", priority=1,
        )
        enqueue_job(
            self.con, job_id="J-TARGET", mission_id="M-TEST", kind="fetch",
            params={}, git_commit="abc", idempotency_key="target", priority=100,
        )

        claimed = claim_job(
            self.con, "J-TARGET", "operator",
            now="2026-08-19T00:00:02.000Z", lease_seconds=60,
        )

        self.assertEqual(claimed["job_id"], "J-TARGET")
        statuses = dict(self.con.execute(
            "SELECT job_id,status FROM job_queue WHERE job_id IN ('J-OLDER','J-TARGET')"
        ))
        self.assertEqual(statuses, {"J-OLDER": "queued", "J-TARGET": "running"})

    def test_expired_worker_lease_is_retried_then_failed_at_attempt_limit(self):
        self.assertTrue(enqueue_job(
            self.con, job_id="J-LEASE", mission_id="M-TEST", kind="parse", params={},
            git_commit="abc", idempotency_key="lease-job", max_attempts=2,
        ))
        claimed = claim_next_job(
            self.con, "worker-a", now="2026-08-19T00:01:00.000Z", lease_seconds=10
        )
        self.assertEqual(claimed["job_id"], "J-LEASE")
        heartbeat_job(
            self.con, "J-LEASE", "worker-a", now="2026-08-19T00:01:05.000Z",
            lease_seconds=10,
        )
        self.assertEqual(
            recover_expired_jobs(self.con, now="2026-08-19T00:01:10.000Z"), (0, 0)
        )
        self.assertEqual(
            recover_expired_jobs(self.con, now="2026-08-19T00:01:16.000Z"), (1, 0)
        )
        claim_next_job(
            self.con, "worker-b", now="2026-08-19T00:01:17.000Z", lease_seconds=10
        )
        self.assertEqual(
            recover_expired_jobs(self.con, now="2026-08-19T00:01:28.000Z"), (0, 1)
        )
        row = self.con.execute("SELECT status,attempt_count FROM job_queue WHERE job_id='J-LEASE'").fetchone()
        self.assertEqual(tuple(row), ("failed", 2))

    def test_route_has_no_direct_state_column(self):
        names = {row[1] for row in self.con.execute("PRAGMA table_info(route)")}
        self.assertNotIn("route_state", names)

    def test_artifact_metadata_is_immutable(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute("UPDATE artifact SET byte_len=2 WHERE sha256=?", ("a" * 64,))

    def approve_test_route(self, reviewed_at_utc="2026-08-19T00:00:00Z"):
        self.con.execute(
            """UPDATE source SET legal_review_state='approved',allowed_purpose='parser pilot',
                 last_legal_review_utc=? WHERE source_id='SRC-T'""",
            (reviewed_at_utc,),
        )
        self.con.execute(
            """UPDATE route SET policy_state='approved',robots_state='allowed',robots_snapshot_sha=?
               WHERE route_id='RT-T'""", ("a" * 64,)
        )
        self.con.execute(
            """INSERT OR IGNORE INTO source_policy_review
               (source_policy_review_id,source_id,decision,terms_url,license_basis,
                allowed_purpose,retention_period,data_categories_json,reviewed_by,reviewed_at_utc)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            ("SPR-T-1", "SRC-T", "approved", "https://example.invalid/terms", "permission",
             "parser pilot", "90 days", '["public organisation data"]', "legal-reviewer",
             reviewed_at_utc),
        )
        self.con.execute(
            """INSERT OR IGNORE INTO route_policy_review
               (route_policy_review_id,route_id,source_policy_review_id,decision,robots_state,
                robots_snapshot_sha,reviewed_by,reviewed_at_utc)
               VALUES (?,?,?,?,?,?,?,?)""",
            ("RPR-T-1", "RT-T", "SPR-T-1", "approved", "allowed", "a" * 64,
             "route-reviewer", reviewed_at_utc),
        )

    def create_finalized_fetch(self, attempt_id="FA-RUN", *, outcome="content_200", tier=1,
                               roles=("response_body",)):
        self.approve_test_route()
        self.con.execute(
            """INSERT INTO fetch_attempt
               (attempt_id,job_id,route_id,request_url,http_status,outcome,requested_at_utc,
                fetch_tier,fetcher_version,etag,source_policy_review_id,route_policy_review_id,
                robots_snapshot_sha)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (attempt_id, "J-1", "RT-T", "https://example.invalid/list",
             304 if outcome == "not_modified_304" else 200, outcome,
             "2026-08-19T00:00:02Z", tier, "test",
             '"etag-1"' if outcome == "not_modified_304" else None,
             "SPR-T-1", "RPR-T-1", "a" * 64),
        )
        for role in roles:
            self.con.execute(
                "INSERT INTO fetch_attempt_artifact VALUES (?,?,?)",
                (attempt_id, "a" * 64, role),
            )
        finalize_fetch_attempt(self.con, attempt_id, finalized_at_utc="2026-08-19T00:00:03Z")

    def test_fetch_is_blocked_until_legal_policy_and_robots_are_approved(self):
        values = ("FA-1", "J-1", "RT-T", "https://example.invalid/list", 200,
                  "content_200", "2026-08-19T00:00:02Z", 1, "test",
                  "SPR-T-1", "RPR-T-1", "a" * 64)
        sql = """INSERT INTO fetch_attempt
                 (attempt_id,job_id,route_id,request_url,http_status,outcome,requested_at_utc,
                  fetch_tier,fetcher_version,source_policy_review_id,route_policy_review_id,
                  robots_snapshot_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"""
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute(sql, values)
        self.approve_test_route()
        self.con.execute(sql, values)
        with self.assertRaises(sqlite3.IntegrityError):
            finalize_fetch_attempt(self.con, "FA-1", finalized_at_utc="2026-08-19T00:00:03Z")
        self.con.execute(
            "INSERT INTO fetch_attempt_artifact VALUES (?,?,?)",
            ("FA-1", "a" * 64, "response_body"),
        )
        finalize_fetch_attempt(self.con, "FA-1", finalized_at_utc="2026-08-19T00:00:03Z")
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute("UPDATE fetch_attempt SET http_status=201 WHERE attempt_id='FA-1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute(
                "UPDATE source_policy_review SET decision='rejected' WHERE source_policy_review_id='SPR-T-1'"
            )

    def test_tier2_and_304_fetches_require_replayable_artifacts(self):
        self.create_finalized_fetch("FA-BASE")
        self.create_finalized_fetch(
            "FA-T2", tier=2, roles=("rendered_dom", "screenshot")
        )
        self.create_finalized_fetch(
            "FA-304", outcome="not_modified_304", roles=("reused_body",)
        )
        self.assertEqual(
            self.con.execute(
                "SELECT count(*) FROM fetch_attempt WHERE is_finalized=1"
            ).fetchone()[0],
            3,
        )

    def test_universe_freeze_is_gated_and_membership_becomes_immutable(self):
        self.con.execute(
            "INSERT INTO source_universe VALUES (?,?,?,?,?,?)",
            ("U-T", 1, "Test denominator", "draft", "2026-08-19T00:00:00Z", None),
        )
        self.con.execute("INSERT INTO universe_source VALUES (?,?,?,?,?)",
                         ("U-T", "SRC-T", "candidate", None, None))
        self.con.execute("INSERT INTO universe_route VALUES (?,?,?,?,?,?,?,?)",
                         ("U-T", "RT-T", "candidate", None, None, None, None, None))
        with self.assertRaises(sqlite3.IntegrityError):
            freeze_universe(self.con, "U-T", frozen_at_utc="2026-08-19T00:00:01Z")
        self.approve_test_route()
        self.con.execute(
            """UPDATE universe_source SET eligibility='eligible',source_policy_review_id='SPR-T-1'
               WHERE universe_id='U-T'"""
        )
        self.con.execute(
            """UPDATE universe_route SET eligibility='eligible',expected_records=1,
                 expected_basis='published count',expected_as_of_utc='2026-08-19T00:00:00Z',
                 route_policy_review_id='RPR-T-1'
               WHERE universe_id='U-T'"""
        )
        freeze_universe(self.con, "U-T", frozen_at_utc="2026-08-19T00:00:01Z")
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute("DELETE FROM universe_route WHERE universe_id='U-T'")

    def test_adapter_without_fixture_cannot_be_activated(self):
        self.con.execute(
            "INSERT INTO adapter VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("bad__adapter", "1.0.0", "rules", "d" * 64, None, None, "human", 1, None,
             "2026-08-19T00:00:00Z"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute(
                "UPDATE route SET active_adapter_id='bad__adapter',active_adapter_version='1.0.0'"
            )

    def test_operational_view_demotes_expired_complete_run_to_stale(self):
        enqueue_job(
            self.con, job_id="J-OLD", mission_id="M-TEST", kind="parse", params={},
            git_commit="abc", idempotency_key="old-run-job",
        )
        claim_next_job(
            self.con, "worker-old", now="2026-01-01T00:00:00.000Z",
            lease_seconds=3 * 24 * 60 * 60,
        )
        self.con.execute(
            """INSERT INTO route_run
               (run_id,job_id,route_id,run_status,started_at_utc,count_quality)
               VALUES (?,?,?,?,?,?)""",
            ("RUN-OLD", "J-OLD", "RT-T", "running", "2026-01-01T00:00:00Z", "not_published"),
        )
        self.con.execute(
            """UPDATE route_run SET run_status='completed',finished_at_utc='2026-01-02T00:00:00Z',
                 terminal_state='complete_count_unpublished',terminal_reason='test',
                 terminal_calculator_version='2.1.0' WHERE run_id='RUN-OLD'"""
        )
        self.con.execute(
            "INSERT INTO route_current_run VALUES (?,?,?)",
            ("RT-T", "RUN-OLD", "2026-01-02T00:00:00Z"),
        )
        row = self.con.execute(
            "SELECT stored_terminal_state,terminal_state FROM v_route_current_status WHERE route_id='RT-T'"
        ).fetchone()
        self.assertEqual(tuple(row), ("complete_count_unpublished", "stale"))

    def test_writer_computes_and_publishes_terminal_state(self):
        self.create_finalized_fetch()
        self.con.execute(
            """INSERT INTO route_run
               (run_id,job_id,route_id,adapter_id,adapter_version,run_status,started_at_utc,
                freshness_state,published_count,count_quality,extracted_count,structural_count,
                container_resolved,variance_status,audit_strategy,audit_sampled_count,audit_error_count)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("RUN-1", "J-1", "RT-T", "test__html", "1.0.0", "running",
             "2026-08-19T00:00:02Z", "fresh", 1, "published", 1, 1, 1, "reconciled",
             "exhaustive", 1, 0),
        )
        with self.assertRaises(WriterConflict):
            finalize_route_run(self.con, "RUN-1", finished_at_utc="2026-08-19T00:00:03Z")
        self.con.execute("INSERT INTO route_run_fetch VALUES (?,?)", ("RUN-1", "FA-RUN"))
        inputs_hash = artifact_set_hash([("response_body", "a" * 64)])
        self.con.execute(
            "INSERT INTO parse_run VALUES (?,?,?,?,?,?,?,?,?)",
            ("PARSE-1", "RUN-1", "test__html", "1.0.0", inputs_hash, "test-parser",
             "running", "2026-08-19T00:00:02Z", None),
        )
        self.con.execute(
            "INSERT INTO parse_run_artifact VALUES (?,?,?)",
            ("PARSE-1", "a" * 64, "response_body"),
        )
        self.con.execute(
            "INSERT INTO source_record VALUES (?,?,?,?,?,?)",
            ("REC-1", "PARSE-1", "provider-1", 0, "css:.row:nth(1)",
             "2026-08-19T00:00:02Z"),
        )
        self.con.execute(
            "INSERT INTO field_observation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("OBS-1", "REC-1", "published_name", 0, "Example Centre", "Example Centre",
             "a" * 64, "css:.name", "Example Centre", "normalized", "accepted", "[]",
             "2026-08-19T00:00:02Z"),
        )
        self.assertEqual(
            finalize_parse_run(self.con, "PARSE-1", finished_at_utc="2026-08-19T00:00:03Z"),
            1,
        )
        self.con.execute(
            "INSERT INTO audit_sample VALUES (?,?,?,?,?,?,?,?)",
            ("RUN-1", "exhaustive", 1, 0, None, "[]", "auditor",
             "2026-08-19T00:00:02Z"),
        )
        state, _ = finalize_route_run(self.con, "RUN-1", finished_at_utc="2026-08-19T00:00:03Z")
        self.assertEqual(state, "complete_reconciled")
        row = self.con.execute("SELECT * FROM v_route_current_status WHERE route_id='RT-T'").fetchone()
        self.assertEqual(row["terminal_state"], "complete_reconciled")
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute("UPDATE audit_sample SET n_errors=1 WHERE run_id='RUN-1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute("UPDATE route_run SET terminal_reason='changed' WHERE run_id='RUN-1'")

    # ---- helpers for multi-run scenarios --------------------------------------------

    @staticmethod
    def ts(moment):
        return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def run_over_fetch(self, suffix, *, fetched_at, started_at, finished_at, records=0,
                       lease_seconds=86400, **run_columns):
        """Drive one complete route run whose content was fetched at ``fetched_at``."""
        self.approve_test_route(reviewed_at_utc="2020-01-01T00:00:00Z")
        job, attempt = f"J-{suffix}", f"FA-{suffix}"
        run, parse = f"RUN-{suffix}", f"PARSE-{suffix}"
        enqueue_job(self.con, job_id=job, mission_id="M-TEST", kind="parse", params={},
                    git_commit="abc", idempotency_key=f"key-{suffix}")
        claim_next_job(self.con, f"worker-{suffix}", now=self.ts(fetched_at),
                       lease_seconds=lease_seconds)
        self.con.execute(
            """INSERT INTO fetch_attempt
               (attempt_id,job_id,route_id,request_url,http_status,outcome,requested_at_utc,
                fetch_tier,fetcher_version,source_policy_review_id,route_policy_review_id,
                robots_snapshot_sha)
               VALUES (?,?,'RT-T','https://example.invalid/list',200,'content_200',?,1,'test',
                       'SPR-T-1','RPR-T-1',?)""",
            (attempt, job, self.ts(fetched_at), "a" * 64),
        )
        self.con.execute("INSERT INTO fetch_attempt_artifact VALUES (?,?,'response_body')",
                         (attempt, "a" * 64))
        finalize_fetch_attempt(self.con, attempt, finalized_at_utc=self.ts(fetched_at))
        columns = dict(count_quality="not_published", extracted_count=records,
                       structural_count=records, container_resolved=1)
        columns.update(run_columns)
        names = ",".join(columns)
        self.con.execute(
            f"""INSERT INTO route_run (run_id,job_id,route_id,adapter_id,adapter_version,
                  run_status,started_at_utc,{names})
                VALUES (?,?,'RT-T','test__html','1.0.0','running',?,
                        {",".join("?" * len(columns))})""",
            (run, job, self.ts(started_at), *columns.values()),
        )
        self.con.execute("INSERT INTO route_run_fetch VALUES (?,?)", (run, attempt))
        self.con.execute(
            "INSERT INTO parse_run VALUES (?,?,'test__html','1.0.0',?,'test-parser','running',?,NULL)",
            (parse, run, artifact_set_hash([("response_body", "a" * 64)]), self.ts(started_at)),
        )
        self.con.execute("INSERT INTO parse_run_artifact VALUES (?,?,'response_body')",
                         (parse, "a" * 64))
        for index in range(records):
            self.con.execute("INSERT INTO source_record VALUES (?,?,?,?,'css:.row',?)",
                             (f"REC-{suffix}-{index}", parse, f"key-{index}", index,
                              self.ts(started_at)))
            self.con.execute(
                """INSERT INTO field_observation VALUES (?,?,'published_name',0,'X','X',?,
                   'css:.n','X','normalized','accepted','[]',?)""",
                (f"OBS-{suffix}-{index}", f"REC-{suffix}-{index}", "a" * 64,
                 self.ts(started_at)),
            )
        finalize_parse_run(self.con, parse, finished_at_utc=self.ts(finished_at))
        return run

    # ---- regression coverage ---------------------------------------------------------

    def test_freshness_is_aged_from_fetch_time_not_from_finalization(self):
        # refetch_days is 30, so the documented window is 2 x 30 = 60 days. A run finalized
        # 59 days ago over content fetched 119 days ago must not buy a second window.
        now = datetime.now(timezone.utc)
        fetched_at = now - timedelta(days=119)
        finished_at = now - timedelta(days=59)
        run = self.run_over_fetch(
            "OLDFETCH", fetched_at=fetched_at, started_at=finished_at - timedelta(seconds=1),
            finished_at=finished_at, records=1, lease_seconds=200 * 86400,
            published_count=1, variance_status="reconciled", audit_strategy="exhaustive",
            audit_sampled_count=1, audit_error_count=0, count_quality="published",
        )
        self.con.execute("INSERT INTO audit_sample VALUES (?,'exhaustive',1,0,NULL,'[]','a',?)",
                         (run, self.ts(finished_at - timedelta(seconds=1))))
        state, _ = finalize_route_run(self.con, run, finished_at_utc=self.ts(finished_at))
        self.assertEqual(state, "complete_reconciled")
        row = self.con.execute(
            "SELECT * FROM v_route_current_status WHERE route_id='RT-T'"
        ).fetchone()
        self.assertEqual(row["stored_terminal_state"], "complete_reconciled")
        self.assertEqual(row["terminal_state"], "stale")
        self.assertEqual(row["content_fetched_at_utc"], self.ts(fetched_at))

    def test_blocked_prior_run_is_not_evidence_of_emptiness(self):
        now = datetime.now(timezone.utc)
        earlier = now - timedelta(days=3)
        enqueue_job(self.con, job_id="J-BLK", mission_id="M-TEST", kind="parse", params={},
                    git_commit="abc", idempotency_key="blocked")
        claim_next_job(self.con, "worker-blk", now=self.ts(earlier), lease_seconds=10 * 86400)
        self.con.execute(
            """INSERT INTO route_run (run_id,job_id,route_id,run_status,started_at_utc,
                 access_status,count_quality,extracted_count,structural_count,container_resolved)
               VALUES ('RUN-BLK','J-BLK','RT-T','running',?,'blocked_access','not_published',
                       0,0,1)""",
            (self.ts(earlier),),
        )
        blocked, _ = finalize_route_run(
            self.con, "RUN-BLK", finished_at_utc=self.ts(earlier + timedelta(seconds=1))
        )
        self.assertEqual(blocked, "blocked_access")

        run = self.run_over_fetch("EMPTY1", fetched_at=now - timedelta(seconds=60),
                                  started_at=now - timedelta(seconds=60),
                                  finished_at=now - timedelta(seconds=30))
        self.con.execute(
            "INSERT INTO empty_verification_evidence VALUES (?,'second_structural_count',NULL,NULL,NULL,?)",
            (run, self.ts(now - timedelta(seconds=60))),
        )
        self.con.execute("INSERT INTO run_corroboration VALUES (?,'second_parser','{}','p',?)",
                         (run, self.ts(now - timedelta(seconds=60))))
        state, reason = finalize_route_run(self.con, run, finished_at_utc=self.ts(now))
        self.assertEqual((state, reason), ("unresolved", "empty_not_corroborated"))

    def test_genuine_prior_empty_observation_still_reaches_verified_empty(self):
        now = datetime.now(timezone.utc)
        earlier = now - timedelta(days=2)
        first = self.run_over_fetch("EMPTYA", fetched_at=earlier, started_at=earlier,
                                    finished_at=earlier + timedelta(seconds=1))
        state, reason = finalize_route_run(
            self.con, first, finished_at_utc=self.ts(earlier + timedelta(seconds=1))
        )
        self.assertEqual((state, reason), ("unresolved", "empty_not_corroborated"))

        second = self.run_over_fetch("EMPTYB", fetched_at=now - timedelta(seconds=60),
                                     started_at=now - timedelta(seconds=60),
                                     finished_at=now - timedelta(seconds=30))
        self.con.execute(
            "INSERT INTO empty_verification_evidence VALUES (?,'second_structural_count',NULL,NULL,NULL,?)",
            (second, self.ts(now - timedelta(seconds=60))),
        )
        self.con.execute("INSERT INTO run_corroboration VALUES (?,'second_parser','{}','p',?)",
                         (second, self.ts(now - timedelta(seconds=60))))
        state, reason = finalize_route_run(self.con, second, finished_at_utc=self.ts(now))
        self.assertEqual((state, reason),
                         ("verified_empty", "deterministically_corroborated_empty"))

    def test_artifact_registration_rejects_conflicting_metadata(self):
        register_artifact(self.con, sha256="d" * 64, byte_len=5, storage_path="/artifacts/d",
                          content_type="application/pdf")
        register_artifact(self.con, sha256="d" * 64, byte_len=5, storage_path="/artifacts/d",
                          content_type="application/pdf")
        for field, value in (("content_type", "text/html"), ("byte_len", 6),
                             ("storage_path", "/artifacts/elsewhere")):
            kwargs = dict(sha256="d" * 64, byte_len=5, storage_path="/artifacts/d",
                          content_type="application/pdf")
            kwargs[field] = value
            with self.subTest(field=field), self.assertRaises(WriterConflict):
                register_artifact(self.con, **kwargs)

    def test_audit_bound_contradicting_its_error_count_is_rejected(self):
        self.con.execute(
            """INSERT INTO route_run (run_id,job_id,route_id,run_status,started_at_utc,
                 count_quality) VALUES ('RUN-AUD','J-1','RT-T','running',
                 '2026-08-19T00:00:02Z','not_published')"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute(
                "INSERT INTO audit_sample VALUES ('RUN-AUD','stratified_random',10,10,0.99,'[]','a',?)",
                ("2026-08-19T00:00:02Z",),
            )
        self.con.execute(
            "INSERT INTO audit_sample VALUES ('RUN-AUD','stratified_random',10,0,0.96,'[]','a',?)",
            ("2026-08-19T00:00:02Z",),
        )

    def test_coverage_reports_how_much_of_its_denominator_is_unknown(self):
        self.con.execute(
            "INSERT INTO source_universe VALUES ('U-T','1','scope','draft','2026-08-19T00:00:00Z',NULL)"
        )
        self.approve_test_route()
        self.con.execute(
            """INSERT INTO universe_route (universe_id,route_id,eligibility,expected_records,
                 expected_basis,route_policy_review_id)
               VALUES ('U-T','RT-T','eligible',NULL,NULL,'RPR-T-1')"""
        )
        row = self.con.execute("SELECT * FROM v_universe_coverage WHERE universe_id='U-T'").fetchone()
        self.assertEqual(row["eligible_routes"], 1)
        self.assertEqual(row["eligible_routes_with_expected_records"], 0)
        self.assertEqual(row["eligible_routes_missing_expected_records"], 1)
        self.assertIsNone(row["volume_coverage"])


if __name__ == "__main__":
    unittest.main()
