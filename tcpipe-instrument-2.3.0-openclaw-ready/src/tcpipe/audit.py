"""Run audit evidence: sampling plan and the accuracy bound the completion gate reads.

``terminal_state.verification_passed`` will not pass a sampled audit whose
``accuracy_lower_cp`` is below 0.95, and the schema now refuses to store a bound that
exceeds the accuracy observed in its own sample. This module is what produces an honest
number for that field instead of a hopeful one.

The bound is a one-sided Clopper–Pearson (exact binomial) lower limit. It is deliberately
conservative: with 30 of 30 records correct it reports 0.905, not 1.0, so a small sample
cannot buy a completion verdict. Reaching 0.95 takes roughly 60 clean records.

Someone still has to actually check the sampled rows. ``checker`` is that person or
process; this module will not invent an error count.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from math import comb
from typing import Callable, Optional, Sequence

from .writer import utc_now

EXHAUSTIVE_MAX_ROWS = 50


class AuditError(RuntimeError):
    pass


def _binomial_tail_ge(successes: int, trials: int, probability: float) -> float:
    """P(X >= successes) for X ~ Binomial(trials, probability)."""
    if probability <= 0.0:
        return 1.0 if successes == 0 else 0.0
    if probability >= 1.0:
        return 1.0 if successes <= trials else 0.0
    total = 0.0
    for i in range(successes, trials + 1):
        total += comb(trials, i) * (probability ** i) * ((1.0 - probability) ** (trials - i))
    return min(1.0, total)


def clopper_pearson_lower(n_sampled: int, n_errors: int, *, confidence: float = 0.95) -> float:
    """One-sided exact lower confidence bound on the accuracy rate."""
    if n_sampled <= 0:
        raise AuditError("an audit sample must contain at least one record")
    if not 0 <= n_errors <= n_sampled:
        raise AuditError(f"n_errors {n_errors} outside 0..{n_sampled}")
    if not 0.0 < confidence < 1.0:
        raise AuditError("confidence must be strictly between 0 and 1")

    successes = n_sampled - n_errors
    if successes == 0:
        return 0.0
    alpha = 1.0 - confidence
    if successes == n_sampled:
        return alpha ** (1.0 / n_sampled)

    low, high = 0.0, 1.0
    for _ in range(200):
        middle = (low + high) / 2.0
        if _binomial_tail_ge(successes, n_sampled, middle) < alpha:
            low = middle
        else:
            high = middle
    return low


def minimum_clean_sample(target: float = 0.95, *, confidence: float = 0.95) -> int:
    """Smallest all-correct sample whose lower bound reaches ``target``."""
    size = 1
    while clopper_pearson_lower(size, 0, confidence=confidence) < target:
        size += 1
        if size > 100_000:  # pragma: no cover - defensive
            raise AuditError("target unreachable")
    return size


@dataclass(frozen=True)
class AuditRequest:
    """How a run should be audited, and who checks the sampled rows.

    ``checker`` receives the sampled ``source_record_id`` values and returns how many were
    wrong. Returning 0 without looking is falsifying evidence — the schema will happily
    store it, which is precisely why this is a named, explicit dependency.
    """

    checker: Callable[[Sequence[str]], int]
    audited_by: str
    strategy: Optional[str] = None       # None = choose by extracted count
    sample_size: Optional[int] = None
    confidence: float = 0.95
    seed: str = "tcpipe-audit-v1"


def choose_strategy(extracted_count: int) -> str:
    return "exhaustive" if extracted_count <= EXHAUSTIVE_MAX_ROWS else "stratified_random"


def stratified_sample(record_ids: Sequence[str], size: int, *, seed: str) -> list[str]:
    """Deterministic pseudo-random sample: same run and seed, same rows, every replay.

    Ordering by a hash of (seed, record id) spreads the sample across the list without a
    stateful RNG, so an auditor on another machine can reproduce exactly which rows were
    checked.
    """
    if size >= len(record_ids):
        return list(record_ids)
    ranked = sorted(
        record_ids,
        key=lambda rid: hashlib.sha256(f"{seed}:{rid}".encode("utf-8")).hexdigest(),
    )
    return sorted(ranked[:size])


def record_audit_sample(con, run_id: str, parse_run_id: str, request: AuditRequest) -> dict:
    """Sample, check, and store the audit evidence for a running route run.

    Must be called while the route run is still ``running`` — ``audit_sample_insert_guard``
    enforces that, so audit evidence cannot be appended after a verdict is reached.
    """
    record_ids = [
        row[0] for row in con.execute(
            "SELECT source_record_id FROM source_record WHERE parse_run_id=? ORDER BY row_ordinal",
            (parse_run_id,),
        )
    ]
    if not record_ids:
        return {"strategy": "none", "n_sampled": 0, "reason": "no records to audit"}

    strategy = request.strategy or choose_strategy(len(record_ids))
    if strategy == "exhaustive":
        if len(record_ids) > EXHAUSTIVE_MAX_ROWS:
            raise AuditError(
                f"exhaustive audit refused for {len(record_ids)} records; the completion "
                f"gate only accepts it up to {EXHAUSTIVE_MAX_ROWS}"
            )
        sampled = list(record_ids)
    else:
        size = request.sample_size or min(
            len(record_ids), max(minimum_clean_sample(confidence=request.confidence), 60)
        )
        sampled = stratified_sample(record_ids, size, seed=request.seed)

    n_errors = int(request.checker(sampled))
    if not 0 <= n_errors <= len(sampled):
        raise AuditError(f"checker returned {n_errors} errors for {len(sampled)} sampled records")

    accuracy_lower_cp = (
        None if strategy == "exhaustive"
        else clopper_pearson_lower(len(sampled), n_errors, confidence=request.confidence)
    )
    con.execute(
        "INSERT INTO audit_sample VALUES (?,?,?,?,?,?,?,?)",
        (run_id, strategy, len(sampled), n_errors, accuracy_lower_cp,
         json.dumps({"sampled_record_ids": sampled[:200],
                     "sampled_total": len(sampled),
                     "seed": request.seed,
                     "confidence": request.confidence}, sort_keys=True),
         request.audited_by, utc_now()),
    )
    return {"strategy": strategy, "n_sampled": len(sampled), "n_errors": n_errors,
            "accuracy_lower_cp": accuracy_lower_cp}
