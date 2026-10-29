"""Build the step index for a reviewed instruction booklet.

Reads your own copy of the booklet PDF and writes site/books/<set>.json: the
printed element IDs, quantities, step numbers, pages and the positions of the
part pictures. It writes no images and no copy of the PDF; the viewer draws
the pages from the reader's own copy, in the browser.

Usage:
  python3 tools/build_index.py booklets/6394823.pdf

The PDF must be the reviewed booklet: its SHA-256 has to match the reference.
"""

import hashlib
import json
from pathlib import Path
import re
import sys

import pymupdf as pdf

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = Path(__file__).resolve().parent / "40517.reference.json"


def spans(page):
    # Some PDF labels are painted twice in the same place.
    unique = {}
    for block in page.get_text("dict", flags=0)["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                key = (span["text"], tuple(round(v, 2) for v in span["bbox"]))
                unique[key] = span
    return list(unique.values())


def illustration(images, label):
    x, y = label["bbox"][:2]
    candidates = [
        image for image in images
        if abs(image["bbox"][0] - x) < 2 and -1 < y - image["bbox"][3] < 6
    ]
    if not candidates:
        raise ValueError(f"No illustration above quantity {label['text']} at {x}, {y}")
    return min(candidates, key=lambda im: abs(im["bbox"][0] - x) + abs(y - im["bbox"][3]))


def index_book(document, reference):
    # shortcut: this layout and reviewed image map cover one booklet; review a new map before adding another.
    parts = {}
    for number in reference["inventory_pages"]:
        page = document[number - 1]
        labels = spans(page)
        images = page.get_image_info(xrefs=True)
        for label in labels:
            if not re.fullmatch(r"\d{6,7}", label["text"]):
                continue
            part_id = label["text"]
            quantities = [
                q for q in labels if re.fullmatch(r"\d+x", q["text"])
                and abs(q["bbox"][0] - label["bbox"][0]) < 1
                and 0 < label["bbox"][1] - q["bbox"][1] < 12
            ]
            if len(quantities) != 1:
                raise ValueError(f"Ambiguous inventory quantity for {part_id}")
            quantity = quantities[0]
            image = illustration(images, quantity)
            if part_id in parts or image["xref"] != reference["parts"][part_id]["inventory_image"]:
                raise ValueError(f"Inventory illustration changed for {part_id}")
            parts[part_id] = {
                "id": part_id, "quantity": int(quantity["text"][:-1]),
                "page": number, "image_bbox": [round(v, 2) for v in image["bbox"]], "uses": [],
            }

    image_parts = {p["step_image"]: part_id for part_id, p in reference["parts"].items()}
    steps = {}
    for number in range(reference["instruction_pages"][0], reference["instruction_pages"][1] + 1):
        page = document[number - 1]
        labels = spans(page)
        headings = [s for s in labels if re.fullmatch(r"\d+", s["text"]) and 23 < s["size"] < 24]
        for heading in headings:
            step = int(heading["text"])
            if step in steps:
                raise ValueError(f"Duplicate step heading: {step}")
            steps[step] = {"number": step, "page": number}
        quantities = [s for s in labels if re.fullmatch(r"\d+x", s["text"]) and 7 < s["size"] < 8]
        images = page.get_image_info(xrefs=True)
        for quantity in quantities:
            image = illustration(images, quantity)
            if image["xref"] not in image_parts:
                raise ValueError(f"Unreviewed part illustration on page {number}: {image['xref']}")
            candidates = [s for s in headings if s["bbox"][0] <= quantity["bbox"][0] + 1]
            if not candidates:
                raise ValueError(f"No step for a quantity on page {number}")
            heading = max(candidates, key=lambda s: s["bbox"][0])
            part = parts[image_parts[image["xref"]]]
            box = pdf.Rect(image["bbox"]) | pdf.Rect(quantity["bbox"])
            part["uses"].append({
                "step": int(heading["text"]), "page": number,
                "quantity": int(quantity["text"][:-1]), "bbox": [round(v, 2) for v in box],
            })

    if set(steps) != set(range(1, reference["step_count"] + 1)):
        raise ValueError("The booklet's step sequence is incomplete")
    if set(parts) != set(reference["parts"]) or len(image_parts) != len(parts):
        raise ValueError("The reviewed part mapping is incomplete")
    for step in steps.values():
        next_page = steps.get(step["number"] + 1, {"page": reference["instruction_pages"][1] + 1})["page"]
        step["last_page"] = max(step["page"], next_page - 1)
    for part in parts.values():
        part["uses"].sort(key=lambda use: (use["step"], use["page"]))
        if sum(use["quantity"] for use in part["uses"]) != part["quantity"]:
            raise ValueError(f"Step quantities disagree with the inventory for {part['id']}")
        for use in part["uses"]:
            use["last_page"] = steps[use["step"]]["last_page"]
    return {
        "title": reference["title"], "set": reference["set"],
        "booklet": {"id": reference["booklet"], "sha256": reference["sha256"], "url": reference["url"]},
        "page_count": len(document), "step_count": len(steps),
        "width": round(document[0].rect.width, 2), "height": round(document[0].rect.height, 2),
        "inventory_pages": reference["inventory_pages"],
        "parts": sorted(parts.values(), key=lambda p: (p["page"], p["image_bbox"][1], p["image_bbox"][0])),
    }


def load(path):
    reference = json.loads(REFERENCE.read_text())
    source = Path(path)
    if hashlib.sha256(source.read_bytes()).hexdigest() != reference["sha256"]:
        raise ValueError("The PDF differs from the reviewed booklet. Review its index before building.")
    with pdf.open(source) as document:
        return index_book(document, reference)


def main(argv):
    if len(argv) != 1:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    data = load(argv[0])
    out = ROOT / "site" / "books" / f"{data['set']}.json"
    out.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"Indexed {len(data['parts'])} parts across {data['step_count']} steps: {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
