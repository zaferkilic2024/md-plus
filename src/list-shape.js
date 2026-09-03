// Where a list item sits, and what moving it in or out costs.
//
// Pure on purpose. The shape of a list is arithmetic over the parsed tree, and
// arithmetic is the half of this that can be checked without a browser
// (`test/liste.test.mjs`). Two callers ask their questions here — the surface
// that DRAWS the indent (inline-format.js) and the key that WRITES it
// (commands.js) — so what the reader sees and what Tab types can never drift
// apart.

const LISTS = new Set(["BulletList", "OrderedList"]);

/** The spaces a line is written with — the nesting the file itself carries. */
export const indentOf = (text) => text.length - text.trimStart().length;

/**
 * The column an item's own text begins at — marker and the space after it
 * included.
 *
 * This is the number a nesting step is made of, and it is NOT a constant. A
 * bullet's content starts two columns in ("- x"), a numbered item's three
 * ("1. x"), and a two-digit one four. Stepping by a fixed two spaces was the
 * bug behind "Tab has to be pressed twice": under a numbered item two spaces
 * are not enough to nest, so the first press wrote characters that changed
 * nothing and only the second one landed deep enough to count.
 */
export function contentColumnOf(text) {
  const marker = /^(\s*)(?:[-*+]|\d{1,9}[.)])([ \t]+)/.exec(text);
  if (marker) return marker[0].length;
  // A marker with nothing after it yet — the writer is still typing the item.
  const bare = /^(\s*)(?:[-*+]|\d{1,9}[.)])$/.exec(text);
  return bare ? bare[0].length + 1 : indentOf(text);
}

/**
 * The list shape of a line: how deep it is nested, how many characters of that
 * nesting stand in front of it, and the item it belongs to. `null` when the
 * line is not in a list at all.
 *
 * The question is asked at the line's first REAL character, never at its start.
 * A nested list begins at its marker, not at the whitespace before it, so the
 * spaces in front still belong to the item OUTSIDE — ask there and every nested
 * item answers one level too high.
 */
export function shapeAt(tree, line) {
  const indent = indentOf(line.text);
  // A quoted list ("> - x") starts after the quote marks, so the scan steps
  // over those too — otherwise the answer comes back from the Blockquote and a
  // list inside a callout has no shape at all. Only the leading whitespace is
  // reported as `indent` though: the "> " is already hung by the quote's own
  // mark, and zeroing a space inside it would drag the prose left with it.
  const prefix = /^[\s>]*/.exec(line.text)[0].length;
  let item = null;
  let depth = -1;
  for (let node = tree.resolveInner(line.from + prefix, 1); node; node = node.parent) {
    if (!item && node.name === "ListItem") item = node;
    if (LISTS.has(node.name)) depth++;
  }
  return item ? { depth: Math.max(depth, 0), indent, item } : null;
}

/** The item just above this one in the same list — what it would nest under. */
const previousItem = (item) => {
  const sibling = item.prevSibling;
  return sibling?.name === "ListItem" ? sibling : null;
};

/** The item this one's list is written inside — what it would come out to. */
const enclosingItem = (item) => {
  const list = item.parent;
  const owner = LISTS.has(list?.name ?? "") ? list.parent : null;
  return owner?.name === "ListItem" ? owner : null;
};

/** Where an ordered marker's digits sit on a line, and what they say. */
export function orderedMarkerOf(text) {
  const match = /^(\s*)(\d{1,9})([.)])/.exec(text);
  return match
    ? { from: match[1].length, to: match[1].length + match[2].length, value: Number(match[2]) }
    : null;
}

/** This item's place in its own list, counted rather than read off the page. */
const indexIn = (list, item) => {
  let n = 0;
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name !== "ListItem") continue;
    n++;
    if (child.from === item.from) return n;
  }
  return Math.max(n, 1);
};

/**
 * What a numbered item should SAY: "1." at the top, "1.1" one level in, "1.1.1"
 * below that (3 Eyl, KR-113 — Zafer: *"1 altında tab yapınca 2. oluyor. saçma.
 * 1.1 gibi bir şey olması lazım."*).
 *
 * Counted from the tree, never read off the line. Two reasons, and the second
 * one is the important one: writers legitimately number every item "1." and
 * leave the renderer to sort it out, so the digits on the page are not a fact;
 * and a nested item keeps whatever number it was carrying when it moved, which
 * is how "1." followed by "2." underneath it came about.
 *
 * The chain stops at the first bullet ancestor: a number nested inside a bullet
 * has no "1." above it to belong to, so it says its own place and nothing more.
 * `null` for anything that is not a numbered item.
 */
export function orderedLabelAt(tree, line) {
  const shape = shapeAt(tree, line);
  if (!shape) return null;

  const parts = [];
  for (let item = shape.item; item; ) {
    const list = item.parent;
    if (list?.name !== "OrderedList") break;
    parts.unshift(indexIn(list, item));
    const owner = list.parent;
    item = owner?.name === "ListItem" ? owner : null;
  }
  if (!parts.length) return null;
  // A lone number keeps the full stop it has always had; a path does not need
  // one — "1.1." reads as an unfinished third level.
  return parts.length === 1 ? `${parts[0]}.` : parts.join(".");
}

/**
 * The number a moved item should carry once it lands.
 *
 * Only the moved item is rewritten, never the list it left: CommonMark takes a
 * list's start from its FIRST item and ignores every number after it, so the
 * gap left behind ("1." then "3.") is invisible in this app and in any other
 * reader. What is not invisible is a nested list that begins at "2." — that
 * one really does render as "2." elsewhere, and it is the whole complaint.
 */
function landingNumber(doc, item, target, deeper) {
  if (deeper) {
    // Scan back for the item this one is about to sit under or beside. A line
    // further in belongs to a deeper list and is skipped; a line further out
    // means there was nothing at this column yet, so the item opens a new list.
    for (let n = doc.lineAt(item.from).number - 1; n >= 1; n--) {
      const text = doc.line(n).text;
      if (!text.trim()) continue;
      const indent = indentOf(text);
      if (indent < target) break;
      if (indent > target) continue;
      const marker = orderedMarkerOf(text);
      return marker ? marker.value + 1 : 1;
    }
    return 1;
  }
  const owner = enclosingItem(item);
  const marker = owner && orderedMarkerOf(doc.lineAt(owner.from).text);
  return marker ? marker.value + 1 : 1;
}

/**
 * How far one item moves, and in which direction. 0 means "nowhere to go".
 *
 * Both answers come from a REAL line, never from a step we chose: going in, the
 * item lands exactly where the item above it starts its text; coming out, it
 * lands exactly where the item it lives inside starts. That is what nesting
 * means in the file, so it is what the key writes — and it is right for a
 * bullet, a number and a hand-written four-space list alike.
 */
function stepFor(doc, item, deeper) {
  const here = indentOf(doc.lineAt(item.from).text);
  if (deeper) {
    const above = previousItem(item);
    if (!above) return 0; // a list's first item has nothing to nest under
    return contentColumnOf(doc.lineAt(above.from).text) - here;
  }
  const owner = enclosingItem(item);
  if (!owner) return 0; // a top-level item has nothing to come out of
  return indentOf(doc.lineAt(owner.from).text) - here;
}

/**
 * What Tab (or Shift+Tab) writes over the lines `first`…`last`.
 *
 * `null` means "no list here" — the key is handed back and goes on moving the
 * focus the way it does everywhere else in the app. An empty array means the
 * cursor IS in a list but there is nowhere to go; the key is swallowed rather
 * than writing characters with no effect on screen.
 *
 * An item takes its children with it, by the same amount. Left behind, the
 * level they were written at stops meaning what it meant and the sub-list folds
 * into its parent — which is also why outdenting a top-level item must do
 * NOTHING: it would hold the item still and pull its children up a level,
 * flattening the very nesting the key was reached for.
 *
 * `doc` needs only the two questions a document can answer: the line at a
 * position, and the line with a number.
 */
export function nestPlan(tree, doc, first, last, deeper) {
  /** line number → how many columns that line moves */
  const moving = new Map();
  /** line number → the number a moved ordered marker should land on */
  const renumber = new Map();
  let inList = false;

  for (let n = first; n <= last; n++) {
    const shape = shapeAt(tree, doc.line(n));
    if (!shape) continue;
    inList = true;

    const step = stepFor(doc, shape.item, deeper);
    if (!step) return [];

    // `item.to` is one past the item's last character; on an item that ends the
    // document that is still inside the last line, but on any other it would be
    // read as the line after.
    const start = doc.lineAt(shape.item.from).number;
    const end = doc.lineAt(Math.max(shape.item.from, shape.item.to - 1)).number;
    for (let each = start; each <= end; each++) {
      if (!moving.has(each)) moving.set(each, step);
    }

    // Only the item that moves is renumbered, and only if it is numbered: its
    // children keep their own places inside it.
    if (!renumber.has(start) && orderedMarkerOf(doc.line(start).text)) {
      renumber.set(start, landingNumber(doc, shape.item, shape.indent + step, deeper));
    }
  }
  if (!inList) return null;

  const changes = [];
  for (const [n, step] of [...moving].sort((a, b) => a[0] - b[0])) {
    const line = doc.line(n);
    if (!line.text.trim()) continue; // a blank line inside an item gets no tail

    const landing = renumber.get(n);
    const marker = landing ? orderedMarkerOf(line.text) : null;
    if (marker) {
      // Indent and number are rewritten as ONE change, from the line's start to
      // the end of the digits. Two changes touching at the same offset are legal
      // but their order decides the result, and "which of these lands first" is
      // not a question a reader of this code should have to answer.
      const indent = Math.max(0, marker.from + step);
      changes.push({
        from: line.from,
        to: line.from + marker.to,
        insert: " ".repeat(indent) + String(landing),
      });
      continue;
    }

    if (step > 0) {
      changes.push({ from: line.from, insert: " ".repeat(step) });
      continue;
    }
    const drop = Math.min(-step, indentOf(line.text));
    if (drop) changes.push({ from: line.from, to: line.from + drop });
  }
  return changes;
}
