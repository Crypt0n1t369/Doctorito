import tempfile
import unittest
import sqlite3
from pathlib import Path
from types import SimpleNamespace

from tcpipe.artifact_store import ArtifactStore
from tcpipe.bootstrap import bootstrap
from tcpipe.db import open_db
from tcpipe.fetch_policy import FailureClass
from tcpipe.public_policy import PublicPreflightError, public_preflight
from tcpipe.transport import FetchResult, Transport
from tcpipe.writer import claim_job, enqueue_job, utc_now


class FakeTransport:
    def __init__(self, robots: bytes, status: int = 200):
        self.robots = robots
        self.status = status
        self.config = SimpleNamespace(user_agent="tcpipe/2.3 (+transparent test crawler)")
        self.calls = 0

    def fetch_robots(self, url):
        self.calls += 1
        return FetchResult(
            url=url.split("/", 3)[0] + "//" + url.split("/", 3)[2] + "/robots.txt",
            final_url=None, http_status=self.status,
            outcome="content_200" if self.status == 200 else "error_4xx",
            failure_class=FailureClass.SUCCESS if self.status == 200 else FailureClass.TERMINAL,
            body=self.robots, content_type="text/plain", etag=None, last_modified=None,
            requested_at_utc="2026-08-20T00:00:00.000Z",
        )

    robots_allows = staticmethod(Transport.robots_allows)
    robots_crawl_delay = staticmethod(Transport.robots_crawl_delay)


class PublicPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db = root / "pilot.db"
        self.store = ArtifactStore(root / "artifacts")
        bootstrap(self.db, artifacts=root / "artifacts")
        self.con = open_db(self.db, required_schema_version="2.3.0")

    def tearDown(self):
        self.con.close()
        self.temp.cleanup()

    def test_ordinary_public_route_is_approved_with_stored_robots_evidence(self):
        transport = FakeTransport(b"User-agent: *\nAllow: /\nCrawl-delay: 7\n")
        report = public_preflight(self.con, self.store, transport, "RT-0001")
        self.assertEqual(report["decision"], "approved")
        row = self.con.execute(
            "SELECT access_class,policy_state,robots_state,crawl_delay_s FROM route "
            "WHERE route_id='RT-0001'"
        ).fetchone()
        self.assertEqual(tuple(row), ("public", "approved", "allowed", 7.0))
        review = self.con.execute(
            "SELECT reviewed_by,evidence_artifact_sha FROM source_policy_review "
            "WHERE source_policy_review_id=?", (report["source_policy_review_id"],)
        ).fetchone()
        self.assertEqual(review["reviewed_by"], "tcpipe-public-preflight/v1")
        self.store.verify(review["evidence_artifact_sha"])

    def test_automated_reviews_cannot_authorize_route_reclassified_as_private(self):
        report = public_preflight(
            self.con, self.store, FakeTransport(b"User-agent: *\nAllow: /\n"), "RT-0001"
        )
        self.con.execute("UPDATE route SET access_class='private' WHERE route_id='RT-0001'")
        enqueue_job(
            self.con, job_id="J-PRIVATE", mission_id="M-120", kind="fetch", params={},
            git_commit="test", idempotency_key="private-fetch",
        )
        claim_job(self.con, "J-PRIVATE", "test-worker")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "approval missing"):
            self.con.execute(
                """INSERT INTO fetch_attempt
                   (attempt_id,job_id,route_id,request_url,http_status,outcome,
                    requested_at_utc,fetch_tier,fetcher_version,source_policy_review_id,
                    route_policy_review_id,robots_snapshot_sha)
                   VALUES ('FA-PRIVATE','J-PRIVATE','RT-0001','https://example.com',200,
                           'content_200',?,1,'test',?,?,?)""",
                (utc_now(), report["source_policy_review_id"],
                 report["route_policy_review_id"], report["robots_snapshot_sha"]),
            )

    def test_explicit_robots_disallow_is_recorded_and_never_approved(self):
        transport = FakeTransport(b"User-agent: *\nDisallow: /\n")
        with self.assertRaisesRegex(PublicPreflightError, "explicitly prohibits"):
            public_preflight(self.con, self.store, transport, "RT-0001")
        row = self.con.execute(
            "SELECT policy_state,robots_state FROM route WHERE route_id='RT-0001'"
        ).fetchone()
        self.assertEqual(tuple(row), ("rejected", "disallowed"))

    def test_non_public_route_never_opens_a_socket(self):
        self.con.execute("UPDATE route SET access_class='authenticated' WHERE route_id='RT-0001'")
        transport = FakeTransport(b"User-agent: *\nAllow: /\n")
        with self.assertRaisesRegex(PublicPreflightError, "human approval"):
            public_preflight(self.con, self.store, transport, "RT-0001")
        self.assertEqual(transport.calls, 0)

    def test_sensitive_human_classification_cannot_be_overridden(self):
        self.con.execute(
            """INSERT INTO source_policy_review
               (source_policy_review_id,source_id,decision,data_categories_json,
                reviewed_by,reviewed_at_utc)
               VALUES ('SPR-SENSITIVE','SRC-0001','pending','[\"personal data\"]',
                       'human-reviewer','2026-08-20T00:00:00Z')"""
        )
        transport = FakeTransport(b"User-agent: *\nAllow: /\n")
        with self.assertRaisesRegex(PublicPreflightError, "sensitive"):
            public_preflight(self.con, self.store, transport, "RT-0001")
        self.assertEqual(transport.calls, 0)

    def test_absent_robots_is_stored_as_an_allow_decision(self):
        report = public_preflight(self.con, self.store, FakeTransport(b"", status=404), "RT-0001")
        self.assertEqual(report["robots_state"], "allowed")
        self.store.verify(report["robots_snapshot_sha"])


if __name__ == "__main__":
    unittest.main()
