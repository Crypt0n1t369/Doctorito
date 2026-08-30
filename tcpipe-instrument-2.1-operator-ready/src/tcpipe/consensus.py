"""Cross-extractor consensus and conflict detection (T2-07).

By now several extractors can produce the same field, and they disagree in practice. The
common case is not exotic: a site updates its visible price table and forgets the JSON-LD
block, so structured data confidently states last year's price. Both extractors are working
correctly; the page contradicts itself.

The rule this module enforces is that **a disagreement is a review item, never a silent
winner**. Source precedence decides which claim to *show first*, not which one is true. If
two sources give materially different values for a single-valued field, no value is
promoted — the conflict is recorded with both claims and their evidence, and a human
decides. Tier-2 output is review-only anyway, so the cost of a conflict is one review, and
the cost of guessing is a wrong price nobody ever notices.

Agreement is judged after field-appropriate normalization: "1250.00 EUR" and "EUR 1250"
agree, "+371 6700 1234" and "0037167001234" agree, "Baltic Safety Centre OÜ" and "Baltic
Safety Centre" agree. Comparing raw strings would manufacture conflicts out of formatting.

Never raises, bounded, deterministic.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Iterable, Optional, Sequence

MAX_CLAIMS = 5_000

#: How much a source is trusted, before corroboration. Structured data is high precision
#: but goes stale silently; visible text is what a customer actually sees.
SOURCE_PRECISION = {
    "tel_link": 0.95,          # the site declared this string to be a phone number
    "json_ld": 0.90,
    "microdata": 0.85,
    "rdfa": 0.80,
    "table_column": 0.80,      # a labelled column pairs a value with its row
    "package": 0.75,
    "visible_text": 0.70,
    "opengraph": 0.60,         # often a template default rather than the page's content
    "inferred": 0.40,
}
DEFAULT_PRECISION = 0.50

#: Fields where several different values are all correct at once. A centre teaches many
#: courses and may publish several phone numbers; it has one name and one country.
MANY_VALUED = frozenset({
    "certificate_name", "published_phone", "published_website", "published_apply_url",
    "published_address", "package_contents", "provider_id",
})

CONFIDENCE_RANK = {"certain": 0, "probable": 1, "ambiguous": 2}


@dataclass(frozen=True)
class Claim:
    """One extractor's assertion about one field, with its evidence."""

    field: str
    value: str
    source: str
    locator: str = ""
    quote: str = ""
    confidence: str = "probable"
    normalized: Optional[str] = None
    extra: dict = field(default_factory=dict, compare=False)

    @property
    def precision(self) -> float:
        base = SOURCE_PRECISION.get(self.source, DEFAULT_PRECISION)
        penalty = {"certain": 0.0, "probable": 0.05, "ambiguous": 0.20}
        return max(0.0, base - penalty.get(self.confidence, 0.10))

    def as_dict(self) -> dict:
        return {"field": self.field, "value": self.value, "source": self.source,
                "locator": self.locator, "quote": self.quote,
                "confidence": self.confidence, "normalized": self.normalized}


@dataclass
class FieldConsensus:
    """What the extractors collectively say about one field."""

    field: str
    status: str                       # corroborated | single_source | conflict | none
    value: Optional[str] = None
    normalized: Optional[str] = None
    score: float = 0.0
    claims: list[Claim] = field(default_factory=list)
    alternatives: list[str] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)

    @property
    def needs_review(self) -> bool:
        return self.status == "conflict"

    @property
    def validation_state(self) -> str:
        """The ``field_observation.validation_state`` this consensus justifies.

        Nothing from tier 2 is ever ``accepted``: it is generic extraction over unknown
        templates and a human decides. A conflict is additionally ``flagged``.
        """
        return "flagged" if self.status in ("conflict", "none") else "pending"

    def as_dict(self) -> dict:
        return {"field": self.field, "status": self.status, "value": self.value,
                "normalized": self.normalized, "score": round(self.score, 3),
                "alternatives": list(self.alternatives),
                "evidence": list(self.evidence),
                "sources": sorted({claim.source for claim in self.claims}),
                "claims": [claim.as_dict() for claim in self.claims]}


# -- normalization for comparison ----------------------------------------------------------


def _fold(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "")
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return " ".join(folded.split()).lower()


_MONEY = re.compile(r"([A-Z]{3})?\s*([\d.,]+)\s*([A-Z]{3})?")


def _canonical_price(value: str) -> Optional[str]:
    """"EUR 1250.00" and "1250 EUR" and "1,250.00 EUR" all reduce to the same key."""
    if not value:
        return None
    text = value.strip().upper()
    match = _MONEY.search(text)
    if not match:
        return None
    currency = match.group(1) or match.group(3)
    number = match.group(2).replace(" ", "")
    if "." in number and "," in number:
        number = (number.replace(",", "") if number.rfind(".") > number.rfind(",")
                  else number.replace(".", "").replace(",", "."))
    elif "," in number:
        parts = number.split(",")
        number = number.replace(",", ".") if len(parts[-1]) == 2 else number.replace(",", "")
    try:
        amount = Decimal(number).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None
    return f"{currency or '?'} {amount}"


def _canonical_phone(value: str) -> Optional[str]:
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        return None
    digits = re.sub(r"^00", "", digits)
    return digits[-11:] if len(digits) > 11 else digits


def _canonical_name(value: str) -> Optional[str]:
    from .resolver import normalize_name

    return normalize_name(value or "") or None


def _canonical_url(value: str) -> Optional[str]:
    from .resolver import registrable_domain

    domain = registrable_domain(value or "")
    if not domain:
        return _fold(value) or None
    path = re.sub(r"^https?://[^/]+", "", (value or "").strip(), flags=re.I).rstrip("/")
    return f"{domain}{path.lower()}" if path else domain


def _canonical_tokens(value: str) -> Optional[str]:
    tokens = [token for token in re.split(r"[^\w]+", _fold(value)) if token]
    return " ".join(sorted(set(tokens))) or None


CANONICALIZERS = {
    "price_text": _canonical_price,
    "published_phone": _canonical_phone,
    "published_name": _canonical_name,
    "published_website": _canonical_url,
    "published_apply_url": _canonical_url,
    "published_address": _canonical_tokens,
    "published_locality": _fold,
    "published_country": lambda value: (value or "").strip().upper()[:2] or None,
    "certificate_name": _fold,
    "package_name": _fold,
}


def canonical(field_name: str, value: str) -> Optional[str]:
    """A comparison key for one field, or None when the value carries no signal."""
    try:
        canonicalizer = CANONICALIZERS.get(field_name, _fold)
        key = canonicalizer(value)
    except Exception:
        return None
    return key or None


def _compatible(field_name: str, first: str, second: str) -> bool:
    """Whether two canonical keys should be treated as agreeing.

    Prices agree when the amounts match and at most one side names a currency: a page that
    writes "1250" in one place and "EUR 1250" in another is not contradicting itself.
    Addresses agree by token containment, since one source often carries a fuller form.
    """
    if first == second:
        return True
    if field_name == "price_text":
        first_currency, _, first_amount = first.partition(" ")
        second_currency, _, second_amount = second.partition(" ")
        if first_amount == second_amount and "?" in (first_currency, second_currency):
            return True
        return False
    if field_name in ("published_address", "published_name"):
        first_tokens, second_tokens = set(first.split()), set(second.split())
        if not first_tokens or not second_tokens:
            return False
        return first_tokens <= second_tokens or second_tokens <= first_tokens
    return False


# -- reconciliation ---------------------------------------------------------------------


def _group_claims(claims: Sequence[Claim]) -> list[list[Claim]]:
    """Cluster claims whose canonical values agree."""
    groups: list[tuple[str, list[Claim]]] = []
    for claim in claims:
        key = canonical(claim.field, claim.value)
        if key is None:
            continue
        for existing_key, members in groups:
            if _compatible(claim.field, existing_key, key):
                members.append(claim)
                break
        else:
            groups.append((key, [claim]))
    return [members for _, members in groups]


def _pick(claims: Sequence[Claim]) -> Claim:
    """The claim to show for a group: most precise source, then confidence, then value."""
    return sorted(claims, key=lambda c: (-c.precision, CONFIDENCE_RANK.get(c.confidence, 3),
                                         c.source, c.value))[0]


def reconcile_field(field_name: str, claims: Sequence[Claim]) -> FieldConsensus:
    """Reconcile every claim about one field of one subject."""
    usable = [claim for claim in claims if claim.value and claim.value.strip()]
    if not usable:
        return FieldConsensus(field=field_name, status="none",
                              evidence=["no extractor produced a value"])

    groups = _group_claims(usable)
    if not groups:
        return FieldConsensus(field=field_name, status="none", claims=list(usable),
                              evidence=["values carried no comparable signal"])

    if field_name in MANY_VALUED:
        # Several different values are all correct here, so disagreement is not conflict.
        chosen = [_pick(group) for group in groups]
        chosen.sort(key=lambda c: (-c.precision, c.value))
        best = chosen[0]
        sources = sorted({claim.source for claim in usable})
        return FieldConsensus(
            field=field_name, status="corroborated" if len(sources) > 1 else "single_source",
            value=best.value, normalized=best.normalized or canonical(field_name, best.value),
            score=_score(groups[0], len(sources)), claims=list(usable),
            alternatives=[claim.value for claim in chosen[1:]],
            evidence=[f"{len(groups)} distinct value(s) from {len(sources)} source(s); "
                      f"{field_name} may hold several"],
        )

    if len(groups) == 1:
        group = groups[0]
        sources = sorted({claim.source for claim in group})
        best = _pick(group)
        status = "corroborated" if len(sources) > 1 else "single_source"
        evidence = [f"{len(sources)} source(s) agree: {', '.join(sources)}"]
        return FieldConsensus(
            field=field_name, status=status, value=best.value,
            normalized=best.normalized or canonical(field_name, best.value),
            score=_score(group, len(sources)), claims=list(group), evidence=evidence,
        )

    # Materially different values for a single-valued field. Precedence orders what a
    # reviewer sees; it does not decide the answer.
    ordered = sorted(groups, key=lambda group: -_pick(group).precision)
    leading = _pick(ordered[0])
    others = [_pick(group) for group in ordered[1:]]
    evidence = [
        f"{len(groups)} incompatible values for a single-valued field",
        *[f"{claim.source} says {claim.value!r}" for claim in [leading, *others]],
    ]
    return FieldConsensus(
        field=field_name, status="conflict", value=None,
        normalized=None, score=0.0, claims=list(usable),
        alternatives=[claim.value for claim in [leading, *others]],
        evidence=evidence,
    )


#: Tier 2 is generic extraction over unknown templates and is never certain, however many
#: sources agree. Capping below 1.0 keeps the output honest about what it is.
MAX_SCORE = 0.95


def _score(group: Sequence[Claim], source_count: int) -> float:
    """Confidence in a group: its best source, lifted by independent corroboration."""
    if not group:
        return 0.0
    best = max(claim.precision for claim in group)
    lift = min(0.10 * (source_count - 1), 0.20)
    return round(min(MAX_SCORE, best + lift), 3)


def reconcile(claims: Iterable[Claim]) -> dict[str, FieldConsensus]:
    """Reconcile all claims about one subject, keyed by field name.

    ``claims`` must describe a single subject — one centre, or one course. Mixing subjects
    turns two centres' different phone numbers into a conflict about one centre.
    """
    by_field: dict[str, list[Claim]] = {}
    for index, claim in enumerate(claims):
        if index >= MAX_CLAIMS:
            break
        by_field.setdefault(claim.field, []).append(claim)
    return {field_name: reconcile_field(field_name, field_claims)
            for field_name, field_claims in sorted(by_field.items())}


# -- output -------------------------------------------------------------------------------


def review_items(consensus: dict[str, FieldConsensus]) -> list[dict]:
    """The conflicts a human has to settle, ready for ``review_queue``."""
    items = []
    for field_name, result in sorted(consensus.items()):
        if not result.needs_review:
            continue
        items.append({
            "review_kind": "field_validation",
            "field": field_name,
            "reason": "extractors disagree",
            "candidates": [
                {"value": claim.value, "source": claim.source, "locator": claim.locator,
                 "quote": claim.quote[:300]}
                for claim in sorted(result.claims, key=lambda c: (-c.precision, c.source))
            ][:8],
            "evidence": list(result.evidence),
        })
    return items


def observation_rows(consensus: dict[str, FieldConsensus]) -> list[dict]:
    """Field observations for the governed tables.

    Every row is ``pending`` or ``flagged`` — never ``accepted``. Tier 2 is generic
    extraction over unknown templates, and G5 keeps non-deterministic output review-only.
    """
    rows = []
    for field_name, result in sorted(consensus.items()):
        for claim in sorted(result.claims, key=lambda c: (-c.precision, c.source, c.value)):
            rows.append({
                "field_name": field_name,
                "raw_value": claim.value,
                "normalized_value": claim.normalized or canonical(field_name, claim.value),
                "field_locator": claim.locator,
                "evidence_quote": (claim.quote or claim.value)[:2000],
                "validation_state": result.validation_state,
                "validation_flags_json": sorted({
                    *( ["extractor_conflict"] if result.needs_review else []),
                    f"source:{claim.source}",
                    f"confidence:{claim.confidence}",
                }),
                "consensus_status": result.status,
                "consensus_score": result.score,
            })
    return rows


def summarize(consensus: dict[str, FieldConsensus]) -> dict:
    """A compact report of what was agreed, what stands alone and what is disputed."""
    buckets: dict[str, list[str]] = {}
    for field_name, result in sorted(consensus.items()):
        buckets.setdefault(result.status, []).append(field_name)
    return {
        "fields": len(consensus),
        "corroborated": sorted(buckets.get("corroborated", [])),
        "single_source": sorted(buckets.get("single_source", [])),
        "conflict": sorted(buckets.get("conflict", [])),
        "none": sorted(buckets.get("none", [])),
        "mean_score": round(
            sum(result.score for result in consensus.values()) / len(consensus), 3
        ) if consensus else 0.0,
    }
