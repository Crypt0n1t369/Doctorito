"""Bundle detection (T2-06): multi-course offers and what they contain.

A bundle is the one field in this project that has no home in the tier-1 model. An
``offering`` is one centre × one certificate × one location × one delivery mode, and a
``price_observation`` attaches to exactly one of those. "GWO BST + BSTR + ART, €2,400" is a
single price covering three certificates, which is why 2.2.0 added ``package`` and
``package_item``. This module is what fills them.

The precision rule that matters: **a bundle must resolve to at least two distinct courses.**
Without it every course page with a "what's included" section becomes a one-item "package",
the package table fills with duplicates of the offering table, and the distinction that
justified the schema change disappears. A block that names one course is a course.

Course names come from a gazetteer of the standards this domain actually uses, plus
structural patterns. Knowing what to look for beats generic entity extraction here: "BST"
is meaningless in general and unambiguous in wind-turbine safety training.

Never raises, bounded, deterministic.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from .money import Money, best_price, page_vat_statement, parse_money

MAX_INPUT = 200_000
MAX_PACKAGES = 40
MIN_ITEMS = 2

#: Standards this corpus is actually about. A gazetteer beats general-purpose entity
#: extraction in a narrow domain: "BST" means nothing in general and exactly one thing here.
COURSE_GAZETTEER = (
    # GWO
    "GWO Basic Safety Training", "GWO BST", "BST Refresher", "GWO BSTR", "GWO BST Refresher",
    "GWO Advanced Rescue Training", "GWO ART", "GWO ART Refresher",
    "GWO Basic Technical Training", "GWO BTT", "GWO Blade Repair", "GWO Slinger Signaller",
    "GWO Enhanced First Aid", "GWO Control of Hazardous Energies", "GWO COHE",
    "Working at Height", "Manual Handling", "Fire Awareness", "First Aid", "Sea Survival",
    # OPITO
    "BOSIET", "FOET", "HUET", "CA-EBS", "T-BOSIET", "T-FOET", "OPITO Banksman",
    "Minimum Industry Safety Training", "MIST", "Helicopter Underwater Escape Training",
    # IRATA / rope access
    "IRATA Level 1", "IRATA Level 2", "IRATA Level 3", "Rope Access Level 1",
    "Rope Access Level 2", "Rope Access Level 3",
    # Marine / VTS
    "VTS Operator", "VTS Supervisor", "VTS On-the-Job Trainer", "STCW", "GMDSS",
    # General safety
    "NEBOSH General Certificate", "NEBOSH", "IOSH Managing Safely", "IOSH",
    "OSHA 500", "OSHA 510", "OSHA 511", "Confined Space", "Working at Heights",
)

#: Words that mark a block as a bundle rather than a single course.
PACKAGE_MARKERS = (
    r"packages?", r"bundles?", r"combos?", r"combinations?", r"deals?",
    r"all[-\s]?in[-\s]?one", r"complete\s+(?:course|training|programme|program)",
    r"full\s+(?:course|training|programme|program)\s+(?:package|set)",
    r"training\s+(?:programme|program|pathway|package)", r"multi[-\s]?course",
    # Baltic / Nordic / German / Polish
    r"pakete", r"paketes", r"komplekts", r"komplekti", r"pakett", r"paketid",
    r"pakke", r"pakker", r"paket", r"paketet", r"pakiet", r"pakiety", r"zestaw",
    r"gesamtpaket", r"kombipaket", r"kurspaket",
)

#: Wording that introduces a list of contents.
CONTENTS_MARKERS = (
    r"includes?", r"including", r"included", r"consists?\s+of", r"comprises?",
    r"contains?", r"covers?", r"you\s+will\s+complete", r"made\s+up\s+of",
    r"ietver", r"iek[lļ]auj", r"sast[aā]v\s+no", r"sisaldab", r"koosneb",
    r"inneholder", r"omfatter", r"inneh[aå]ller", r"beinhaltet", r"enth[aä]lt",
    r"umfasst", r"zawiera", r"obejmuje",
)

SAVINGS_MARKERS = (
    r"save\s+\d", r"savings?\s+of", r"discount", r"instead\s+of", r"normally",
    r"reduced\s+from", r"was\s+[€£$]?\d", r"ietaupiet", r"atlaide", r"rabatt",
    r"soodustus", r"ersparnis", r"znizka",
)

_PACKAGE_RE = re.compile(r"\b(?:" + "|".join(PACKAGE_MARKERS) + r")\b", re.IGNORECASE)
_CONTENTS_RE = re.compile(r"\b(?:" + "|".join(CONTENTS_MARKERS) + r")\b[:\s]", re.IGNORECASE)
_SAVINGS_RE = re.compile(r"(?:" + "|".join(SAVINGS_MARKERS) + r")", re.IGNORECASE)

#: Separators that join course names in a bundle title: "BOSIET + HUET", "BST & BSTR".
_JOINERS = re.compile(r"\s*(?:\+|&|/|,|;|\band\b|\bplus\b|\bun\b|\bja\b|\bund\b|\boraz\b)\s*",
                      re.IGNORECASE)


@dataclass(frozen=True)
class PackageItem:
    """One course inside a bundle."""

    name: str
    ordinal: int
    matched_by: str          # gazetteer | pattern | list_item
    quote: str = ""


@dataclass
class Package:
    """A multi-course offer, with the evidence that identified it."""

    name: str
    items: list[PackageItem] = field(default_factory=list)
    price: Optional[Money] = None
    locator: str = ""
    quote: str = ""
    confidence: str = "probable"
    evidence: list[str] = field(default_factory=list)

    @property
    def item_names(self) -> list[str]:
        return [item.name for item in self.items]

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "items": [{"name": i.name, "ordinal": i.ordinal, "matched_by": i.matched_by}
                      for i in self.items],
            "price": self.price.as_dict() if self.price else None,
            "confidence": self.confidence, "locator": self.locator,
            "quote": self.quote, "evidence": list(self.evidence),
        }


def _fold(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in folded if not unicodedata.combining(ch)).lower()


# -- course names -------------------------------------------------------------------------

def _gazetteer_patterns(extra: Sequence[str] = ()) -> list[tuple[str, re.Pattern]]:
    """Longest names first, so "GWO BST Refresher" wins over "GWO BST"."""
    names = list(COURSE_GAZETTEER) + [name for name in extra if name]
    unique = sorted(set(names), key=lambda n: (-len(n), n))
    return [(name, re.compile(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])",
                              re.IGNORECASE))
            for name in unique]


_DEFAULT_PATTERNS = _gazetteer_patterns()


def find_course_names(text: str, *, extra_names: Sequence[str] = (),
                      max_names: int = 40) -> list[tuple[str, str]]:
    """Find known course names in a fragment of text.

    Returns ``(canonical_name, matched_text)`` in order of first appearance, with
    overlapping matches suppressed so "GWO BST Refresher" is not also reported as
    "GWO BST".
    """
    if not text:
        return []
    patterns = _gazetteer_patterns(extra_names) if extra_names else _DEFAULT_PATTERNS
    claimed: list[tuple[int, int]] = []
    found: list[tuple[int, str, str]] = []
    for canonical, pattern in patterns:
        for match in pattern.finditer(text):
            start, end = match.span()
            if any(start < other_end and other_start < end
                   for other_start, other_end in claimed):
                continue
            claimed.append((start, end))
            found.append((start, canonical, match.group(0)))
            if len(found) >= max_names:
                break
        if len(found) >= max_names:
            break
    found.sort()
    return [(canonical, matched) for _, canonical, matched in found]


# -- bundle detection -----------------------------------------------------------------------


def _items_from_list(block, limit: int = 30) -> list[tuple[str, str]]:
    """Course names taken from real list items inside the block."""
    results: list[tuple[str, str]] = []
    try:
        nodes = block.xpath(".//li")[:limit]
    except Exception:
        return results
    for node in nodes:
        try:
            text = " ".join(node.text_content().split())
        except Exception:
            continue
        if not text or len(text) > 160:
            continue
        names = find_course_names(text)
        if names:
            results.append((names[0][0], text))
        elif 3 <= len(text) <= 80:
            # A short list item under a contents marker is a course even when it is not in
            # the gazetteer — the site is telling us what is in the package.
            results.append((text, text))
    return results


def _items_from_joined_title(title: str) -> list[tuple[str, str]]:
    """"BOSIET + HUET + CA-EBS" — a bundle named by listing its parts.

    Sites abbreviate the second and later parts against the first: "IRATA Level 1 / Level 2",
    "GWO BST + BSTR". A bare "Level 2" is not in the gazetteer and should not be, since it
    means nothing on its own — but next to "IRATA Level 1" it is unambiguous. Unmatched
    parts are retried with the leading words of a matched sibling.
    """
    parts = [part.strip() for part in _JOINERS.split(title) if part and part.strip()]
    if len(parts) < MIN_ITEMS:
        return []
    results: list[tuple[str, str]] = []
    prefixes: list[str] = []
    for part in parts:
        names = find_course_names(part)
        if names:
            canonical = names[0][0]
            results.append((canonical, part))
            words = canonical.split()
            # Every leading prefix, shortest first: for "IRATA Level 1" the useful prefix
            # for a sibling "Level 2" is "IRATA", not "IRATA Level" — which would build
            # "IRATA Level Level 2".
            for width in range(1, len(words)):
                prefix = " ".join(words[:width])
                if prefix not in prefixes:
                    prefixes.append(prefix)
            continue
        completed = None
        for prefix in prefixes:
            candidate = f"{prefix} {part}"
            matched = find_course_names(candidate)
            if matched and matched[0][0].lower() == candidate.lower():
                completed = matched[0][0]
                break
        if completed:
            results.append((completed, part))
        elif 2 <= len(part) <= 60 and not _PACKAGE_RE.search(part):
            results.append((part, part))
    return results if len(results) >= MIN_ITEMS else []


def _dedupe(items: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    kept: list[tuple[str, str]] = []
    for name, quote in items:
        key = _fold(name)
        if key and key not in seen:
            seen.add(key)
            kept.append((name, quote))
    return kept


def _locator(element) -> str:
    try:
        return element.getroottree().getpath(element)
    except Exception:
        return ""


def _block_text(element, limit: int = 4000) -> str:
    try:
        parts = [" ".join(chunk.split()) for chunk in element.itertext()]
        return " ".join(part for part in parts if part)[:limit]
    except Exception:
        return ""


def _title_of(element, fallback: str) -> str:
    for expression in ("./h1", "./h2", "./h3", "./h4", ".//h2", ".//h3", ".//h4",
                       ".//*[@class='title' or @class='name']"):
        try:
            nodes = element.xpath(expression)
        except Exception:
            continue
        for node in nodes[:1]:
            text = " ".join(node.text_content().split())
            if text:
                return text[:200]
    return fallback[:200]


def detect_package(text: str, *, title: str = "", locator: str = "",
                   block=None, locale_hint: Optional[str] = None,
                   default_includes_vat: Optional[bool] = None,
                   extra_names: Sequence[str] = ()) -> Optional[Package]:
    """Decide whether one block of content describes a bundle, and what is in it."""
    if not text:
        return None
    # The block text already contains its own heading; prepending the title again doubled
    # it in every stored summary and evidence quote.
    combined = text.strip() if _fold(text).startswith(_fold(title)) and title \
        else f"{title} {text}".strip()
    evidence: list[str] = []

    marker = _PACKAGE_RE.search(combined)
    contents_marker = _CONTENTS_RE.search(combined)
    joined = _items_from_joined_title(title) if title else []

    if marker:
        evidence.append(f"package wording {marker.group(0)!r}")
    if contents_marker:
        evidence.append(f"contents wording {contents_marker.group(0)!r}")
    if joined:
        evidence.append("title lists several courses")
    if not (marker or joined):
        return None

    items: list[tuple[str, str]] = list(joined)
    if block is not None and contents_marker:
        items.extend(_items_from_list(block))
    if len(items) < MIN_ITEMS:
        tail = combined[contents_marker.end():] if contents_marker else combined
        items.extend(find_course_names(tail, extra_names=extra_names))
    items = _dedupe(items)

    # The rule that keeps `package` from becoming a duplicate of `offering`.
    if len(items) < MIN_ITEMS:
        return None

    prices = parse_money(combined, locale_hint=locale_hint,
                         default_includes_vat=default_includes_vat)
    price = best_price(prices)
    if price is not None:
        evidence.append(f"price {price.normalized}")
    if _SAVINGS_RE.search(combined):
        evidence.append("savings wording present")

    confidence = "probable"
    if marker and price is not None and len(items) >= MIN_ITEMS:
        confidence = "certain" if contents_marker or joined else "probable"
    elif not marker:
        confidence = "ambiguous"

    name = title.strip() or (marker.group(0) if marker else "package")
    return Package(
        name=name[:200],
        items=[PackageItem(item_name, index,
                           "gazetteer" if any(item_name.lower() == g.lower()
                                              for g in COURSE_GAZETTEER) else "list_item",
                           quote[:300])
               for index, (item_name, quote) in enumerate(items)],
        price=price, locator=locator, quote=combined[:500],
        confidence=confidence, evidence=evidence,
    )


def find_packages(tree=None, *, text: Optional[str] = None,
                  locale_hint: Optional[str] = None,
                  extra_names: Sequence[str] = (),
                  max_packages: int = MAX_PACKAGES) -> list[Package]:
    """Find every bundle on a page.

    Works from a DOM when one is available — list items are the clearest statement of what
    a package contains — and degrades to flat text when it is not.
    """
    packages: list[Package] = []
    page_text = text if text is not None else _block_text(tree, MAX_INPUT)
    if not page_text:
        return packages
    page_vat = page_vat_statement(page_text)

    if tree is not None:
        candidates = []
        for expression in ("//section", "//article", "//div", "//li", "//tr"):
            try:
                candidates.extend(tree.xpath(expression)[:400])
            except Exception:
                continue
        seen_locators: set[str] = set()
        for block in candidates:
            if len(packages) >= max_packages:
                break
            block_text = _block_text(block)
            if not block_text or len(block_text) > 3000:
                continue
            if not _PACKAGE_RE.search(block_text):
                continue
            locator = _locator(block)
            if any(locator.startswith(other + "/") or locator == other
                   for other in seen_locators):
                continue
            package = detect_package(
                block_text, title=_title_of(block, block_text), locator=locator,
                block=block, locale_hint=locale_hint, default_includes_vat=page_vat,
                extra_names=extra_names,
            )
            if package is not None:
                packages.append(package)
                seen_locators.add(locator)
        if packages:
            return packages

    package = detect_package(page_text, title="", locale_hint=locale_hint,
                             default_includes_vat=page_vat, extra_names=extra_names)
    return [package] if package is not None else []


def to_schema_rows(package: Package, *, centre_id: str, package_id: str,
                   certificate_ids: dict) -> dict:
    """Shape a detected package for the 2.2.0 ``package`` / ``package_item`` tables.

    ``certificate_ids`` maps item name to an existing ``certificate_id``; items with no
    certificate are returned separately rather than invented, because ``package_item``
    requires a real certificate and a bundle naming an unknown course is a review item.
    """
    items = []
    unresolved = []
    for item in package.items:
        certificate_id = certificate_ids.get(item.name) or certificate_ids.get(
            item.name.lower())
        if certificate_id:
            items.append({"package_id": package_id, "certificate_id": certificate_id,
                          "item_ordinal": len(items)})
        else:
            unresolved.append(item.name)
    row = {
        "package": {"package_id": package_id, "centre_id": centre_id,
                    "package_name": package.name,
                    "published_summary": package.quote[:500] or None},
        "package_item": items,
        "unresolved_items": unresolved,
    }
    if package.price is not None and package.price.amount is not None:
        row["price_observation"] = {
            "package_id": package_id, "offering_id": None,
            "amount": str(package.price.amount),
            "currency": package.price.currency,
            "price_basis": "package",
            "includes_vat": package.price.includes_vat,
        }
    return row
