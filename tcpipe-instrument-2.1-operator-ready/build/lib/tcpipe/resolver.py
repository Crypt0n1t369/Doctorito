"""Deterministic entity resolution (G5a).

Identity is decided by evidence rank, never by similarity score. The same training centre
appears in the GWO, OPITO and IRATA directories under different names, so resolution has to
be reproducible: given the same observations, the same centre, every replay.

Rank order, strongest first:

1. ``official_provider_id`` scoped to its issuing source — the only genuinely authoritative
   key, which is why the schema forbids an unscoped one.
2. Registrable domain of the published website.
3. Normalized name within a country.

Anything ambiguous is a **merge blocker**: the resolver refuses and hands the case to
review rather than guessing. An unresolved centre costs one human minute; a wrongly merged
one silently fuses two businesses' prices and contacts.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence
from urllib.parse import urlsplit

# Multi-label public suffixes common in this domain. Not a full PSL: an unknown multi-part
# suffix degrades to a slightly-too-long domain, which blocks a merge rather than forcing a
# wrong one. Extend from the real PSL before large-scale tier-2 resolution.
MULTI_PART_SUFFIXES = frozenset({
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au",
    "co.nz", "net.nz", "org.nz", "co.za", "org.za", "com.br", "com.mx", "com.sg",
    "com.tr", "com.cn", "com.hk", "co.jp", "or.jp", "ne.jp", "co.in", "co.kr",
    "com.pl", "com.es", "com.pt", "com.ua", "co.no", "com.cy", "com.mt",
})

LEGAL_SUFFIXES = (
    "limited", "ltd", "llc", "inc", "incorporated", "corporation", "corp", "company",
    "gmbh", "ag", "bv", "nv", "sa", "sas", "sarl", "srl", "spa", "oy", "ab", "as",
    "a/s", "aps", "sia", "ou", "oü", "uab", "sp z o o", "sp zoo", "zoo", "pte",
    "pty", "plc", "kft", "doo", "d o o", "ehf", "hf", "vof",
)

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+")
_NOISE_WORDS = frozenset({"the", "and", "of"})


def _fold(value: str) -> list[str]:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = _PUNCT.sub(" ", text.casefold())
    return [t for t in _WS.sub(" ", text).strip().split(" ") if t]


# Legal forms are folded through the SAME punctuation rules as the names they are stripped
# from, so "A/S" becomes the token pair ("a","s") and still matches. Longest first, because
# "sp z o o" must be tried before "o".
_SUFFIX_TOKENS = sorted((tuple(_fold(suffix)) for suffix in LEGAL_SUFFIXES),
                        key=len, reverse=True)


class ResolutionBlocked(RuntimeError):
    """Resolution could not proceed without a human decision."""

    def __init__(self, reason: str, detail: dict):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


def normalize_name(value: str) -> str:
    """Fold a published name to a comparable key.

    Deliberately lossy but deterministic: accents folded, punctuation dropped, legal form
    and filler words removed. "Rīgas Ostas Centrs SIA" and "Rigas Ostas Centrs" agree;
    "Nordic Wind Academy" and "Nordic Wind Academy Norway" do not, because a place name is
    not filler and two branches are not one entity.
    """
    tokens = _fold(value)
    stripping = True
    while stripping and tokens:
        stripping = False
        for suffix in _SUFFIX_TOKENS:
            width = len(suffix)
            if width and len(tokens) > width and tuple(tokens[-width:]) == suffix:
                del tokens[-width:]
                stripping = True
                break
    tokens = [t for t in tokens if t not in _NOISE_WORDS]
    return " ".join(tokens)


def registrable_domain(url_or_host: str) -> Optional[str]:
    """Reduce a URL or host to its registrable domain, lowercased."""
    if not url_or_host:
        return None
    candidate = url_or_host.strip()
    if "://" in candidate:
        host = urlsplit(candidate).hostname or ""
    else:
        host = urlsplit("//" + candidate).hostname or candidate
    host = host.strip().lower().rstrip(".")
    if not host or host.replace(".", "").isdigit():
        return None
    if host.startswith("www."):
        host = host[4:]
    labels = host.split(".")
    if len(labels) < 2:
        return None
    last_two = ".".join(labels[-2:])
    if last_two in MULTI_PART_SUFFIXES and len(labels) >= 3:
        return ".".join(labels[-3:])
    return last_two


@dataclass(frozen=True)
class IdentityKey:
    kind: str  # official_provider_id | domain | name_country
    value: str
    source_scope: str = ""

    @property
    def rank(self) -> int:
        return {"official_provider_id": 1, "domain": 2, "name_country": 3}[self.kind]


@dataclass
class CandidateCentre:
    """The identity evidence extracted from one parsed source record."""

    display_name: str
    country_iso2: Optional[str] = None
    website_url: Optional[str] = None
    provider_ids: Sequence[tuple[str, str]] = ()  # (source_scope, id_value)
    keys: list[IdentityKey] = field(default_factory=list)

    def build_keys(self) -> list[IdentityKey]:
        keys = [
            IdentityKey("official_provider_id", value, scope)
            for scope, value in self.provider_ids if value and scope
        ]
        domain = registrable_domain(self.website_url or "")
        if domain:
            keys.append(IdentityKey("domain", domain))
        normalized = normalize_name(self.display_name)
        if normalized:
            country = (self.country_iso2 or "").upper()
            keys.append(IdentityKey("name_country", f"{normalized}|{country}"))
        self.keys = sorted(keys, key=lambda k: (k.rank, k.kind, k.value))
        return self.keys


@dataclass(frozen=True)
class Resolution:
    centre_id: Optional[str]
    matched_by: Optional[IdentityKey]
    is_new: bool
    blockers: tuple[str, ...] = ()


def lookup_centre(con, key: IdentityKey) -> Optional[str]:
    if key.kind == "name_country":
        row = con.execute(
            """SELECT centre_id FROM centre_identifier
                WHERE id_kind='legacy_tc_id' AND id_value=? AND source_scope='name_country'""",
            (key.value,),
        ).fetchone()
        return row["centre_id"] if row else None
    row = con.execute(
        "SELECT centre_id FROM centre_identifier WHERE id_kind=? AND id_value=? AND source_scope=?",
        (key.kind, key.value, key.source_scope),
    ).fetchone()
    return row["centre_id"] if row else None


def resolve(con, candidate: CandidateCentre, *, allow_create: bool = True) -> Resolution:
    """Resolve a candidate to an existing centre, or report why it cannot be resolved."""
    keys = candidate.build_keys()
    if not keys:
        return Resolution(None, None, False, ("no identity evidence on record",))

    matches: dict[str, list[IdentityKey]] = {}
    for key in keys:
        centre_id = lookup_centre(con, key)
        if centre_id:
            matches.setdefault(centre_id, []).append(key)

    if not matches:
        return Resolution(None, None, True, ()) if allow_create else Resolution(
            None, None, False, ("no match and creation disabled",)
        )

    if len(matches) == 1:
        centre_id, matched_keys = next(iter(matches.items()))
        best = min(matched_keys, key=lambda k: k.rank)
        blockers = _conflict_blockers(con, centre_id, candidate, best)
        if blockers:
            return Resolution(None, None, False, tuple(blockers))
        return Resolution(centre_id, best, False, ())

    # Several distinct centres matched. A strictly stronger key wins outright; otherwise
    # this is exactly the ambiguity a human has to settle.
    ranked = sorted(
        ((min(k.rank for k in ks), centre_id) for centre_id, ks in matches.items())
    )
    if len(ranked) > 1 and ranked[0][0] < ranked[1][0]:
        centre_id = ranked[0][1]
        best = min(matches[centre_id], key=lambda k: k.rank)
        blockers = _conflict_blockers(con, centre_id, candidate, best)
        if blockers:
            return Resolution(None, None, False, tuple(blockers))
        return Resolution(centre_id, best, False, ())

    return Resolution(None, None, False, (
        "ambiguous identity: {} distinct centres matched at equal evidence rank ({})".format(
            len(matches), ", ".join(sorted(matches))
        ),
    ))


def _conflict_blockers(con, centre_id: str, candidate: CandidateCentre,
                       matched: IdentityKey) -> list[str]:
    """Refuse a match whose supporting evidence contradicts the stored centre."""
    blockers: list[str] = []
    row = con.execute(
        "SELECT display_name, registrable_domain, entity_state FROM centre WHERE centre_id=?",
        (centre_id,),
    ).fetchone()
    if row is None:
        return [f"matched centre {centre_id} no longer exists"]
    if row["entity_state"] == "merged_into":
        blockers.append(f"matched centre {centre_id} has been merged into another centre")
    if row["entity_state"] == "rejected":
        blockers.append(f"matched centre {centre_id} was previously rejected")

    candidate_domain = registrable_domain(candidate.website_url or "")
    stored_domain = (row["registrable_domain"] or "").lower() or None
    if (matched.kind != "domain" and candidate_domain and stored_domain
            and candidate_domain != stored_domain):
        blockers.append(
            f"domain conflict: record says {candidate_domain}, centre says {stored_domain}"
        )
    if matched.kind == "domain":
        stored_name = normalize_name(row["display_name"])
        record_name = normalize_name(candidate.display_name)
        if stored_name and record_name and not _names_compatible(stored_name, record_name):
            blockers.append(
                f"same domain but incompatible names: {row['display_name']!r} vs "
                f"{candidate.display_name!r}"
            )
    return blockers


def _names_compatible(a: str, b: str) -> bool:
    """Token containment, not fuzzy distance — a deterministic, explainable rule."""
    if a == b:
        return True
    tokens_a, tokens_b = set(a.split()), set(b.split())
    if not tokens_a or not tokens_b:
        return False
    return tokens_a <= tokens_b or tokens_b <= tokens_a


def identifier_rows(centre_id: str, candidate: CandidateCentre
                    ) -> list[tuple[str, str, str, str]]:
    """The ``centre_identifier`` rows a resolved candidate justifies."""
    rows = []
    for key in candidate.build_keys():
        if key.kind == "official_provider_id":
            rows.append(("official_provider_id", key.value, key.source_scope, centre_id))
        elif key.kind == "domain":
            rows.append(("domain", key.value, "", centre_id))
        else:
            rows.append(("legacy_tc_id", key.value, "name_country", centre_id))
    return rows


def identifier_entity_id(id_kind: str, id_value: str, source_scope: str) -> str:
    """The composite key ``materialization_lineage`` uses for centre_identifier."""
    return f"{id_kind}:{id_value}:{source_scope}"
