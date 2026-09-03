// In-place formatting (KR-06).
//
// One rule: a raw Markdown mark (**, ##, `, >, [](...)) is visible only on the
// line holding the cursor, and hidden everywhere else.
//
// How a mark hides matters more than it looks. Two earlier attempts both failed,
// each in the opposite direction:
//
//   1. Delete it from the flow (Decoration.replace). Text never shifted, but a
//      zero-width mark is a place the cursor cannot stand: arrow keys skipped
//      over headings and clicks near the line start landed in dead space.
//   2. Let it back into the flow on the cursor's line. The cursor behaved, but
//      the line lurched sideways every time the cursor arrived.
//
// What works is neither: the mark ALWAYS occupies its space and merely turns
// invisible (visibility: hidden). Nothing moves, because nothing is ever added
// or removed — and the cursor can walk through it, because the characters are
// really there. A leading mark ("## ") would push the prose right, so its line
// gets a hanging indent of exactly the mark's width: the mark hangs out to the
// left, the prose starts where every other line starts.

import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { isCiteFace } from "./citation.js";
import { orderedLabelAt, shapeAt } from "./list-shape.js";
import { t } from "./i18n.js";

const hidden = Decoration.replace({});
const dimmed = Decoration.mark({ class: "cm-mark" });
// Occupies its width, shows nothing. The key to "no jump, cursor still works".
const invisible = Decoration.mark({ class: "cm-mark cm-mark-invisible" });

// Marks in the middle of a line: cheap to delete outright, since the cursor is
// on that line whenever they are shown.
const HIDEABLE = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "StrikethroughMark",
]);

// Marks at the start of a line: these are the ones that shove the prose around,
// so they get the invisible + hanging-indent treatment.
const LEADING = new Set(["HeaderMark", "QuoteMark"]);

// The three callout types (IS-03). Anything else stays a plain quote. The label
// is localized at build time (t below); the file always keeps its plain [!NOTE].
const CALLOUT_KINDS = {
  NOTE: { slug: "note", labelKey: "callout.note" },
  WARNING: { slug: "warning", labelKey: "callout.warning" },
  TIP: { slug: "tip", labelKey: "callout.tip" },
};

class LabelWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-callout-label";
    span.textContent = this.text;
    return span;
  }
}

// A bullet list's "*" or "-" becomes a real bullet; an ordered list's "1." is
// already what the reader should see, so it is left alone.
//
// Either way the marker wears the slot class: it hangs out to the left of the
// text, in the room the line's own indent opened for it. That is what makes a
// long item wrap back under the WORDS instead of under the bullet.
class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-list-mark cm-bullet";
    dot.textContent = "•";
    return dot;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });

// A numbered item's place, counted rather than read: "1.", then "1.1" under it.
// The file keeps its own plain "1." / "2." — this is a drawing, the way the
// bullet is (portability law).
class NumberWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }
  eq(other) {
    return other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-list-mark cm-list-number";
    span.textContent = this.label;
    return span;
  }
}

const listMark = Decoration.mark({ class: "cm-list-mark" });
const listMarkRaw = Decoration.mark({ class: "cm-list-mark cm-mark" });
// The spaces a nested item is written with. The line's own padding already says
// how deep it is, so these must not indent it a second time — they are taken
// out of the flow with the same `hidden` every other piece of machinery uses.
//
// They were first given zero width instead, to keep them as characters the
// cursor could walk through. That cost a bug worth remembering: an inline-block
// with `overflow: hidden` takes its BASELINE from its bottom edge, so the empty
// box stood a whole line-height above the text and every nested item opened a
// gap under itself (Zafer, 3 Eyl: *"gereksiz boş satırlar açılıyor"*). Zero
// width is not zero height.
const listIndent = hidden;

// A "---" thematic break, drawn our own way: a line that is solid in the middle
// and fades toward both edges. In any other reader it is still a plain "---",
// so nothing about the file changes (portability law).
class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-kural";
    return hr;
  }
}
const rule = Decoration.replace({ widget: new RuleWidget() });

/**
 * The lines holding a cursor — the *head* of each selection, not every line it
 * covers. Revealing marks across a whole selection makes the text grow under
 * the mouse while you drag, so the selection slides away from where you aimed.
 */
function activeLines(state) {
  const lines = new Set();
  for (const range of state.selection.ranges) {
    lines.add(state.doc.lineAt(range.head).number);
  }
  return lines;
}

function buildDecorations(view) {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(state);
  const decorations = [];

  for (const { from, to } of view.visibleRanges) {
    // CodeMirror parses lazily, so jumping straight to the middle of a long
    // document (reopening at the saved place, say) lands on a region it has not
    // read yet — and the marks would sit there raw. Push the parse as far as
    // what is on screen, with a budget so a huge file cannot stall the frame.
    const tree = ensureSyntaxTree(state, to, 100) ?? syntaxTree(state);

    tree.iterate({
      from,
      to,
      enter: (node) => {
        const line = doc.lineAt(node.from);

        if (/^ATXHeading[1-6]$/.test(node.name)) {
          const level = node.name.slice(-1);
          decorations.push(
            Decoration.line({ class: `cm-h${level}` }).range(line.from),
          );
          return;
        }
        // A callout is just a quote block whose first line carries [!TYPE]
        // (KR-07). It is typeset as a box, but on disk it stays plain Markdown.
        if (node.name === "Blockquote") {
          const first = doc.lineAt(node.from);
          const type = /^>\s*\[!(\w+)\]/.exec(first.text)?.[1]?.toUpperCase();
          const kind = CALLOUT_KINDS[type];

          const last = doc.lineAt(node.to);
          for (let n = first.number; n <= last.number; n++) {
            const each = doc.line(n);
            const classes = kind
              ? `cm-callout cm-callout-${kind.slug}` +
                (n === first.number ? " cm-callout-head" : "")
              : "cm-quote";
            decorations.push(
              Decoration.line({ class: classes }).range(each.from),
            );
          }

          if (kind) {
            // Replace the raw "[!NOTE]" with its human label.
            const marker = /\[!\w+\]/.exec(first.text);
            const at = first.from + marker.index;
            decorations.push(
              Decoration.replace({
                widget: new LabelWidget(t(kind.labelKey)),
              }).range(at, at + marker[0].length),
            );
          }
          return;
        }


        // A link's TITLE is what the reader is told on hover — the whole of a
        // moved piece's citation lives there (KR-81, citation.js). It hangs on
        // the link's text, which for a citation is the one emoji: the words come
        // when you point at them, and take up no room in the prose until then.
        if (node.name === "Link") {
          const raw = doc.sliceString(node.from, node.to);
          const label = /^\[([^\]]*)\]/.exec(raw);
          const title = /\s"((?:[^"\\]|\\.)*)"\s*\)$/.exec(raw);
          if (label?.[1] && title) {
            decorations.push(
              Decoration.mark({
                // The citation glyph is a CONTROL, not prose: it wants a hand
                // under the pointer and none of the underline a link wears (a
                // line under an emoji reads as a smudge). The class carries
                // both, and the click that follows it (surface.js).
                class: isCiteFace(label[1]) ? "cm-cite" : undefined,
                attributes: { title: title[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\") },
              }).range(node.from + 1, node.from + 1 + label[1].length),
            );
          }
          return;
        }

        // The URL half of [text](target.md) is machinery, not prose: hide it
        // with the brackets, or the reader sees "textbelge.md". A title is the
        // same machinery — unhidden, the citation's whole sentence would sit in
        // the middle of the paragraph in quotation marks.
        if ((node.name === "URL" || node.name === "LinkTitle") && !active.has(line.number)) {
          decorations.push(hidden.range(node.from, node.to));
          return;
        }

        // "---" becomes our fading rule — unless the cursor is on it, where the
        // raw dashes come back so they can be edited or deleted.
        if (node.name === "HorizontalRule") {
          if (!active.has(line.number)) {
            decorations.push(rule.range(node.from, node.to));
          }
          return;
        }

        if (node.name === "ListMark") {
          // The marker and the space after it travel as one, the way "## " does:
          // hung together, the text behind them starts on the line's own left
          // edge and stays there whether the marker is a bullet or the raw dash.
          let end = node.to;
          if (doc.sliceString(end, end + 1) === " ") end += 1;

          const raw = doc.sliceString(node.from, node.to);
          if (raw !== "*" && raw !== "-" && raw !== "+") {
            // A numbered item says its PLACE, not its digits: "1." at the top,
            // "1.1" one level in (KR-113). The digits on the page are not a
            // fact — writers number every item "1." and let the renderer sort
            // it out, and a nested item keeps whatever number it moved with.
            //
            // ALWAYS, including on the cursor's line — and this is the one
            // place where the "raw marks come back under the cursor" law is
            // deliberately not followed. It cannot be: a mark's two faces are
            // the same token in two skins ("-" and "•"), but a number's two
            // faces are two different VALUES, and swapping them under the
            // cursor made the list count itself differently line by line as
            // the reader walked down it (Zafer, 3 Eyl: *"2. maddenin üstüne
            // gelince 3., 3. maddenin üstüne gelince 2. düzeliyor"*) — and
            // moved the prose sideways with every swap, because "1.1" and "1."
            // are not the same width. A number that flickers is worse than a
            // number you cannot see the source of.
            const label = orderedLabelAt(tree, line);
            decorations.push(
              label
                ? Decoration.replace({ widget: new NumberWidget(label) }).range(node.from, end)
                : listMark.range(node.from, end),
            );
            return;
          }
          decorations.push(
            active.has(line.number)
              ? listMarkRaw.range(node.from, end)
              : bullet.range(node.from, end),
          );
          return;
        }

        if (LEADING.has(node.name)) {
          // Take the space after the mark with it, so "## " hangs as a unit.
          let end = node.to;
          if (doc.sliceString(end, end + 1) === " ") end += 1;
          const width = end - node.from;

          // The mark hangs itself into the left gutter with a negative margin
          // that cancels its own width: the prose after it starts flush with
          // every other line, and the mark sits out to the left — in the same
          // place whether it is painted or not, so nothing ever moves.
          //
          // The pull must live on the mark, not on the line. A text-indent on
          // the line shifts the line box itself, and CodeMirror then loses the
          // line in vertical motion — arrowing down skipped the heading and it
          // could not be clicked into.
          decorations.push(
            Decoration.mark({
              class: active.has(line.number)
                ? "cm-mark"
                : "cm-mark cm-mark-invisible",
              attributes: { style: `margin-left:-${width}ch` },
            }).range(node.from, end),
          );
          return;
        }

        if (!HIDEABLE.has(node.name)) return;

        if (active.has(line.number)) {
          decorations.push(dimmed.range(node.from, node.to));
        } else {
          decorations.push(hidden.range(node.from, node.to));
        }
      },
    });

    // ---- lists -------------------------------------------------------------
    //
    // A list is set in from the margin the way any typeset list is, and each
    // nesting level moves it one step further. Both come from the LINE, not
    // from the characters in it: an indent written on the line is a padding CM
    // measures with the line, so a wrapped item comes back under its own text
    // and the cursor keeps finding the line in vertical motion. (The two spaces
    // the file is nested with are given no width instead — they are still there
    // to walk through, they simply do not indent it twice.)
    //
    // The depth is written as a custom property rather than a padding, so a
    // list inside a quote or a callout ADDS to that box's own left padding
    // instead of overwriting it (style.css).
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      const line = doc.line(n);
      const shape = shapeAt(tree, line);
      if (!shape) continue;
      decorations.push(
        Decoration.line({
          class: "cm-list",
          attributes: { style: `--list-depth:${shape.depth}` },
        }).range(line.from),
      );
      if (shape.indent > 0) {
        decorations.push(listIndent.range(line.from, line.from + shape.indent));
      }
    }
  }

  // sort=true: line and inline decorations were collected out of order.
  return Decoration.set(decorations, true);
}

// No atomicRanges here on purpose. Marking the hidden ranges atomic is what
// turned the prose into a field of invisible boxes: the cursor hopped over
// words and backspace swallowed whole spans. Since a mark becomes visible the
// moment the cursor reaches its line, the cursor can simply walk through it.
export const inlineFormatting = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
