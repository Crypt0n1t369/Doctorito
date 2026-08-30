import unittest

from tcpipe.adapter import load_document
from tcpipe.money import page_vat_statement
from tcpipe.packages import (
    MIN_ITEMS,
    detect_package,
    find_course_names,
    find_packages,
    to_schema_rows,
)


def tree_of(html):
    return load_document(html.encode("utf-8"), content_type="text/html").tree


def section(title, body):
    return f"<html><body><section><h3>{title}</h3><p>{body}</p></section></body></html>"


BUNDLE_PAGE = """<html><body><main>
<section class="pkg"><h3>GWO Full Safety Package</h3>
<p>This package includes:</p><ul>
<li>Working at Height</li><li>First Aid</li><li>Manual Handling</li><li>Fire Awareness</li>
</ul><p>Price 1 200,00 EUR per person. Save 15% instead of 1 410,00 EUR.</p></section>
<section class="pkg"><h3>BOSIET + HUET + CA-EBS</h3>
<p>Combined offshore package, 1850 EUR incl. VAT.</p></section>
<section class="course"><h3>GWO Basic Safety Training</h3>
<p>Includes Working at Height module. Duration 5 days. 1250 EUR per person.</p></section>
</main></body></html>"""


class CourseNameTests(unittest.TestCase):
    def test_gazetteer_prefers_the_longest_name(self):
        names = [n for n, _ in find_course_names("Complete GWO BST Refresher and GWO ART")]
        self.assertEqual(names, ["GWO BST Refresher", "GWO ART"])
        self.assertNotIn("GWO BST", names, "the longer name must claim the span")

    def test_finds_multiple_standards(self):
        names = [n for n, _ in find_course_names("BOSIET with CA-EBS plus HUET")]
        self.assertEqual(names, ["BOSIET", "CA-EBS", "HUET"])

    def test_unrelated_text_yields_nothing(self):
        self.assertEqual(find_course_names("We teach welding and forklift driving"), [])

    def test_extra_names_extend_the_gazetteer(self):
        names = [n for n, _ in find_course_names("Our Wind Turbine Rescue course",
                                                 extra_names=["Wind Turbine Rescue"])]
        self.assertIn("Wind Turbine Rescue", names)


class BundleDetectionTests(unittest.TestCase):
    def test_package_with_an_explicit_contents_list(self):
        packages = find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")
        by_name = {p.name: p for p in packages}
        full = by_name["GWO Full Safety Package"]
        self.assertEqual(full.item_names,
                         ["Working at Height", "First Aid", "Manual Handling",
                          "Fire Awareness"])
        self.assertEqual(full.price.normalized, "EUR 1200.00")
        self.assertEqual(full.confidence, "certain")

    def test_package_named_by_listing_its_parts(self):
        packages = find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")
        combo = {p.name: p for p in packages}["BOSIET + HUET + CA-EBS"]
        self.assertEqual(combo.item_names, ["BOSIET", "HUET", "CA-EBS"])
        self.assertIs(combo.price.includes_vat, True)

    def test_abbreviated_siblings_are_completed_from_their_neighbour(self):
        # "IRATA Level 1 / Level 2" — a bare "Level 2" means nothing on its own and must
        # not be in the gazetteer, but beside "IRATA Level 1" it is unambiguous.
        cases = {
            "IRATA Level 1 / Level 2": ["IRATA Level 1", "IRATA Level 2"],
            "GWO BST + BSTR": ["GWO BST", "GWO BSTR"],
            "Rope Access Level 1, Level 2 and Level 3":
                ["Rope Access Level 1", "Rope Access Level 2", "Rope Access Level 3"],
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                packages = find_packages(
                    tree_of(section(title, "Training bundle. 2 400,00 EUR.")),
                    locale_hint="LV")
                self.assertTrue(packages)
                self.assertEqual(packages[0].item_names, expected)

    def test_a_single_course_is_not_a_package(self):
        """The rule that keeps `package` from duplicating `offering`."""
        result = detect_package("Our BST package includes Working at Height only. 950 EUR.",
                                title="BST Package", locale_hint="LV")
        self.assertIsNone(result)

    def test_a_plain_course_page_yields_no_package(self):
        packages = find_packages(
            tree_of(section("GWO Basic Safety Training",
                            "Duration 5 days. 1250 EUR per person.")),
            locale_hint="LV")
        self.assertEqual(packages, [])

    def test_savings_wording_is_recorded_as_evidence(self):
        packages = find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")
        full = {p.name: p for p in packages}["GWO Full Safety Package"]
        self.assertTrue(any("savings" in note for note in full.evidence))

    def test_every_package_carries_evidence_and_a_quote(self):
        for package in find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV"):
            self.assertTrue(package.evidence)
            self.assertTrue(package.quote)
            self.assertGreaterEqual(len(package.items), MIN_ITEMS)

    def test_summary_is_not_doubled(self):
        packages = find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")
        quote = packages[0].quote
        self.assertEqual(quote.count("GWO Full Safety Package"), 1,
                         "the block text already contains its own heading")


class PageVatScopeTests(unittest.TestCase):
    """A single item's VAT wording must not become the whole page's default."""

    def test_a_global_statement_is_inherited(self):
        for text, expected in (("Visas cenas ar PVN.", True),
                               ("All prices include VAT", True),
                               ("Alle Preise zzgl. MwSt", False),
                               ("Prices are excl. VAT", False),
                               ("Kõik hinnad sisaldavad käibemaksu", True)):
            with self.subTest(text=text):
                self.assertIs(page_vat_statement(text), expected)

    def test_one_items_wording_is_not_global(self):
        for text in ("Combined offshore package, 1850 EUR incl. VAT.",
                     "GWO BST 950 EUR + VAT"):
            with self.subTest(text=text):
                self.assertIsNone(page_vat_statement(text))

    def test_vat_does_not_leak_between_sections(self):
        packages = {p.name: p for p in find_packages(tree_of(BUNDLE_PAGE),
                                                     locale_hint="LV")}
        self.assertIs(packages["BOSIET + HUET + CA-EBS"].price.includes_vat, True,
                      "this section states its own VAT")
        self.assertIsNone(packages["GWO Full Safety Package"].price.includes_vat,
                          "this one does not, and must not borrow its neighbour's")


class SchemaMappingTests(unittest.TestCase):
    def test_maps_onto_the_2_2_0_package_tables(self):
        package = find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")[0]
        rows = to_schema_rows(
            package, centre_id="C-1", package_id="PK-1",
            certificate_ids={"Working at Height": "CERT-WAH", "First Aid": "CERT-FA",
                             "Manual Handling": "CERT-MH", "Fire Awareness": "CERT-FIRE"},
        )
        self.assertEqual(rows["package"]["centre_id"], "C-1")
        self.assertEqual(len(rows["package_item"]), 4)
        self.assertEqual([item["item_ordinal"] for item in rows["package_item"]],
                         [0, 1, 2, 3])
        price = rows["price_observation"]
        self.assertEqual(price["price_basis"], "package")
        self.assertIsNone(price["offering_id"], "a bundle price attaches to the package")
        self.assertEqual(price["package_id"], "PK-1")

    def test_unknown_courses_are_reported_not_invented(self):
        # package_item requires a real certificate; a bundle naming an unknown course is a
        # review item, not a reason to fabricate one.
        package = find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")[0]
        rows = to_schema_rows(package, centre_id="C-1", package_id="PK-1",
                              certificate_ids={"Working at Height": "CERT-WAH"})
        self.assertEqual(len(rows["package_item"]), 1)
        self.assertIn("First Aid", rows["unresolved_items"])

    def test_the_mapping_satisfies_the_real_schema(self):
        import sqlite3

        from tcpipe.resources import schema_sql

        connection = sqlite3.connect(":memory:")
        connection.executescript(schema_sql())
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute(
            "INSERT INTO mission VALUES ('M','parsing_capability','t','p','d',1,0,1,'2020-01-01T00:00:00Z')")
        connection.execute(
            """INSERT INTO job_queue (job_id,mission_id,kind,params_json,git_commit,
                 idempotency_key,created_at_utc,updated_at_utc)
               VALUES ('J','M','parse','{}','c','k','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')""")
        connection.execute(
            """INSERT INTO centre (centre_id,display_name,entity_state,created_by_job_id,
                 created_at_utc,updated_at_utc)
               VALUES ('C-1','Test Centre','active','J','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')""")
        connection.execute(
            """INSERT INTO source (source_id,legal_name,source_kind,official_website,
                 discovered_via,intake_state,legal_review_state,created_at_utc)
               VALUES ('S','Src','association','https://x.invalid','seed','confirmed','pending','2020-01-01T00:00:00Z')""")
        connection.execute(
            "INSERT INTO certificate VALUES ('CERT-WAH','S',NULL,'Working at Height',NULL,'J')")

        package = find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")[0]
        rows = to_schema_rows(package, centre_id="C-1", package_id="PK-1",
                              certificate_ids={"Working at Height": "CERT-WAH"})
        connection.execute(
            """INSERT INTO package (package_id,centre_id,package_name,published_summary,
                 created_by_job_id) VALUES (?,?,?,?,'J')""",
            (rows["package"]["package_id"], rows["package"]["centre_id"],
             rows["package"]["package_name"], rows["package"]["published_summary"]))
        for item in rows["package_item"]:
            connection.execute(
                "INSERT INTO package_item (package_id,certificate_id,item_ordinal) VALUES (?,?,?)",
                (item["package_id"], item["certificate_id"], item["item_ordinal"]))
        price = rows["price_observation"]
        connection.execute(
            """INSERT INTO price_observation (price_id,offering_id,package_id,amount,currency,
                 price_basis,includes_vat,created_by_job_id) VALUES ('PR-1',?,?,?,?,?,?,'J')""",
            (price["offering_id"], price["package_id"], float(price["amount"]),
             price["currency"], price["price_basis"], price["includes_vat"]))
        stored = connection.execute(
            "SELECT price_basis, package_id, offering_id FROM price_observation").fetchone()
        self.assertEqual(stored, ("package", "PK-1", None))
        connection.close()


class RobustnessTests(unittest.TestCase):
    HOSTILE = ["", "<html>", "<html><body></body></html>",
               "<html><body>" + "<section><h3>package</h3></section>" * 500 + "</body></html>",
               "<html><body><section><h3>" + "x" * 50000 + "</h3></section></body></html>",
               "<html><body><ul>" + "<li>package</li>" * 3000 + "</ul></body></html>"]

    def test_never_raises(self):
        for index, html in enumerate(self.HOSTILE):
            with self.subTest(case=index):
                try:
                    packages = find_packages(tree_of(html) if html.strip() else None)
                    for package in packages:
                        package.as_dict()
                except Exception as exc:  # pragma: no cover - this is the assertion
                    self.fail(f"case {index} raised {type(exc).__name__}: {exc}")
                self.assertIsInstance(packages, list)

    def test_none_tree_and_empty_text(self):
        self.assertEqual(find_packages(None), [])
        self.assertEqual(find_packages(None, text=""), [])

    def test_output_is_bounded(self):
        html = ("<html><body>" + "".join(
            f"<section><h3>Package {i}: BOSIET + HUET</h3><p>{900 + i} EUR</p></section>"
            for i in range(200)) + "</body></html>")
        self.assertLessEqual(len(find_packages(tree_of(html))), 40)

    def test_is_deterministic(self):
        first = [p.as_dict() for p in find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")]
        second = [p.as_dict() for p in find_packages(tree_of(BUNDLE_PAGE), locale_hint="LV")]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
