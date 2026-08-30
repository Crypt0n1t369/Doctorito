"""HTTP transport (G3): the only component that opens sockets.

The transport owns no policy. It asks ``fetch_policy`` what is allowed, writes bytes into
the artifact store, and records the attempt in the fetch tables. Every guard that matters
lives in the schema: a fetch_attempt cannot be inserted without approved, in-date source
and route policy reviews plus a matching robots snapshot, and cannot be finalized until the
artifact roles satisfy its outcome/tier contract.

Egress control is a deployment concern. Setting ``proxy_url`` routes requests through a
proxy, but a proxy that a process can decline to use is not an enforcement boundary. In
production, bind the worker into a network namespace or firewall it so the proxy is the
only route off-host, and set ``require_proxy=True`` so the transport refuses to run without
one configured.
"""
from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Mapping, Optional, Sequence

from .artifact_store import ArtifactStore
from .fetch_policy import (
    FailureClass,
    HostRateLimiter,
    classify_outcome,
    conditional_headers,
)

DEFAULT_TIMEOUT_S = 30.0
MAX_BODY_BYTES = 64 * 1024 * 1024


class TransportError(RuntimeError):
    pass


class ProxyRequired(TransportError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class FetchResult:
    """What a single HTTP exchange produced, before any database write."""

    url: str
    final_url: Optional[str]
    http_status: Optional[int]
    outcome: str
    failure_class: FailureClass
    body: Optional[bytes]
    content_type: Optional[str]
    etag: Optional[str]
    last_modified: Optional[str]
    requested_at_utc: str
    error: Optional[str] = None

    @property
    def is_success(self) -> bool:
        return self.outcome == "content_200"

    @property
    def is_not_modified(self) -> bool:
        return self.outcome == "not_modified_304"


@dataclass
class TransportConfig:
    user_agent: str = "tcpipe/2.2.1 (+governed research crawler; contact in source policy review)"
    timeout_s: float = DEFAULT_TIMEOUT_S
    proxy_url: Optional[str] = None
    require_proxy: bool = False
    max_body_bytes: int = MAX_BODY_BYTES
    extra_headers: Mapping[str, str] = field(default_factory=dict)


class Transport:
    """Politeness-bounded HTTP client. One instance per worker process."""

    def __init__(self, config: Optional[TransportConfig] = None,
                 limiter: Optional[HostRateLimiter] = None):
        self.config = config or TransportConfig()
        if self.config.require_proxy and not self.config.proxy_url:
            raise ProxyRequired(
                "require_proxy is set but no proxy_url was configured; refusing to fetch"
            )
        self.limiter = limiter or HostRateLimiter()
        handlers: list[urllib.request.BaseHandler] = [urllib.request.HTTPRedirectHandler()]
        if self.config.proxy_url:
            handlers.append(urllib.request.ProxyHandler(
                {"http": self.config.proxy_url, "https": self.config.proxy_url}
            ))
        else:
            handlers.append(urllib.request.ProxyHandler({}))
        self._opener = urllib.request.build_opener(*handlers)

    # -- politeness ------------------------------------------------------------------

    def wait_for_slot(self, url: str, crawl_delay_s: float) -> float:
        host = urllib.parse.urlsplit(url).netloc
        delay = self.limiter.reserve(host, max(1.0, float(crawl_delay_s)),
                                     now_monotonic=time.monotonic())
        if delay > 0:
            time.sleep(delay)
        return delay

    # -- robots ----------------------------------------------------------------------

    def fetch_robots(self, url: str) -> FetchResult:
        parts = urllib.parse.urlsplit(url)
        robots_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))
        return self.fetch(robots_url, crawl_delay_s=1.0)

    @staticmethod
    def robots_allows(robots_body: bytes, user_agent: str, url: str) -> bool:
        parser = urllib.robotparser.RobotFileParser()
        parser.parse(robots_body.decode("utf-8", errors="replace").splitlines())
        return bool(parser.can_fetch(user_agent, url))

    @staticmethod
    def robots_crawl_delay(robots_body: bytes, user_agent: str) -> Optional[float]:
        parser = urllib.robotparser.RobotFileParser()
        parser.parse(robots_body.decode("utf-8", errors="replace").splitlines())
        try:
            delay = parser.crawl_delay(user_agent)
        except Exception:
            return None
        return float(delay) if delay is not None else None

    # -- the one place bytes come from the network ------------------------------------

    def fetch(self, url: str, *, crawl_delay_s: float = 5.0, etag: Optional[str] = None,
              last_modified: Optional[str] = None,
              method: str = "GET") -> FetchResult:
        if self.config.require_proxy and not self.config.proxy_url:
            raise ProxyRequired("require_proxy is set but no proxy_url was configured")
        scheme = urllib.parse.urlsplit(url).scheme
        if scheme not in ("http", "https"):
            raise TransportError(f"refusing non-http(s) scheme: {scheme!r}")

        self.wait_for_slot(url, crawl_delay_s)
        headers = {"User-Agent": self.config.user_agent, "Accept-Encoding": "identity"}
        headers.update(self.config.extra_headers)
        headers.update(conditional_headers(etag, last_modified))
        request = urllib.request.Request(url, headers=headers, method=method)
        requested_at = utc_now()

        try:
            with self._opener.open(request, timeout=self.config.timeout_s) as response:
                body = response.read(self.config.max_body_bytes + 1)
                if len(body) > self.config.max_body_bytes:
                    raise TransportError(
                        f"response body exceeds {self.config.max_body_bytes} bytes: {url}"
                    )
                status = response.status
                return FetchResult(
                    url=url, final_url=response.url, http_status=status,
                    outcome="content_200" if status == 200 else _outcome_for_status(status),
                    failure_class=classify_outcome(http_status=status),
                    body=body, content_type=response.headers.get("Content-Type"),
                    etag=response.headers.get("ETag"),
                    last_modified=response.headers.get("Last-Modified"),
                    requested_at_utc=requested_at,
                )
        except urllib.error.HTTPError as exc:
            body = exc.read(self.config.max_body_bytes) if exc.fp is not None else b""
            status = exc.code
            if status == 304:
                return FetchResult(
                    url=url, final_url=url, http_status=304, outcome="not_modified_304",
                    failure_class=FailureClass.SUCCESS, body=None,
                    content_type=exc.headers.get("Content-Type") if exc.headers else None,
                    etag=(exc.headers.get("ETag") if exc.headers else None) or etag,
                    last_modified=(exc.headers.get("Last-Modified") if exc.headers else None)
                    or last_modified,
                    requested_at_utc=requested_at,
                )
            return FetchResult(
                url=url, final_url=url, http_status=status, outcome=_outcome_for_status(status),
                failure_class=classify_outcome(http_status=status), body=body or None,
                content_type=exc.headers.get("Content-Type") if exc.headers else None,
                etag=None, last_modified=None, requested_at_utc=requested_at,
                error=f"HTTP {status}",
            )
        except urllib.error.URLError as exc:
            timed_out = isinstance(exc.reason, TimeoutError) or "timed out" in str(exc.reason)
            return FetchResult(
                url=url, final_url=None, http_status=None,
                outcome="timeout" if timed_out else "error_5xx",
                failure_class=classify_outcome(timed_out=timed_out, connection_reset=not timed_out),
                body=None, content_type=None, etag=None, last_modified=None,
                requested_at_utc=requested_at, error=str(exc.reason),
            )
        except TimeoutError as exc:
            return FetchResult(
                url=url, final_url=None, http_status=None, outcome="timeout",
                failure_class=FailureClass.TRANSIENT, body=None, content_type=None,
                etag=None, last_modified=None, requested_at_utc=requested_at, error=str(exc),
            )


def _outcome_for_status(status: int) -> str:
    if status == 200:
        return "content_200"
    if status == 304:
        return "not_modified_304"
    if status == 429:
        return "rate_limited"
    if status == 403:
        return "blocked"
    if 400 <= status < 500:
        return "error_4xx"
    return "error_5xx"


# -- persistence: turn a FetchResult into governed rows -------------------------------


@dataclass(frozen=True)
class RecordedFetch:
    attempt_id: str
    outcome: str
    artifact_shas: tuple[str, ...]
    reused_from_attempt_id: Optional[str] = None


def record_fetch(
    con,
    store: ArtifactStore,
    result: FetchResult,
    *,
    attempt_id: str,
    job_id: str,
    route_id: str,
    fetch_tier: int,
    fetcher_version: str,
    source_policy_review_id: str,
    route_policy_review_id: str,
    robots_snapshot_sha: Optional[str],
    extra_artifacts: Sequence[tuple[str, bytes, Optional[str]]] = (),
    captured_by: Optional[str] = None,
) -> RecordedFetch:
    """Stage the attempt, link its artifacts, then finalize it.

    Ordering is deliberate and enforced by the schema: the attempt is inserted unfinalized,
    artifacts are linked, and only then does ``finalize_fetch_attempt`` flip the flag — at
    which point ``fetch_attempt_finalize_guard`` checks the roles against the outcome/tier
    contract. Nothing here can invent a body: a 304 must point at the exact prior artifact
    it revalidated, which this function looks up rather than re-deriving.
    """
    from .writer import finalize_fetch_attempt, register_artifact

    shas: list[str] = []
    reused_from: Optional[str] = None

    con.execute(
        """INSERT INTO fetch_attempt
           (attempt_id,job_id,route_id,request_url,final_url,http_status,outcome,etag,
            last_modified,requested_at_utc,fetch_tier,fetcher_version,
            source_policy_review_id,route_policy_review_id,robots_snapshot_sha,captured_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (attempt_id, job_id, route_id, result.url, result.final_url, result.http_status,
         result.outcome, result.etag, result.last_modified, result.requested_at_utc,
         fetch_tier, fetcher_version, source_policy_review_id, route_policy_review_id,
         robots_snapshot_sha, captured_by),
    )

    def link(role: str, data: bytes, content_type: Optional[str]) -> str:
        stored = store.put_bytes(data)
        register_artifact(con, sha256=stored.sha256, byte_len=stored.byte_len,
                          storage_path=stored.storage_path, content_type=content_type)
        con.execute(
            "INSERT OR IGNORE INTO fetch_attempt_artifact VALUES (?,?,?)",
            (attempt_id, stored.sha256, role),
        )
        shas.append(stored.sha256)
        return stored.sha256

    if result.outcome == "content_200" and result.body is not None:
        role = "download" if fetch_tier == 1 and _looks_like_download(result.content_type) \
            else "response_body"
        link(role, result.body, result.content_type)
    elif result.outcome == "human_capture" and result.body is not None:
        link("human_capture", result.body, result.content_type)
    elif result.outcome == "not_modified_304":
        prior = con.execute(
            """SELECT faa.attempt_id, faa.artifact_sha256
                 FROM fetch_attempt_artifact faa
                 JOIN fetch_attempt fa ON fa.attempt_id=faa.attempt_id
                WHERE fa.route_id=? AND fa.is_finalized=1 AND fa.attempt_id<>?
                  AND faa.role IN ('response_body','download','reused_body','rendered_dom')
                  AND julianday(fa.requested_at_utc)<=julianday(?)
                ORDER BY fa.requested_at_utc DESC LIMIT 1""",
            (route_id, attempt_id, result.requested_at_utc),
        ).fetchone()
        if prior is None:
            raise TransportError(
                f"304 for {result.url} has no prior stored body on route {route_id}; "
                "a revalidation cannot be recorded without the body it revalidated"
            )
        reused_from = prior["attempt_id"]
        con.execute(
            "INSERT OR IGNORE INTO fetch_attempt_artifact VALUES (?,?,?)",
            (attempt_id, prior["artifact_sha256"], "reused_body"),
        )
        shas.append(prior["artifact_sha256"])

    for role, data, content_type in extra_artifacts:
        link(role, data, content_type)

    finalize_fetch_attempt(con, attempt_id)
    return RecordedFetch(attempt_id, result.outcome, tuple(shas), reused_from)


def _looks_like_download(content_type: Optional[str]) -> bool:
    if not content_type:
        return False
    head = content_type.split(";")[0].strip().lower()
    return head in {
        "application/pdf", "text/csv", "application/csv", "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream", "application/zip",
    }
