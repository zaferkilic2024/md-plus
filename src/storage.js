// Disk access (UC-05, UC-10).
//
// Two rules from the constitution shape this file:
//   KR-18 — backups go into .mdplus/ next to the document, never beside it.
//   IS-14 — a document the user did not touch must come back byte for byte.
//           Nothing here normalises line endings, trims whitespace, or rewrites
//           list markers.

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
import { appDataDir } from "@tauri-apps/api/path";
import { SIDECAR_DIR, fileNameOf, folderOf, separator } from "./paths.js";

// Re-exported so callers keep asking storage about paths, as they always have.
export { fileNameOf, folderOf, samePath, titleOf } from "./paths.js";

const IMAGE_DIR = "gorseller";

/** The .mdplus/ folder beside a document; created on demand. */
async function sidecarFolder(documentPath) {
  const sep = separator(documentPath);
  const folder = `${folderOf(documentPath)}${sep}${SIDECAR_DIR}`;
  if (!(await exists(folder))) await mkdir(folder, { recursive: true });
  return folder;
}

export const readDocument = (path) => readTextFile(path);

/**
 * The bytes of a file, for the one reader that is not text: PDF (KR-68).
 * readTextFile would hand pdf.js a UTF-8 mangling of a binary format.
 */
export const readBytes = (path) => readFile(path);

export const documentExists = (path) => exists(path);

/**
 * Renames a document on disk and brings its sidecar with it — the marks and
 * comments live in `.mdplus/<name>.json` (KR-15), so a rename that left them
 * behind would orphan them. Returns the new full path.
 */
export async function renameDocument(oldPath, yeniAd) {
  const sep = separator(oldPath);
  let ad = yeniAd.trim();
  if (!/\.md$/i.test(ad)) ad += ".md";

  const newPath = `${folderOf(oldPath)}${sep}${ad}`;
  if (newPath === oldPath) return oldPath;
  if (await exists(newPath)) throw new Error("Bu adda bir dosya zaten var.");

  await rename(oldPath, newPath);

  // The sidecar (<name>.json) and its backup (<name>.bak) travel with it.
  const folder = `${folderOf(oldPath)}${sep}${SIDECAR_DIR}`;
  const eski = fileNameOf(oldPath);
  const yeni = fileNameOf(newPath);
  for (const suffix of [".json", ".bak"]) {
    const kaynak = `${folder}${sep}${eski}${suffix}`;
    if (await exists(kaynak)) await rename(kaynak, `${folder}${sep}${yeni}${suffix}`);
  }

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
// gorseller/, and the text gets a plain Markdown link. No base64, ever.
//
// IS-05 forbids demanding "save the document first". An unsaved document has no
// folder yet, so its images go to a draft folder and move across on the first
// save. The link text never changes, because it is relative either way.

// Resolved once at startup so the image typesetter can ask for it synchronously.
let draftDir = null;
export async function initDraftFolder() {
  draftDir = `${await appDataDir()}/taslak`;
  return draftDir;
}
export const draftFolderSync = () => draftDir;

const draftFolder = async () => draftDir ?? (await initDraftFolder());

/** gorseller/ beside the document — or beside the draft, if it has no home yet. */
async function imageFolder(documentPath) {
  const base = documentPath ? folderOf(documentPath) : await draftFolder();
  const sep = documentPath ? separator(documentPath) : "/";
  const folder = `${base}${sep}${IMAGE_DIR}`;
  if (!(await exists(folder))) await mkdir(folder, { recursive: true });
  return { folder, sep };
}

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

  return `${IMAGE_DIR}/${chosen}`;
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
 * (UC-05/A1, UC-05-K2). The links in the text already read gorseller/…, so they
 * are correct the moment the files land — nothing in the document is rewritten.
 */
export async function adoptDraftImages(documentPath) {
  const source = `${await draftFolder()}/${IMAGE_DIR}`;
  if (!(await exists(source))) return;

  const { folder, sep } = await imageFolder(documentPath);
  for (const entry of await readDir(source)) {
    if (!entry.isFile) continue;
    await copyFile(`${source}/${entry.name}`, `${folder}${sep}${entry.name}`);
    await remove(`${source}/${entry.name}`);
  }
}

/**
 * Writes the document, keeping the previous on-disk content as a backup first
 * (UC-10). A failed backup must not cost the user their text, so the write goes
 * ahead either way — but it is reported, never swallowed: the backup is what
 * IS-13 (no data loss) rests on.
 *
 * @returns {Promise<{backupFailed: Error | null}>}
 */
export async function writeDocument(path, text) {
  const sep = separator(path);
  let backupFailed = null;

  try {
    if (await exists(path)) {
      const previous = await readTextFile(path);
      const folder = await sidecarFolder(path);
      await writeTextFile(`${folder}${sep}${fileNameOf(path)}.bak`, previous);
    }
  } catch (error) {
    backupFailed = error;
  }

  await writeTextFile(path, text);
  return { backupFailed };
}
