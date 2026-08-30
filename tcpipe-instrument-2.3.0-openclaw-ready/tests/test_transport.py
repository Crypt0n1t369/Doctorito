import tempfile
import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .pilot_support import PilotRoute, ts
from tcpipe.fetch_policy import FailureClass
from tcpipe.transport import (
    FetchResult,
    ProxyRequired,
    Transport,
    TransportConfig,
    TransportError,
    record_fetch,
    validate_public_http_url,
)

ROBOTS = b"""User-agent: *
Disallow: /private/
Allow: /
Crawl-delay: 7

User-agent: BadBot
Disallow: /
"""


class RobotsTests(unittest.TestCase):
    def test_allow_and_disallow(self):
        self.assertTrue(Transport.robots_allows(ROBOTS, "tcpipe", "https://x.invalid/partners"))
        self.assertFalse(Transport.robots_allows(ROBOTS, "tcpipe", "https://x.invalid/private/a"))
        self.assertFalse(Transport.robots_allows(ROBOTS, "BadBot", "https://x.invalid/partners"))

    def test_crawl_delay_is_read_from_the_snapshot(self):
        self.assertEqual(Transport.robots_crawl_delay(ROBOTS, "tcpipe"), 7.0)


class PolitenessTests(unittest.TestCase):
    def test_rate_limiter_serializes_per_host(self):
        transport = Transport()
        first = transport.limiter.reserve("a.invalid", 5.0, now_monotonic=100.0)
        second = transport.limiter.reserve("a.invalid", 5.0, now_monotonic=100.0)
        other = transport.limiter.reserve("b.invalid", 5.0, now_monotonic=100.0)
        self.assertEqual(first, 0.0)
        self.assertEqual(second, 5.0)
        self.assertEqual(other, 0.0, "a different host has its own budget")

    def test_sub_second_crawl_delay_is_refused(self):
        with self.assertRaises(ValueError):
            Transport().limiter.reserve("a.invalid", 0.2, now_monotonic=0.0)


class EgressTests(unittest.TestCase):
    def test_require_proxy_without_a_proxy_refuses_to_construct(self):
        with self.assertRaises(ProxyRequired):
            Transport(TransportConfig(require_proxy=True))

    def test_non_http_schemes_are_refused(self):
        transport = Transport()
        for url in ("file:///etc/passwd", "ftp://x.invalid/a", "data:text/html,x"):
            with self.subTest(url=url), self.assertRaises(TransportError):
                transport.fetch(url)

    @mock.patch("tcpipe.transport.socket.getaddrinfo")
    def test_public_fetch_rejects_private_or_loopback_dns(self, resolver):
        for address in ("127.0.0.1", "10.1.2.3", "169.254.1.1"):
            resolver.return_value = [(2, 1, 6, "", (address, 443))]
            with self.subTest(address=address), self.assertRaises(TransportError):
                validate_public_http_url("https://example.test/path")

    @mock.patch("tcpipe.transport.socket.getaddrinfo")
    def test_public_fetch_accepts_only_global_dns_and_rejects_url_credentials(self, resolver):
        resolver.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]
        validate_public_http_url("https://example.test/path")
        with self.assertRaisesRegex(TransportError, "credentials"):
            validate_public_http_url("https://user:secret@example.test/path")


def result(outcome, *, body=b"<html>hi</html>", status=200, etag=None):
    return FetchResult(
        url="https://assoc.invalid/partners", final_url="https://assoc.invalid/partners",
        http_status=status, outcome=outcome, failure_class=FailureClass.SUCCESS, body=body,
        content_type="text/html", etag=etag, last_modified=None,
        requested_at_utc=ts(datetime.now(timezone.utc) - timedelta(minutes=5)),
    )


class RecordFetchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = datetime.now(timezone.utc)
        self.pilot = PilotRoute(Path(self.temp.name))
        self.job = self.pilot.claim_job("J-1", at=self.now - timedelta(minutes=10))

    def tearDown(self):
        self.pilot.close()
        self.temp.cleanup()

    def record(self, attempt_id, fetch_result):
        return record_fetch(
            self.pilot.con, self.pilot.store, fetch_result,
            attempt_id=attempt_id, job_id=self.job, route_id="RT-P", fetch_tier=1,
            fetcher_version="test", source_policy_review_id="SPR-P",
            route_policy_review_id="RPR-P", robots_snapshot_sha=self.pilot.robots_sha,
        )

    def test_success_stores_and_finalizes(self):
        recorded = self.record("FA-1", result("content_200"))
        self.assertEqual(recorded.outcome, "content_200")
        self.assertEqual(len(recorded.artifact_shas), 1)
        row = self.pilot.con.execute(
            "SELECT is_finalized FROM fetch_attempt WHERE attempt_id='FA-1'").fetchone()
        self.assertEqual(row["is_finalized"], 1)

    def test_human_reviews_still_authorize_a_private_route(self):
        self.pilot.con.execute("UPDATE route SET access_class='private' WHERE route_id='RT-P'")
        recorded = self.record("FA-PRIVATE-HUMAN", result("content_200"))
        self.assertEqual(recorded.outcome, "content_200")

    def test_304_reuses_the_exact_prior_body_rather_than_minting_one(self):
        first = self.record("FA-1", result("content_200", etag='"v1"'))
        second = self.record("FA-2", result("not_modified_304", body=None, status=304,
                                            etag='"v1"'))
        self.assertEqual(second.artifact_shas, first.artifact_shas)
        self.assertEqual(second.reused_from_attempt_id, "FA-1")
        role = self.pilot.con.execute(
            "SELECT role FROM fetch_attempt_artifact WHERE attempt_id='FA-2'").fetchone()
        self.assertEqual(role["role"], "reused_body")
        self.assertEqual(self.pilot.con.execute(
            "SELECT count(*) FROM artifact").fetchone()[0], 2,
            "revalidation must not duplicate stored bytes")

    def test_304_without_any_prior_body_is_refused(self):
        with self.assertRaises(TransportError):
            self.record("FA-1", result("not_modified_304", body=None, status=304, etag='"v1"'))

    def test_identical_bodies_are_stored_once(self):
        self.record("FA-1", result("content_200"))
        self.record("FA-2", result("content_200"))
        # robots + one content body; the second fetch is byte-identical
        self.assertEqual(self.pilot.con.execute(
            "SELECT count(*) FROM artifact").fetchone()[0], 2)

    def test_access_barrier_body_is_preserved_and_host_is_blocked(self):
        blocked = FetchResult(
            url="https://assoc.invalid/partners", final_url=None, http_status=403,
            outcome="blocked", failure_class=FailureClass.AMBIGUOUS,
            body=b"access denied", content_type="text/html", etag=None,
            last_modified=None,
            requested_at_utc=ts(self.now - timedelta(minutes=5)), error="HTTP 403",
        )
        recorded = self.record("FA-BLOCKED", blocked)
        self.assertEqual(len(recorded.artifact_shas), 1)
        state = self.pilot.con.execute(
            "SELECT route_state,reason FROM host_state WHERE host='assoc.invalid'"
        ).fetchone()
        self.assertEqual(tuple(state), ("awaiting_retry", "ambiguous_403"))

    def test_fetch_outside_an_approved_policy_window_is_refused_by_the_schema(self):
        import sqlite3

        stale = FetchResult(
            url="https://assoc.invalid/partners", final_url=None, http_status=200,
            outcome="content_200", failure_class=FailureClass.SUCCESS, body=b"x",
            content_type="text/html", etag=None, last_modified=None,
            requested_at_utc="2019-01-01T00:00:00.000Z",  # before the policy review existed
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.record("FA-STALE", stale)


if __name__ == "__main__":
    unittest.main()
