// Son açılan belgeler — the last ten documents opened (KR-58, KR-59, UC-20).
//
// This is not a library (KR-14). It does not browse folders, search them, shelf
// them, tag them or preview them. Its only job is to spare you hunting folder by
// folder for the document you had open yesterday. Hence its place: beside the
// door that opens documents, because it does the same job.
//
// The list belongs to the APP, not to any document — so it cannot live in a
// .mdplus/ folder beside one (on startup there is no document folder to look in
// yet), and it never touches the .md. It rides in oturum.json, `sonAcilanlar`.
//
// Everything here is pure: no Tauri, no DOM, no disk. The list is data, and the
// rules about it are the kind of thing that should be provable at a terminal.
// The rendering lives in chrome.js, the disk in session.js.

/** Ten. It lives here and in the config, never in a settings panel — "how many
    should I remember?" is the first brick of a preferences window (KR-23). */
import { samePath, separator } from "./paths.js";

export const LIMIT = 10;

const nameOf = (path) => path.slice(path.lastIndexOf(separator(path)) + 1);

/** The immediate parent folder's name — the qualifier, not the whole path. */
const parentOf = (path) => {
  const cut = path.lastIndexOf(separator(path));
  if (cut === -1) return "";
  return nameOf(path.slice(0, cut));
};

/**
 * A document was opened: it goes to the front (KR-59).
 *
 * Identity is the FULL PATH, never the name (SD-19) — two different notlar.md
 * files are two different documents, and collapsing them would lose one.
 *
 * The only event that touches this list is opening a document. Switching tabs,
 * writing, saving and restoring a session all leave it alone (UC-20-K5): the
 * list is a door, not an activity log, and a list that resorts itself on every
 * click pulls the place your eye learned out from under it.
 */
export function remember(list, path, limit = LIMIT) {
  if (!path) return list; // an unsaved draft has no path to remember (UC-20-K7)
  return [path, ...list.filter((entry) => !samePath(entry, path))].slice(0, limit);
}

/**
 * A path clicked and found missing drops out (UC-20-K4, SD-20). This is the
 * only other way a row leaves the list — that, and the eleventh document
 * pushing the oldest off the end. There is no "clear" button: the limit is what
 * handles the crowding.
 */
export function forget(list, path) {
  return list.filter((entry) => !samePath(entry, path));
}

/**
 * The document was renamed on disk: its row keeps its place under the new name.
 * Before this, the old path sat in the list until it was clicked, said
 * "bulunamadı" and dropped — a stumble the app itself caused (18 Tem review).
 */
export function renamePath(list, oldPath, newPath) {
  return list.map((entry) => (samePath(entry, oldPath) ? newPath : entry));
}

/**
 * Rows ready to draw: the name, and — only where the name alone does not settle
 * it — the folder that does (SD-19).
 *
 * The folder is a qualifier stuck to the name, not a right-aligned column: a
 * column would make this a table, and ten rows of full paths would make it a
 * dump. The full path is said in exactly one place, the tooltip — and once more
 * when it is genuinely being asked about, on "bulunamadı".
 */
export function rows(list) {
  const names = list.map(nameOf);
  return list.map((path, index) => {
    const name = names[index];
    const ambiguous = names.some((other, j) => j !== index && other === name);
    return { path, name, folder: ambiguous ? parentOf(path) : "" };
  });
}
