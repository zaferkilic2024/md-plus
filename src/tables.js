// Table typesetting.
//
// A GFM table is drawn as a table. The same rule as every other mark: the raw
// pipes come back the moment the cursor enters the table, so it stays editable —
// there is no table wizard and never will be (KR-14). MD Plus only *reads* the
// table well; you still write it in Markdown.

import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

class TableWidget extends WidgetType {
  constructor(rows, aligns) {
    super();
    this.rows = rows;
    this.aligns = aligns;
  }

  eq(other) {
    return (
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      JSON.stringify(other.aligns) === JSON.stringify(this.aligns)
    );
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-table";

    const table = document.createElement("table");
    this.rows.forEach((cells, index) => {
      const row = document.createElement("tr");
      cells.forEach((cell, column) => {
        const box = document.createElement(index === 0 ? "th" : "td");
        fillCell(box, cell);
        const align = this.aligns[column];
        if (align) box.style.textAlign = align;
        row.append(box);
      });
      table.append(row);
    });

    wrap.append(table);
    return wrap;
  }
}

/**
 * A cell carries its own formatting — "**İşbirliği**" has to come out bold, not
 * with its asterisks showing. Built as nodes, never as innerHTML: cell text is
 * the user's document, and it is not going to be parsed as markup.
 */
function fillCell(box, text) {
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`/g;
  let at = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > at) {
      box.append(document.createTextNode(text.slice(at, match.index)));
    }

    const [whole, strongMark, strongText, emMark, emText, codeText] = match;
    const node = document.createElement(
      strongMark ? "strong" : emMark ? "em" : "code",
    );
    node.textContent = strongText ?? emText ?? codeText;
    box.append(node);

    at = match.index + whole.length;
  }

  if (at < text.length) box.append(document.createTextNode(text.slice(at)));
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

const isDivider = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

function alignmentsOf(divider) {
  return splitRow(divider).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return null;
  });
}

function buildDecorations(state) {
  const doc = state.doc;
  const cursorLine = doc.lineAt(state.selection.main.head).number;
  const decorations = [];

  for (let n = 1; n <= doc.lines - 1; n++) {
    const header = doc.line(n);
    const divider = doc.line(n + 1);

    if (!header.text.includes("|") || !isDivider(divider.text)) continue;

    // Collect the body rows.
    let last = n + 1;
    while (last + 1 <= doc.lines && doc.line(last + 1).text.includes("|")) last++;

    // The cursor is in the table: leave it as Markdown, so it can be edited.
    if (cursorLine >= n && cursorLine <= last) {
      n = last;
      continue;
    }

    const rows = [splitRow(header.text)];
    for (let r = n + 2; r <= last; r++) rows.push(splitRow(doc.line(r).text));

    decorations.push(
      Decoration.replace({
        widget: new TableWidget(rows, alignmentsOf(divider.text)),
        block: true,
      }).range(header.from, doc.line(last).to),
    );

    n = last;
  }

  return Decoration.set(decorations, true);
}

export const tableTypesetting = StateField.define({
  create: (state) => buildDecorations(state),
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildDecorations(transaction.state);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
