"""Regression checks against the printed inventory and reviewed step callouts.

They read the committed index, so they run anywhere. With a copy of the booklet
in booklets/, they also rebuild the index from it and require the same result.
"""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "site" / "books" / "40517.json"
SAMPLE = ROOT / "site" / "sample"
BOOKLET = ROOT / "booklets" / "6394823.pdf"


class IndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = json.loads(INDEX.read_text())
        cls.parts = {part["id"]: part for part in cls.book["parts"]}

    def steps(self, part_id):
        return [use["step"] for use in self.parts[part_id]["uses"]]

    def test_complete_inventory_and_repeated_uses(self):
        self.assertEqual(len(self.parts), 60)
        self.assertEqual(self.book["step_count"], 47)
        self.assertEqual(self.steps("6210269"), [3, 40])
        self.assertEqual(self.steps("6170390"), [28, 39, 46, 47])
        self.assertEqual(self.steps("6371584"), [43])
        self.assertNotIn("637158", self.parts)

    def test_column_boundaries_and_duplicate_pdf_text(self):
        self.assertEqual(self.steps("6056816"), [9])
        self.assertEqual(self.steps("6173961"), [16, 21])
        uses = self.parts["371021"]["uses"]
        self.assertEqual([(u["step"], u["quantity"]) for u in uses], [(25, 1)])

    def test_similar_gray_parts_have_distinct_references(self):
        self.assertEqual(self.steps("4211807"), [34])
        self.assertEqual(self.steps("6168646"), [35])
        self.assertEqual(self.steps("4260707"), [24])

    def test_continuation_pages_and_inventory_quantities(self):
        uses = self.parts["370026"]["uses"]
        self.assertEqual([(u["step"], u["page"], u["last_page"]) for u in uses], [(30, 19, 20)])
        self.assertEqual([u["last_page"] for u in self.parts["6308000"]["uses"]], [33, 35])
        self.assertEqual(sum(p["quantity"] for p in self.parts.values()), 117)
        for part in self.parts.values():
            self.assertEqual(sum(u["quantity"] for u in part["uses"]), part["quantity"], part["id"])

    def test_every_picture_and_callout_lies_on_its_page(self):
        w, h = self.book["width"], self.book["height"]
        for part in self.parts.values():
            boxes = [part["image_bbox"]] + [u["bbox"] for u in part["uses"]]
            for x0, y0, x1, y1 in boxes:
                self.assertTrue(0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h, part["id"])

    def test_the_index_carries_no_artwork(self):
        # Facts and positions only: the pages are drawn from the reader's own copy.
        text = INDEX.read_text()
        self.assertLess(len(text), 64_000)
        self.assertNotIn("data:image", text)
        self.assertTrue(self.book["booklet"]["url"].startswith("https://www.lego.com/"))

    def test_the_sample_is_a_limited_extract(self):
        # The pages that add one part, and its picture. Nothing more of the booklet is in the repo.
        part = self.parts[self.book["sample_part"]]
        pages = {use["page"] for use in part["uses"]}
        self.assertLessEqual(len(pages), 2)
        expected = {f"part-{part['id']}.png"} | {f"page-{n}.png" for n in pages}
        self.assertEqual({path.name for path in SAMPLE.iterdir()}, expected)
        for path in SAMPLE.iterdir():
            self.assertTrue(path.read_bytes().startswith(b"\x89PNG"), path.name)


@unittest.skipUnless(BOOKLET.exists(), "no copy of the booklet in booklets/")
@unittest.skipUnless(importlib.util.find_spec("pymupdf"), "PyMuPDF is not installed")
class RebuildTests(unittest.TestCase):
    def test_rebuilding_from_the_booklet_gives_the_same_index(self):
        import build_index

        self.assertEqual(build_index.load(BOOKLET), json.loads(INDEX.read_text()))

    def test_unreviewed_pdf_is_rejected(self):
        import build_index

        with tempfile.TemporaryDirectory() as directory:
            other = Path(directory) / "other.pdf"
            other.write_bytes(b"different booklet")
            with self.assertRaisesRegex(ValueError, "differs from the reviewed booklet"):
                build_index.load(other)

    def test_the_sample_is_the_booklet_unaltered(self):
        import build_sample

        files = build_sample.render(BOOKLET)
        self.assertEqual({name: (SAMPLE / name).read_bytes() for name in files}, files)


if __name__ == "__main__":
    unittest.main()
