/**
 * PDF as a read-only surface (KR-68: PDF is a source, never a target).
 *
 * What this file owes the rest of the app is a *reading* experience — pages the
 * way a browser shows them, with real selectable text on top. It is not a CM
 * surface and does not pretend to be one: main.js branches on `tab.kind`, so a
 * PDF tab has `view: null` and everything that would write to a document is
 * closed off at the door rather than stubbed out here.
 *
 * Two pdf.js pieces are used and nothing else: a canvas render per page, and
 * pdf.js's own TextLayer — the invisible <span> mesh that makes the drawing
 * selectable. The mesh is what the next phase (Aktarma) reads passages from, so
 * it is here from the start, not bolted on later.
 */
import { GlobalWorkerOptions, TextLayer, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readingOrder } from "./pdf-order.js";
import { GLYPH, icon } from "./strip.js";
import { t } from "./i18n.js";

GlobalWorkerOptions.workerSrc = workerUrl;

export const isPdfPath = (path) => /\.pdf$/i.test(path ?? "");

// How far outside the viewport a page is still drawn. A book is not rendered at
// once — 300 canvases would take the launch with them — but scrolling must not
// land on a blank sheet either, so the band is generous.
const RENDER_BAND = 1200;

// How far out a drawn page is kept before it is thrown away again. Deliberately
// wider than RENDER_BAND, and that gap is the point: with one band, a page
// sitting on the line would be drawn and dropped and drawn again on every
// wobble of the scroll. Why throw them away at all — the band said what to
// draw, nobody said what to forget, so pages piled up for the life of the tab:
// at device resolution one A4 canvas is around 22 MB, and forty pages of
// reading is most of a gigabyte (Zafer, 29 Tem).
const KEEP_BAND = 3600;

// The white space around a page. Also how far above a page `goTo` stops.
const PAGE_GUTTER = 24;

// How big a page is before anyone touches it, as a multiple of its natural
// size. See measure() for why it is not 1.
const OPENING_ZOOM = 1.25;

// Zoom is the reader's, within reason. **1 is the size the page opens at, and
// that is what "%100" means here** — the reader's hundred is where the app put
// them, not the paper's own geometry (Zafer, 28 Tem). So Ctrl+0 and "%100" are
// the same place, which is the only way either of them is worth reading.
//
// Fixed rungs, not a multiplier. Ctrl+wheel used to multiply by 1.1, which
// walks 100 → 110 → 121 → 133 → 146: numbers nobody chose and no two of which
// are the same distance apart. A reader climbing a ladder should land on the
// steps every other reader has (Zafer: "8'er falan gidiyor").
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/**
 * Every drawn page's text layer, with the sacrificial <div> that makes dragging
 * across it behave. One registry for the whole app, because a selection is the
 * document's, not a page's: it starts on one page and ends three pages down.
 *
 * Ported from pdf.js's own viewer (web/text_layer_builder.js), trimmed to what
 * a Chromium WebView needs. It is not decoration. Drawing the mesh alone gives
 * you text that CAN be selected but fights the pointer: the layer is a heap of
 * absolutely positioned spans with nothing between them, so the browser has
 * nothing to extend the selection *through*, and the highlight jumps between
 * spans instead of following the drag (Zafer, 28 Tem: "tasmasından kurtulmaya
 * çalışan köpek gibi"). The `endOfContent` div is what fills those gaps: while
 * a drag is in progress it is moved next to the span the selection is anchored
 * on and stretched over the rest of the page, so the drag always has something
 * selectable under it.
 */
const textLayers = new Map();
let selectionWatched = false;

function registerTextLayer(layer, end) {
  textLayers.set(layer, end);
  watchSelection();
}

function forgetTextLayer(layer) {
  textLayers.delete(layer);
}

/** Puts a layer back to rest: the filler returns to the end, the class drops. */
function restLayer(end, layer) {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
}

/**
 * One set of document-level listeners, installed when the first PDF page is
 * drawn and left in place. They are cheap at rest (the registry is empty when
 * no PDF is open) and there is no moment at which removing them would be
 * correct — a selection can outlive the tab it started in.
 */
function watchSelection() {
  if (selectionWatched) return;
  selectionWatched = true;

  let pointerDown = false;
  document.addEventListener("pointerdown", () => {
    pointerDown = true;
  });
  document.addEventListener("pointerup", () => {
    pointerDown = false;
    textLayers.forEach(restLayer);
  });
  window.addEventListener("blur", () => {
    pointerDown = false;
    textLayers.forEach(restLayer);
  });
  document.addEventListener("keyup", () => {
    if (!pointerDown) textLayers.forEach(restLayer);
  });

  let previous = null;
  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      textLayers.forEach(restLayer);
      return;
    }

    // Which pages the selection is currently over — the others go back to rest.
    const active = new Set();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const layer of textLayers.keys()) {
        if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
      }
    }
    for (const [layer, end] of textLayers) {
      if (active.has(layer)) layer.classList.add("selecting");
      else restLayer(end, layer);
    }

    // Which end of the selection is moving: the filler goes on the far side of
    // the anchor, so the drag has somewhere to go.
    const range = selection.getRangeAt(0);
    const fromStart =
      previous &&
      (range.compareBoundaryPoints(Range.END_TO_END, previous) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, previous) === 0);

    let anchor = fromStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    // A range ending at offset 0 really ends on the previous node; walking back
    // finds the span the reader is actually on.
    if (!fromStart && range.endOffset === 0) {
      do {
        while (!anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor.previousSibling;
      } while (!anchor.childNodes.length);
    }

    const layer = anchor.parentElement?.closest(".textLayer");
    const end = layer && textLayers.get(layer);
    if (end) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      end.style.userSelect = "text";
      anchor.parentElement.insertBefore(end, fromStart ? anchor : anchor.nextSibling);
    }
    previous = range.cloneRange();
  });
}

/**
 * A page's text, as one string, with the offset each span covers in it.
 *
 * This is what gives a PDF something to anchor a mark TO. A PDF has no text
 * positions of its own — it has glyphs at coordinates — so a position has to be
 * built, and it is built here, from the spans in the order the reading-order
 * sort left them in. Rebuilding it from the spans (rather than from the items)
 * means nothing can drift out of alignment: the span is the thing the reader
 * selects, highlights are painted over, and offsets are counted through.
 *
 * The text runs together without line breaks, and that is deliberate — the
 * breaks in a PDF are typesetting (pdf-text.js), so an anchor that included them
 * would be anchored to the column width.
 */
function indexPage(slot) {
  const map = [];
  let at = 0;
  let text = "";
  for (const span of slot.text.querySelectorAll("span")) {
    const node = span.firstChild;
    if (!node) continue;
    const piece = node.textContent ?? "";
    if (!piece) continue;
    map.push({ node, from: at, to: at + piece.length });
    text += piece;
    at += piece.length;
  }
  slot.map = map;
  slot.pageText = text;
}

/**
 * The document's outline, flattened to rows of `{ title, level, page }`.
 *
 * Every entry has to be resolved to a page number, and that is the fiddly part:
 * a destination is either an array whose first element is a page reference, or
 * a NAME that has to be looked up first. Anything that will not resolve is
 * dropped rather than guessed — a contents row that goes to the wrong page is
 * worse than one that is not there.
 *
 * Depth is capped at three: below that the list stops being a map and becomes
 * the document again.
 */
async function readOutline(doc) {
  let tree;
  try {
    tree = await doc.getOutline();
  } catch {
    return [];
  }
  if (!tree?.length) return [];

  const rows = [];
  const walk = async (items, level) => {
    for (const item of items) {
      const spot = await pageOfDest(doc, item.dest);
      if (spot) rows.push({ title: item.title.trim(), level, page: spot.page, y: spot.y });
      if (item.items?.length && level < 3) await walk(item.items, level + 1);
    }
  };
  await walk(tree, 1);
  return rows;
}

/**
 * A destination, as `{ page, y }`.
 *
 * Two things had to be got right and only one of them was. The page reference
 * is usually an object, but some files write the page INDEX there instead, and
 * getPageIndex throws on a number — those rows were being dropped.
 *
 * And a destination is not a page: it is a place ON a page. A heading two
 * thirds down its page was landing at the top of that page, which reads as
 * "the contents took me to the wrong place". The y is in PDF coordinates —
 * measured from the BOTTOM — and which slot of the array holds it depends on
 * the destination's kind (XYZ carries x,y,zoom; FitH and FitBH carry y alone).
 */
async function pageOfDest(doc, dest) {
  try {
    const target = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(target) || !target.length) return null;

    const ref = target[0];
    const page =
      typeof ref === "number" ? ref + 1 : (await doc.getPageIndex(ref)) + 1;

    const kind = target[1]?.name;
    let y = null;
    if (kind === "XYZ") y = typeof target[3] === "number" ? target[3] : null;
    else if (kind === "FitH" || kind === "FitBH") y = typeof target[2] === "number" ? target[2] : null;

    return { page, y };
  } catch {
    return null;
  }
}

/** A DOM range over [from, to) of a page's text — for painting and for reading. */
function rangeOf(slot, from, to) {
  const first = slot.map.find((each) => each.to > from);
  const last = [...slot.map].reverse().find((each) => each.from < to);
  if (!first || !last) return null;

  const range = document.createRange();
  range.setStart(first.node, Math.max(0, from - first.from));
  range.setEnd(last.node, Math.min((last.node.textContent ?? "").length, to - last.from));
  return range;
}

/**
 * How much of one span the selection actually covers. Whole, unless the span is
 * where the drag started or ended — then it is cut at the offset.
 */
function selectedWithin(selection, span) {
  const node = span.firstChild;
  if (!node) return "";
  const whole = node.textContent ?? "";

  const range = selection.getRangeAt(0);
  const startsHere = node === range.startContainer;
  const endsHere = node === range.endContainer;
  if (!startsHere && !endsHere) return whole;

  return whole.slice(startsHere ? range.startOffset : 0, endsHere ? range.endOffset : whole.length);
}

/**
 * @param {{ parent: HTMLElement, data: Uint8Array, onPage?: (n: number, total: number) => void }} options
 * @returns {Promise<PdfSurface>}
 */
export async function createPdfSurface({ parent, data, onPage, onPaint, onZoom }) {
  const dom = document.createElement("div");
  dom.className = "pdf";
  // Scrollable and focusable: PageUp/Home have to reach it, and renderBody
  // focuses whatever the active tab is.
  dom.tabIndex = 0;
  parent.append(dom);

  const doc = await getDocument({
    data,
    // The 14 standard fonts a PDF is allowed to leave out (see vite.config.js).
    // The folder is copied into the bundle, so this is a path inside the app,
    // not a network fetch — MD Plus is offline (IS-01).
    standardFontDataUrl: "standard_fonts/",
  }).promise;

  // Page one's shape sizes every placeholder, so the scrollbar is honest before
  // a single page has been drawn. Each page corrects its own box once it renders
  // (a document may mix portrait and landscape).
  const first = await doc.getPage(1);
  const baseRatio = first.getViewport({ scale: 1 }).height / first.getViewport({ scale: 1 }).width;
  const baseWidth = first.getViewport({ scale: 1 }).width;

  // The document's own contents, resolved once at open.
  //
  // A .md's İçindekiler is read off its headings; a PDF carries its own tree,
  // and where it does not, its pages ARE its structure. Resolved here rather
  // than when the menu opens, because a destination is an async round trip
  // through the worker and a menu cannot wait.
  const outlineRows = await readOutline(doc);

  /** @type {Slot[]} */
  const slots = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const el = document.createElement("div");
    el.className = "pdf-page";
    const label = document.createElement("div");
    label.className = "pdf-page-no";
    label.textContent = String(n);
    el.append(label);
    dom.append(el);
    slots.push({ n, el, page: null, text: null, marks: null, hits: null, map: null, pageText: null, searchText: null, drawn: false, task: null, width: baseWidth, ratio: baseRatio });
  }

  let zoom = 1;
  // Whether the reader asked for the whole page. Any other zoom gesture clears
  // it: the control must not offer to "restore" a size the reader has left.
  let fitted = false;
  let fitScale = 1;
  let destroyed = false;
  let visible = 1;

  /**
   * Where the reader is: a page, and how far into it.
   *
   * Not a pixel offset — it has to survive a zoom and a narrower column, and
   * both change what a pixel means. Not a page number alone either: at the
   * opening zoom a page is taller than the window, so the number puts you back
   * on the page but not where you were on it.
   */
  let place = { n: 1, ratio: 0 };
  let restoring = false;

  /**
   * The resting size of a page, in pdf.js scale units.
   *
   * A page opens a quarter over its natural size and only ever shrinks from
   * there — never blown up to fill the window (a PDF spread edge to edge reads
   * as a poster, not as a document).
   *
   * Where OPENING_ZOOM comes from: at 100% an A4 page is 794 px wide, and it was
   * tempting to stop there because that is close to the app's own column
   * (--column: 760px). But the page is not the column — the PDF's own margins
   * are inside it, so its TEXT sits around 570 px while the app's prose sits at
   * 760. The two do not line up at all; they only look like they should on
   * paper (Zafer, 28 Tem: "iki tık daha yakınlaştırılabilir … md ile üst üste
   * oturmuyor"). A quarter up puts the PDF's text block near the app's own
   * measure, which is what actually matters when you read one after the other.
   * It is a starting point, not a limit: Ctrl+wheel is right there.
   */
  function measure() {
    const room = dom.clientWidth - 2 * PAGE_GUTTER;
    fitScale = room > 0 ? Math.min(room / baseWidth, OPENING_ZOOM) : OPENING_ZOOM;
  }

  const scaleOf = (slot) => (fitScale * zoom * baseWidth) / slot.width;

  /** Puts a 1-based page at the top of the view — the one place that decides
      what "being on a page" means, so the counter and the saved place agree. */
  function goToPage(n, { y = null } = {}) {
    const slot = slots.find((each) => each.n === n);
    if (!slot) return;
    let top = slot.el.offsetTop - PAGE_GUTTER;
    if (y != null) {
      const heightPt = slot.width * slot.ratio;
      // A little above it, so the heading is not welded to the top edge.
      top += Math.max(0, (heightPt - y) * scaleOf(slot) - 10);
    }
    dom.scrollTop = top;
    // Noted AT ONCE, not left to the scroll event: a restore that comes later in
    // the same breath asks `place`, and a stale one would pull the reader back
    // off the page they were just sent to.
    refresh();
    notePlace();
  }

  /** Sizes a page's box without drawing it — placeholders and zoom both need it. */
  function layout(slot) {
    const width = slot.width * scaleOf(slot);
    slot.el.style.width = `${Math.round(width)}px`;
    slot.el.style.height = `${Math.round(width * slot.ratio)}px`;
  }

  function layoutAll() {
    measure();
    for (const slot of slots) layout(slot);
  }

  /**
   * Pages waiting to be drawn, and the one being drawn.
   *
   * One at a time, nearest to the eye first. Everything in the band used to be
   * started at once, and a PDF has a single worker: the page you were looking at
   * queued behind three you were not, and its text mesh — which is main-thread
   * work — landed after theirs. Order is asked freshly at every turn, not fixed
   * when the page joined the queue, so scrolling away from a page that has not
   * started yet costs nothing.
   */
  const waiting = new Set();
  let painting = false;

  /** Draws a page if it is not drawn, and hands back the drawing in progress —
      what anyone who needs to know WHERE something on that page is has to wait
      for (see revealRange: an undrawn page cannot answer that question). */
  function draw(slot) {
    if (destroyed || slot.drawn) return slot.drawing ?? Promise.resolve();
    slot.drawn = true; // claimed before the first await: scrolling fires again
    // The promise is handed out now and settled later, when the page's turn
    // comes: showPage awaits this, and it must exist from the moment the page
    // was asked for — not from the moment it starts being drawn.
    slot.drawing = new Promise((resolve) => {
      slot.begin = resolve;
    });
    waiting.add(slot);
    pump();
    return slot.drawing;
  }

  /** Starts the waiting page closest to the middle of the window. */
  function pump() {
    if (painting || destroyed || !waiting.size) return;
    const middle = dom.scrollTop + dom.clientHeight / 2;
    let next = null;
    let best = Infinity;
    for (const slot of waiting) {
      const distance = Math.abs(slot.el.offsetTop + slot.el.offsetHeight / 2 - middle);
      if (distance < best) {
        best = distance;
        next = slot;
      }
    }
    // Nothing to choose between: a detached box has no offset, so every distance
    // came back NaN. Release what was promised instead of leaving the queue to
    // be looked at again forever (see `begin` in clear: a dropped promise hangs).
    if (!next) {
      for (const slot of waiting) {
        slot.begin?.();
        slot.begin = null;
        slot.drawing = null;
        slot.drawn = false;
      }
      waiting.clear();
      return;
    }
    waiting.delete(next);
    painting = true;
    try {
      const done = paint(next);
      next.begin?.(done); // whoever holds `drawing` now waits on the real work
      next.begin = null;
      done.finally(() => {
        painting = false;
        pump();
      });
    } catch (error) {
      // The lane is a latch, and it is opened again only from `done.finally`. A
      // throw before that promise exists would shut it for the life of the tab:
      // no page would ever be drawn again, silently.
      painting = false;
      next.begin?.();
      next.begin = null;
      next.drawn = false;
      console.warn(`PDF: ${next.n}. sayfa sıraya alınamadı`, error);
    }
  }

  /**
   * Draws one page: canvas first, then the text mesh over it.
   *
   * The canvas is drawn at device resolution and shown at CSS resolution — on a
   * 150% Windows display the cheap way (CSS-scaled canvas) turns academic body
   * text to mush, which is the one thing a reader would notice immediately.
   */
  async function paint(slot) {
    // A page thrown away mid-draw must not put itself back on screen: `clear`
    // can cancel the canvas, but not a getTextContent already in flight. The
    // generation says whether the work still belongs to anyone.
    const gen = slot.gen ?? 0;
    const stale = () => destroyed || (slot.gen ?? 0) !== gen;

    try {
      slot.page ??= await doc.getPage(slot.n);
      if (stale()) return;

      const unit = slot.page.getViewport({ scale: 1 });
      slot.width = unit.width;
      slot.ratio = unit.height / unit.width;
      layout(slot);

      const scale = scaleOf(slot);
      const viewport = slot.page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;

      slot.task = slot.page.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
      });
      await slot.task.promise;
      if (stale()) return;

      const text = document.createElement("div");
      text.className = "textLayer";
      // Every span's font-size is `calc(var(--total-scale-factor) * …)` — the
      // property IS the geometry, and its name matters: `--scale-factor` (the
      // name pdf.js used up to v4) leaves the calc unresolved, so every span
      // falls back to 16px and lands in the wrong place. Nothing errors; the
      // text simply is not where the drawing is, which only shows when you try
      // to select it.
      text.style.setProperty("--total-scale-factor", String(scale));
      // The order the items arrive in is the order they were DRAWN in, which is
      // not the order they are read in — see pdf-order.js. Selection follows the
      // DOM, so the sort has to happen before the mesh is built, not after.
      //
      // (`includeMarkedContent: true`, which pdf.js's own viewer passes, was
      // tried first on the theory that the structure tree would supply a logical
      // order. It changed nothing here: these PDFs carry no useful structure
      // tree, and a flag cannot invent one. Left off — it only adds markers we
      // would have to step around.)
      const content = await slot.page.getTextContent();
      const layer = new TextLayer({
        textContentSource: { items: readingOrder(content.items), styles: content.styles },
        container: text,
        viewport,
      });
      await layer.render();
      if (stale()) return;

      // What makes dragging a selection feel like dragging a selection (see
      // watchSelection). Without it the pointer is picking single spans out of a
      // mesh, and the highlight lurches between them.
      const end = document.createElement("div");
      end.className = "endOfContent";
      text.append(end);
      registerTextLayer(text, end);
      slot.text = text;
      indexPage(slot);

      // Where marks are painted. Its own layer under the text mesh: a highlight
      // is not text and must not join the selection, and it must sit over the
      // drawing so the ink shows through it.
      const marks = document.createElement("div");
      marks.className = "pdf-marks";
      slot.marks = marks;

      // Search hits get a layer of their own rather than sharing the marks'.
      // paintPage clears its layer on every repaint, and a hit painted into it
      // would blink out the next time a mark moved — two lifetimes, two layers.
      const hits = document.createElement("div");
      hits.className = "pdf-hits";
      slot.hits = hits;

      slot.el.replaceChildren(canvas, marks, hits, text, pageNumber(slot.n));
      onPaint?.(slot.n);
    } catch (error) {
      if (stale()) return; // cancelled on purpose (clear): not a failure
      // A page that will not draw is a page, not a crash: the rest of the book
      // still reads. console.warn, never error — the red band is for crashes.
      console.warn(`PDF: ${slot.n}. sayfa çizilemedi`, error);
      slot.drawn = false;
    }
  }

  /** Throws a drawn page away. The registry entry goes with it: a Map holding
      detached text layers would grow with every zoom and be walked on every
      selectionchange for the life of the app. */
  function clear(slot) {
    slot.drawn = false;
    // Whatever is in flight for this page no longer belongs to anyone (see
    // paint/stale): the canvas can be cancelled, a getTextContent cannot, and
    // without this the abandoned work would put the page back on screen.
    slot.gen = (slot.gen ?? 0) + 1;
    waiting.delete(slot);
    // A page waiting its turn was promised to somebody (showPage awaits it).
    // Dropping it silently would leave that await hanging for good.
    slot.begin?.();
    slot.begin = null;
    slot.drawing = null;
    slot.task?.cancel();
    slot.task = null;
    // The canvas is the big thing, but not the only one: pdf.js keeps the page's
    // operator list and font data on the proxy, and that is exactly what forty
    // pages of reading accumulate. The proxy itself is kept (it saves a getPage);
    // only what it cached is released, and it comes back on the next render.
    slot.page?.cleanup();
    if (slot.text) forgetTextLayer(slot.text);
    slot.text = null;
    slot.marks = null;
    slot.hits = null;
    slot.map = null;
    slot.pageText = null;
    slot.el.replaceChildren(pageNumber(slot.n));
  }

  function pageNumber(n) {
    const label = document.createElement("div");
    label.className = "pdf-page-no";
    label.textContent = String(n);
    return label;
  }

  /** Draws what is on screen (plus the band), and reports the page being read. */
  function refresh() {
    if (destroyed) return;
    // No height is not "a short window", it is NOT BEING SEEN — a hidden tab, a
    // host between two parents. Every page would sit at offset 0 and so test
    // inside the band, and the whole book would be queued for drawing.
    if (!dom.clientHeight) return;
    const top = dom.scrollTop;
    const bottom = top + dom.clientHeight;
    let current = visible;
    for (const slot of slots) {
      const from = slot.el.offsetTop;
      const to = from + slot.el.offsetHeight;
      if (to > top - RENDER_BAND && from < bottom + RENDER_BAND) draw(slot);
      // Out of the wider band: forgotten, canvas and mesh and all. It comes
      // back the same way it came the first time — the anchors of its marks are
      // text, not offsets into a live layer (KR-16), so nothing is lost by it.
      else if (slot.drawn && (to < top - KEEP_BAND || from > bottom + KEEP_BAND)) clear(slot);
      // The page you are reading is the one crossing the upper third, not the
      // one that happens to start highest: on a tall page those differ for
      // whole screenfuls of scrolling.
      if (from <= top + dom.clientHeight / 3 && to > top + dom.clientHeight / 3) current = slot.n;
    }
    if (current !== visible) {
      visible = current;
      onPage?.(visible, doc.numPages);
    }
  }

  /**
   * Throws away every drawn page and lays the boxes out again — what both a zoom
   * and a window resize need. The page being read is kept under the eye: without
   * it, widening the window sends the reader back to wherever the old pixel
   * offset now happens to point.
   */
  function redrawAll() {
    for (const slot of slots) clear(slot);
    layoutAll();
    restoreView();
  }

  /** Notes where the reader is, off a scroll that really happened. */
  function notePlace() {
    if (restoring || destroyed) return;
    const slot = slots.find((each) => each.n === visible);
    const height = slot?.el.offsetHeight;
    if (!height) return;
    place = { n: visible, ratio: (dom.scrollTop - (slot.el.offsetTop - PAGE_GUTTER)) / height };
  }

  /** Puts the eye back where it was, and draws around it. */
  function restoreView() {
    if (!dom.clientHeight) return; // out of sight: nothing to put back yet
    const anchor = slots.find((slot) => slot.n === place.n);
    if (anchor) {
      // Restoring is not reading: the scroll it causes must not be taken for the
      // reader moving, or the place would be rewritten from the place itself.
      restoring = true;
      const top = anchor.el.offsetTop - PAGE_GUTTER + place.ratio * anchor.el.offsetHeight;
      dom.scrollTop = Math.max(0, top);
      visible = place.n;
      restoring = false;
    }
    refresh();
  }

  /** Re-draws everything at a new zoom, keeping the page you were on in view. */
  function rezoom(next) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (clamped === zoom) return;
    zoom = clamped;
    redrawAll();
    // The status line carries the scale (see `scale` below). Ctrl+wheel is a
    // gesture with no visible control behind it: without a number somewhere,
    // the reader has no way to tell how far they have gone or that Ctrl+0 is
    // what comes back.
    onZoom?.();
  }

  /**
   * One rung up or down. The current zoom may sit between rungs (a window
   * resize does not move it, but an older session might), so the step is taken
   * from the nearest one — never "the first rung above", which would make one
   * of the two directions a no-op.
   */
  function zoomStep(direction) {
    fitted = false;
    let nearest = 0;
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      if (Math.abs(ZOOM_STEPS[i] - zoom) < Math.abs(ZOOM_STEPS[nearest] - zoom)) nearest = i;
    }
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, nearest + direction));
    rezoom(ZOOM_STEPS[next]);
  }

  dom.addEventListener(
    "scroll",
    () => {
      refresh(); // it decides which page is being read; the place is read off that
      notePlace();
    },
    { passive: true },
  );

  // Ctrl+wheel is the zoom gesture everywhere else; the app should not be the
  // one place it means something different.
  // The wheel turns pages while a page is being held whole, and scrolls
  // otherwise. Held whole, the document is a deck: a wheel that inches a
  // fully-fitted slide by forty pixels moves nothing anyone wanted moved, and it
  // disagreed with ↑ ↓, which were already turning pages (Zafer, 2 Ağu).
  //
  // Throttled, because one flick of a wheel is many events and a trackpad is a
  // stream of them: without the lock a single gesture would fly through five
  // slides. The threshold ignores the tail of an inertial scroll.
  let turnLock = 0;
  dom.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
        zoomStep(event.deltaY < 0 ? 1 : -1);
        return;
      }
      if (!fitted) return;

      event.preventDefault();
      if (Math.abs(event.deltaY) < 4) return;
      const now = Date.now();
      if (now < turnLock) return;
      turnLock = now + 320;
      goToPage(Math.min(Math.max(1, visible + (event.deltaY > 0 ? 1 : -1)), doc.numPages));
    },
    { passive: false },
  );

  // Resizing the pages from inside the observer's own callback is what raised
  // "ResizeObserver loop completed with undelivered notifications" while the
  // window was being dragged narrower: re-laying out the pages changes the
  // scroll height, which brings a scrollbar in or out, which is another resize —
  // in the same frame, forever. So the callback only notes that something moved;
  // the work happens in the next frame, and only if the WIDTH really changed.
  // (Height alone changes nothing: the pages are sized to the column.)
  let lastWidth = 0;
  let queued = false;
  let unseen = false;
  const resize = new ResizeObserver(() => {
    if (queued || destroyed) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (destroyed) return;
      const width = dom.clientWidth;
      // Zero is not a width, it is the ABSENCE of one: switching tabs hides the
      // host (`display:none`, main.js/renderBody) and the observer dutifully
      // reports 0×0. Taken as a resize, that threw every drawn page away — and
      // coming back to the tab paid for all of them again, from scratch (Zafer,
      // 29 Tem: "bir pdf'e tıkladığımda 1-2 sn geç geliyor"). A page that cannot
      // be measured has not changed; it is merely out of sight.
      if (!width) {
        unseen = true;
        return;
      }
      if (width === lastWidth) {
        // Same column, so nothing has to be laid out again — but a tab that was
        // hidden does not come back where it was left: the browser drops a
        // `display:none` scroller's offset, so scrollTop is 0 and nothing has
        // scrolled to make `refresh` run. The reader who left off on page 30
        // faced a blank sheet while the status line still said "sayfa 30 / n",
        // until the first turn of the wheel. (Only after being out of sight: a
        // height-only resize must not snap the page under the eye.)
        if (!unseen) return;
        unseen = false;
        restoreView();
        return;
      }
      unseen = false;
      lastWidth = width;
      redrawAll();
      // No onZoom here: the pages are refitted to the new column width, but the
      // reader's zoom is a multiple of that fit, so the number does not move.
    });
  });
  resize.observe(dom);

  layoutAll();
  // Noted here, not left at 0: the observer fires once the moment it starts
  // watching, and a zero would read as "the window changed" and throw away the
  // pages that were just drawn.
  lastWidth = dom.clientWidth;
  refresh();
  onPage?.(1, doc.numPages);

  /** @typedef {{ n: number, el: HTMLDivElement, page: any, text: HTMLDivElement | null, drawn: boolean, task: any, width: number, ratio: number }} Slot */
  /** @typedef {ReturnType<typeof surface>} PdfSurface */
  function surface() {
    return {
      dom,
      pageCount: doc.numPages,
      get page() {
        return visible;
      },
      /**
       * The number in the status line. Against the size the document OPENED at
       * — so "%100" and Ctrl+0 are the same place. (The paper's own scale was
       * tried first and rejected: it made the opening size read "%125", a
       * number the reader never chose and cannot return to by name.)
       */
      get zoomPercent() {
        return Math.round(zoom * 100);
      },
      focus: () => dom.focus({ preventScroll: true }),
      /**
       * Puts the reader back where they were — what anything that MOVES this
       * surface in the DOM has to call.
       *
       * A scroller that leaves the tree and comes back is at the top again: the
       * browser rebuilds its box from nothing and the offset with it, silently.
       * Aktarma does exactly that on every retarget (transfer.js/unbind + bind,
       * in one task and at the same width, so no observer ever sees it) and the
       * reader faced a blank sheet — the page they were on had been thrown out
       * of the band long ago — until the first turn of the wheel.
       */
      restorePlace: restoreView,
      zoomIn: () => zoomStep(1),
      zoomOut: () => zoomStep(-1),
      zoomReset: () => {
        fitted = false;
        rezoom(1);
      },

      /** Whether the whole page is currently on screen — what the fit control
          reads to know which half of the toggle it is showing. */
      get fitted() {
        return fitted;
      },

      /**
       * The page at the largest size this window can show it WHOLE, and back
       * again.
       *
       * Both directions, not just width. A slide deck is landscape: filled to
       * the width it runs off the bottom, and a slide with its last line cut off
       * is not a slide (Zafer, 2 Ağu — Archaeology_of_Meaning.pdf). Whichever
       * side runs out first decides, so an A4 shrinks to fit and a slide grows
       * to fill; both end up entirely on screen, as large as they can be.
       *
       * Measured from what is on screen rather than recomputed from the
       * viewport: the page's box already knows how big it is at this zoom, so
       * the ratio between that and the window is the factor, whatever the paper.
       */
      fitToScreen() {
        if (fitted) {
          fitted = false;
          rezoom(1);
          return;
        }
        const slot = slots.find((each) => each.n === visible) ?? slots[0];
        if (!slot) return;
        // The gutter on every side: a page pushed to the very edge makes the
        // window scroll to show a margin that is not there.
        const roomWidth = dom.clientWidth - PAGE_GUTTER * 2;
        const roomHeight = dom.clientHeight - PAGE_GUTTER * 2;
        const nowWidth = slot.width * scaleOf(slot);
        const nowHeight = nowWidth * slot.ratio;
        if (!nowWidth || !nowHeight || roomWidth <= 0 || roomHeight <= 0) return;
        const before = zoom;
        rezoom(zoom * Math.min(roomWidth / nowWidth, roomHeight / nowHeight));
        // Only claim it if the zoom could actually go there (the ladder has
        // ends): otherwise the next press would "restore" a size never left.
        fitted = zoom !== before;
        // Land on the page that was being read, not wherever the reflow left us.
        goToPage(slot.n);
      },
      /**
       * Scrolls to a 1-based page — and, if the caller knows one, to a place on
       * it (`y`, in PDF coordinates, measured from the bottom of the page). The
       * contents of a PDF point at places, not at pages.
       */
      goTo: goToPage,

      /**
       * Scrolls to a page AND waits until it is drawn — the door for anything
       * that has to look at what is on it (marks: their anchors resolve against
       * a page's text, and there is no text before the page is drawn).
       * Resolves to whether the page can now be asked.
       */
      async showPage(n) {
        const slot = slots.find((each) => each.n === n);
        if (!slot) return false;
        dom.scrollTop = slot.el.offsetTop - PAGE_GUTTER;
        refresh();
        notePlace();
        await slot.drawing;
        return !destroyed && Boolean(slot.map);
      },

      /**
       * Puts a stored range on screen. `goTo` stops at the top of a page, and at
       * the zoom this opens at a page is taller than the window — so travelling
       * to a mark in the lower half of a page showed the reader the page and not
       * the mark (Zafer, 28 Tem: "F8 ile dolaşıyor ama ekran dışındakilere
       * odaklanmıyor"). A third of the way down, so the passage's continuation
       * stays under it.
       */
      revealRange(page, from, to) {
        const slot = slots.find((each) => each.n === page);
        if (!slot?.map) return;
        const box = rangeOf(slot, from, to)?.getBoundingClientRect();
        if (!box || (!box.width && !box.height)) return;
        const view = dom.getBoundingClientRect();
        dom.scrollTop = Math.max(0, dom.scrollTop + (box.top - view.top) - dom.clientHeight / 3);
        refresh();
        notePlace();
      },
      /** The text the reader has selected, or "" — raw, line breaks and all. */
      selectedText() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return "";
        if (!dom.contains(selection.anchorNode)) return "";
        return selection.toString();
      },

      /**
       * The selected passage as pieces WITH THE SHAPE they had on the page —
       * what pdf-text.js repairs into paragraphs. Text alone cannot tell a
       * wrapped line from a new paragraph; where the line started and how far
       * below the last one it sat can.
       *
       * The boxes are read off the spans themselves rather than off the text
       * items, so nothing depends on the two lists staying index-aligned: the
       * span IS the thing that was selected.
       */
      selectedParts() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
        if (!dom.contains(selection.anchorNode)) return [];

        const parts = [];
        for (const slot of slots) {
          if (!slot.text) continue;
          for (const span of slot.text.querySelectorAll("span")) {
            if (!selection.containsNode(span, true)) continue;
            const text = selectedWithin(selection, span);
            if (!text) continue;
            const box = span.getBoundingClientRect();
            parts.push({ text, left: box.left, right: box.right, top: box.top });
          }
        }
        return parts;
      },
      /**
       * The rows İçindekiler shows for this document: its own outline where it
       * has one, its pages where it does not. Both answer the same question —
       * "what is in here, and take me there" — which is why they come out of one
       * door and land in one menu.
       */
      contents() {
        if (outlineRows.length) return outlineRows;
        return Array.from({ length: doc.numPages }, (_, index) => ({
          title: null, // named by the caller, in the reader's language
          level: 1,
          page: index + 1,
        }));
      },

      /**
       * A page as a small picture, for the contents menu. Cached on the slot and
       * NOT thrown away with the drawn page: a thumbnail is a few kilobytes, and
       * re-rendering one every time the menu opens would make the list stutter.
       *
       * Drawn on its own canvas, so it never touches the page being read.
       */
      async thumbnail(n, height = 90) {
        const slot = slots.find((each) => each.n === n);
        if (!slot) return null;
        if (slot.thumb) return slot.thumb;

        slot.page ??= await doc.getPage(n);
        if (destroyed) return null;
        // Sized by HEIGHT, not width: the rows line up on a single height and
        // each page is as wide as it actually is, so no page floats inside a
        // frame with grey to the left and right of it.
        const base = slot.page.getViewport({ scale: 1 });
        const viewport = slot.page.getViewport({ scale: height / base.height });
        // Supersampled ×3 over the device's own resolution, capped at six times
        // life size. A 46-pixel-wide page is mostly 4pt type: at 1:1 the strokes
        // fall between pixels whatever the screen, and each doubling of the
        // drawing buys back some of that. The cap is where it stops paying —
        // and where the canvases stop being a few kilobytes each.
        const dpr = Math.min((window.devicePixelRatio || 1) * 3, 6);
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        await slot.page.render({
          canvasContext: canvas.getContext("2d", { alpha: false }),
          viewport,
          transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
        }).promise;
        if (destroyed) return null;
        slot.thumb = canvas;
        return canvas;
      },

      /** The text of a page, once it has been drawn — what an anchor binds to. */
      textOfPage(n) {
        return slots.find((slot) => slot.n === n)?.pageText ?? null;
      },

      /**
       * A page's text WHETHER OR NOT it is drawn — what searching the document
       * needs. `textOfPage` can only answer for pages on screen, and the whole
       * point of a search is to find what is not on screen (B-32's lesson, in
       * its second form: "not in the list" and "not on screen" are not the same
       * thing).
       *
       * The undrawn answer is built the same way the drawn one is: the same
       * reading-order sort, the same skipping of empty pieces, so an offset
       * found here is the offset the page will have once it IS drawn. Cached —
       * a search re-runs on every keystroke and this crosses the worker.
       */
      async textForSearch(n) {
        const slot = slots.find((each) => each.n === n);
        if (!slot) return "";
        if (slot.pageText) return slot.pageText;
        if (slot.searchText != null) return slot.searchText;
        slot.page ??= await doc.getPage(n);
        if (destroyed) return "";
        const content = await slot.page.getTextContent();
        slot.searchText = readingOrder(content.items)
          .map((item) => item.str ?? "")
          .filter(Boolean)
          .join("");
        return slot.searchText;
      },

      /** Paints one page's hits. Same geometry as the marks, its own layer. */
      paintHits(n, ranges) {
        const slot = slots.find((each) => each.n === n);
        if (!slot?.hits || !slot.map) return;
        slot.hits.replaceChildren();
        const page = slot.el.getBoundingClientRect();

        for (const one of ranges) {
          const range = rangeOf(slot, one.from, one.to);
          if (!range) continue;
          for (const box of range.getClientRects()) {
            if (!box.width || !box.height) continue;
            const rect = document.createElement("div");
            rect.className = one.active ? "pdf-hit pdf-hit-active" : "pdf-hit";
            rect.style.left = `${box.left - page.left}px`;
            rect.style.top = `${box.top - page.top}px`;
            rect.style.width = `${box.width}px`;
            rect.style.height = `${box.height}px`;
            slot.hits.append(rect);
          }
        }
      },

      /** Every page's hits, gone — the search ended or the word changed. */
      clearHits() {
        for (const slot of slots) slot.hits?.replaceChildren();
      },

      /** Which pages are drawn, so their marks can be resolved and painted. */
      drawnPages() {
        return slots.filter((slot) => slot.pageText).map((slot) => slot.n);
      },

      /**
       * Where the selection is, as a page and a span of that page's text — the
       * PDF's answer to "from, to". Null unless it lies within a single page: a
       * mark is a passage, and a passage that crosses a page break is two.
       */
      selectionRange() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
        if (!dom.contains(selection.anchorNode)) return null;
        const range = selection.getRangeAt(0);

        for (const slot of slots) {
          if (!slot.map || !slot.text.contains(range.startContainer)) continue;
          if (!slot.text.contains(range.endContainer)) return null; // across pages
          const start = slot.map.find((each) => each.node === range.startContainer);
          const end = slot.map.find((each) => each.node === range.endContainer);
          if (!start || !end) return null;
          return {
            page: slot.n,
            from: start.from + range.startOffset,
            to: end.from + range.endOffset,
          };
        }
        return null;
      },

      /** The repaired Markdown of a stored range — what actually gets moved. */
      partsOfRange(page, from, to) {
        const slot = slots.find((each) => each.n === page);
        if (!slot?.map) return [];
        return slot.map
          .filter((each) => each.to > from && each.from < to)
          .map((each) => {
            const span = each.node.parentElement;
            const box = span.getBoundingClientRect();
            const text = (each.node.textContent ?? "").slice(
              Math.max(0, from - each.from),
              Math.min(each.to - each.from, to - each.from),
            );
            return { text, left: box.left, right: box.right, top: box.top };
          })
          .filter((part) => part.text);
      },

      /**
       * Paints the marks of one page. Rectangles, not a background on the spans:
       * the spans are transparent text used for selection, and colouring them
       * would put the highlight on top of the words instead of behind them.
       */
      paintPage(n, marks) {
        const slot = slots.find((each) => each.n === n);
        if (!slot?.marks || !slot.map) return;
        slot.marks.replaceChildren();
        const page = slot.el.getBoundingClientRect();

        for (const mark of marks) {
          const range = rangeOf(slot, mark.from, mark.to);
          if (!range) continue;

          let first = null;
          for (const box of range.getClientRects()) {
            if (!box.width || !box.height) continue;
            first ??= box;
            const rect = document.createElement("div");
            rect.className = mark.active ? "pdf-mark pdf-mark-active" : "pdf-mark";
            rect.dataset.mark = mark.id;
            rect.style.left = `${box.left - page.left}px`;
            rect.style.top = `${box.top - page.top}px`;
            rect.style.width = `${box.width}px`;
            rect.style.height = `${box.height}px`;
            slot.marks.append(rect);
          }

          // The badge, exactly as in a document (UC-14): out in the margin,
          // level with the mark's FIRST line, so a page of them forms one
          // column instead of trailing the prose wherever it happens to end.
          // Only a commented mark has one — colour already says "marked", the
          // badge says "there is something written about this".
          if (mark.note && first) {
            const badge = document.createElement("button");
            badge.className = "pdf-badge";
            badge.dataset.mark = mark.id;
            badge.title = t("palette.comment");
            badge.innerHTML = icon(GLYPH.note, 13);
            badge.style.top = `${first.top - page.top}px`;
            slot.marks.append(badge);
          }
        }
      },

      /** Where a stored range sits on screen — what the strip opens against. */
      rectOfRange(page, from, to) {
        const slot = slots.find((each) => each.n === page);
        if (!slot?.map) return null;
        const range = rangeOf(slot, from, to);
        const box = range?.getBoundingClientRect();
        return box && (box.width || box.height) ? box : null;
      },

      /**
       * The mark under a point, or null — the strip's way in (KR-73).
       *
       * Measured, not hit-tested. `elementsFromPoint` looks like the obvious
       * tool and it does not work here: it skips anything with
       * `pointer-events: none`, which the highlights must have — they lie over
       * the page, and a highlight that catches the pointer is a highlight you
       * cannot select text through. So the rectangles are compared by geometry,
       * which is what they are (Zafer, 28 Tem: pressing a mark did nothing,
       * while the counter opened it — the counter never asks a pointer).
       */
      /** Where a mark's badge sits, so its box can open against it (B-21). */
      badgeRect(id) {
        for (const slot of slots) {
          const badge = slot.marks?.querySelector(`.pdf-badge[data-mark="${id}"]`);
          if (badge) return badge.getBoundingClientRect();
        }
        return null;
      },

      markAt(x, y) {
        for (const slot of slots) {
          if (!slot.marks) continue;
          for (const rect of slot.marks.children) {
            const box = rect.getBoundingClientRect();
            if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
              return rect.dataset.mark;
            }
          }
        }
        return null;
      },

      destroy() {
        destroyed = true;
        resize.disconnect();
        waiting.clear();
        for (const slot of slots) {
          slot.task?.cancel();
          slot.begin?.(); // nobody is going to draw it now; let the awaits go
          slot.begin = null;
          if (slot.text) forgetTextLayer(slot.text);
        }
        doc.destroy();
        dom.remove();
      },
    };
  }

  return surface();
}
