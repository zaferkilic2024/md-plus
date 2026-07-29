/**
 * Reading order for a PDF page's text items — pure, no pdf.js, no DOM (KR-68).
 *
 * WHY THIS EXISTS. A PDF's text is a drawing-instruction stream, and a stream is
 * under no obligation to run down the page. Measured on Zafer's own documents:
 * in `oyun_teorisi_determinizm.pdf` the prose is emitted top to bottom and then
 * every KaTeX glyph on the page follows, jumping back up — the printer draws the
 * formulas in a later pass. A list whose lines begin with a formula therefore
 * has its opening symbols sitting, in the stream, AFTER the paragraph below the
 * list.
 *
 * That matters because a selection follows the DOM and the DOM follows the
 * stream: dragging into such a list leaps to the text underneath it (Zafer,
 * 28 Tem). Edge has no such trouble — its viewer orders text geometrically — so
 * this is not "how PDFs are", it is work a viewer is expected to do.
 *
 * Reordering costs nothing visually: every span is positioned absolutely from
 * its own transform, so the page is drawn identically. Only the ORDER changes,
 * which is what selection, copy and (later) passage extraction read.
 *
 * HOW. Recursive XY-cut, the standard answer: find the widest band of white
 * space crossing the whole block, split there, and treat each half the same way.
 * A page-wide heading is cut off horizontally first, which is what UNCOVERS the
 * gutter between the columns beneath it — a single pass looking for a gutter
 * finds none on such a page, because the heading crosses it. When neither cut is
 * possible the block is a paragraph, and paragraphs read line by line.
 *
 * Not a layout engine: it knows white space, not tables, sidebars or pull
 * quotes. On those the order is no worse than the stream it started from.
 */

/** Items whose baselines are closer than this share a line (superscripts too). */
const LINE_SLACK = 0.55;

/** A gutter must clear all three of these to count as a column break.
    Measured, not guessed: the gutter on a Nature two-column page is 11pt on a
    595pt sheet — 1.8%. A 3.5% rule (tried first) threw it away and read the two
    columns as one. The floor that keeps a "river" of aligned word gaps inside a
    paragraph from passing is the font: a gutter is about as wide as a line is
    tall, a river is a space. */
const GUTTER_SHARE = 0.015;
const GUTTER_MIN = 6;
const GUTTER_LINES = 3;

/** Neither side of a vertical cut may be a sliver. */
const SIDE_SHARE = 0.15;

/** Cutting cannot go on forever; a page is not that deep. */
const MAX_DEPTH = 40;

/**
 * @param {Array<{ str: string, transform: number[], width?: number, height?: number }>} items
 * @returns {Array} the same items, in reading order
 */
export function readingOrder(items) {
  if (!Array.isArray(items) || items.length < 2) return items;
  // Anything without a position (marked-content markers, say) is left alone
  // rather than guessed at: this function reorders, it never drops.
  if (!items.every((item) => Array.isArray(item?.transform) && item.transform.length >= 6)) return items;

  const boxes = items.map(boxOf);

  const slack = Math.max(2, LINE_SLACK * medianHeight(boxes));

  // Text that does not run the way the page runs is not part of the flow: a
  // margin stamp, a rotated figure label, a stray watermark. It goes to the END
  // of the page rather than into the column it happens to sit beside.
  //
  // The rule it is settling (Zafer, 28 Tem — "Edge seçmiyor, biz seçiyoruz,
  // hangisi doğru?"): DELIBERATELY selectable, never selected BY ACCIDENT. Edge
  // leaves such text unselectable altogether, which hides something real — an
  // arXiv id is exactly what you reach for when a passage lands in a document.
  // Dropping it into the middle of a column, which is what happened before, is
  // the other error: sweeping a paragraph brought a line of metadata with it.
  const main = boxes.filter((box) => box.turned === dominantTurn(boxes));
  const aside = boxes.filter((box) => box.turned !== dominantTurn(boxes));

  return [...cut(main, slack, 0), ...cut(aside, slack, 0)].map((box) => box.item);
}

/**
 * Which way the page's text runs, as the quarter-turn most of it takes. Counted
 * by width, not by item: a page of body text broken into many short runs must
 * still outweigh one long stamp — and a genuinely sideways page (a landscape
 * table) must be allowed to call itself upright.
 */
function dominantTurn(boxes) {
  const weight = new Map();
  for (const box of boxes) {
    const width = Math.max(box.right - box.x, box.top - box.bottom, 1);
    weight.set(box.turned, (weight.get(box.turned) ?? 0) + width);
  }
  let best = 0;
  let mass = -1;
  for (const [turn, total] of weight) {
    if (total > mass) {
      mass = total;
      best = turn;
    }
  }
  return best;
}

/** One block: split it if white space allows, otherwise read it line by line. */
function cut(boxes, slack, depth) {
  if (boxes.length <= 1 || depth >= MAX_DEPTH) return lineSort(boxes, slack);

  // A gutter first. It is the stronger claim — two columns are two texts, and
  // reading across them is not a near miss, it is nonsense.
  const gutter = verticalGap(boxes);
  if (gutter !== null) {
    const left = boxes.filter((box) => centerOf(box) < gutter);
    const right = boxes.filter((box) => centerOf(box) >= gutter);
    return [...cut(left, slack, depth + 1), ...cut(right, slack, depth + 1)];
  }

  // Otherwise the widest horizontal band. On a plain page this just peels off
  // paragraph by paragraph and ends in lineSort — the same answer, reached
  // safely. On a page with a banner heading it is what exposes the columns.
  const band = horizontalGap(boxes, slack);
  if (band !== null) {
    const above = boxes.filter((box) => box.y > band);
    const below = boxes.filter((box) => box.y <= band);
    if (above.length && below.length) {
      return [...cut(above, slack, depth + 1), ...cut(below, slack, depth + 1)];
    }
  }

  return lineSort(boxes, slack);
}

/**
 * An item's real bounding box — which means honouring ROTATION.
 *
 * `width` and `height` are given along the text's own axes, not the page's. Read
 * as if they were horizontal, a 90°-rotated margin stamp (arXiv puts its id down
 * the left edge of page 1) turns into a 344pt-wide bar lying across the middle
 * of the page — and a bar across the middle erases the column gutter, so the two
 * columns read as one. Measured on 2412.16241v1.pdf: exactly two items crossed
 * the gutter, the title and that stamp (Zafer, 28 Tem).
 */
function boxOf(item, index) {
  const [a, b, c, d, e, f] = item.transform;
  const width = Number.isFinite(item.width) ? item.width : 0;
  const height = Number.isFinite(item.height) && item.height > 0 ? item.height : 0;

  // The advance runs along (a, b); the ascent along (c, d). Normalised, because
  // width/height are already in page units.
  const along = Math.hypot(a, b) || 1;
  const up = Math.hypot(c, d) || 1;
  const wx = (a / along) * width;
  const wy = (b / along) * width;
  const hx = (c / up) * height;
  const hy = (d / up) * height;

  const xs = [e, e + wx, e + hx, e + wx + hx];
  const ys = [f, f + wy, f + hy, f + wy + hy];
  return {
    item,
    index,
    // Which quarter-turn this item's baseline takes: 0 upright, 1 turned.
    turned: Math.abs(b) > Math.abs(a) ? 1 : 0,
    x: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
    y: f, // the baseline: what lines are grouped by
    height,
  };
}

const centerOf = (box) => (box.x + box.right) / 2;

function medianHeight(boxes) {
  const heights = boxes.map((box) => box.height).filter((h) => h > 0).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)] : 0;
}

/** Lines top to bottom, each read left to right. */
function lineSort(boxes, slack) {
  const sorted = [...boxes].sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  let line = null;
  let baseline = null;
  for (const box of sorted) {
    // Measured against the LINE's baseline, not the previous item: a run of
    // small type would otherwise creep upward one item at a time and swallow
    // the line above it.
    if (line && Math.abs(baseline - box.y) <= slack) {
      line.push(box);
      continue;
    }
    if (line) out.push(...line.sort(byX));
    line = [box];
    baseline = box.y;
  }
  if (line) out.push(...line.sort(byX));
  return out;
}

const byX = (a, b) => a.x - b.x || a.index - b.index;

/** How many distinct lines a block holds — a gutter has to outlast a few. */
function lineCount(boxes, slack) {
  const ys = boxes.map((box) => box.y).sort((a, b) => b - a);
  let lines = 0;
  let baseline = null;
  for (const y of ys) {
    if (baseline === null || Math.abs(baseline - y) > Math.max(2, slack)) {
      lines++;
      baseline = y;
    }
  }
  return lines;
}

/**
 * The x of a column gutter inside this block, or null. Strict emptiness is the
 * right test here precisely because the recursion has already cut away whatever
 * spanned the page.
 */
function verticalGap(boxes) {
  const from = Math.min(...boxes.map((box) => box.x));
  const to = Math.max(...boxes.map((box) => box.right));
  const span = to - from;
  if (span <= 0) return null;

  // Two lines either side of a gap is a coincidence; a column is a column for
  // the length of the block.
  if (lineCount(boxes, 0.55 * medianHeight(boxes)) < GUTTER_LINES) return null;

  const floor = Math.max(GUTTER_MIN, GUTTER_SHARE * span, 0.9 * medianHeight(boxes));
  const runs = emptyRuns(span, (mark) => {
    for (const box of boxes) mark(box.x - from, box.right - from);
  });

  // EVERY wide-enough band is a candidate, not just the widest one. Page 1 of
  // 2412.16241v1.pdf has two bands of exactly 20pt: the real gutter, and the
  // channel between arXiv's margin stamp and the left column. Taking the widest
  // and stopping picked the stamp's channel, failed the share test below, and
  // concluded there was no gutter at all — so the two columns were read across
  // (Zafer, 28 Tem: "seçmeye başlar başlamaz sağa zıplıyor").
  const enough = SIDE_SHARE * boxes.length;
  let best = null;
  for (const run of runs) {
    if (run.size < floor) continue;
    const at = from + run.middle;
    const left = boxes.filter((box) => centerOf(box) < at).length;
    if (left < enough || boxes.length - left < enough) continue;
    // Widest wins; on a tie the more even split does — a gutter halves a page,
    // a margin channel shaves a strip off it.
    const balance = Math.abs(0.5 - left / boxes.length);
    if (!best || run.size > best.size || (run.size === best.size && balance < best.balance)) {
      best = { size: run.size, at, balance };
    }
  }
  return best ? best.at : null;
}

/**
 * The y of the widest horizontal band of white space, or null. The band has to
 * be more than the ordinary leading between two lines, or every line break in
 * the block would count as a structural cut.
 */
function horizontalGap(boxes, slack) {
  const from = Math.min(...boxes.map((box) => box.bottom));
  const to = Math.max(...boxes.map((box) => box.top));
  const span = to - from;
  if (span <= 0) return null;

  // The item's real vertical extent (rotation included), with the slack standing
  // in for a missing height so a run of zero-height items cannot fake a gap.
  const runs = emptyRuns(span, (mark) => {
    for (const box of boxes) {
      const bottom = box.height > 0 ? box.bottom : box.y - slack * 0.25;
      const top = box.height > 0 ? box.top : box.y + slack;
      mark(bottom - from, top - from);
    }
  });
  const widest = runs.reduce((best, run) => (!best || run.size > best.size ? run : best), null);
  if (!widest || widest.size <= slack) return null;
  return from + widest.middle;
}

/**
 * Every uncovered run in a 1-D span, as {size, middle}. `fill` is handed a
 * `mark(a, b)` to declare the covered stretches. One point per cell: a page is
 * hundreds of points across and the blocks only get smaller from here.
 */
function emptyRuns(span, fill) {
  const width = Math.ceil(span);
  const taken = new Uint8Array(width + 1);
  fill((a, b) => {
    const start = Math.max(0, Math.floor(a));
    const end = Math.min(width, Math.ceil(b));
    for (let at = start; at <= end; at++) taken[at] = 1;
  });

  const runs = [];
  let runFrom = null;
  for (let at = 0; at <= width; at++) {
    if (!taken[at]) {
      runFrom ??= at;
    } else if (runFrom !== null) {
      runs.push({ size: at - runFrom, middle: (runFrom + at - 1) / 2 });
      runFrom = null;
    }
  }
  // A run reaching the end is a margin, not a gap — the span was measured from
  // the content itself, so it is dropped rather than offered as a candidate.
  return runs;
}
