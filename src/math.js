// LaTeX typesetting (UC-03).
//
// $…$ renders inline, $$…$$ as a centred block. Same rule as every other mark:
// the raw source shows only while the cursor is inside the formula, so a formula
// being edited stays editable. A broken formula must never take the app down —
// it is left as plain text in a neutral tone (UC-03/A1, UC-03-K3).
//
// This is a StateField, not a ViewPlugin: CodeMirror forbids block-level
// decorations from view plugins, and a $$…$$ on its own line needs one.

import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";

class FormulaWidget extends WidgetType {
  constructor(source, block) {
    super();
    this.source = source;
    this.block = block;
  }

  eq(other) {
    return other.source === this.source && other.block === this.block;
  }

  toDOM() {
    const host = document.createElement(this.block ? "div" : "span");
    host.className = this.block ? "cm-formula-block" : "cm-formula-inline";
    try {
      katex.render(this.source, host, {
        displayMode: this.block,
        throwOnError: true,
        output: "html",
      });
    } catch {
      host.className = "cm-formula-broken";
      host.textContent = this.block ? `$$${this.source}$$` : `$${this.source}$`;
    }
    return host;
  }

  ignoreEvent() {
    return false;
  }
}

const FORMULA = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

function buildDecorations(state) {
  const doc = state.doc;
  const text = doc.toString();
  const decorations = [];

  FORMULA.lastIndex = 0;
  let match;
  while ((match = FORMULA.exec(text))) {
    let from = match.index;
    let to = from + match[0].length;

    // Cursor inside the formula? Leave the raw source alone.
    const touched = state.selection.ranges.some(
      (range) => range.to >= from && range.from <= to,
    );
    if (touched) continue;

    const isBlockSyntax = match[1] !== undefined;
    const source = (isBlockSyntax ? match[1] : match[2]).trim();

    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(to);
    // A block widget must cover whole lines, so only promote $$…$$ to a block
    // when nothing else shares those lines. Otherwise it stays inline.
    const alone =
      isBlockSyntax &&
      doc.sliceString(startLine.from, from).trim() === "" &&
      doc.sliceString(to, endLine.to).trim() === "";

    if (alone) {
      from = startLine.from;
      to = endLine.to;
    } else if (startLine.number !== endLine.number) {
      // Inline decorations cannot span line breaks; leave it as raw text.
      continue;
    }

    decorations.push(
      Decoration.replace({
        widget: new FormulaWidget(source, alone),
        block: alone,
      }).range(from, to),
    );
  }

  return Decoration.set(decorations, true);
}

export const mathTypesetting = StateField.define({
  create: (state) => buildDecorations(state),
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildDecorations(transaction.state);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
