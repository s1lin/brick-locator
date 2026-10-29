"""Render the sample the viewer shows before a reader opens their booklet.

The pages that add one part, and that part's inventory picture, rendered
unaltered: a limited extract, which the LEGO Group's Fair Play policy does not
object to. Every other page is drawn from the reader's own copy.

Usage:
  python3 tools/build_sample.py booklets/6394823.pdf
"""

from pathlib import Path
import sys

import pymupdf as pdf

import build_index

SAMPLE = build_index.ROOT / "site" / "sample"
PAGE_SCALE = 2  # 766 x 579 px, sharp at the width the viewer shows it
PICTURE_SCALE = 4


def render(path):
    """The sample's files, as {name: PNG bytes}."""
    book = build_index.load(path)
    part = next(p for p in book["parts"] if p["id"] == book["sample_part"])
    pages = sorted({use["page"] for use in part["uses"]})
    if len(pages) > 2:
        raise ValueError("A sample is two pages at most; choose a part used on fewer pages")
    with pdf.open(path) as document:
        picture = document[part["page"] - 1].get_pixmap(
            matrix=pdf.Matrix(PICTURE_SCALE, PICTURE_SCALE), clip=part["image_bbox"], alpha=False)
        files = {f"part-{part['id']}.png": picture.tobytes("png")}
        for number in pages:
            page = document[number - 1].get_pixmap(matrix=pdf.Matrix(PAGE_SCALE, PAGE_SCALE), alpha=False)
            files[f"page-{number}.png"] = page.tobytes("png")
    return files


def main(argv):
    if len(argv) != 1:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    files = render(argv[0])
    SAMPLE.mkdir(exist_ok=True)
    for old in SAMPLE.iterdir():
        old.unlink()
    for name, data in files.items():
        (SAMPLE / name).write_bytes(data)
    print(f"Wrote {', '.join(sorted(files))} to {SAMPLE.relative_to(build_index.ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
