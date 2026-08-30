import unittest

from tcpipe.adapter import load_document
from tcpipe.structured import (
    Finding,
    extract_microdata,
    extract_opengraph,
    extract_structured,
    iter_json_ld_nodes,
    parse_json_ld_text,
)


def tree_of(html: str):
    return load_document(html.encode("utf-8"), content_type="text/html").tree


def values(findings, field):
    return [f.value for f in findings if f.field == field]


RICH_PAGE = """<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"LocalBusiness","name":"Baltic Safety Centre","telephone":"+372 600 9999",
  "url":"https://baltic.example",
  "address":{"@type":"PostalAddress","streetAddress":"Õismäe tee 12",
             "addressLocality":"Tallinn","postalCode":"13512","addressCountry":"EE"}},
 {"@type":"Course","name":"GWO Basic Safety Training",
  "description":"Includes Working at Height, First Aid, Manual Handling, Fire Awareness",
  "offers":{"@type":"Offer","price":"1250.50","priceCurrency":"EUR"}},
 {"@type":"Course","name":"GWO BST Refresher",
  "offers":{"@type":"AggregateOffer","lowPrice":"450","highPrice":"600",
            "priceCurrency":"EUR"}}
]}
</script></head><body>
<div itemscope itemtype="https://schema.org/Course">
  <span itemprop="name">HUET Survival</span><span itemprop="price">890</span>
</div></body></html>"""


class JsonLdParsingTests(unittest.TestCase):
    def test_plain_object_and_array(self):
        self.assertEqual(parse_json_ld_text('{"a":1}'), [{"a": 1}])
        self.assertEqual(parse_json_ld_text('[{"a":1},{"b":2}]'), [{"a": 1}, {"b": 2}])

    def test_repairs_the_damage_real_sites_actually_ship(self):
        # Trailing commas, JS comments and CDATA wrappers are common enough that refusing
        # them throws away genuine data.
        self.assertEqual(parse_json_ld_text('{"a":1,}'), [{"a": 1}])
        self.assertEqual(parse_json_ld_text('/* cms */{"a":1}'), [{"a": 1}])
        self.assertEqual(parse_json_ld_text('<![CDATA[{"a":1}]]>'), [{"a": 1}])

    def test_gives_up_rather_than_guessing(self):
        for junk in ("", "not json at all", "{unclosed", "<html>", "{'single':'quotes'}"):
            with self.subTest(junk=junk):
                self.assertEqual(parse_json_ld_text(junk), [])

    def test_oversized_block_is_skipped(self):
        self.assertEqual(parse_json_ld_text('{"a":"' + "x" * (3 * 1024 * 1024) + '"}'), [])

    def test_graph_walk_survives_a_cycle(self):
        node = {"@type": "Course", "name": "A"}
        node["self"] = node          # sites really do emit these
        self.assertLessEqual(len(list(iter_json_ld_nodes(node))), 4)

    def test_graph_walk_is_depth_bounded(self):
        deep = current = {"@type": "Thing"}
        for _ in range(200):
            current["child"] = {"@type": "Thing"}
            current = current["child"]
        self.assertLess(len(list(iter_json_ld_nodes(deep))), 30)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.findings = extract_structured(tree_of(RICH_PAGE))

    def test_gets_every_field_tier_2_is_for(self):
        self.assertIn("Baltic Safety Centre", values(self.findings, "published_name"))
        self.assertIn("+372 600 9999", values(self.findings, "published_phone"))
        self.assertIn("Tallinn", values(self.findings, "published_locality"))
        self.assertIn("EE", values(self.findings, "published_country"))
        self.assertIn("https://baltic.example", values(self.findings, "published_website"))
        courses = values(self.findings, "certificate_name")
        self.assertIn("GWO Basic Safety Training", courses)
        self.assertIn("HUET Survival", courses, "microdata must be read too")
        prices = values(self.findings, "price_text")
        self.assertIn("EUR 1250.50", prices)
        self.assertIn("EUR 450", prices, "AggregateOffer low/high are both prices")
        self.assertIn("EUR 600", prices)

    def test_unicode_addresses_survive(self):
        self.assertTrue(any("Õismäe" in v for v in values(self.findings, "published_address")))

    def test_every_finding_carries_reviewable_evidence(self):
        for finding in self.findings:
            with self.subTest(field=finding.field, value=finding.value):
                self.assertTrue(finding.locator)
                self.assertTrue(finding.quote)
                self.assertTrue(finding.source)

    def test_price_findings_keep_their_currency_and_role(self):
        offers = [f for f in self.findings
                  if f.field == "price_text" and f.source == "json_ld" and f.extra]
        self.assertTrue(offers)
        self.assertTrue(all(f.extra.get("currency") == "EUR" for f in offers))
        self.assertIn("lowPrice", {f.extra.get("price_role") for f in offers})

    def test_opengraph_price_picks_up_its_currency_sibling(self):
        html = ('<html><head><meta property="product:price:amount" content="1250.50">'
                '<meta property="product:price:currency" content="GBP"></head><body></body></html>')
        self.assertEqual(values(extract_opengraph(tree_of(html)), "price_text"), ["GBP 1250.50"])

    def test_microdata_uses_content_attribute_before_text(self):
        html = ('<html><body><div itemscope itemtype="https://schema.org/Offer">'
                '<meta itemprop="price" content="99.00">'
                '<span itemprop="name">Nice Course</span></div></body></html>')
        findings = extract_microdata(tree_of(html))
        self.assertIn("99.00", values(findings, "price_text"))
        self.assertIn("Nice Course", values(findings, "certificate_name"))

    def test_the_same_property_is_read_by_its_context(self):
        # "name" is a course title inside a Course and a centre name inside an Organization.
        course = ('<html><body><div itemscope itemtype="https://schema.org/Course">'
                  '<span itemprop="name">BOSIET</span></div></body></html>')
        org = ('<html><body><div itemscope itemtype="https://schema.org/LocalBusiness">'
               '<span itemprop="name">Aberdeen Safety</span></div></body></html>')
        self.assertEqual(values(extract_microdata(tree_of(course)), "certificate_name"),
                         ["BOSIET"])
        self.assertEqual(values(extract_microdata(tree_of(org)), "published_name"),
                         ["Aberdeen Safety"])


class RobustnessTests(unittest.TestCase):
    """Tier 2 runs over a thousand hostile documents. It degrades; it does not raise."""

    HOSTILE = [
        "",
        "<html>",
        "<html><body><p>no structured data at all</p></body></html>",
        '<html><head><script type="application/ld+json"></script></head><body></body></html>',
        '<html><head><script type="application/ld+json">null</script></head></html>',
        '<html><head><script type="application/ld+json">[[[[[]]]]]</script></head></html>',
        '<html><head><script type="application/ld+json">{"@type":123}</script></head></html>',
        '<html><head><script type="application/ld+json">{"@type":"Offer","price":{}}</script></head></html>',
        '<html><body><div itemprop="price"></div></body></html>',
        '<html><body><div itemprop="name">' + "<b>" * 400 + "deep" + "</b>" * 400 + "</div></body></html>",
        '<html><body><meta property="og:title"></body></html>',
        "<html><body>" + "<div itemprop='name'>x</div>" * 2000 + "</body></html>",
        '<html><head><script type="application/ld+json">{"@type":"Course","offers":'
        + '{"@type":"Offer","offers":' * 40 + '{"price":"1"}' + "}" * 40 + "}</script></head></html>",
    ]

    def test_never_raises_on_hostile_input(self):
        for index, html in enumerate(self.HOSTILE):
            with self.subTest(case=index):
                try:
                    findings = extract_structured(tree_of(html) if html.strip() else None)
                except Exception as exc:  # pragma: no cover - this is the assertion
                    self.fail(f"case {index} raised {type(exc).__name__}: {exc}")
                self.assertIsInstance(findings, list)

    def test_none_tree_is_handled(self):
        self.assertEqual(extract_structured(None), [])

    def test_output_is_bounded(self):
        huge = "<html><body>" + "<div itemprop='name'>x</div>" * 5000 + "</body></html>"
        self.assertLessEqual(len(extract_structured(tree_of(huge))), 2000)

    def test_extraction_is_deterministic(self):
        first = extract_structured(tree_of(RICH_PAGE))
        second = extract_structured(tree_of(RICH_PAGE))
        self.assertEqual([(f.field, f.value, f.locator) for f in first],
                         [(f.field, f.value, f.locator) for f in second])


if __name__ == "__main__":
    unittest.main()
