"""Pure, versioned route-terminal-state calculation.

The calculator has no database or network access. Its complete input is stored on a
route_run row, so a decision is replayable and independently testable.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional

CALCULATOR_VERSION = "2.1.1"

# The calculator is the replay authority, so it refuses inputs it does not understand
# rather than falling through to a permissive default. These mirror the route_run CHECK
# constraints; a disagreement between the two is itself a bug worth failing on.
VALID_ACCESS_STATUS = frozenset(
    {"ok", "robots_denied", "paywall", "blocked_access", "transient_failure"}
)
VALID_FRESHNESS_STATE = frozenset({"fresh", "stale", "unknown"})
VALID_COUNT_QUALITY = frozenset({"published", "derived_from_category_text", "not_published"})
VALID_VARIANCE_STATUS = frozenset(
    {"not_evaluated", "reconciled", "parser_bug", "adjudicated_source_variance", "unexplained"}
)
VALID_AUDIT_STRATEGY = frozenset({"none", "exhaustive", "stratified_random"})
VALID_CORROBORATION_STATE = frozenset(
    {"none", "second_parser", "human_verified", "independent_source"}
)


@dataclass(frozen=True)
class TerminalInputs:
    access_status: str = "ok"
    suspension_cycles: int = 0
    has_blocking_escalation: bool = False
    freshness_state: str = "unknown"
    published_count: Optional[int] = None
    count_quality: str = "not_published"
    extracted_count: Optional[int] = None
    structural_count: Optional[int] = None
    container_resolved: Optional[bool] = None
    variance_status: str = "not_evaluated"
    audit_strategy: str = "none"
    audit_sampled_count: int = 0
    audit_error_count: int = 0
    accuracy_lower_cp: Optional[float] = None
    field_health_blocked: bool = False
    passing_fixture_count: int = 0
    corroboration_state: str = "none"
    empty_corroborated: bool = False
    llm_oracle_veto: bool = False

    @classmethod
    def from_mapping(cls, row: Mapping[str, Any]) -> "TerminalInputs":
        def b(name: str) -> bool:
            return bool(row[name])

        return cls(
            access_status=row["access_status"],
            suspension_cycles=row["suspension_cycles"],
            has_blocking_escalation=b("has_blocking_escalation"),
            freshness_state=row["freshness_state"],
            published_count=row["published_count"],
            count_quality=row["count_quality"],
            extracted_count=row["extracted_count"],
            structural_count=row["structural_count"],
            container_resolved=None if row["container_resolved"] is None else b("container_resolved"),
            variance_status=row["variance_status"],
            audit_strategy=row["audit_strategy"],
            audit_sampled_count=row["audit_sampled_count"],
            audit_error_count=row["audit_error_count"],
            accuracy_lower_cp=row["accuracy_lower_cp"],
            field_health_blocked=b("field_health_blocked"),
            passing_fixture_count=row["passing_fixture_count"],
            corroboration_state=row["corroboration_state"],
            empty_corroborated=b("empty_corroborated"),
            llm_oracle_veto=b("llm_oracle_veto"),
        )


@dataclass(frozen=True)
class TerminalDecision:
    state: str
    reason: str
    calculator_version: str = CALCULATOR_VERSION


def _validate(i: TerminalInputs) -> None:
    for value, allowed, name in (
        (i.access_status, VALID_ACCESS_STATUS, "access_status"),
        (i.freshness_state, VALID_FRESHNESS_STATE, "freshness_state"),
        (i.count_quality, VALID_COUNT_QUALITY, "count_quality"),
        (i.variance_status, VALID_VARIANCE_STATUS, "variance_status"),
        (i.audit_strategy, VALID_AUDIT_STRATEGY, "audit_strategy"),
        (i.corroboration_state, VALID_CORROBORATION_STATE, "corroboration_state"),
    ):
        if value not in allowed:
            raise ValueError(f"unsupported {name}: {value!r}")


def verification_passed(i: TerminalInputs) -> bool:
    """Return the fully parenthesized verification gate."""
    _validate(i)
    if i.extracted_count is None:
        return False
    exhaustive_pass = (
        i.extracted_count <= 50
        and i.audit_strategy == "exhaustive"
        and i.audit_sampled_count == i.extracted_count
        and i.audit_error_count == 0
    )
    # accuracy_lower_cp is supplied by the auditor, not recomputed here, so the one thing
    # this gate can check is that the stored bound does not contradict the stored error
    # count: a lower confidence bound on accuracy never exceeds the observed accuracy.
    sampled_pass = False
    if i.audit_strategy == "stratified_random" and i.audit_sampled_count > 0:
        observed_accuracy = 1.0 - (i.audit_error_count / i.audit_sampled_count)
        sampled_pass = (
            i.accuracy_lower_cp is not None
            and i.accuracy_lower_cp <= observed_accuracy
            and i.accuracy_lower_cp >= 0.95
        )
    return (
        (exhaustive_pass or sampled_pass)
        and not i.field_health_blocked
        and i.passing_fixture_count >= 1
    )


def calculate_terminal_state(i: TerminalInputs) -> TerminalDecision:
    _validate(i)
    if i.access_status == "robots_denied":
        return TerminalDecision("blocked_robots", "robots_denied")
    if i.access_status == "paywall":
        return TerminalDecision("blocked_paywall", "paywall_detected")
    if i.access_status == "blocked_access":
        return TerminalDecision("blocked_access", "terminal_access_failure")
    if i.access_status == "transient_failure":
        if i.suspension_cycles < 3:
            return TerminalDecision("awaiting_retry", "transient_failure_below_retry_limit")
        return TerminalDecision("needs_human", "transient_failure_retry_limit_reached")
    if i.has_blocking_escalation:
        return TerminalDecision("needs_human", "blocking_escalation_open")
    if i.freshness_state == "stale":
        return TerminalDecision("stale", "outside_freshness_window")
    if i.freshness_state != "fresh":
        return TerminalDecision("unresolved", "freshness_not_established")
    if i.extracted_count is None or i.structural_count is None:
        return TerminalDecision("unresolved", "counts_not_recorded")
    if i.variance_status == "parser_bug" or i.extracted_count != i.structural_count:
        return TerminalDecision("needs_human", "independent_counts_disagree")

    if i.extracted_count == 0:
        if i.published_count is not None and i.published_count > 0:
            return TerminalDecision("blocked_no_public_rows", "source_claims_rows_but_none_extracted")
        if i.passing_fixture_count < 1 or i.field_health_blocked:
            return TerminalDecision("unresolved", "empty_result_failed_parser_health_gate")
        if (
            i.container_resolved
            and i.empty_corroborated
            and not i.llm_oracle_veto
            and i.corroboration_state != "none"
        ):
            return TerminalDecision("verified_empty", "deterministically_corroborated_empty")
        return TerminalDecision("unresolved", "empty_not_corroborated")

    if i.published_count is not None and i.extracted_count != i.published_count:
        if i.variance_status != "adjudicated_source_variance":
            return TerminalDecision("partial", "published_and_extracted_counts_differ")

    verified = verification_passed(i)
    if not verified:
        return TerminalDecision("unresolved", "verification_gate_not_passed")

    if i.count_quality == "published":
        if i.variance_status in ("reconciled", "adjudicated_source_variance"):
            return TerminalDecision("complete_reconciled", "published_count_reconciled_and_verified")
        return TerminalDecision("unresolved", "published_count_not_reconciled")
    if i.count_quality == "derived_from_category_text":
        if i.variance_status in ("reconciled", "adjudicated_source_variance"):
            return TerminalDecision(
                "complete_reconciled_derived_count", "derived_count_reconciled_and_verified"
            )
        return TerminalDecision("unresolved", "derived_count_not_reconciled")
    if i.corroboration_state != "none":
        return TerminalDecision("complete_count_unpublished", "unpublished_count_independently_verified")
    return TerminalDecision("unresolved", "unpublished_count_lacks_corroboration")
