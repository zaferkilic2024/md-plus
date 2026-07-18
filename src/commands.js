// Formatting commands (UC-06, UC-07).
//
// Everything here writes plain Markdown and nothing else (IS-01, IS-02): no
// HTML, no app-specific syntax. Block formats always take the whole block
// (KR-19) — a selection in the middle of a paragraph turns the paragraph into a
// heading, it never splits it.

import { EditorSelection } from "@codemirror/state";

// ---- inline ----------------------------------------------------------------

/** Wraps the selection in `mark`, or unwraps it if it is already wrapped. */
function toggleInline(view, mark) {
  const { state } = view;

  const changes = state.changeByRange((range) => {
    // No selection: act on the word under the cursor (UC-06/A1).
    let { from, to } = range;
    if (from === to) {
      const line = state.doc.lineAt(from);
      const offset = from - line.from;
      const before = /[\p{L}\p{N}_]*$/u.exec(line.text.slice(0, offset))[0];
      const after = /^[\p{L}\p{N}_]*/u.exec(line.text.slice(offset))[0];
      if (!before && !after) return { range };
      from = line.from + offset - before.length;
      to = line.from + offset + after.length;
    } else {
      // Drag-selecting a word usually catches the space after it. Wrapping that
      // gives "**word **", and Markdown does not accept a space before the
      // closing mark — the text simply never turns bold. So the marks go inside
      // the whitespace, never around it.
      const text = state.doc.sliceString(from, to);
      from += text.length - text.trimStart().length;
      to -= text.length - text.trimEnd().length;
      if (from >= to) return { range };
    }

    const width = mark.length;
    const outside =
      state.doc.sliceString(from - width, from) === mark &&
      state.doc.sliceString(to, to + width) === mark;
    const inside =
      to - from >= width * 2 &&
      state.doc.sliceString(from, from + width) === mark &&
      state.doc.sliceString(to - width, to) === mark;

    // UC-06/A2: already marked → the shortcut removes the mark.
    if (outside) {
      return {
        changes: [
          { from: from - width, to: from },
          { from: to, to: to + width },
        ],
        range: EditorSelection.range(from - width, to - width),
      };
    }
    if (inside) {
      return {
        changes: [
          { from, to: from + width },
          { from: to - width, to },
        ],
        range: EditorSelection.range(from, to - width * 2),
      };
    }

    return {
      changes: [
        { from, insert: mark },
        { from: to, insert: mark },
      ],
      range: EditorSelection.range(from + width, to + width),
    };
  });

  view.dispatch(changes, { scrollIntoView: true });
  view.focus();
  return true;
}

export const toggleBold = (view) => toggleInline(view, "**");
export const toggleItalic = (view) => toggleInline(view, "*");

/**
 * Inline `code` for a selection inside one line; a fenced block when the
 * selection spans lines — a multi-line span cannot be inline code in Markdown.
 */
export function toggleCode(view) {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);

  if (first.number === last.number) return toggleInline(view, "`");

  const text = state.doc.sliceString(first.from, last.to);
  view.dispatch({
    changes: {
      from: first.from,
      to: last.to,
      insert: "```\n" + text + "\n```",
    },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

// ---- blocks ----------------------------------------------------------------

/** The full lines a selection touches — KR-19: never a fragment of a block. */
function selectedLines(state) {
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const lines = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n));
  return lines;
}

/** Strips any block prefix (heading, list, quote) from a line's text. */
const stripPrefix = (text) =>
  text.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/, "");

/**
 * Rewrites every touched line with `prefix`. If every line already has exactly
 * that prefix, it is removed instead (toggle).
 */
function setBlockPrefix(view, prefix) {
  const { state } = view;
  const lines = selectedLines(state);

  const already = lines.every(
    (line) => line.text.trim() !== "" && line.text.startsWith(prefix),
  );

  const changes = lines
    .filter((line) => line.text.trim() !== "" || !already)
    .map((line) => ({
      from: line.from,
      to: line.to,
      insert: already ? stripPrefix(line.text) : prefix + stripPrefix(line.text),
    }));

  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
  return true;
}

/** level 0 turns the block back into a paragraph. */
export const setHeading = (level) => (view) =>
  setBlockPrefix(view, level === 0 ? "" : "#".repeat(level) + " ");

export const toggleList = (view) => setBlockPrefix(view, "- ");
export const toggleQuote = (view) => setBlockPrefix(view, "> ");

/**
 * A callout is a quote block with a type marker (KR-07, IS-03) — never HTML,
 * never a coloured box written into the file. UC-07/A2: several paragraphs go
 * inside one callout.
 */
export function setCallout(type) {
  return (view) => {
    const { state } = view;
    const lines = selectedLines(state);
    const first = lines[0];
    const last = lines[lines.length - 1];

    // Already a callout of some type? Retype it rather than nesting (UC-07/A1).
    const existing = /^>\s*\[!\w+\]/.test(first.text);
    const body = (existing ? lines.slice(1) : lines)
      .map((line) => "> " + line.text.replace(/^>\s?/, ""))
      .join("\n");

    view.dispatch({
      changes: {
        from: first.from,
        to: last.to,
        insert: `> [!${type}]\n${body}`,
      },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  };
}

/** Canonical link form (KR-13): [text](target.md). */
export function insertLink(view, target) {
  const { state } = view;
  const range = state.selection.main;
  const text = state.doc.sliceString(range.from, range.to) || "bağlantı";

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[${text}](${target})` },
    selection: { anchor: range.from + 1, head: range.from + 1 + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}
