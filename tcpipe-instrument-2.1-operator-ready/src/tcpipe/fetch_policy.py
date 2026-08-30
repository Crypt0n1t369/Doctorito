"""Deterministic fetch politeness and circuit-breaker policy.

This module does not open sockets. A transport or egress proxy calls it before and after
requests, keeping policy testable independently from HTTP implementation.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Mapping, Optional


class FailureClass(str, Enum):
    SUCCESS = "success"
    TRANSIENT = "transient"
    AMBIGUOUS = "ambiguous"
    TERMINAL = "terminal"


def classify_outcome(
    *,
    http_status: Optional[int] = None,
    timed_out: bool = False,
    connection_reset: bool = False,
    robots_denied: bool = False,
    login_wall: bool = False,
    captcha: bool = False,
) -> FailureClass:
    if robots_denied or login_wall or captcha or http_status == 401:
        return FailureClass.TERMINAL
    if http_status == 403:
        return FailureClass.AMBIGUOUS
    if timed_out or connection_reset or http_status in (429, 503):
        return FailureClass.TRANSIENT
    if http_status is not None and 200 <= http_status < 400:
        return FailureClass.SUCCESS
    if http_status is not None and 400 <= http_status:
        return FailureClass.TERMINAL
    return FailureClass.TRANSIENT


@dataclass(frozen=True)
class BreakerState:
    consecutive_failures: int = 0
    suspension_cycles: int = 0
    consecutive_403_cycles: int = 0
    suspended_until_utc: Optional[str] = None
    route_state: str = "fetchable"
    reason: str = "initial"


def transition_breaker(
    state: BreakerState,
    failure_class: FailureClass,
    *,
    now: datetime,
    retry_after_s: Optional[int] = None,
) -> BreakerState:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    if failure_class == FailureClass.SUCCESS:
        return BreakerState(route_state="fetchable", reason="success_reset")
    if failure_class == FailureClass.TERMINAL:
        return BreakerState(
            consecutive_failures=state.consecutive_failures + 1,
            suspension_cycles=state.suspension_cycles,
            consecutive_403_cycles=state.consecutive_403_cycles,
            route_state="blocked_access",
            reason="terminal_failure",
        )

    cycles = state.suspension_cycles + 1
    is_403 = failure_class == FailureClass.AMBIGUOUS
    cycles_403 = state.consecutive_403_cycles + 1 if is_403 else 0
    if is_403 and cycles_403 >= 2:
        return BreakerState(
            consecutive_failures=state.consecutive_failures + 1,
            suspension_cycles=cycles,
            consecutive_403_cycles=cycles_403,
            route_state="blocked_access",
            reason="second_consecutive_403_cycle",
        )
    if cycles >= 3:
        return BreakerState(
            consecutive_failures=state.consecutive_failures + 1,
            suspension_cycles=cycles,
            consecutive_403_cycles=cycles_403,
            route_state="needs_human",
            reason="transient_retry_limit_reached",
        )
    delay_s = max(24 * 60 * 60, retry_after_s or 0)
    suspended_until = (now.astimezone(timezone.utc) + timedelta(seconds=delay_s)).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    return BreakerState(
        consecutive_failures=state.consecutive_failures + 1,
        suspension_cycles=cycles,
        consecutive_403_cycles=cycles_403,
        suspended_until_utc=suspended_until,
        route_state="awaiting_retry",
        reason="ambiguous_403" if is_403 else "transient_failure",
    )


class HostRateLimiter:
    """Thread-safe reservation of one request slot per host."""

    def __init__(self):
        self._lock = threading.Lock()
        self._next_allowed: dict[str, float] = {}

    def reserve(self, host: str, crawl_delay_s: float, *, now_monotonic: float) -> float:
        if not host:
            raise ValueError("host is required")
        if crawl_delay_s < 1.0:
            raise ValueError("crawl_delay_s must be at least 1 second")
        with self._lock:
            available = self._next_allowed.get(host, now_monotonic)
            start = max(now_monotonic, available)
            self._next_allowed[host] = start + crawl_delay_s
            return max(0.0, start - now_monotonic)


def conditional_headers(etag: Optional[str], last_modified: Optional[str]) -> Mapping[str, str]:
    headers: dict[str, str] = {}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    return headers
