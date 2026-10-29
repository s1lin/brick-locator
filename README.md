# Brick Locator

One piece left over after a build? Pick it from the booklet's inventory and see
every step that adds it, with its callout marked on the page.

**Use it:** [s1lin.tokensbeat.com/brick-locator](https://s1lin.tokensbeat.com/brick-locator/)

It covers one booklet so far: the Vespa, set 40517, LEGO building instructions
6394823. That is 60 piece types, 117 pieces and 47 steps, checked by hand
against the printed inventory.

## How it works

The site holds no instruction artwork. It holds an index of the booklet
(`site/books/40517.json`): element IDs, quantities, step numbers, pages and the
positions of the part pictures and callouts. Nothing else.

You bring the booklet:

1. Download the PDF from LEGO. The page links to it.
2. Open it in the page. Your browser checks its SHA-256 against the reviewed
   booklet, and then [PDF.js](https://mozilla.github.io/pdf.js/) draws the
   pages from your copy.
3. Your copy stays in your browser. If you open it there, the page keeps it in
   IndexedDB for next time. "Forget it" in the colophon clears it.

The index is built from the booklet's own text and image layout, not by a
model. A step is listed when its callout shows the piece. That tells you where
the piece goes, not that you missed it there, so compare the page with your
build.

## Run it locally

The viewer is static files and needs no build step:

```sh
python3 -m http.server 8000 --directory site
```

Then open <http://127.0.0.1:8000/>.

## Rebuild the index

You need a copy of the booklet and PyMuPDF:

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
curl -o booklets/6394823.pdf https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6394823.pdf
.venv/bin/python tools/build_index.py booklets/6394823.pdf
.venv/bin/python -m unittest discover -s tools -v
```

`booklets/*.pdf` is ignored by git, and must stay that way. The tests check
the committed index against the printed inventory. With the booklet present,
they also rebuild the index and require an identical result.

The builder only accepts the reviewed PDF. `tools/40517.reference.json` pins
its SHA-256 and maps each part to the picture the booklet uses for it, so a
changed booklet fails loudly. Adding a booklet means reviewing a new map like
that one. The parser also assumes this booklet's layout.

## Licence

The code is under the [GNU AGPL 3.0](LICENSE). The index builder uses
PyMuPDF, which is AGPL as well.

`site/vendor/pdfjs` holds PDF.js 6.4.299, unmodified, under the Apache 2.0
licence (`site/vendor/pdfjs/LICENSE`).

LEGO® is a trademark of the LEGO Group of companies which does not sponsor,
authorize or endorse this site. The building instructions are © the LEGO
Group, and this repository contains none of them.
