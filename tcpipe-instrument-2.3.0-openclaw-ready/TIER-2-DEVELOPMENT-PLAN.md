# Tier 2 — centre-site intel extraction: development plan

**Status file for autonomous development.** Each work session picks the next unchecked
item, implements it with tests, ticks it, and appends to the log at the bottom.

## The problem tier 2 actually poses

Tier 1 parses 5 known association directories with 5 bespoke adapters. Tier 2 must read
~1,200 *unknown* training-centre websites for courses, prices, bundle packages, contact
numbers and locations. Per-site adapters do not scale, so tier 2 needs a **generic
extractor that is honest about its own uncertainty**.

### Design commitments (do not violate these)

1. **Precision over recall.** A wrong price is far worse than a missing one. Every
   extractor must be able to return "I don't know" and must prefer that to a guess.
2. **Review-only output.** Tier-2 extractions land as `field_observation` rows with
   `validation_state='pending'` and a `review_queue` entry. They MUST NOT become governed
   entities without a human decision. FOUNDATION G5 already requires this for
   non-deterministic output; tier 2 is exactly that case.
3. **Evidence for every value.** artifact sha256 + locator + verbatim quote, same as tier 1.
   A price with no quote is not a price.
4. **Never crash.** Malformed HTML, hostile markup, 50MB pages, wrong encodings, infinite
   nesting — the extractor degrades to fewer fields, never to an exception.
5. **Deterministic and replayable.** Same bytes in, same observations out, always.
6. **Bounded.** Page size, node count, and time are all capped and enforced.
7. **No live fetching during development.** Tier-2 acquisition requires per-source policy
   reviews that do not exist. Build against synthetic fixtures only.

## Work items

- [x] T2-01 Structured-data extractor: JSON-LD (schema.org Course/Offer/Organization/
      LocalBusiness/AggregateOffer), microdata, RDFa-lite, OpenGraph. Highest-precision
      generic signal; many real course pages carry it.
- [x] T2-02 Money parser: multi-currency, symbol/ISO/prefix/suffix, thousands and decimal
      separators across locales, VAT wording, ranges ("from X"), per-person/per-group.
      Must refuse ambiguous input rather than guess a locale.
- [x] T2-03 Phone parser: E.164 normalization with country context, extension handling,
      rejects things that merely look numeric (dates, IDs, postcodes).
- [x] T2-04 Page classifier: is this a course page, a price list, a contact page, a
      centre-profile page, or none of those? Drives which extractors run.
- [x] T2-05 Repeated-structure detector: find the course/price list on an unknown page by
      structural repetition rather than by selector.
- [x] T2-06 Bundle/package detector: recognise multi-course offers and map their contents
      onto `package` / `package_item`.
- [x] T2-07 Confidence scoring + conflict detection across extractors; disagreement is a
      review item, never a silent winner.
- [ ] T2-08 Robustness/fuzz suite: malformed HTML, adversarial markup, encoding chaos,
      size bombs, deeply nested trees. Must never raise.
- [ ] T2-09 Tier-2 pipeline: emit review-only observations + `review_queue` rows, with
      `accreditation.direction='reverse'`, `evidence_strength='centre_self_claim'`.
- [ ] T2-10 Site discovery: robots/sitemap-driven candidate URL selection, bounded per host.
- [ ] T2-11 Golden-corpus harness: measure precision/recall per field over the fixture
      corpus so robustness claims are measured, not asserted.

### Additional acquisition avenues (coverage, not just parsing)

The point of these is that structured data is only present on a minority of sites. Each
avenue below recovers fields the previous one missed, so coverage is the union.

- [ ] T2-12 Embedded JSON state: `__NEXT_DATA__`, `window.__NUXT__`, `__INITIAL_STATE__`,
      Redux/Apollo preload blobs. Client-rendered sites usually ship their whole catalogue
      here as JSON — often the single richest source on a modern site.
- [ ] T2-13 `tel:` / `mailto:` link harvesting. Near-perfect precision for contacts:
      the site has explicitly marked the string as a phone number or address.
- [ ] T2-14 HTML table extractor with header inference. Price lists are overwhelmingly
      tables; map header cells to fields (course / duration / price / dates).
- [ ] T2-15 Definition lists, cards and `<dl>`/label-value pairs — the other common
      price/spec layout.
- [ ] T2-16 URL-pattern and sitemap discovery: `/courses`, `/training`, `/prices`,
      `/book`, `/contact`, plus `sitemap.xml` walking, bounded per host.
- [ ] T2-17 Linked PDF/DOCX catalogue and price-list extraction (reuses the tier-1 PDF path).
- [ ] T2-18 Geo signals: map embeds, `geo` microformats, coordinates in JSON state.
- [ ] T2-19 Currency/locale inference from page context (TLD, lang attribute, address
      country) to disambiguate a bare "1.250,00".
- [ ] T2-20 Course-name gazetteer built from tier-1 certificates (GWO BST, BOSIET, IRATA
      Level 1…). Knowing what to look for beats generic NER on this domain.

## Log

(Newest last. One entry per session.)

### 2026-08-20 07:01Z — session 1

**T2-01 structured-data extractor — done.** `src/tcpipe/structured.py`, 17 tests in
`tests/test_structured.py`. Reads JSON-LD (incl. `@graph` flattening, cycle and depth
guards), microdata, RDFa-lite and OpenGraph. Recovers all five target fields: name, phone,
address/locality/country, course names, prices (incl. AggregateOffer low/high), and course
descriptions as `package_contents`.

Bugs found and fixed while building:
- A stray non-ASCII character had corrupted a schema.org type name, silently disabling
  `EducationalOccupationalProgram` matching.
- The nested-offer walk leaked its loop variable into the locator, so nested price
  provenance pointed at the wrong key.
- **Coverage bug:** microdata `name` was mapped without regard to its enclosing itemtype,
  so every course title inside a `Course` scope was filed as an organisation name and the
  course list was lost. Mapping is now type-aware; `name` inside an `Offer` is also read as
  a course name, since in this domain an offer names the thing being sold.

Also extended the plan with nine additional acquisition avenues (T2-12…T2-20) — embedded
JSON state blobs, tel:/mailto: harvesting, table extraction, sitemap discovery, linked PDF
catalogues, geo signals, locale-aware currency inference and a course-name gazetteer.
Structured data is only present on a minority of sites, so coverage is the union of these.

Next: T2-02 money parser.

### 2026-08-20 07:33Z — session 2 (packaging interrupt)

Paused tier-2 work to package the instrument for deployment. Found that the package was
**not installable at all**: the wheel shipped only Python modules — no `schema.sql`, no
adapters, no seeds — and `tcpipe init` shelled out to `scripts/bootstrap.py`, which is not
part of a wheel. First command on a clean install died.

Fixed by moving all data into `src/tcpipe/data/` as package data, adding
`tcpipe.resources` (importlib.resources lookup) and `tcpipe.bootstrap` (importable, no
subprocess). Added `tests/test_packaging.py`, which fails the build if any shipped module
resolves a path with `parents[N]` or references `scripts/`. 127 tests green.

Tier-2 note: `structured.py` was written before this move and already used no repo-relative
paths, so it needed no change. Resume at T2-02 (money parser).

### 2026-08-20 07:39Z — session 3

**T2-02 money parser — done.** `src/tcpipe/money.py`, 28 tests in `tests/test_money.py`.
155 tests total, bundle verified.

The core problem is one character: `1.250` is 1250 in Riga and 1.25 in London, so a wrong
read is off by 1000x and still looks plausible in a spreadsheet. The parser never picks
silently — it returns the best reading, the competing reading in `alternative`, and a
confidence of `certain` / `probable` / `ambiguous`. Rules that settle it without guessing:
both separators present → the last one is decimal; repeated separators → grouping; one or
two trailing digits → decimal; a leading zero group → fraction. Only the three-trailing-
digit case is genuinely contested, and a locale hint resolves it.

Amounts are `Decimal` end to end. Also covers: ambiguous currency symbols (`$` is six
currencies, `kr` is four — both refuse to guess without a locale hint), VAT wording in 8
languages, pricing basis (per person / group / course / from) in 9, price ranges, and
Nordic `450,-` notation.

Bugs found and fixed while building:
- **Determinism bug against our own rule:** `detect_currency` iterated a `frozenset`, so
  with two currency codes in one window the winner depended on set ordering. Now the
  earliest match wins, deterministically.
- `best_price` broke confidence ties by magnitude — "the biggest number on the page" is not
  a pricing rule. Now ties break by position, since the headline price is stated first.
- Norwegian `eksklusiv mva` and Swedish `exkl. moms` were both missed (the patterns only
  matched abbreviated forms, and Swedish `exkl` differs from Norwegian `ekskl` by a
  letter). VAT patterns are now organised by language family and cover abbreviated and
  spelled-out forms; all 30 variants verified.
- Latvian `no personas` and Estonian `osaleja kohta` were not recognised as per-person.

Next: T2-03 phone parser.

### 2026-08-20 08:03Z — session 4

**T2-03 phone parser — done.** `src/tcpipe/phone.py`, 26 tests in `tests/test_phone.py`.
181 tests total, bundle verified.

Formatting was the easy half; precision was the work. A wrong number in a contact export
gets dialled, so the parser rejects on structure before it normalizes: calendar-validated
dates, prices, postcodes, VAT/IBAN identifiers, opening hours, years, repeated-digit
placeholders. Covers 50 calling codes with per-country national-length validation,
bracketed country codes, bracketed trunk zeros, Italy's retained leading zero, extensions
in 8 languages, and `tel:` links (highest precision — the site has declared the string a
phone number, so only normalization applies).

When no country can be established it refuses to emit E.164 and says so: an eight-digit
national number is +371… in Riga and +372… in Tallinn, and those are different businesses.
`+1` likewise never names a country on its own.

Bugs found and fixed while building:
- **Precision bug that would have gutted recall:** postcode/VAT rejection tested whether
  one appeared *anywhere in the surrounding context*, so every real phone number in a
  contact block was rejected — contact blocks always contain an address too. Now checks
  whether the candidate itself overlaps the identifier's span.
- French `06.12.34.56.78` was rejected as a date, because its first three groups are
  date-shaped. Date detection is now anchored to the whole candidate with real calendar
  bounds; a date has three components, that has five.
- `(+371) 6700 1234` lost its country: the `+` inside brackets defeated the
  international-format check, silently demoting it to an un-normalizable national number.
- `x99` extensions were concatenated onto the number (`\bx\b` needs a word boundary that a
  following digit does not provide), producing a 14-digit nonsense number.
- Prices with four or more digits before the decimals (`1250.00`) were not rejected.

Next: T2-04 page classifier.

### 2026-08-20 08:10Z — session 5

**T2-04 page classifier — done.** `src/tcpipe/classify.py`, 18 tests in
`tests/test_classify.py`. 202 tests total, bundle verified.

Multi-label by design — a real course page is a course page *and* a contact page *and* a
price list, and forcing one winner discards two extractions. Scores come from URL path
(strongest: an author chose it), declared schema.org types, headings, body keywords in 9
languages, and concrete artefacts (currency-marked amounts, VAT wording, tel:/mailto:
links, forms, address markup, course-link density). Every score carries named evidence.

The load-bearing output is `price_context`, not the label: it decides whether a bare number
on this page may be read as money at all. Demonstrated end to end — a privacy page
containing "12 months", "group size 12" and "since 1998" yields three confident prices
ungated, and none once gated.

Bugs found and fixed while building:
- **Coverage:** a Latvian price list headed "Kursu cenradis" scored no course context,
  because Baltic and Slavic declensions defeat exact-word matching. Added bounded stem
  matching. Without it, course names are never extracted from price lists — losing the
  course-to-price pairing, which is the most valuable pairing on the site.
- A price list now implies course context: a training centre's price list prices courses.
- A page with many outbound course links is an index, not a course.

Fixing the classifier exposed two precision bugs in T2-02 that only appear in combination:
- **A locale default currency makes every bare number look priced.** On "Duration 3 days …
  Fee 950 EUR", `best_price` returned EUR 3.00 — the locale hint gave "3" a currency and it
  won on position. `Money` now records `currency_explicit`, and an explicitly marked
  currency outranks an inferred one.
- **Counted quantities were competing with prices.** Numbers followed by a unit ("3 days",
  "12 participants") or preceded by one ("group size 12", "max 20") are now recorded with
  `quantity_unit` and excluded from price selection. Price-word proximity ("fee", "cena",
  "pris") is also a ranking signal. Seven realistic course-page phrasings now resolve to
  the right amount; before the fix, four of seven were wrong.

Next: T2-05 repeated-structure detector.

### 2026-08-20 08:21Z — session 6

**T2-05 repeated-structure detector — done.** `src/tcpipe/repetition.py`, 19 tests in
`tests/test_repetition.py`. 223 tests total, bundle verified.

Finds records by shape, not by selector — which is the only thing that scales to ~1,200
unknown templates. Groups siblings by a normalized structural signature (hashed build-tool
classes, trailing indices and state classes all stripped, or every row looks unique) and
scores each group on whether it reads as data.

Most of the work is telling data from furniture. Navigation, pagination, tag clouds and
footers repeat *more regularly* than real records do, so a detector that only counts
repeats returns the nav bar on every site. Signals used: text volume, length variance
(records vary, menus are uniform), presence of the fields we came for, bare-link runs, and
furniture ancestry. Verified on a page carrying a nav, a sidebar tag cloud, a footer and a
real course table: the table is found and all three furniture blocks are rejected.

Two coverage additions beyond the plan item:
- `row_cells` / `column_profile`: a price table states name, duration and price in separate
  cells. Reading columns keeps the association; flattening the row leaves the price
  attached to nothing. Column labels are inferred from the values in each column.
- **Page-level VAT inheritance** (fixes a gap in T2-02 that only integration revealed):
  "Visas cenas ar PVN" sits in its own paragraph, far outside any price's ±48-char window,
  so every price on such a page had an unknown VAT status. `page_vat_statement()` plus
  `parse_money(default_includes_vat=…)` now propagates it, and per-price wording still wins.

Bug found and fixed: `text_content()` concatenates without separators, turning
`<td>Training</td><td>5 days</td>` into "Training5 days" — merging a course name into a
duration and corrupting every downstream parse and evidence quote. Row text now preserves
cell boundaries.

Integration check: on one synthetic unknown page with no selectors, the four modules
together recover centre name, locality, country, phone, and three courses each paired with
its own price and VAT status.

Next: T2-06 bundle/package detector.

### 2026-08-20 08:30Z — session 7

**T2-06 bundle/package detector — done.** `src/tcpipe/packages.py`, 22 tests in
`tests/test_packages.py`. 245 tests total, bundle verified. This is the fifth and last of
the target fields, and the first real use of the `package` / `package_item` tables added in
2.2.0 — one test round-trips a detected bundle through the actual schema.

The precision rule that carries the module: **a bundle must resolve to at least two
distinct courses.** Without it every course page with a "what's included" section becomes a
one-item package, `package` fills with duplicates of `offering`, and the distinction that
justified the schema change evaporates. A block naming one course is a course.

Includes a course-name gazetteer of the standards this domain actually uses (GWO, OPITO,
IRATA, VTS, NEBOSH/IOSH/OSHA), longest-match first so "GWO BST Refresher" is not also
reported as "GWO BST". Package and contents wording covers 8 languages. This partly
pre-builds T2-20, which now reduces to wiring the gazetteer to real tier-1 certificates.

Bugs found and fixed while building:
- **VAT leaked between sections.** Page-level inheritance (added last session) treated any
  VAT mention as global, so one package's "incl. VAT" was inherited by every other price on
  the page — asserting a VAT status for prices that never stated one. `page_vat_statement`
  now requires a phrase that quantifies over all prices ("all prices…", "visas cenas…",
  "Kõik hinnad…"); a single item's wording no longer becomes the page default. This is a
  correction to T2-05's addition, caught only because two packages sat on one page.
- **Abbreviated siblings were not completed.** Sites write "IRATA Level 1 / Level 2" and
  "GWO BST + BSTR"; the second part is meaningless alone and must not be in the gazetteer,
  but is unambiguous beside its neighbour. Unmatched parts now retry against each *leading*
  prefix of a matched sibling — the first attempt used the longest prefix and built
  "IRATA Level Level 2".
- Block summaries doubled their own heading, because the block text already contains it.
- Estonian "sisaldavad käibemaksu" was missing from the inclusive VAT patterns.

All five target fields — location, courses, prices, contact numbers, bundle packages — now
have working extractors. Next: T2-07 confidence scoring and cross-extractor conflict
detection.

### 2026-08-20 08:35Z — session 8

**T2-07 consensus and conflict detection — done.** `src/tcpipe/consensus.py`, 20 tests in
`tests/test_consensus.py`. 265 tests total, bundle verified.

Several extractors now produce the same field and they disagree in practice. The commonest
real case is not exotic: a site updates its visible price table and forgets the JSON-LD
block, so structured data confidently states last year's price. Both extractors are correct;
the page contradicts itself.

The enforced rule: **a disagreement is a review item, never a silent winner.** Source
precedence (tel: link > JSON-LD > microdata > RDFa > table column > visible text >
OpenGraph) orders what a reviewer sees; it does not decide truth. Two incompatible values
for a single-valued field promote nothing — both claims are kept with their evidence and a
`field_validation` review item is raised.

Agreement is judged after field-appropriate normalization, or formatting alone would
manufacture conflicts: "EUR 1250.00" agrees with "1,250.00 EUR", "+371 6700 1234" with
"0037167001234", "Baltic Safety Centre OÜ" with "Baltic Safety Centre", and a bare "1250"
with "EUR 1250" (one side simply omits the currency). Many-valued fields — courses, phone
numbers, addresses — treat several distinct values as coexisting rather than conflicting.

Output holds the G5 line: every tier-2 observation is `pending` or `flagged`, never
`accepted`, and conflicting rows carry an `extractor_conflict` flag. Scores cap at 0.95,
because generic extraction over unknown templates is never certain however many sources
agree.

Next: T2-08 robustness/fuzz suite.

### 2026-08-20 — session 9 (operator/export hardening)

Paused T2-08 to finish the interrupted deployment handoff. Version 2.2.1 adds the
OpenClaw workspace/skill, one guarded executable, readiness and lease-recovery commands,
operator-owned network/approval/audit gates, automation installers, and a reproducible
checksummed export.

Found and fixed a queue correctness bug in `fetch`: it created one acquisition job but
claimed the highest-priority queued job, so an older backlog item could receive the lease
and the new fetch would fail its evidence guard. Interactive fetch now atomically claims its
own named job. Failures are terminalized instead of being left to expire, and operator
runtime errors are rendered as bounded CLI errors instead of tracebacks.

The wheel/sdist are now verified handoff contents rather than ignored build output. A clean
environment installed the 2.2.1 wheel without the source tree, initialized schema 2.2.0,
and produced the expected five policy-blocked candidate routes. 272 tests pass.

Next remains T2-08 robustness/fuzz suite; no tier-2 completion claim has changed.
