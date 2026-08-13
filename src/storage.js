// Disk access (UC-05).
//
// The rule from the constitution that shapes this file:
//   IS-14 — a document the user did not touch must come back byte for byte.
//           Nothing here normalises line endings, trims whitespace, or rewrites
//           list markers.
//
// Nothing here creates a folder beside the reader's document any more. Marks
// and comments went to the workshop (`workshop.js`), and `.bak` is gone with
// them — see writeDocument.

import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { DRAFTS_DIR, appSubfolder } from "./app-folder.js";
import { fileNameOf, folderOf, separator, titleOf } from "./paths.js";
import { notePathChanged } from "./workshop.js";

// Re-exported so callers keep asking storage about paths, as they always have.
export { fileNameOf, folderOf, samePath, titleOf } from "./paths.js";

/**
 * The folder an image is copied into, beside its document: `tez.md` keeps its
 * pictures in `tez.images/`.
 *
 * Per document, not one shared folder, and the reason is a question Zafer asked
 * (6 Aug 2026): *"say I want to put a.md on GitHub — do I have to upload the
 * whole images folder?"* With one shared folder the answer is yes, or else pick
 * the right files out by hand. With this one it is `a.md` and `a.images/`, and
 * what to take is legible from the name. The folder is only ever born for a
 * document that actually has a picture.
 *
 * The name is English and unbranded on purpose. It is written INSIDE the .md
 * (`![](tez.images/x.png)`), so a Turkish word would put our language, and our
 * product's name would put our brand, into somebody else's document — which is
 * the one thing the portability law forbids outright.
 *
 * A draft has no name yet, so its pictures wait under a plain `images/` in the
 * app's own drafts folder until the first save gives them one.
 */
const DRAFT_IMAGE_DIR = "images";
const imageDirName = (documentPath) =>
  documentPath ? `${titleOf(documentPath)}.images` : DRAFT_IMAGE_DIR;

export const readDocument = (path) => readTextFile(path);

/**
 * The bytes of a file, for the one reader that is not text: PDF (KR-68).
 * readTextFile would hand pdf.js a UTF-8 mangling of a binary format.
 */
export const readBytes = (path) => readFile(path);

export const documentExists = (path) => exists(path);

/**
 * Renames a document on disk and tells the workshop its new address. Returns
 * the new full path.
 *
 * The record would find its way back anyway — the content did not change, so
 * the signature lookup would catch it on the next open — but being told is
 * cheaper than being searched for, and it keeps the index honest in between.
 */
export async function renameDocument(oldPath, yeniAd) {
  const sep = separator(oldPath);
  let ad = yeniAd.trim();
  if (!/\.md$/i.test(ad)) ad += ".md";

  const newPath = `${folderOf(oldPath)}${sep}${ad}`;
  if (newPath === oldPath) return oldPath;
  if (await exists(newPath)) throw new Error("Bu adda bir dosya zaten var.");

  await rename(oldPath, newPath);
  await notePathChanged(oldPath, newPath);
  return newPath;
}

/** Turns a link target ("notlar/x.md") into a full path, next to the document. */
export function resolveAgainst(documentPath, target) {
  if (!documentPath || /^([a-z]:[\\/]|\/)/i.test(target)) return target;

  const sep = separator(documentPath);
  const parts = folderOf(documentPath).split(/[\\/]/);
  for (const step of target.split(/[\\/]/)) {
    if (step === "." || step === "") continue;
    if (step === "..") parts.pop();
    else parts.push(step);
  }
  return parts.join(sep);
}

/**
 * A link target as it must appear in the file: relative to the document that
 * holds the link (KR-13). An absolute path would break the moment the folder is
 * moved or opened on another machine — the portability law (IS-01) forbids it.
 * Falls back to an absolute path only when the two files share no root at all.
 */
export function relativePath(fromDocument, toDocument) {
  const sep = separator(fromDocument);
  const from = folderOf(fromDocument).split(/[\\/]/);
  const to = toDocument.split(/[\\/]/);

  let shared = 0;
  while (
    shared < from.length &&
    shared < to.length - 1 &&
    from[shared].toLowerCase() === to[shared].toLowerCase()
  ) {
    shared++;
  }
  if (shared === 0) return toDocument;

  const up = from.slice(shared).map(() => "..");
  const down = to.slice(shared);
  // Markdown links use forward slashes even on Windows.
  return [...up, ...down].join("/").replaceAll(sep, "/");
}

// ---- images (UC-08) --------------------------------------------------------
//
// IS-04: an image is never embedded. It is copied next to the document, into
// <belge>.images/, and the text gets a plain Markdown link. No base64, ever.
//
// IS-05 forbids demanding "save the document first". An unsaved document has no
// folder yet — and no name to build a folder name out of — so its images wait
// in the app's drafts folder and move across on the first save, when their
// links are retargeted (main.js/retargetImageLinks).

// Resolved once at startup so the image typesetter can ask for it synchronously.
let draftDir = null;
export async function initDraftFolder() {
  draftDir = await appSubfolder(DRAFTS_DIR);
  return draftDir;
}
export const draftFolderSync = () => draftDir;

const draftFolder = async () => draftDir ?? (await initDraftFolder());

/** The image folder beside the document — or beside the draft, if it has no
    home yet. */
async function imageFolder(documentPath) {
  const base = documentPath ? folderOf(documentPath) : await draftFolder();
  const sep = documentPath ? separator(documentPath) : "/";
  const folder = `${base}${sep}${imageDirName(documentPath)}`;
  if (!(await exists(folder))) await mkdir(folder, { recursive: true });
  return { folder, sep };
}

/**
 * A folder name as it can appear inside a Markdown link. A document called
 * "oyun teorisi.md" gives "oyun teorisi.images", and a space ends a link target
 * — the rest of the path would be read as a title and the image would not load.
 */
const linkSafe = (name) => (/[ ()]/.test(name) ? encodeURI(name) : name);

/** Appends a counter until the name is free: x.png, x-2.png, … (UC-08/A2). */
async function freeName(folder, sep, name) {
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const suffix = dot === -1 ? "" : name.slice(dot);

  let candidate = name;
  for (let n = 2; await exists(`${folder}${sep}${candidate}`); n++) {
    candidate = `${stem}-${n}${suffix}`;
  }
  return candidate;
}

/**
 * Brings an image in — either from a path (dragged file) or from bytes (pasted
 * clipboard) — and returns the Markdown link to write.
 */
export async function importImage({ documentPath, sourcePath, bytes, name }) {
  const { folder, sep } = await imageFolder(documentPath);
  const chosen = await freeName(folder, sep, name ?? fileNameOf(sourcePath));
  const destination = `${folder}${sep}${chosen}`;

  if (bytes) await writeFile(destination, bytes);
  else await copyFile(sourcePath, destination);

  return `${linkSafe(imageDirName(documentPath))}/${linkSafe(chosen)}`;
}

/** A name for something pasted, which arrives without one (UC-08/A3). */
export function pastedImageName(mime) {
  // 2026-07-13T18:04:24.123Z → 20260713-180424
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14)
    .replace(/(\d{8})(\d{6})/, "$1-$2");
  const extension = (mime?.split("/")[1] ?? "png").replace("jpeg", "jpg");
  return `yapistirilan-${stamp}.${extension}`;
}

/**
 * Moves draft images next to the document once it finally has a folder
 * (UC-05/A1, UC-05-K2). The links still read images/…, which was true while
 * there was no name to fold into the folder; the caller retargets them.
 */
export async function adoptDraftImages(documentPath) {
  const source = `${await draftFolder()}/${DRAFT_IMAGE_DIR}`;
  if (!(await exists(source))) return null;

  // Counted BEFORE the destination is made, and this order is the whole point.
  // The drafts folder outlives the draft that made it — pictures leave it, the
  // folder stays — so `exists` above says yes on every later save as well. With
  // the destination created first, saving a brand new document put an empty
  // `belge.images/` beside a document that has no picture at all (Zafer,
  // 13 Ağu). The folder is only ever born for a document that has one.
  const files = (await readDir(source)).filter((entry) => entry.isFile);
  if (!files.length) return null;

  const { folder, sep } = await imageFolder(documentPath);
  for (const entry of files) {
    await copyFile(`${source}/${entry.name}`, `${folder}${sep}${entry.name}`);
    await remove(`${source}/${entry.name}`);
  }

  // The links in the draft still say `images/…`, which was true while the
  // document had no name. Now it has one, and they have to be told: the folder
  // is named after the document, so the name could not have been known when the
  // picture was pasted. The caller rewrites them before the first save, so what
  // lands on disk is right the first time.
  return { from: DRAFT_IMAGE_DIR, to: linkSafe(imageDirName(documentPath)) };
}

/**
 * Writes the document through a temporary file: the text lands in
 * `<name>.md.tmp` and only then takes the document's place, in one move. A
 * write interrupted halfway — power cut, crash, a full disk — costs the
 * temporary file, never the document. Without this the user is left holding a
 * half-written `.md`, and the sentence we tell people ("your text is safe")
 * would be false at exactly the moment it matters.
 *
 * There is no `.bak` any more (KR-18 dropped, 5 Aug 2026). It copied the
 * whole file on every save and bought two seconds of history, because autosave
 * runs every two seconds — undo already covers that stretch, step by step and
 * better. The one thing undo could not have rescued (someone else's edit,
 * overwritten by our autosave) it could not rescue reliably either: the next
 * keystroke overwrote the backup too. What `.bak` was really for — a write
 * left halfway — is what the rename above makes impossible.
 *
 * The temporary file sits beside the document rather than in a folder of ours,
 * for a reason that is not style: a rename is only atomic within one volume,
 * and the workshop may well be on another drive.
 *
 * One deliberate fallback — a safety feature must never become the reason the
 * text is lost: if the move fails (Windows hands out `ERROR_ACCESS_DENIED` when
 * another process — a sync client, a scanner — holds the file open, in cases
 * where a plain write would still succeed) the text goes straight into the
 * document and the leftover is cleared. That gives up atomicity and keeps the
 * text, which is the right way round.
 */
export async function writeDocument(path, text) {
  const temp = `${path}.tmp`;
  try {
    await writeTextFile(temp, text);
    await rename(temp, path);
  } catch {
    await writeTextFile(path, text);
    // A leftover would otherwise sit next to the document looking like a file.
    try {
      if (await exists(temp)) await remove(temp);
    } catch {
      // Nothing to do: the document is written, which is the part that matters.
    }
  }
}
