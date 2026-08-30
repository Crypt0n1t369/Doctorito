import unittest

from tcpipe.adapter import load_document
from tcpipe.classify import (
    CENTRE_PROFILE,
    CONTACT,
    COURSE,
    COURSE_LIST,
    OTHER,
    PRICE_LIST,
    classify_page,
    classify_url,
    is_worth_fetching,
)


def tree_of(html):
    return load_document(html.encode("utf-8"), content_type="text/html").tree


COURSE_PAGE = """<html><head><title>GWO Basic Safety Training | Nordic Wind</title></head>
<body><h1>GWO Basic Safety Training</h1>
<p>Duration: 5 days. Price €1,250.50 per person incl. VAT.</p>
<a href="tel:+37167001234">Call us</a></body></html>"""

LV_PRICE_LIST = """<html><head><title>Cenas</title></head><body>
<h1>Kursu cenradis</h1>
<table><tr><td>GWO BST</td><td>1 250,00 EUR</td></tr>
<tr><td>GWO BSTR</td><td>650,00 EUR</td></tr></table>
<p>Cenas ar PVN.</p></body></html>"""

EE_CONTACT = """<html><head><title>Kontaktid</title></head><body><h1>Kontakt</h1>
<address>Õismäe tee 12, Tallinn</address>
<a href="tel:+3726009999">+372 600 9999</a><a href="mailto:info@x.ee">info</a>
<form><input name="msg"><textarea></textarea></form></body></html>"""

COURSE_INDEX = ("""<html><head><title>Our training courses</title></head><body>
<h1>Courses</h1><ul>"""
                + "".join(f'<li><a href="/courses/c{i}">Course {i}</a></li>'
                          for i in range(9))
                + "</ul></body></html>")

UNRELATED = """<html><head><title>Privacy policy</title></head><body><h1>Privacy</h1>
<p>We retain data for 12 months. Maximum group size 12. Established 1998.</p>
</body></html>"""


class ClassificationTests(unittest.TestCase):
    def test_course_page(self):
        result = classify_page(tree_of(COURSE_PAGE),
                               url="https://c.example/courses/gwo-basic-safety-training")
        self.assertEqual(result.primary, COURSE)
        self.assertTrue(result.course_context)
        self.assertTrue(result.price_context)
        self.assertTrue(result.contact_context)

    def test_latvian_price_list_is_recognised_through_a_declension(self):
        # "Kursu cenradis" — neither word matches the base forms "kurs"/"cena" exactly.
        # Missing this loses the course-to-price pairing, the most valuable pairing there is.
        result = classify_page(tree_of(LV_PRICE_LIST), url="https://c.example/cenas")
        self.assertEqual(result.primary, PRICE_LIST)
        self.assertTrue(result.price_context)
        self.assertTrue(result.course_context,
                        "a training centre's price list prices courses")
        self.assertIn("certificate_name", result.extractors())
        self.assertIn("price_text", result.extractors())

    def test_estonian_price_list(self):
        html = ("<html><head><title>Hinnad</title></head><body>"
                "<h1>Koolituste hinnakiri</h1><p>GWO BST 1250 EUR</p></body></html>")
        result = classify_page(tree_of(html), url="https://c.example/hinnad")
        self.assertEqual(result.primary, PRICE_LIST)
        self.assertTrue(result.course_context)

    def test_contact_page(self):
        result = classify_page(tree_of(EE_CONTACT), url="https://c.example/kontakt")
        self.assertEqual(result.primary, CONTACT)
        self.assertTrue(result.contact_context)
        self.assertFalse(result.price_context)
        self.assertIn("published_phone", result.extractors())

    def test_course_index_is_labelled_as_a_list(self):
        result = classify_page(tree_of(COURSE_INDEX), url="https://c.example/training")
        self.assertIn(COURSE_LIST, result.labels)
        self.assertTrue(result.course_context)

    def test_about_page(self):
        html = ("<html><head><title>Über uns</title></head><body><h1>Über uns</h1>"
                "<p>Wir sind ein Trainingszentrum seit 1998.</p></body></html>")
        result = classify_page(tree_of(html), url="https://c.example/ueber-uns")
        self.assertEqual(result.primary, CENTRE_PROFILE)

    def test_unrelated_page_claims_nothing(self):
        result = classify_page(tree_of(UNRELATED), url="https://c.example/privacy")
        self.assertEqual(result.primary, OTHER)
        self.assertEqual(result.labels, [])

    def test_structured_types_are_treated_as_assertions(self):
        result = classify_page(None, url=None, text="",
                               structured_types=["Course", "Offer"])
        self.assertIn(COURSE, result.labels)
        self.assertIn(PRICE_LIST, result.labels)


class PriceContextTests(unittest.TestCase):
    """The reason this module exists: when may a bare number be read as money?"""

    def test_a_page_with_no_pricing_signal_denies_price_context(self):
        # 12 months, group size 12, established 1998 — none of these are prices.
        result = classify_page(tree_of(UNRELATED), url="https://c.example/privacy")
        self.assertFalse(result.price_context)
        self.assertNotIn("price_text", result.extractors())

    def test_a_currency_marked_amount_grants_price_context(self):
        html = "<html><body><p>Fee: €950</p></body></html>"
        self.assertTrue(classify_page(tree_of(html)).price_context)

    def test_vat_wording_alone_grants_price_context(self):
        html = "<html><body><p>All figures shown are excl. VAT.</p></body></html>"
        self.assertTrue(classify_page(tree_of(html)).price_context)

    def test_price_context_requires_a_positive_signal_not_mere_absence(self):
        html = "<html><body><p>Course runs for 3 days with 12 participants.</p></body></html>"
        self.assertFalse(classify_page(tree_of(html)).price_context)


class UrlTriageTests(unittest.TestCase):
    def test_url_alone_classifies(self):
        cases = {
            "https://x.example/courses/bosiet": COURSE,
            "https://x.example/prices": PRICE_LIST,
            "https://x.example/kontakti": CONTACT,
            "https://x.example/about-us": CENTRE_PROFILE,
            "https://x.example/blog/2024/some-post": OTHER,
        }
        for url, expected in cases.items():
            with self.subTest(url=url):
                self.assertEqual(classify_url(url).primary, expected)

    def test_worth_fetching_is_generous(self):
        # A false positive costs one fetch; a false negative loses a centre's prices.
        self.assertTrue(is_worth_fetching("https://x.example/courses"))
        self.assertTrue(is_worth_fetching("https://x.example/hinnad"))
        self.assertFalse(is_worth_fetching("https://x.example/privacy-policy"))
        self.assertFalse(is_worth_fetching(""))


class RobustnessTests(unittest.TestCase):
    HOSTILE = ["", "<html>", "<html><body></body></html>",
               "<html><body>" + "<a href='/courses/x'>c</a>" * 5000 + "</body></html>",
               "<html><body>" + "€1 " * 20000 + "</body></html>",
               "<html><body><table>" + "<tr><td>x</td></tr>" * 5000 + "</table></body></html>"]

    def test_never_raises(self):
        for index, html in enumerate(self.HOSTILE):
            with self.subTest(case=index):
                try:
                    result = classify_page(tree_of(html) if html.strip() else None,
                                           url="https://x.example/courses")
                    result.as_dict()
                except Exception as exc:  # pragma: no cover - this is the assertion
                    self.fail(f"case {index} raised {type(exc).__name__}: {exc}")

    def test_handles_missing_evidence(self):
        self.assertEqual(classify_page(None).primary, OTHER)
        self.assertEqual(classify_page(None, url=None, text=None).primary, OTHER)
        self.assertEqual(classify_page(None, url="https://x.example/prices").primary,
                         PRICE_LIST)

    def test_is_deterministic(self):
        first = classify_page(tree_of(COURSE_PAGE), url="https://c.example/courses/a").as_dict()
        second = classify_page(tree_of(COURSE_PAGE), url="https://c.example/courses/a").as_dict()
        self.assertEqual(first, second)

    def test_every_score_carries_evidence(self):
        result = classify_page(tree_of(COURSE_PAGE), url="https://c.example/courses/a")
        for kind in result.kinds:
            self.assertTrue(result.evidence.get(kind),
                            f"{kind} scored with no stated reason")


if __name__ == "__main__":
    unittest.main()
