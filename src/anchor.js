// Anchoring (IS-08, KR-16).
//
// Kept free of Tauri and of the DOM on purpose: this is the logic the whole of
// Aktarma rests on — that a mark survives the file being edited elsewhere — so
// it has to be testable on its own, without launching the app.
//
// This file used to do a second job as well: track a transferred piece inside
// the *target* document, so that undoing a transfer could delete it again.
// That job is gone (KR-33). It was the most intricate code in the product —
// sentence-level matching, partial deletion, blank-line arithmetic — and every
// serious bug we shipped came out of it. A transfer is now one-way: what lands
// on the right belongs to the document on the right, and Ctrl+Z is how you take
// it back (KR-34).

/** How much text around the quote is kept as context (SD-06 tells duplicates apart). */
const CONTEXT = 64;

/** Builds an anchor for [from, to) in `text` (IS-08). */
export function makeAnchor(text, from, to) {
  return {
    metin: text.slice(from, to),
    oncesi: text.slice(Math.max(0, from - CONTEXT), from),
    sonrasi: text.slice(to, Math.min(text.length, to + CONTEXT)),
  };
}

const allIndexesOf = (haystack, needle) => {
  const found = [];
  if (!needle) return found;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
};

/** How much of each end to fall back on when the quote holds no sentence break. */
const END = 40;

/**
 * The two ends of a quote — the second stage of KR-16.
 *
 * Sentences when the quote has them. But a selection is free to start and end
 * mid-sentence (SD-03), and such a quote does not split at all: the "first
 * sentence" would be the whole quote, so a single typo inside it would orphan
 * the mark — exactly what KR-16 exists to prevent. So a quote without a sentence
 * break falls back on its literal ends. Still an exact match, never fuzzy
 * (KR-10); it just leans on the edges, as AS-02 put it.
 */
function anchorEnds(quote) {
  const sentences = quote
    .split(/(?<=[.!?…])\s+/)
    .map((each) => each.trim())
    .filter(Boolean);

  if (sentences.length >= 2) {
    return { head: sentences[0], tail: sentences[sentences.length - 1] };
  }

  if (quote.length < END * 2) return null; // too short to have distinct ends
  return {
    head: quote.slice(0, END),
    tail: quote.slice(-END),
  };
}

/**
 * Finds where an anchor now sits in `text`, in the two stages KR-16 fixed:
 *
 *   1. the whole quote, matched exactly;
 *   2. failing that, its first and last sentence, matched exactly and in order.
 *
 * Both stages are exact — there is no fuzzy matching anywhere (KR-10). When the
 * quote appears more than once, the surrounding context decides; when even that
 * cannot tell them apart, it gives up rather than guess (SD-06).
 *
 * Returns null when the mark cannot be placed — and a mark that cannot be placed
 * is now dropped (KR-36), so this answer is final. It is worth being sure.
 */
export function resolveAnchor(anchor, text) {
  const exact = allIndexesOf(text, anchor.metin);
  if (exact.length === 1) {
    return { from: exact[0], to: exact[0] + anchor.metin.length };
  }

  if (exact.length > 1) {
    const scored = exact.map((at) => {
      const before = text.slice(Math.max(0, at - CONTEXT), at);
      const after = text.slice(
        at + anchor.metin.length,
        at + anchor.metin.length + CONTEXT,
      );
      let score = 0;
      if (anchor.oncesi && before.endsWith(anchor.oncesi.slice(-24))) score++;
      if (anchor.sonrasi && after.startsWith(anchor.sonrasi.slice(0, 24))) score++;
      return { at, score };
    });

    const best = Math.max(...scored.map((each) => each.score));
    const winners = scored.filter((each) => each.score === best);
    // Context does not tell them apart either: do not pick at random.
    if (best === 0 || winners.length !== 1) return null;
    return { from: winners[0].at, to: winners[0].at + anchor.metin.length };
  }

  // Stage 2: the quote has been edited somewhere in the middle. Its ends still
  // pin it down — a typo fix inside a paragraph must not orphan the mark.
  const ends = anchorEnds(anchor.metin);
  if (!ends) return null;

  const starts = allIndexesOf(text, ends.head);
  if (starts.length !== 1) return null;

  const from = starts[0];
  const tail = text.indexOf(ends.tail, from + ends.head.length);
  if (tail === -1) return null;

  return { from, to: tail + ends.tail.length };
}

/**
 * Where a mark goes when the writer types (KR-56).
 *
 * This is the whole of what keeps a mark on its text while the document is open,
 * and the two `assoc` arguments are the entire argument. Both ends lean
 * outwards: `from` associates with what follows it, so text typed at the mark's
 * first character lands in front of the mark; `to` associates with what precedes
 * it, so text typed after its last character lands behind. The mark does not
 * grow at its edges (SD-18), and it does grow in its middle, where `from` sits
 * still and `to` is pushed along (UC-13/A3).
 *
 * `changes` is a CodeMirror ChangeSet, but nothing here knows that — which is
 * why this lives beside the anchor logic, where it can be sat down with a real
 * ChangeSet and asked to prove it.
 */
export function mapMark(mark, changes) {
  return {
    ...mark,
    from: changes.mapPos(mark.from, 1),
    to: changes.mapPos(mark.to, -1),
  };
}

/**
 * Where a mark stands at save time, and what its anchor should say (KR-56).
 *
 * `at` is the surface's live range — the truth for as long as the document is
 * open. Everything above this line answers "where did this text go?"; this
 * answers "where is this mark?", and while the document is open those are not
 * the same question. Since marking moved into the tab (KR-55) the writer edits
 * *inside* marked text, so an anchor searched for after a keystroke would not
 * match, and a mark that does not resolve is dropped with its comment (KR-36) —
 * for the crime of being written in. So the range is not searched for, it is
 * carried; the anchor is rewritten from it here, on the way to disk.
 *
 * A collapsed range means the text was deleted. That still gets the anchor one
 * last word, because Ctrl+Z may have put the text back and a collapsed range
 * does not re-open by itself (SD-17). Only then does the mark go.
 *
 * @returns {{from:number, to:number, cipa:object}|null} null when the mark is gone.
 */
export function reanchor(cipa, text, at) {
  if (at && at.to > at.from) {
    return { from: at.from, to: at.to, cipa: makeAnchor(text, at.from, at.to) };
  }

  const again = resolveAnchor(cipa, text);
  return again ? { ...again, cipa } : null;
}

