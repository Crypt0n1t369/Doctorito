import json
import unittest
from pathlib import Path

from .support import HAVE_PYPDF, ROOT
from tcpipe.resources import adapter_path, iter_adapter_paths
from tcpipe.adapter import (
    AdapterError,
    decode_text,
    load_document,
    load_rules,
    merge_outcomes,
    normalize,
    parse_document,
    resolve_json_pointer,
)

FIXTURES = ROOT / "tests" / "fixtures"


def sel(strategy, value, *, fb1=None, fb2=None, count_mode=None):
    selector = {"primary": {"strategy": strategy, "value": value}}
    if fb1 and fb2:
        selector.update({"fallback_policy": "required",
                         "fallback_1": {"strategy": fb1[0], "value": fb1[1]},
                         "fallback_2": {"strategy": fb2[0], "value": fb2[1]}})
    else:
        selector.update({"fallback_policy": "none_with_reason",
                         "fallback_reason": "single authoritative locator for this test"})
    if count_mode:
        selector["count_mode"] = count_mode
    return selector


SIMPLE_HTML = """<!doctype html><html><head><meta charset="utf-8"></head><body>
<p class="total">Total 3 providers</p>
<div class="list">
  <div class="row"><span class="n">Alpha Centre</span><span class="c">LV</span>
    <a class="w" href="/a">site</a><span class="p">+371 6700 1234</span></div>
  <div class="row"><span class="n">Beta Centre</span><span class="c">EE</span>
    <a class="w" href="https://beta.example">site</a><span class="p">+372 600 9999</span></div>
  <div class="row"><span class="n">Gamma Centre (withdrawn)</span><span class="c">NO</span>
    <a class="w" href="/g">site</a><span class="p">+47 7012 3456</span></div>
</div></body></html>""".encode("utf-8")


def simple_rules(**overrides):
    rules = {
        "adapter_id": "test__html", "version": "1.0.0", "output_contract_version": "2.1",
        "applies_to": {"url_pattern": ".*"},
        "list": {"container": sel("css", "div.list"), "row": sel("css", "div.row"),
                 "empty_is_valid": False,
                 "structural_count": sel("css", "div.row", count_mode="nodes"),
                 "published_count": sel("css_text", "p.total", count_mode="value")},
        "fields": {
            "published_name": {"selector": sel("css_text", "span.n"), "required": True,
                               "normalize": "trim"},
            "published_country": {"selector": sel("css_text", "span.c"),
                                  "normalize": "country_iso2"},
            "published_website": {"selector": sel("css_attr", "a.w@href"),
                                  "normalize": "url_absolute"},
            "published_phone": {"selector": sel("css_text", "span.p"),
                                "normalize": "phone_e164_or_verbatim", "cardinality": "many"},
        },
        "rejects": [{"when": r"withdrawn", "parse_state": "rejected_not_centre"}],
        "fixtures": ["0" * 64],
    }
    rules.update(overrides)
    return rules


class DecodingTests(unittest.TestCase):
    def test_encoding_precedence_does_not_mangle_diacritics(self):
        # lxml's byte-level guess turns UTF-8 into Latin-1 mojibake, silently corrupting
        # every Latvian, Estonian and Norwegian centre name.
        self.assertEqual(decode_text("Rīga £450 Ålesund".encode("utf-8")), "Rīga £450 Ålesund")
        self.assertEqual(decode_text("Malmö".encode("cp1252")), "Malmö")
        self.assertEqual(
            decode_text("Õismäe".encode("utf-8"), "text/html; charset=utf-8"), "Õismäe"
        )
        self.assertEqual(
            decode_text(b"<meta charset='iso-8859-1'>Malm\xf6", "text/html"),
            "<meta charset='iso-8859-1'>Malmö",
        )

    def test_html_document_keeps_unicode(self):
        doc = load_document(
            "<html><body><p>Rīgas Centrs</p></body></html>".encode("utf-8"),
            content_type="text/html",
        )
        self.assertIn("Rīgas Centrs", doc.text)


class NormalizationTests(unittest.TestCase):
    def test_modes(self):
        self.assertEqual(normalize("  a  b ", "trim"), ("a b", "normalized"))
        self.assertEqual(normalize("lv", "country_iso2"), ("LV", "normalized"))
        self.assertEqual(normalize("Latvia", "country_iso2"), (None, "failed"))
        self.assertEqual(normalize("+371 6700 1234", "phone_e164_or_verbatim"),
                         ("+37167001234", "normalized"))
        self.assertEqual(normalize("/x", "url_absolute", base_url="https://e.invalid/")[0],
                         "https://e.invalid/x")
        self.assertEqual(normalize("£1,250.50", "currency_amount"), ("GBP 1250.50", "normalized"))
        self.assertEqual(normalize("450,00 EUR", "currency_amount"), ("EUR 450.00", "normalized"))
        self.assertEqual(normalize("1 234", "currency_amount"), ("1234.00", "ambiguous"))

    def test_failed_normalization_never_discards_the_raw_value(self):
        value, state = normalize("not a country", "country_iso2")
        self.assertIsNone(value)
        self.assertEqual(state, "failed")


class SelectorTests(unittest.TestCase):
    def test_json_pointer_resolution(self):
        doc = {"a": {"b": [1, 2, 3]}}
        self.assertEqual(resolve_json_pointer(doc, "/a/b/1"), 2)
        self.assertEqual(resolve_json_pointer(doc, "/a/b/-"), [1, 2, 3])
        with self.assertRaises(KeyError):
            resolve_json_pointer(doc, "/a/missing")

    def test_bad_rules_raise_rather_than_silently_missing(self):
        doc = load_document(SIMPLE_HTML, content_type="text/html")
        rules = simple_rules()
        rules["fields"]["published_name"]["selector"] = sel("css_attr", "a.w")
        with self.assertRaises(AdapterError):
            parse_document(rules, doc)


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.doc = load_document(SIMPLE_HTML, content_type="text/html")

    def test_clean_parse_extracts_normalizes_and_rejects(self):
        out = parse_document(simple_rules(), self.doc, base_url="https://e.invalid/")
        self.assertEqual(out.status, "parsed")
        self.assertEqual(len(out.records), 2)
        self.assertEqual(out.structural_count, 3)
        self.assertEqual(out.published_count, 3)
        self.assertEqual(len(out.rejects), 1)
        first = out.records[0]
        self.assertEqual(first.fields["published_name"][0].value, "Alpha Centre")
        self.assertEqual(first.fields["published_country"][0].normalized, "LV")
        self.assertEqual(first.fields["published_website"][0].normalized, "https://e.invalid/a")

    def test_counts_use_the_mode_the_selector_declares(self):
        # css counts nodes; css_text reads the published figure. Inferring from the matched
        # text instead once turned a phone number into a structural count of 37 billion.
        out = parse_document(simple_rules(), self.doc)
        self.assertEqual((out.structural_count, out.published_count), (3, 3))

    def test_fallback_selector_extracts_but_quarantines(self):
        rules = simple_rules()
        rules["fields"]["published_name"] = {
            "selector": sel("css_text", "span.gone",
                            fb1=("css_text", "span.n"), fb2=("xpath", ".//span[1]")),
            "required": True}
        out = parse_document(rules, self.doc)
        self.assertEqual(out.status, "quarantined_schema_drift")
        self.assertTrue(out.drift)
        self.assertEqual(len(out.records), 2, "drifted data is preserved for review")

    def test_missing_container_is_quarantined(self):
        rules = simple_rules()
        rules["list"]["container"] = sel("css", "div.nothing-like-this")
        out = parse_document(rules, self.doc)
        self.assertFalse(out.container_resolved)
        self.assertEqual(out.status, "quarantined_schema_drift")

    def test_missing_required_field_drops_the_row(self):
        rules = simple_rules()
        rules["fields"]["provider_id"] = {"selector": sel("css_text", "span.absent"),
                                          "required": True}
        out = parse_document(rules, self.doc)
        self.assertEqual(len(out.records), 0)
        self.assertEqual(len(out.rejects), 3)

    def test_below_min_expected_rows_is_drift(self):
        rules = simple_rules()
        rules["list"]["min_expected_rows"] = 50
        self.assertEqual(parse_document(rules, self.doc).status, "quarantined_schema_drift")

    def test_merge_outcomes_combines_pages(self):
        a = parse_document(simple_rules(), self.doc)
        b = parse_document(simple_rules(), self.doc, row_offset=len(a.records))
        combined = merge_outcomes([a, b])
        self.assertEqual(len(combined.records), 4)
        self.assertEqual(combined.structural_count, 6)
        self.assertEqual(combined.published_count, 3)


class ArchetypeFixtureTests(unittest.TestCase):
    """Each archetype's shipped adapter must parse its golden artifact and reconcile.

    These fixtures are SYNTHETIC — they prove the interpreter handles each archetype's
    shape. Real golden fixtures come from approved fetches after G2; see FIXTURES.md.
    """

    CASES = [
        ("gwo__download", ["gwo_providers.html"], "text/html", 120, 2),
        ("osha__api", ["osha_courses.json"], "application/json", 2, 0),
        ("irata__html_paginated",
         ["irata_members_p1.html", "irata_members_p2.html"], "text/html", 3, 0),
        ("iala__pdf", ["iala_vts.pdf"], "application/pdf", 3, 0),
        ("opito__js_app", ["opito_centres.json"], "application/json", 2, 0),
    ]

    def test_every_archetype_parses_and_reconciles(self):
        for adapter_id, files, content_type, expected_rows, expected_rejects in self.CASES:
            if adapter_id == "iala__pdf" and not HAVE_PYPDF:
                continue
            with self.subTest(adapter=adapter_id):
                rules = load_rules(adapter_path(adapter_id))
                outcomes, offset = [], 0
                for name in files:
                    doc = load_document((FIXTURES / name).read_bytes(),
                                        content_type=content_type)
                    outcome = parse_document(rules, doc, base_locator=f"artifact:{name}",
                                             base_url="https://example.invalid/",
                                             row_offset=offset)
                    offset += len(outcome.records)
                    outcomes.append(outcome)
                combined = merge_outcomes(outcomes)
                self.assertEqual(combined.status, "parsed", combined.drift_detail)
                self.assertEqual(len(combined.records), expected_rows)
                self.assertEqual(len(combined.rejects), expected_rejects)
                in_scope = combined.structural_count - len(combined.rejects)
                self.assertEqual(
                    in_scope, len(combined.records),
                    "independent structural count must reconcile with extracted rows",
                )
                for record in combined.records:
                    self.assertIn("published_name", record.fields)

    def test_every_shipped_adapter_validates_against_the_rules_schema(self):
        for path in iter_adapter_paths():
            with self.subTest(adapter=path.name):
                rules = load_rules(path)
                self.assertEqual(rules["output_contract_version"], "2.1")
                self.assertTrue(rules["fixtures"])

    @unittest.skipUnless(HAVE_PYPDF, "pypdf extra not installed")
    def test_pdf_rows_are_scoped_to_their_own_line(self):
        # A row scope of one PDF line must not fall back to the whole document, which made
        # every IALA row report the first row's country and courses.
        rules = load_rules(adapter_path("iala__pdf"))
        doc = load_document((FIXTURES / "iala_vts.pdf").read_bytes(),
                            content_type="application/pdf")
        out = parse_document(rules, doc)
        names = [r.fields["published_name"][0].value for r in out.records]
        countries = [r.fields["published_country"][0].normalized for r in out.records]
        self.assertEqual(len(set(names)), 3)
        self.assertEqual(countries, ["LV", "NL", "HR"])


if __name__ == "__main__":
    unittest.main()
