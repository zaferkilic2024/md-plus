/**
 * A selected PDF passage, repaired into Markdown — pure, no pdf.js, no DOM.
 *
 * WHY. A PDF has no paragraphs. It has glyphs at coordinates, and the line
 * breaks in it are typesetting, not meaning: the same sentence is broken
 * wherever the column ran out. Copied straight, a tidy-looking passage arrives
 * in the document as rubble — "bir satır tam, bir satır iki üç kelime" (Zafer,
 * 28 Tem). Repair is therefore not a polish step, it is the whole difference
 * between a passage you can use and one you have to retype.
 *
 * The input is deliberately not text. Text alone cannot tell a wrapped line from
 * a new paragraph — both are just a newline — and guessing from punctuation
 * fails on the two commonest cases at once (a sentence ending mid-paragraph, and
 * a paragraph starting mid-sentence after a formula). So this works on the
 * SHAPES the lines had on the page: where they start, how far apart they sit,
 * how short the last one is. That is the same evidence a reader uses.
 *
 * Second customer, already known: pasting text into a document (VZ-04) needs the
 * same repair. Hence a module of its own rather than a private helper.
 */

/** A line starting this much to the LEFT of the one before it has stepped out
    of a block — the way a list ends and the body resumes. */
const DEDENT = 6;

/** A list item, by its marker. Geometry cannot see one: a list's continuation
    lines are indented FURTHER than the line that opens it, so "indented" reads
    as "new paragraph" and every wrapped line becomes its own item (Zafer, 28
    Tem — "bir satır tam, bir satır iki üç kelime"). The marker is the honest
    signal, and it is the one Markdown wants anyway. */
const BULLET = /^\s*[•·▪◦]\s+/;
const NUMBER = /^\s*\d{1,3}[.)]\s+/;

/** Lines further apart than this multiple of the usual leading break a paragraph. */
const LOOSE = 1.45;

/** A last line shorter than this share of the column also ends a paragraph. */
const SHORT_LINE = 0.86;

/**
 * @param {Array<{ text: string, left: number, top: number, right: number }>} parts
 *   the selected pieces, in reading order, with the box each had on the page
 * @returns {string} Markdown: paragraphs separated by a blank line
 */
export function passageMarkdown(parts) {
  const lines = groupLines(parts);
  if (lines.length === 0) return "";
  if (lines.length === 1) return tidy(lines[0].text);

  const margin = Math.min(...lines.map((line) => line.left));
  const column = Math.max(...lines.map((line) => line.right)) - margin;
  const leading = medianLeading(lines);

  const paragraphs = [];
  let current = [];

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const previous = lines[at - 1];

    if (previous && startsParagraph(line, previous, { margin, column, leading })) {
      paragraphs.push(current);
      current = [];
    }
    current.push(line);
  }
  paragraphs.push(current);

  return paragraphs
    .map((lines) => asMarkdown(tidy(joinLines(lines))))
    .filter(Boolean)
    .join("\n\n");
}

/** Pieces that sat on the same line become one line, in reading order. */
function groupLines(parts) {
  const lines = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = lines.at(-1);
    // Same line if the baselines are within a few pixels. Superscripts and
    // formula fragments ride a little high and still belong to their line.
    if (last && Math.abs(last.top - part.top) <= 4) {
      last.text += part.text;
      last.right = Math.max(last.right, part.right);
      continue;
    }
    lines.push({ text: part.text, left: part.left, right: part.right, top: part.top });
  }
  return lines.filter((line) => line.text.trim());
}

/** The usual distance between one line and the next — the median, so a single
    formula block or a heading cannot set the standard for the whole passage. */
function medianLeading(lines) {
  const gaps = [];
  for (let at = 1; at < lines.length; at++) {
    const gap = lines[at].top - lines[at - 1].top;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Does this line begin a new paragraph? Four signs, any one of which is enough:
 *
 *   · it opens with a list marker;
 *   · it starts to the left of the line before it — a block has ended;
 *   · it sits further below its predecessor than the lines usually do;
 *   · its predecessor ended a sentence AND stopped well short of the column —
 *     a full line that happens to end in a full stop is just a sentence break
 *     inside a paragraph, which is why the two conditions are joined.
 *
 * Note which sign is NOT here: "this line is indented". It was, and it was
 * wrong — see BULLET.
 */
function startsParagraph(line, previous, { margin, column, leading }) {
  if (isItem(line.text)) return true;
  if (line.left < previous.left - DEDENT) return true;
  if (leading > 0 && line.top - previous.top > leading * LOOSE) return true;

  const ended = /[.!?:;”"’']\s*$/.test(previous.text.trim());
  const short = column > 0 && previous.right - margin < column * SHORT_LINE;
  return ended && short;
}

/**
 * Joins a paragraph's lines back into running text.
 *
 * A trailing hyphen is a word the column broke, so the halves are fused and the
 * hyphen goes. Not always: a capital after it means the hyphen was the author's
 * (a compound, a range, a name), and fusing there invents a word.
 */
function joinLines(lines) {
  let out = "";
  for (const line of lines) {
    const text = line.text.trim();
    if (!out) {
      out = text;
      continue;
    }
    const broken = /[-‐­]$/.test(out);
    if (broken && !/^[A-ZÇĞİÖŞÜ]/.test(text)) {
      out = out.replace(/[-‐­]$/, "") + text;
    } else {
      out += ` ${text}`;
    }
  }
  return out;
}

const isItem = (text) => BULLET.test(text) || NUMBER.test(text);

/**
 * A bullet the PDF drew becomes a bullet Markdown writes. Numbered items already
 * read as Markdown ("1. …"), so they are left exactly as the author typeset them
 * — rewriting the number would be inventing one.
 */
function asMarkdown(text) {
  return BULLET.test(text) ? text.replace(BULLET, "- ") : text;
}

/** Whitespace a PDF leaves behind: doubled spaces, spaces before punctuation. */
function tidy(text) {
  return text
    .replace(/­/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();
}
