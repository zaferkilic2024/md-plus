// Image typesetting (UC-03).
//
// ![alt](tez.images/x.png) is drawn at the text measure. Same rule as every other
// mark: the raw source shows only while the cursor is on that line, so the link
// stays editable. A missing file says so and keeps the text flowing (UC-03/A2).
//
// A StateField, not a ViewPlugin: an image on its own line is a block widget,
// and CodeMirror does not accept block decorations from view plugins.

import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { t } from "./i18n.js";

class ImageWidget extends WidgetType {
  constructor(source, alt) {
    super();
    this.source = source;
    this.alt = alt;
  }

  eq(other) {
    return other.source === this.source && other.alt === this.alt;
  }

  toDOM() {
    const figure = document.createElement("div");
    figure.className = "cm-image";

    const image = document.createElement("img");
    image.src = this.source;
    image.alt = this.alt;
    image.onerror = () => {
      figure.classList.add("cm-image-missing");
      figure.textContent = t("editor.imageNotFound", { alt: this.alt || "?" });
    };
    figure.append(image);
    return figure;
  }
}

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

function buildDecorations(state, folderOfDocument) {
  const documentFolder = folderOfDocument();
  const doc = state.doc;
  const text = doc.toString();
  const decorations = [];

  IMAGE.lastIndex = 0;
  let match;
  while ((match = IMAGE.exec(text))) {
    const from = match.index;
    const to = from + match[0].length;

    const line = doc.lineAt(from);
    if (line.number === doc.lineAt(state.selection.main.head).number) continue;

    // Only a line that is nothing but the image becomes a block.
    const alone =
      doc.sliceString(line.from, from).trim() === "" &&
      doc.sliceString(to, line.to).trim() === "";
    if (!alone) continue;

    const target = match[2];
    const absolute = /^([a-z]+:)?\//i.test(target)
      ? target
      : `${documentFolder}/${target}`;

    decorations.push(
      Decoration.replace({
        widget: new ImageWidget(
          documentFolder ? convertFileSrc(absolute) : target,
          match[1],
        ),
        block: true,
      }).range(line.from, line.to),
    );
  }

  return Decoration.set(decorations, true);
}

/**
 * `folderOfDocument` is read fresh each time, not captured once: an unsaved
 * document keeps its images in the draft folder and moves them on first save,
 * so the folder these links resolve against changes underneath us.
 */
export const imageTypesetting = (folderOfDocument) =>
  StateField.define({
    create: (state) => buildDecorations(state, folderOfDocument),
    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildDecorations(transaction.state, folderOfDocument);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
