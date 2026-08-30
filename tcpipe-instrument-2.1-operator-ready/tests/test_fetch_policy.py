import unittest
from datetime import datetime, timezone

from .support import ROOT
from tcpipe.fetch_policy import (
    BreakerState, FailureClass, HostRateLimiter, classify_outcome, conditional_headers,
    transition_breaker,
)


NOW = datetime(2026, 8, 19, tzinfo=timezone.utc)


class FetchPolicyTests(unittest.TestCase):
    def test_classification(self):
        self.assertEqual(classify_outcome(http_status=200), FailureClass.SUCCESS)
        self.assertEqual(classify_outcome(http_status=429), FailureClass.TRANSIENT)
        self.assertEqual(classify_outcome(http_status=403), FailureClass.AMBIGUOUS)
        self.assertEqual(classify_outcome(captcha=True), FailureClass.TERMINAL)

    def test_second_403_blocks(self):
        first = transition_breaker(BreakerState(), FailureClass.AMBIGUOUS, now=NOW)
        second = transition_breaker(first, FailureClass.AMBIGUOUS, now=NOW)
        self.assertEqual(first.route_state, "awaiting_retry")
        self.assertEqual(second.route_state, "blocked_access")

    def test_third_transient_needs_human(self):
        state = BreakerState()
        for _ in range(3):
            state = transition_breaker(state, FailureClass.TRANSIENT, now=NOW)
        self.assertEqual(state.route_state, "needs_human")

    def test_success_resets(self):
        state = BreakerState(consecutive_failures=3, suspension_cycles=2,
                             route_state="awaiting_retry")
        self.assertEqual(transition_breaker(state, FailureClass.SUCCESS, now=NOW), BreakerState(
            route_state="fetchable", reason="success_reset"))

    def test_rate_limiter_reserves_serial_slots(self):
        limiter = HostRateLimiter()
        self.assertEqual(limiter.reserve("example.org", 5, now_monotonic=10), 0)
        self.assertEqual(limiter.reserve("example.org", 5, now_monotonic=11), 4)
        self.assertEqual(limiter.reserve("other.org", 5, now_monotonic=11), 0)

    def test_conditional_headers(self):
        self.assertEqual(conditional_headers('"abc"', "Wed, 19 Aug 2026 00:00:00 GMT"), {
            "If-None-Match": '"abc"', "If-Modified-Since": "Wed, 19 Aug 2026 00:00:00 GMT"
        })


if __name__ == "__main__":
    unittest.main()
