"""Page classification (T2-04): what kind of page is this, and what may be read from it.

The money parser deliberately cannot tell a price from a duration — ``3`` and ``1250`` are
both just numbers, and a course page is full of both. That judgement needs page-level
context, which is what this module supplies. Its most load-bearing output is not the label
but ``price_context``: whether a bare number on this page may be read as money at all. On a
page with no pricing signal, an unlabelled number is a group size or a module count, and
promoting it to a price manufactures confident nonsense.

Classification is multi-label on purpose. A real course page usually *is* a course page and
a contact page and a price list at once, and forcing a single winner throws away the other
two extractions.

Every score carries named evidence, because tier-2 output is review-only and a human has to
be able to see why a page was read the way it was.

Never raises, bounded, deterministic — scores are computed from sorted inputs so the same
page always classifies identically.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence
from urllib.parse import urlsplit

MAX_TEXT = 400_000
MAX_NODES = 20_000

COURSE = "course"
COURSE_LIST = "course_list"
PRICE_LIST = "price_list"
CONTACT = "contact"
CENTRE_PROFILE = "centre_profile"
SCHEDULE = "schedule"
OTHER = "other"

ALL_KINDS = (COURSE, COURSE_LIST, PRICE_LIST, CONTACT, CENTRE_PROFILE, SCHEDULE)

#: Keyword families, folded and accent-stripped before comparison. The corpus is Baltic,
#: Nordic, German and English first; a page that says "hinnad" is a price list even though
#: nothing on it says "price".
KEYWORDS = {
    COURSE: (
        "course", "courses", "training", "trainings", "class", "classes", "workshop",
        "seminar", "certification", "qualification", "kurs", "kurse", "kursus", "kurser",
        "kursi", "kurss", "kursai", "koolitus", "koolitused", "apmacibas", "mokymai",
        "szkolenie", "szkolenia", "kurz", "cours", "curso", "corso", "opleiding",
        "opplaering", "utbildning", "koulutus",
    ),
    PRICE_LIST: (
        "price", "prices", "pricing", "fee", "fees", "cost", "costs", "rate", "rates",
        "tariff", "tariffs", "pris", "priser", "prisliste", "prislista", "hind", "hinnad",
        "hinnakiri", "cena", "cenas", "cenradis", "cennik", "preis", "preise",
        "preisliste", "prijs", "tarief", "tarif", "prezzo", "precio", "kaina", "kainos",
    ),
    CONTACT: (
        "contact", "contacts", "contact us", "get in touch", "reach us", "enquiry",
        "enquiries", "kontakt", "kontakti", "kontaktid", "kontakty", "kontaktai",
        "contacto", "contatti", "contactez", "yhteystiedot", "sazinies",
    ),
    CENTRE_PROFILE: (
        "about", "about us", "who we are", "our story", "company", "om oss", "om os",
        "uber uns", "par mums", "meist", "o nas", "chi siamo", "sobre nosotros",
        "tietoa meista", "apie mus",
    ),
    SCHEDULE: (
        "schedule", "timetable", "calendar", "dates", "upcoming", "availability",
        "book now", "booking", "kalender", "kalendar", "grafiks", "ajakava", "aikataulu",
        "terminplan", "kursusdatoer", "datumi",
    ),
}

#: URL path fragments are a stronger signal than body text: a site author chose them.
URL_HINTS = {
    COURSE: ("course", "courses", "training", "kurs", "kursi", "koolitus", "szkolenie",
             "opleiding", "utbildning", "seminar", "workshop", "class"),
    PRICE_LIST: ("price", "prices", "pricing", "fees", "tariff", "pris", "hinnad",
                 "cenas", "cennik", "preise", "kaina"),
    CONTACT: ("contact", "kontakt", "kontakti", "contacto", "contatti", "yhteystiedot"),
    CENTRE_PROFILE: ("about", "about-us", "company", "om-oss", "par-mums", "o-nas"),
    SCHEDULE: ("schedule", "timetable", "calendar", "dates", "booking", "kalender"),
}

#: schema.org types that assert a page kind outright.
SCHEMA_KIND = {
    "course": COURSE, "courseinstance": COURSE, "educationaloccupationalprogram": COURSE,
    "event": SCHEDULE, "educationevent": SCHEDULE,
    "offer": PRICE_LIST, "aggregateoffer": PRICE_LIST, "pricespecification": PRICE_LIST,
    "contactpage": CONTACT, "contactpoint": CONTACT,
    "organization": CENTRE_PROFILE, "localbusiness": CENTRE_PROFILE,
    "educationalorganization": CENTRE_PROFILE, "aboutpage": CENTRE_PROFILE,
    "itemlist": COURSE_LIST, "collectionpage": COURSE_LIST,
}

_PRICE_SHAPED = re.compile(
    r"(?:[€£$¥]|\b(?:EUR|GBP|USD|SEK|NOK|DKK|PLN|CZK|CHF)\b)\s*\d"
    r"|\d[\d   .,]*\s*(?:[€£$]|\b(?:EUR|GBP|USD|SEK|NOK|DKK|PLN|CZK|CHF)\b)",
    re.IGNORECASE,
)
_VAT_WORDING = re.compile(
    r"\b(?:vat|mwst|moms|mva|pvn|kaibemaks|btw|iva|tva)\b", re.IGNORECASE
)
_DURATION = re.compile(
    r"\b\d{1,2}\s*(?:days?|day|hours?|hrs?|weeks?|dienas|stundas|paeva|tunni|tage|"
    r"stunden|dagar|timmar|dni|godzin)\b", re.IGNORECASE
)

#: Baltic and Slavic languages decline nouns, so "kurs" appears as kursu / kursi / kursa /
#: kursus / kursai. Exact-word matching missed a Latvian price list headed "Kursu cenradis"
#: entirely, which would have cost the course-to-price pairing — the single most valuable
#: thing on the page. These stems are matched with a bounded suffix.
STEM_KEYWORDS = {
    COURSE: ("kurs", "koolitus", "apmac", "szkolen", "mokym", "utbildning", "opleiding",
             "koulutus", "seminar", "workshop"),
    PRICE_LIST: ("cen", "hinn", "pris", "preis", "kain", "cennik", "tarif"),
    CONTACT: ("kontakt", "contact", "yhteystied", "sazin"),
    CENTRE_PROFILE: ("par mums", "uber uns", "om oss", "o nas", "apie mus"),
    SCHEDULE: ("kalend", "grafik", "ajakav", "aikataul", "termin"),
}

#: Score needed before a kind is reported at all.
THRESHOLD = 2.0


@dataclass
class Classification:
    """What this page is, why we think so, and what may be read from it."""

    kinds: dict = field(default_factory=dict)          # kind -> score
    evidence: dict = field(default_factory=dict)       # kind -> [reasons]
    price_context: bool = False
    contact_context: bool = False
    course_context: bool = False
    url: Optional[str] = None

    @property
    def primary(self) -> str:
        """The highest-scoring kind, or ``other``. Ties break by name, for determinism."""
        ranked = sorted(self.kinds.items(), key=lambda kv: (-kv[1], kv[0]))
        if not ranked or ranked[0][1] < THRESHOLD:
            return OTHER
        return ranked[0][0]

    @property
    def labels(self) -> list[str]:
        """Every kind that cleared the threshold, strongest first."""
        return [kind for kind, score in
                sorted(self.kinds.items(), key=lambda kv: (-kv[1], kv[0]))
                if score >= THRESHOLD]

    def extractors(self) -> list[str]:
        """Which field extractors this page justifies running."""
        wanted = ["published_name"]
        if self.course_context:
            wanted.append("certificate_name")
        if self.price_context:
            wanted.append("price_text")
        if self.contact_context:
            wanted.extend(["published_phone", "published_apply_url"])
        wanted.extend(["published_address", "published_locality", "published_country"])
        return sorted(set(wanted))

    def as_dict(self) -> dict:
        return {
            "primary": self.primary, "labels": self.labels,
            "scores": {k: round(v, 2) for k, v in sorted(self.kinds.items())},
            "evidence": {k: sorted(v) for k, v in sorted(self.evidence.items())},
            "price_context": self.price_context,
            "contact_context": self.contact_context,
            "course_context": self.course_context,
            "url": self.url,
        }


def _fold(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in folded if not unicodedata.combining(ch)).lower()


def _add(scores: dict, evidence: dict, kind: str, weight: float, reason: str) -> None:
    scores[kind] = scores.get(kind, 0.0) + weight
    evidence.setdefault(kind, []).append(reason)


def _safe_text(tree, limit: int = MAX_TEXT) -> str:
    if tree is None:
        return ""
    try:
        return tree.text_content()[:limit]
    except Exception:
        return ""


def _safe_xpath(tree, expression: str) -> list:
    if tree is None:
        return []
    try:
        result = tree.xpath(expression)
        return list(result)[:MAX_NODES] if isinstance(result, list) else []
    except Exception:
        return []


def classify_page(tree=None, *, url: Optional[str] = None, text: Optional[str] = None,
                  structured_types: Optional[Sequence[str]] = None) -> Classification:
    """Classify one page from whatever evidence is available.

    Any argument may be omitted: a URL alone still classifies, and so does raw text with no
    tree. Missing evidence lowers confidence rather than causing failure.
    """
    scores: dict = {}
    evidence: dict = {}

    body = text if text is not None else _safe_text(tree)
    folded_body = _fold(body)

    # -- URL: the strongest single signal, because an author chose the path --------------
    if url:
        try:
            path = _fold(urlsplit(url).path)
        except Exception:
            path = _fold(url)
        segments = [segment for segment in re.split(r"[^a-z0-9]+", path) if segment]
        for kind, hints in sorted(URL_HINTS.items()):
            for hint in hints:
                if hint in segments:
                    _add(scores, evidence, kind, 3.0, f"url path contains {hint!r}")
                    break
        # A course URL with a slug beyond the section is a single course, not the index.
        if COURSE in scores and len(segments) >= 2:
            tail = segments[-1]
            if tail not in URL_HINTS[COURSE] and not tail.isdigit():
                _add(scores, evidence, COURSE, 1.0, "url has a course slug")
            else:
                _add(scores, evidence, COURSE_LIST, 2.0, "url looks like a course index")

    # -- declared structured data: an assertion, not an inference -----------------------
    for declared in sorted({_fold(t) for t in (structured_types or []) if t}):
        kind = SCHEMA_KIND.get(declared)
        if kind:
            _add(scores, evidence, kind, 3.0, f"schema.org type {declared!r}")

    # -- title and headings -------------------------------------------------------------
    headings: list[str] = []
    for expression in ("//title", "//h1", "//h2"):
        for node in _safe_xpath(tree, expression)[:40]:
            try:
                heading = " ".join(node.text_content().split())
            except Exception:
                continue
            if heading:
                headings.append(heading)
    folded_headings = _fold(" | ".join(headings))
    for kind, words in sorted(KEYWORDS.items()):
        for word in words:
            if re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", folded_headings):
                _add(scores, evidence, kind, 2.0, f"heading mentions {word!r}")
                break
        else:
            for stem in STEM_KEYWORDS.get(kind, ()):
                if re.search(rf"(?<![a-z]){re.escape(stem)}\w{{0,4}}(?![a-z])",
                             folded_headings):
                    _add(scores, evidence, kind, 2.0, f"heading matches stem {stem!r}")
                    break

    # -- body keywords, weighted far lower than headings --------------------------------
    for kind, words in sorted(KEYWORDS.items()):
        hits = sum(1 for word in words
                   if re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", folded_body))
        if hits:
            _add(scores, evidence, kind, min(1.5, 0.5 * hits), f"body mentions {hits} {kind} term(s)")

    # -- concrete artefacts --------------------------------------------------------------
    price_hits = len(_PRICE_SHAPED.findall(body))
    if price_hits:
        _add(scores, evidence, PRICE_LIST, min(3.0, 0.75 * price_hits),
             f"{price_hits} currency-marked amount(s)")
    if _VAT_WORDING.search(body):
        _add(scores, evidence, PRICE_LIST, 1.5, "VAT wording present")

    tel_links = _safe_xpath(tree, "//a[starts-with(@href,'tel:')]")
    mail_links = _safe_xpath(tree, "//a[starts-with(@href,'mailto:')]")
    if tel_links:
        _add(scores, evidence, CONTACT, 2.5, f"{len(tel_links)} tel: link(s)")
    if mail_links:
        _add(scores, evidence, CONTACT, 1.5, f"{len(mail_links)} mailto: link(s)")
    if _safe_xpath(tree, "//form[.//input or .//textarea]"):
        _add(scores, evidence, CONTACT, 1.0, "contact-shaped form present")
    if _safe_xpath(tree, "//*[@itemtype and contains(@itemtype,'PostalAddress')]") or \
            _safe_xpath(tree, "//address"):
        _add(scores, evidence, CONTACT, 1.0, "address markup present")

    course_links = [
        node for node in _safe_xpath(tree, "//a[@href]")
        if any(hint in _fold(node.get("href") or "") for hint in URL_HINTS[COURSE])
    ]
    if len(course_links) >= 5:
        _add(scores, evidence, COURSE_LIST, min(3.0, 0.3 * len(course_links)),
             f"{len(course_links)} links into course pages")
        # Many links out to courses means this is the index, not one of them.
        _add(scores, evidence, COURSE, -1.5, "many course links suggest an index page")

    if _DURATION.search(body):
        _add(scores, evidence, COURSE, 1.0, "course duration wording present")

    tables = _safe_xpath(tree, "//table")
    if tables and price_hits >= 2:
        _add(scores, evidence, PRICE_LIST, 1.5, "table alongside multiple amounts")

    classification = Classification(kinds=scores, evidence=evidence, url=url)

    # -- what may be read from this page -------------------------------------------------
    # price_context is the reason this module exists: it is what lets a bare number be
    # read as money. It requires a positive pricing signal, never a mere absence of one.
    classification.price_context = bool(
        price_hits
        or scores.get(PRICE_LIST, 0.0) >= THRESHOLD
        or _VAT_WORDING.search(body)
    )
    classification.contact_context = bool(
        tel_links or mail_links or scores.get(CONTACT, 0.0) >= THRESHOLD
    )
    # A training centre's price list prices courses, so a price list is course context
    # too. Without this the course-to-price pairing is lost on exactly the pages that
    # state both.
    classification.course_context = bool(
        scores.get(COURSE, 0.0) >= THRESHOLD or scores.get(COURSE_LIST, 0.0) >= THRESHOLD
        or scores.get(SCHEDULE, 0.0) >= THRESHOLD
        or scores.get(PRICE_LIST, 0.0) >= THRESHOLD
    )
    return classification


def classify_url(url: str) -> Classification:
    """Classify from a URL alone — used to prioritise which pages are worth fetching."""
    return classify_page(None, url=url, text="")


def is_worth_fetching(url: str) -> bool:
    """Whether a discovered URL looks like it carries any field tier 2 wants.

    Used by discovery (T2-16) to bound a per-host crawl. Deliberately generous: a false
    positive costs one fetch, a false negative loses a centre's prices entirely.
    """
    if not url:
        return False
    classification = classify_url(url)
    return classification.primary != OTHER or bool(classification.kinds)
