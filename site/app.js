// Brick Locator. This site holds only the booklet's index (books/40517.json):
// part numbers, steps, pages and positions. The pages themselves are drawn by
// PDF.js from the reader's own copy of the booklet, which never leaves the browser.

import * as pdfjs from "./vendor/pdfjs/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const $ = (selector) => document.querySelector(selector);
const book = await fetch("books/40517.json").then((r) => r.json());
const tray = $("#parts-list");
const results = $("#results");
const search = $("#search");
const status = $("#gate-status");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ paper and night, shared with the site

const toggle = $(".theme-toggle");
const dark = () =>
  (document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const relabel = () => (toggle.firstElementChild.textContent = dark() ? "紙" : "夜");
toggle.addEventListener("click", () => {
  const next = dark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("s1lin-theme", next);
  } catch {
    /* private mode: the choice lasts until reload */
  }
  relabel();
});
relabel();

// ------------------------------------------------------------------ the booklet, kept on this device if the reader opens one

const KEY = book.booklet.sha256;
const kept = {
  db: () =>
    new Promise((ok, no) => {
      const open = indexedDB.open("brick-locator", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("booklets");
      open.onsuccess = () => ok(open.result);
      open.onerror = () => no(open.error);
    }),
  async run(mode, act) {
    const db = await this.db();
    return new Promise((ok, no) => {
      const request = act(db.transaction("booklets", mode).objectStore("booklets"));
      request.onsuccess = () => ok(request.result);
      request.onerror = () => no(request.error);
    });
  },
  get: () => kept.run("readonly", (s) => s.get(KEY)).catch(() => undefined),
  put: (buffer) => kept.run("readwrite", (s) => s.put(buffer, KEY)).catch(() => undefined),
  forget: () => kept.run("readwrite", (s) => s.clear()).catch(() => undefined),
};

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let pdf = null;
let fileUrl = "";

const remembered = $("#remembered");
const forget = $("#forget");
function keeping(yes) {
  remembered.textContent = yes ? "This device keeps your copy for next time." : "This device keeps a copy only after you open one here.";
  forget.hidden = !yes;
}

// The three checks under the sheet, ticked as they run.
const checks = Object.fromEntries([...document.querySelectorAll("#checks li")].map((li) => [li.dataset.step, li]));
const waiting = Object.fromEntries(Object.entries(checks).map(([step, li]) => [step, li.querySelector("span").textContent]));
function tick(step, state, note = waiting[step]) {
  checks[step].dataset.state = state;
  checks[step].querySelector("span").textContent = note;
}
const short = (hash) => `${hash.slice(0, 6)}…${hash.slice(-6)}`;
const size = (bytes) => (bytes < 1e6 ? `${Math.ceil(bytes / 1e3)} KB` : `${(bytes / 1e6).toFixed(1)} MB`);

/** Check a booklet against the reviewed one, then open it. */
async function accept(buffer, { remember }) {
  status.classList.remove("is-wrong");
  status.textContent = "";
  tick("read", "done", `${size(buffer.byteLength)}, ${remember ? "in this browser" : "the copy this device kept"}`);
  tick("check", "busy");
  tick("draw", "wait");
  const hash = await sha256(buffer);
  if (hash !== KEY) {
    tick("check", "fail", `SHA-256 ${short(hash)}, not ${short(KEY)}`);
    status.classList.add("is-wrong");
    status.textContent = `That is not booklet ${book.booklet.id}. Download it from LEGO with the link, and open that file.`;
    return;
  }
  tick("check", "done", `SHA-256 ${short(hash)}, the reviewed booklet`);
  if (remember) await kept.put(buffer);
  keeping(true);
  if (pdf) return;
  fileUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  tick("draw", "busy");
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  } catch {
    tick("draw", "fail", "the PDF could not be read");
    status.classList.add("is-wrong");
    status.textContent = "The booklet could not be read. Download it again and retry.";
    return;
  }
  await begin();
  tick("draw", "done", `${book.parts.length} piece types, from pages ${book.inventory_pages.join("–")}`);
  $("#gate").classList.add("is-open");
  status.textContent = `Booklet ${book.booklet.id} is open${remember ? "" : ", from the copy this device kept"}.`;
  if (remember) $("#booklet").scrollIntoView({ block: "start" });
}

async function openFile(file) {
  if (!file) return;
  tick("read", "busy", file.name);
  await accept(await file.arrayBuffer(), { remember: true });
}

$("#download").href = book.booklet.url;
const drop = $("#drop");
$("#booklet-file").addEventListener("change", (e) => openFile(e.target.files?.[0]));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("is-over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("is-over");
  openFile(e.dataTransfer?.files?.[0]);
});
forget.addEventListener("click", async () => {
  await kept.forget();
  keeping(false);
  remembered.textContent = "This device no longer keeps a copy.";
});

// ------------------------------------------------------------------ drawing pages from the booklet

const drawn = new Map(); // "page@scale" -> Promise<canvas>

/** A page of the booklet, drawn once at a scale and kept. */
function page(number, scale) {
  const key = `${number}@${scale}`;
  if (!drawn.has(key)) {
    drawn.set(
      key,
      (async () => {
        const p = await pdf.getPage(number);
        const viewport = p.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await p.render({ canvas, viewport }).promise;
        return canvas;
      })(),
    );
  }
  return drawn.get(key);
}

/** A copy of a region of a drawn page, in booklet points, into a canvas of its own. */
function crop(source, scale, [x0, y0, x1, y1], pad = 0) {
  const canvas = document.createElement("canvas");
  const [sx, sy] = [(x0 - pad) * scale, (y0 - pad) * scale];
  canvas.width = Math.round((x1 - x0 + 2 * pad) * scale);
  canvas.height = Math.round((y1 - y0 + 2 * pad) * scale);
  canvas.getContext("2d").drawImage(source, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const SHEET = 3; // pages for reading, at three times their printed size
const THUMB = 4; // the inventory, a little sharper, as its pictures are small
const pictures = new Map(); // part id -> canvas of its inventory picture

/** A frame round a callout, in booklet points, laid over a page. The page itself is left as printed. */
function frame(sheet, [x0, y0, x1, y1]) {
  const span = document.createElement("span");
  span.className = "mark";
  span.setAttribute("aria-hidden", "true");
  Object.assign(span.style, {
    left: `${((x0 - 2) / book.width) * 100}%`,
    top: `${((y0 - 2) / book.height) * 100}%`,
    width: `${((x1 - x0 + 4) / book.width) * 100}%`,
    height: `${((y1 - y0 + 4) / book.height) * 100}%`,
  });
  sheet.append(span);
  return sheet;
}

/** A page drawn from the reader's copy, with an optional frame round a callout, linked to that page in it. */
async function sheet(number, label, mark) {
  const link = document.createElement("a");
  link.className = "sheet";
  link.href = `${fileUrl}#page=${number}`;
  link.target = "_blank";
  link.rel = "noopener";
  const canvas = crop(await page(number, SHEET), SHEET, [0, 0, book.width, book.height]);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  link.append(canvas);
  return mark ? frame(link, mark) : link;
}

const copyOf = (canvas) => {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  c.getContext("2d").drawImage(canvas, 0, 0);
  return c;
};

// ------------------------------------------------------------------ a chosen piece and the steps that add it

/** The chosen piece: its picture, and how many steps add it. */
function selection(part, picture) {
  const steps = new Set(part.uses.map((u) => u.step)).size;
  const div = document.createElement("div");
  div.className = "selection";
  div.innerHTML = `<div class="selection__picture"></div>
    <div><p class="selection__count">${plural(steps, "step")} <em>${steps === 1 ? "adds" : "add"} it</em></p>
    <p>${plural(part.quantity, "piece")} of it in the whole build.</p></div>`;
  div.querySelector(".selection__picture").append(picture);
  return div;
}

const stepCaption = (use) =>
  `Step ${use.step}, ${use.last_page > use.page ? `pages ${use.page}–${use.last_page}` : `page ${use.page}`}: adds ${plural(use.quantity, "piece")}.`;

// The sample, before a booklet is open: the pages that add one part, as printed, from site/sample.
function showSample() {
  const part = book.parts.find((p) => p.id === book.sample_part);
  const picture = Object.assign(new Image(), { src: `sample/part-${part.id}.png`, alt: `Part ${part.id}, as pictured in the inventory` });
  $("#sample-piece").replaceChildren(selection(part, picture));
  $("#sample-pages").replaceChildren(
    ...part.uses.map((use) => {
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.append(
        Object.assign(new Image(), {
          src: `sample/page-${use.page}.png`,
          width: Math.ceil(book.width * 2),
          height: Math.ceil(book.height * 2),
          alt: `Page ${use.page} of the booklet, as printed, with part ${part.id} framed among the pieces for step ${use.step}`,
        }),
      );
      const figure = document.createElement("figure");
      figure.className = "match";
      const caption = document.createElement("figcaption");
      caption.textContent = stepCaption(use);
      figure.append(frame(sheet, use.bbox), caption);
      return figure;
    }),
  );
}
showSample();

// ------------------------------------------------------------------ the inventory and the steps

async function begin() {
  for (const number of book.inventory_pages) {
    const source = await page(number, THUMB);
    for (const part of book.parts.filter((p) => p.page === number)) pictures.set(part.id, crop(source, THUMB, part.image_bbox));
  }
  $("#sample").hidden = true;
  $("#workspace").hidden = false;
  renderInventory();
  await showPart();
}

function renderInventory() {
  const selected = location.hash.slice(1);
  const visible = book.parts.filter((part) => part.id.includes(search.value.trim()));
  tray.replaceChildren(
    ...visible.map((part) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "piece";
      button.dataset.part = part.id;
      button.setAttribute("aria-pressed", String(part.id === selected));
      button.setAttribute("aria-label", `Find the steps for part ${part.id}`);
      const label = document.createElement("span");
      label.textContent = part.id;
      button.append(copyOf(pictures.get(part.id)), label);
      return button;
    }),
  );
  if (!visible.length) tray.innerHTML = '<p class="none">No part with that number. Clear the filter to see the whole inventory.</p>';
  $("#inventory-count").textContent = `${visible.length} of ${book.parts.length} piece types · inventory, pages ${book.inventory_pages.join("–")}`;
}

let showing = 0; // the latest request wins when the reader picks quickly

async function showPart() {
  const ticket = ++showing;
  const part = book.parts.find((p) => p.id === location.hash.slice(1));
  for (const button of tray.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.part === part?.id));

  if (!part) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = `<h2 class="sect-label" id="results-heading"><span lang="ja">手順</span> Find its place in the build</h2>
      <p>${location.hash ? "That part is not in this booklet. " : ""}Choose a piece from the inventory. Every step that adds it will appear here, with the piece marked on the page.</p>`;
    empty.append(await sheet(1, `The cover of the ${book.title} instruction booklet, set ${book.set}`));
    if (ticket === showing) results.replaceChildren(empty);
    $("#announcement").textContent = "";
    return;
  }

  const steps = new Set(part.uses.map((u) => u.step)).size;
  const head = document.createElement("div");
  head.innerHTML = `<h2 class="sect-label" id="results-heading" tabindex="-1"><span lang="ja">手順</span> Part ${part.id}</h2>`;
  head.append(selection(part, copyOf(pictures.get(part.id))));

  const figures = [];
  for (const use of part.uses) {
    const figure = document.createElement("figure");
    figure.className = "match";
    figure.append(await sheet(use.page, `Page ${use.page}, with part ${part.id} marked among the pieces for step ${use.step}`, use.bbox));
    const caption = document.createElement("figcaption");
    caption.innerHTML = `${stepCaption(use)} <a href="${fileUrl}#page=${use.page}" target="_blank" rel="noopener">Open in your booklet ↗</a>`;
    figure.append(caption);
    for (let n = use.page + 1; n <= use.last_page; n++) {
      const more = document.createElement("details");
      more.innerHTML = `<summary>Step ${use.step} continues on page ${n}</summary>`;
      more.addEventListener("toggle", async () => {
        if (more.open && !more.querySelector(".sheet")) more.append(await sheet(n, `Page ${n}, where step ${use.step} continues`));
      });
      figure.append(more);
    }
    figures.push(figure);
  }
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "These are the steps that add the piece. Compare the marked callout and the model on each page with your build; a matching step alone does not mean the piece was missed there.";

  if (ticket !== showing) return;
  results.replaceChildren(head, ...figures, note);
  $("#announcement").textContent = `Part ${part.id}: ${plural(steps, "step")} ${steps === 1 ? "adds" : "add"} it.`;
}

tray.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-part]");
  if (!button) return;
  location.hash = button.dataset.part;
  if (matchMedia("(max-width: 900px)").matches) results.scrollIntoView({ block: "start" });
});
search.addEventListener("input", renderInventory);
addEventListener("hashchange", () => pdf && showPart());

// A booklet this device kept from last time opens by itself.
const saved = await kept.get();
if (saved) await accept(saved, { remember: false });
