// Belge bilgisi — the file behind the document, said once and properly.
//
// Until now the app knew where a document lived and never told anyone: the path
// showed up in the last-opened list and nowhere else, and that list is HISTORY
// (clear it, or open an eleventh document, and the path of the thing in front of
// you was gone). The tab's tooltip answers the quick question; this card answers
// the rest of it, and lets the path be copied — a tooltip can be read but not
// taken.
//
// It belongs to ⋯ because ⋯ is the document's FILE side (KR-104): the row's
// icons act on the text, this menu acts on the file it is kept in.
//
// The counts are the reader's own leavings, and they come from two different
// places for a reason — see `statsOf`.

import { countCitations, movedTo } from "./citation.js";
import { t } from "./i18n.js";

/**
 * Everything the card says, as data. Pure: no DOM, no disk, no Tauri — so the
 * arithmetic can be argued with at a terminal (`test/belge-bilgi.test.mjs`).
 *
 * @param {object} doc
 * @param {string} doc.text      the document as it stands now ("" for a PDF)
 * @param {Array}  doc.marks     what `MarkStore.listing()` answers with
 * @param {boolean} doc.isPdf    a PDF is read, never written (KR-68)
 */
export function statsOf({ text = "", marks = [], isPdf = false, bytes = null } = {}) {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return {
    // Bytes, not characters: this is the file's size, and a Turkish document is
    // full of two-byte letters. `new Blob` measures what would be written.
    //
    // A caller may hand the number over instead — a PDF has no text here, and
    // weighing "" said 0 KB for a 12 MB book.
    bytes: bytes ?? new Blob([text]).size,
    words,
    chars: text.length,
    marks: marks.length,
    // A comment is an object ({metin, guncelleme}), so its mere presence counts.
    notes: marks.filter((each) => each.record?.yorum).length,
    // How many places pieces of this document were carried into. A mark carried
    // twice into the same document is ONE place, because that is what the record
    // says (withMove refreshes a row rather than adding one).
    sends: marks.reduce((total, each) => total + movedTo(each.record).length, 0),
    // …and how many pieces came in. Read from the text itself, not from anyone's
    // records: a citation arrives WITH the passage (KR-81). A PDF cannot be
    // written into, so it can never be asked this.
    cites: isPdf ? null : countCitations(text),
  };
}

/**
 * A path that fits on one line: the head and the tail, with the middle taken
 * out (Zafer, 6 Ağu — "menü tüm ekrana yayılacak, hiç de hoş görünmeyecek").
 *
 * Wrapping was tried first and was wrong: a deep path turned the menu into a
 * paragraph, and the whole path is already one hover away on the tab. So this
 * says what a path is FOR at a glance — which drive it is on and what it is
 * called — and the full answer stays in the tooltip.
 *
 * The cut lands on a separator when there is one nearby, because half a folder
 * name reads as a different folder. The tail is favoured: the file's own name
 * is the part being looked for.
 *
 * Pure, and measured in characters rather than pixels — the card sets this in
 * mono, where one character is one width.
 */
export function shortPath(path, max = 42) {
  if (!path || path.length <= max) return path ?? "";
  const cut = /[\\/]/;
  const tailWanted = Math.max(max - 12, Math.ceil(max * 0.6));

  let tail = path.slice(path.length - tailWanted);
  const tailBreak = tail.search(cut);
  // Only if it does not eat the name: a tail trimmed back to the last separator
  // could leave the file itself half-shown.
  if (tailBreak > 0 && tailBreak < tailWanted / 2) tail = tail.slice(tailBreak);

  let head = path.slice(0, max - tail.length - 1);
  const headBreak = head.lastIndexOf("\\") > head.lastIndexOf("/") ? head.lastIndexOf("\\") : head.lastIndexOf("/");
  if (headBreak > 2) head = head.slice(0, headBreak + 1);

  return `${head}…${tail}`;
}

/** 142 KB, 1,4 MB — the reader's own separators (`Intl`), never "142000 bytes". */
function humanSize(bytes, lang) {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} B`;
  if (kb < 1024) return `${Math.round(kb).toLocaleString(lang)} KB`;
  return `${(kb / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} MB`;
}

const line = (label, value) => {
  const row = document.createElement("div");
  row.className = "info-line";
  row.innerHTML = `<span>${label}</span><b>${value}</b>`;
  return row;
};

/**
 * The card, as a node the menu can hold (`popover`'s `{ node }` item).
 *
 * @param {object} spec
 * @param {string|null} spec.path   null for a draft that has never been saved
 * @param {object} spec.stats       from statsOf
 * @param {() => void} spec.onOpenFolder
 */
export function createDocInfo({ path, stats, onOpenFolder }) {
  const card = document.createElement("div");
  card.className = "doc-info";
  const lang = document.documentElement.lang || undefined;
  const n = (value) => value.toLocaleString(lang);

  // The path first, because it is the question being asked — shortened to one
  // line, and it IS the way to the folder. One line, one act: copying it to the
  // clipboard was the first version and Zafer asked what it was for, which was
  // the right question (6 Ağu). The whole path lives on the tab's tooltip and
  // on this one.
  const where = document.createElement("button");
  where.className = "info-path";
  where.textContent = path ? shortPath(path) : t("info.unsaved");
  where.disabled = !path;
  where.title = path ? `${path}\n${t("info.openFolder")}` : "";
  where.onclick = onOpenFolder;
  card.append(where);

  const facts = document.createElement("div");
  facts.className = "info-facts";
  facts.append(line(t("info.size"), humanSize(stats.bytes, lang)));
  // A PDF's words are not ours to count — we hold pages, not a text (KR-68).
  if (stats.words) facts.append(line(t("info.words"), n(stats.words)));
  facts.append(line(t("info.marks"), n(stats.marks)));
  facts.append(line(t("info.notes"), n(stats.notes)));
  facts.append(line(t("info.sends"), n(stats.sends)));
  if (stats.cites !== null) facts.append(line(t("info.cites"), n(stats.cites)));
  card.append(facts);
  return card;
}
