// Reading and writing share one surface (KR-06): there is no preview mode.

import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  highlightActiveLine,
  keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { GLYPH } from "./strip.js";
import { inlineFormatting } from "./inline-format.js";
import { mathTypesetting } from "./math.js";
import { imageTypesetting } from "./images.js";
import { tableTypesetting } from "./tables.js";
import { floatingPalette, togglePalette } from "./palette.js";
import { documentSearch, searchField } from "./search.js";
import { embedding } from "./embed.js";
import { Suggestion } from "./suggestion.js";
import { jobScope, jobShortcuts, provider } from "./ai.js";
import { mapMark } from "./anchor.js";

// One card for the whole app: the suggestion belongs to the writer, not to a
// particular editor, and two of them on screen would be two places to look.
// Exported because the ⋯ menu runs jobs too ("Özet"), and it must be the same
// card — otherwise there would be two of them after all.
export const suggestion = new Suggestion();
import {
  setHeading,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleList,
  toggleQuote,
} from "./commands.js";
import "katex/dist/katex.min.css";

// Hiding the ** marks is only half the job: the text between them has to
// actually look bold. Headings are styled per line (see inline-format.js);
// everything inline is styled here.
const typesetting = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.monospace,
    fontFamily: "var(--mono)",
    fontSize: "0.86em",
    background: "#f4f2ee",
    borderRadius: "4px",
    padding: "1px 4px",
  },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--accent)" },
]);

// Ctrl+1..9 already switches tabs, so headings take Ctrl+Alt+1..3 rather than
// stealing them. Ctrl+Alt+0 goes back to a paragraph.
const formatKeymap = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-e", run: toggleCode },
  { key: "Mod-Alt-1", run: setHeading(1) },
  { key: "Mod-Alt-2", run: setHeading(2) },
  { key: "Mod-Alt-3", run: setHeading(3) },
  { key: "Mod-Alt-0", run: setHeading(0) },
  { key: "Mod-Shift-l", run: toggleList },
  { key: "Mod-Shift-q", run: toggleQuote },
];

/**
 * The link target under `pos`, if any. Accepts both the canonical [x](y.md) and
 * a hand-written [[wikilink]] — the app reads wikilinks but never writes them
 * (KR-13).
 */
function linkTargetAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;

  // The canonical form is whatever the Markdown parser calls a Link — not a
  // regex of ours. A regex here followed "links" the file does not contain
  // (`[x](a b.md)` — the space ends the destination) and opened examples out of
  // code fences. Same reasoning, same fix as the embed arrows (embed.js).
  let target = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name !== "URL" || target) return;
      const link = node.node.parent;
      if (!link || link.name !== "Link") return; // an Image is not a door
      if (pos < link.from || pos > link.to) return;
      target = state.sliceDoc(node.from, node.to).replace(/^<|>$/g, "");
    },
  });
  if (target) return target;

  // A hand-written wikilink is read but never produced (KR-13). The parser knows
  // nothing about these, so they stay a regex.
  for (const match of line.text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      const name = match[1].split("|")[0].trim();
      return /\.md$/i.test(name) ? name : `${name}.md`;
    }
  }
  return null;
}

// ---- read-only source, and the marks painted on it (UC-12, UC-13) ----------

const editable = new Compartment();

/**
 * AS-06/KR-22: the source in Aktarma is read-only, and it says so without
 * saying anything — a slightly different ground, and a cursor that shivers on a
 * keystroke. No warning box, no notification strip.
 */
export function setReadOnly(view, readOnly) {
  view.dispatch({
    effects: editable.reconfigure(EditorView.editable.of(!readOnly)),
  });
  view.dom.classList.toggle("cm-readonly", readOnly);

  view.dom.onkeydown = readOnly
    ? (event) => {
        // Modifier-only presses are not attempts to type.
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key.length !== 1 && event.key !== "Backspace") return;
        view.dom.classList.remove("cm-shiver");
        void view.dom.offsetWidth; // restart the animation
        view.dom.classList.add("cm-shiver");
      }
    : null;
}

export const setMarks = StateEffect.define();

const marked = Decoration.mark({ class: "cm-isaretli" });
const current = Decoration.mark({ class: "cm-isaretli cm-isaretli-etkin" });

/** The inline badge a comment opens from (UC-14-K2: one click, no side panel). */
class BadgeWidget extends WidgetType {
  constructor(id) {
    super();
    this.id = id;
  }
  // The id alone: the badge's DOM does not carry the comment (the strip shows
  // it, B-19), so a changed comment must not rebuild the widget — every
  // needless rebuild is DOM churn next to a focused comment box (B-24).
  eq(other) {
    return other.id === this.id;
  }
  toDOM() {
    const badge = document.createElement("span");
    badge.className = "cm-rozet";
    badge.dataset.mark = this.id;

    // A speech bubble, not a dot: the badge should say what it is before you
    // touch it. Drawn, not filled — a solid 16px ochre tile with a white glyph
    // squeezed inside came out as a muffled blob at this size, and it was the
    // heaviest thing in the margin. The glyph comes from GLYPH.note, the same
    // one the palette's "Yorumla" wears: one idea, one drawing.
    badge.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPH.note}</svg>`;

    // The comment itself is NOT drawn here. Hovering opens the strip as a
    // preview (marks.js/onHover) — the same box a click opens, in the same spot.
    // It used to be a CSS bubble beside the badge while the click box opened
    // below it: two geometries for one thing, boxes darting left and right (B-19).
    return badge;
  }
  /**
   * The badge is a control, not text: CodeMirror must keep its hands off it.
   *
   * Saying `false` here let CodeMirror handle the click itself — so pressing the
   * badge dropped a cursor into the prose behind it. That looks harmless and is
   * not: a cursor carries an association, and a cursor with an association at a
   * wrapped line boundary makes CodeMirror re-collapse the DOM selection into
   * the text during its next measure (DocView.enforceCursorAssoc — which has no
   * focus guard). That pulls focus back out of whatever else has it. Which meant
   * the comment box opened, took focus, silently lost it a frame later, and the
   * first character you typed went into the DOCUMENT instead.
   *
   * Our own click handler is a plain DOM listener on view.dom (marks.js), so it
   * still hears the badge; this only tells CodeMirror not to.
   */
  ignoreEvent() {
    return true;
  }
}

/** Paints the marks the field is holding. Marks never touch the file (IS-07). */
function paint(marks) {
  const decorations = [];
  for (const mark of marks) {
    // A mark whose text has been deleted sits here as an empty range, painting
    // nothing, until the next save decides its fate: Ctrl+Z may bring the text
    // back (SD-17).
    if (mark.from >= mark.to) continue;

    // Every mark is coloured. Colour used to mean "this was sent somewhere"
    // (KR-20), which left a plain mark invisible — and marking is the point of
    // the surface now, not a side effect of sending.
    //
    // The one travelled to in Aktarma takes a deeper shade of the same colour,
    // so that the page says which of them you are standing on. Not a second
    // colour: there is still no palette (KR-11).
    decorations.push((mark.etkin ? current : marked).range(mark.from, mark.to));

    // The badge hangs in the margin beside the mark's FIRST line, not inline at
    // its end: inline, the badges landed wherever the prose happened to stop, so
    // a column of comments read as scattered debris. Out here they line up.
    if (mark.yorumlu) {
      decorations.push(
        Decoration.widget({
          widget: new BadgeWidget(mark.id),
          side: -1,
        }).range(mark.from),
      );
    }
  }
  return Decoration.set(decorations, true);
}

/**
 * Where this document's marks ARE, for as long as it is open (KR-56).
 *
 * Not where their anchors say they are. The anchor answers "where did this text
 * go?" and is for loading, when the file may have been edited behind our back
 * (IS-08). Since marking moved into the tab (KR-55) the writer edits inside
 * marked text, and asking the anchor about text that is being written in would
 * come back empty — dropping the mark and its comment (KR-36) for the crime of
 * being edited. So the marks are carried here instead, through every change, and
 * the anchor is refreshed from this on save (see reanchor, anchor.js).
 */
const marksField = StateField.define({
  create: () => [],
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMarks)) return effect.value;
    }
    if (!transaction.docChanged) return marks;
    return marks.map((mark) => mapMark(mark, transaction.changes));
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => paint(state.field(field))),
});

/** The marks as they now stand on the surface — the live truth (KR-56). */
export const liveMarks = (state) => state.field(marksField);

/**
 * Puts each badge beside the row its mark actually starts on.
 *
 * The badge is absolute inside `.cm-line`, which is what gets it out of the
 * flow and into the margin without moving a pixel of text. But in Markdown a
 * paragraph is ONE CodeMirror line — it soft-wraps into many visual rows — so
 * "0.35em from the top of the line" meant "the top of the paragraph", wherever
 * the mark really was. Both halves of the bug came from that one line of CSS:
 * a comment on the tenth row was drawn beside the first, and two comments in
 * one paragraph were drawn at the identical spot, the second hidden under the
 * first and unclickable. It was not that later comments did nothing — they were
 * underneath.
 *
 * So the row has to be measured. Positions come from the field, not the DOM:
 * the field is where marks live (KR-56), and a badge whose mark has been pushed
 * along by typing must move with it even though its widget was never rebuilt.
 *
 * Measuring happens in requestMeasure's read phase — never in update(), which
 * forbids reading layout and would have CodeMirror silently drop the plugin.
 */
const BADGE = 18;
const badgeLayout = ViewPlugin.fromClass(
  class {
    update(update) {
      // Anything that can move a mark down the page, plus the effect that
      // replaces the set outright.
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setMarks)),
        )
      ) {
        this.place(update.view);
      }
    }

    place(view) {
      view.requestMeasure({
        read: () => {
          const marks = view.state.field(marksField, false) ?? [];
          const byId = new Map(marks.map((mark) => [String(mark.id), mark]));
          const placements = [];

          for (const badge of view.dom.querySelectorAll(".cm-rozet")) {
            const mark = byId.get(badge.dataset.mark);
            if (!mark || mark.from >= mark.to) continue;

            const line = badge.closest(".cm-line");
            if (!line) continue;

            let at = null;
            try {
              // side 1: the row the mark STARTS on. At a wrap point the same
              // offset sits at the end of one row and the start of the next;
              // the mark begins on the second.
              at = view.coordsAtPos(mark.from, 1);
            } catch {
              continue; // outside the drawn viewport — it will be placed on scroll
            }
            if (!at) continue;

            // Centred on its row, not hung from its top: rows are taller than
            // the badge, and an 18px glyph pinned to the ceiling of a 33px row
            // reads as belonging to the row above.
            const top =
              at.top - line.getBoundingClientRect().top + (at.bottom - at.top - BADGE) / 2;
            placements.push({ badge, top });
          }
          return placements;
        },
        write: (placements) => {
          for (const { badge, top } of placements) badge.style.top = `${top}px`;
        },
      });
    }
  },
);

export function createSurface({
  parent,
  doc,
  documentFolder,
  onChange,
  onLink,
  onMark,
  onScroll,
  onFollowLink,
  onPasteImage,
  onEmbed,
  nested = false,
}) {
  const state = EditorState.create({
    doc,
    extensions: [
      editable.of(EditorView.editable.of(true)),
      marksField,
      badgeLayout,
      history(),
      // No drawSelection(): the browser's own selection is what a writer
      // expects, and CodeMirror's drawn one spilled into the mark gutter.
      highlightActiveLine(),
      EditorView.lineWrapping,
      markdown(),
      syntaxHighlighting(typesetting),
      inlineFormatting,
      mathTypesetting,
      imageTypesetting(documentFolder),
      tableTypesetting,
      floatingPalette(onLink, (view, job) => suggestion.run(view, job), onMark),
      // Ctrl+F is bound at the window (main.js), not here: this keymap only
      // fires when the editor has focus, and Aktarma opens with a read-only
      // document that nothing has focused — so the key fell through to the
      // WebView and its OWN find bar answered, searching the tab strip and the
      // chrome along with the prose. An embedded surface gets no search of its
      // own either; there is one box, and it belongs to the document you came to
      // read.
      ...(nested ? [] : [searchField, documentSearch]),
      // V2-1: a silent arrow beside every [metin](belge.md). Inside an embed
      // this returns nothing — one level only, or A→B→A never ends.
      ...(onEmbed
        ? embedding({
            ...onEmbed,
            nested,
            makeSurface: ({ parent, doc: text, path }) => {
              const view = createSurface({
                parent,
                doc: text,
                documentFolder: () => onEmbed.folderOf(path),
                nested: true,
              });
              setReadOnly(view, true); // KR-22, and SD-08: one truth per document
              return view;
            },
          })
        : []),
      // Format keys go in front of the defaults so they win the binding.
      keymap.of([
        // Alt+P tucks the selection palette away (and brings it back) without
        // touching the selection it is about.
        { key: "Alt-p", run: () => (togglePalette(), true) },
        // UC-13: Ctrl+Enter marks the selection, without reaching for the
        // palette. It used to send the selection to the target — a thing the
        // selection no longer does, on this screen or any other (KR-37, KR-55).
        {
          key: "Mod-Enter",
          run: (view) => {
            // Nothing is marked from Aktarma's read-only source (UC-12-K7).
            if (!view.state.facet(EditorView.editable)) return false;
            if (view.state.selection.main.empty) return false;
            // Already marked: marking it again would lay a second mark over the
            // first. The palette offers that mark's own verbs instead.
            if (!onMark || onMark.find()) return false;
            onMark.mark({});
            return true;
          },
        },
        // One shortcut per AI job (Alt+A/T/Y/B/K/Ö — defined next to the jobs in
        // ai.js), so any of them can be run without the palette. Each does
        // nothing, and yields its key, if that job is not routed to a model.
        //
        // The key reads `kapsam`, the same question the palette asks: a document
        // job (Özet) has no use for the selection and must not demand one, or the
        // shortcut would refuse to summarise a document you were merely reading.
        ...jobShortcuts().map(({ job, kisayol }) => ({
          key: kisayol,
          run: (view) => {
            if (!provider(job)) return false;
            if (jobScope(job) === "belge") {
              suggestion.run(view, job, { source: view.state.doc.toString() });
              return true;
            }
            if (view.state.selection.main.empty) return false;
            suggestion.run(view, job);
            return true;
          },
        })),
        ...formatKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        scroll: () => {
          onScroll?.();
          return false;
        },
        // UC-08: an image on the clipboard is imported, not embedded. Text on
        // the clipboard is left to CodeMirror.
        paste: (event, view) => {
          const file = [...(event.clipboardData?.files ?? [])].find((each) =>
            each.type.startsWith("image/"),
          );
          if (!file || !onPasteImage) return false;
          event.preventDefault();
          onPasteImage(view, file);
          return true;
        },
        // UC-09: Ctrl+click follows a link. Plain clicking must keep placing
        // the cursor — this is a writing surface, not a web page.
        mousedown: (event, view) => {
          if (!event.ctrlKey || !onFollowLink) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const target = linkTargetAt(view.state, pos);
          if (!target) return false;
          event.preventDefault();
          onFollowLink(target);
          return true;
        },
      }),
    ],
  });

  return new EditorView({ state, parent });
}

/** The text of the topmost visible line — the anchor for "where you were". */
export function topLineText(view) {
  const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return view.state.doc.lineAt(top.from).text.trim();
}

/**
 * Scrolls back to a line matching `anchor`. Silently does nothing when the text
 * is gone — the document just opens at the top (UC-04/A1, UC-04-K2).
 */
export function scrollToAnchor(view, anchor) {
  if (!anchor) return;
  const doc = view.state.doc;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trim() === anchor) {
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      });
      return;
    }
  }
}
