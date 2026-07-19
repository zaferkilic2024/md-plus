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
class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });

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


        // The URL half of [text](target.md) is machinery, not prose: hide it
        // with the brackets, or the reader sees "textbelge.md".
        if (node.name === "URL" && !active.has(line.number)) {
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
          const raw = doc.sliceString(node.from, node.to);
          if (raw === "*" || raw === "-" || raw === "+") {
            decorations.push(
              active.has(line.number)
                ? dimmed.range(node.from, node.to)
                : bullet.range(node.from, node.to),
            );
          }
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
