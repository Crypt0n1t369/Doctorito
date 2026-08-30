import unittest

from tcpipe.adapter import load_document
from tcpipe.money import best_price, parse_money
from tcpipe.repetition import (
    best_region,
    column_profile,
    find_repeated_regions,
    row_cells,
    row_texts,
    signature_of,
)


def tree_of(html):
    return load_document(html.encode("utf-8"), content_type="text/html").tree


def nav(count=8, tag="nav"):
    items = "".join(f'<li><a href="/p{i}">Page {i}</a></li>' for i in range(count))
    return f"<{tag}><ul>{items}</ul></{tag}>"


COURSE_TABLE = """<main><h1>Our courses</h1><table class="courses"><tbody>
<tr class="course-row"><td>GWO Basic Safety Training</td><td>5 days</td><td>1 250,00 EUR</td></tr>
<tr class="course-row"><td>GWO BST Refresher</td><td>2 days</td><td>650,00 EUR</td></tr>
<tr class="course-row"><td>GWO Advanced Rescue Training</td><td>3 days</td><td>980,00 EUR</td></tr>
<tr class="course-row"><td>BOSIET with CA-EBS</td><td>3 days</td><td>1 450,00 EUR</td></tr>
</tbody></table></main>"""

FULL_PAGE = (f"<html><body>{nav()}"
             f'<div class="sidebar"><ul>'
             + "".join(f'<li><a href="/t{i}">Tag {i}</a></li>' for i in range(10))
             + "</ul></div>"
             + COURSE_TABLE
             + f"{nav(6, 'footer')}</body></html>")


class SignatureTests(unittest.TestCase):
    def test_hashed_and_indexed_classes_do_not_break_identity(self):
        # Build tools emit per-element hashes and indices; treating them as identity makes
        # every row structurally unique and finds no repetition at all.
        first = tree_of("<html><body><div class='card css-1a2b3c4 item-1'><h3>a</h3></div></body></html>")
        second = tree_of("<html><body><div class='card css-9z8y7x6 item-2'><h3>b</h3></div></body></html>")
        self.assertEqual(signature_of(first.xpath("//div")[0]),
                         signature_of(second.xpath("//div")[0]))

    def test_state_classes_are_ignored(self):
        first = tree_of("<html><body><li class='row active'><a>x</a></li></body></html>")
        second = tree_of("<html><body><li class='row'><a>y</a></li></body></html>")
        self.assertEqual(signature_of(first.xpath("//li")[0]),
                         signature_of(second.xpath("//li")[0]))

    def test_different_structures_differ(self):
        first = tree_of("<html><body><div class='card'><h3>a</h3></div></body></html>")
        second = tree_of("<html><body><div class='banner'><p>a</p></div></body></html>")
        self.assertNotEqual(signature_of(first.xpath("//div")[0]),
                            signature_of(second.xpath("//div")[0]))


class DetectionTests(unittest.TestCase):
    def test_finds_the_course_table_and_not_the_furniture(self):
        regions = find_repeated_regions(tree_of(FULL_PAGE))
        self.assertTrue(regions)
        winner = regions[0]
        self.assertEqual(winner.row_count, 4)
        self.assertIn("course-row", winner.signature)
        for region in regions:
            self.assertNotIn("/nav/", region.container_locator)
            self.assertNotIn("/footer/", region.container_locator)

    def test_a_navigation_only_page_yields_nothing(self):
        # The commonest failure mode of repetition detection is returning the nav bar.
        self.assertEqual(find_repeated_regions(tree_of(f"<html><body>{nav(12)}</body></html>")), [])

    def test_a_sidebar_tag_cloud_is_rejected(self):
        html = ("<html><body><div class='sidebar widget'><ul>"
                + "".join(f'<li><a href="/t{i}">Tag {i}</a></li>' for i in range(15))
                + "</ul></div></body></html>")
        self.assertEqual(find_repeated_regions(tree_of(html)), [])

    def test_card_grid_is_found(self):
        html = ("<html><body><div class='grid'>" + "".join(
            f"<div class='card css-1a2b3c4 item-{i}'><h3>Course {i}: GWO BST</h3>"
            f"<p>Duration 5 days</p><span>€{1000 + i * 50}</span></div>"
            for i in range(6)) + "</div></body></html>")
        region = best_region(tree_of(html))
        self.assertIsNotNone(region)
        self.assertEqual(region.row_count, 6)

    def test_definition_list_layout_is_found(self):
        html = ("<html><body><div class='prices'>" + "".join(
            f"<div class='item'><span class='n'>GWO Course {i}</span>"
            f"<span class='p'>{900 + i} EUR</span></div>" for i in range(5))
                + "</div></body></html>")
        region = best_region(tree_of(html))
        self.assertIsNotNone(region)
        self.assertEqual(region.row_count, 5)

    def test_a_single_course_page_has_no_repetition(self):
        html = ("<html><body><main><h1>BOSIET</h1><p>Duration 3 days.</p>"
                "<p>Price €950 per person.</p></main></body></html>")
        self.assertEqual(find_repeated_regions(tree_of(html)), [],
                         "no repetition is the right answer, not a forced match")

    def test_the_inner_list_wins_over_its_wrapper(self):
        regions = find_repeated_regions(tree_of(FULL_PAGE))
        containers = [region.container_locator for region in regions]
        self.assertEqual(len(containers), len(set(containers)))
        for outer in containers:
            for inner in containers:
                if outer != inner:
                    self.assertFalse(inner.startswith(outer + "/"),
                                     "a wrapper must not be reported alongside its list")

    def test_every_region_carries_evidence(self):
        for region in find_repeated_regions(tree_of(FULL_PAGE)):
            self.assertTrue(region.evidence)
            self.assertTrue(region.container_locator)
            self.assertEqual(len(region.row_locators), region.row_count)


class CellTests(unittest.TestCase):
    def test_row_text_preserves_cell_boundaries(self):
        # text_content() concatenates, producing "Training5 days1 250,00 EUR" — which
        # merges a course name into a duration and corrupts every downstream parse.
        region = best_region(tree_of(FULL_PAGE))
        self.assertIn("GWO Basic Safety Training 5 days 1 250,00 EUR", row_texts(region))

    def test_column_profile_identifies_what_each_column_holds(self):
        region = best_region(tree_of(FULL_PAGE))
        self.assertEqual(column_profile(region), ["course", "duration", "price"])

    def test_columns_pair_each_course_with_its_own_price(self):
        region = best_region(tree_of(FULL_PAGE))
        profile = column_profile(region)
        name_index, price_index = profile.index("course"), profile.index("price")
        pairs = {}
        for cells in row_cells(region):
            price = best_price(parse_money(cells[price_index], locale_hint="LV"))
            pairs[cells[name_index]] = price.normalized if price else None
        self.assertEqual(pairs["GWO Basic Safety Training"], "EUR 1250.00")
        self.assertEqual(pairs["GWO BST Refresher"], "EUR 650.00")
        self.assertEqual(pairs["BOSIET with CA-EBS"], "EUR 1450.00")

    def test_rows_without_children_still_yield_text(self):
        html = ("<html><body><div class='list'>"
                + "".join(f"<p class='r'>GWO Course {i} costs {900 + i} EUR</p>"
                          for i in range(5)) + "</div></body></html>")
        region = best_region(tree_of(html))
        self.assertIsNotNone(region)
        self.assertTrue(all(cells and cells[0] for cells in row_cells(region)))


class RobustnessTests(unittest.TestCase):
    HOSTILE = [
        "", "<html>", "<html><body></body></html>",
        "<html><body>" + "<div><span>x</span></div>" * 6000 + "</body></html>",
        "<html><body>" + "<div>" * 300 + "deep" + "</div>" * 300 + "</body></html>",
        "<html><body><table>" + "<tr><td>1</td></tr>" * 3000 + "</table></body></html>",
    ]

    def test_never_raises(self):
        for index, html in enumerate(self.HOSTILE):
            with self.subTest(case=index):
                try:
                    regions = find_repeated_regions(
                        tree_of(html) if html.strip() else None)
                    for region in regions:
                        region.as_dict()
                        row_cells(region)
                        column_profile(region)
                except Exception as exc:  # pragma: no cover - this is the assertion
                    self.fail(f"case {index} raised {type(exc).__name__}: {exc}")
                self.assertIsInstance(regions, list)

    def test_none_tree_is_handled(self):
        self.assertEqual(find_repeated_regions(None), [])
        self.assertIsNone(best_region(None))

    def test_output_is_bounded(self):
        html = "<html><body>" + "".join(
            f"<div class='g{g}'>" + "".join(
                f"<div class='card'><h3>GWO Course {i}</h3><span>€{i}00</span></div>"
                for i in range(6)) + "</div>" for g in range(40)) + "</body></html>"
        self.assertLessEqual(len(find_repeated_regions(tree_of(html))), 5)

    def test_is_deterministic(self):
        first = [r.as_dict() for r in find_repeated_regions(tree_of(FULL_PAGE))]
        second = [r.as_dict() for r in find_repeated_regions(tree_of(FULL_PAGE))]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
