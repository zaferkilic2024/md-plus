// The workshop (atölye): where a document's notes live.
//
// The rule this file exists to keep: a `.md` gains its extra powers by coming
// to the workshop, not by the workshop following it home. Before this, opening
// a file anywhere on the disk left a `.mdplus/` folder beside it — no tattoo on
// the document itself, but a sticker on the shelf next to it, everywhere the
// reader ever looked. There is now one `.mdplus/`, in the home folder, and the
// document's own folder gets nothing at all.
//
// What that costs, said out loud: hand someone the `.md` and the notes do not
// go with it; uninstall the app and they are gone; backing up Documents is no
// longer enough. Export/import is the answer to the first (a `.mdplus` package,
// a plain zip inside, so even that is openable anywhere) — the deliberate part
// being that sharing your comments becomes a decision instead of an accident.
//
// Layout, inside `~/.mdplus/annotations/` (see app-folder.js for why the app
// lives in the home folder and why every name there is English):
//   index.json   — id, path, signature, name. A cache. Read once per session.
//   <id>.json    — one record per document: the sidecar as it always looked.
//
// Notes get their own subfolder rather than sitting beside settings and
// session, because they are the only thing in there that is the reader's own
// writing: someone backing up their comments should be able to point at one
// folder and be done.
//
// The index is a cache, never the truth: every record repeats its own path and
// signature, so a lost or corrupt index is rebuilt by reading the folder.
// Splitting them is what keeps startup cheap — one small read instead of five
// hundred round trips through the IPC bridge.

import { exists, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { ANNOTATIONS_DIR, appSubfolder } from "./app-folder.js";
import { fileNameOf } from "./paths.js";
import {
  matchRecord,
  movedFrom,
  nextId,
  withRecord,
  withoutRecord,
} from "./workshop-index.js";

const INDEX = "index.json";
const VERSION = 1;

/** The index, read once and kept for the session. */
let index = null;

/** The folder, asked about once and kept: a single save touches it half a
    dozen times, and every one of those is a round trip through the bridge.
    Deliberately not named `base` — every function here has a local by that
    name, and a shadowed module variable is a bug waiting for a careless edit. */
let folderPath = null;

async function folder() {
  folderPath = folderPath ?? (await appSubfolder(ANNOTATIONS_DIR));
  return folderPath;
}

/**
 * Reads every record in the folder and rebuilds the index from them. The slow
 * path, taken only when the index is missing or unreadable — which is also the
 * reason the records are self-describing.
 */
async function rebuild(base) {
  const records = [];
  try {
    for (const entry of await readDir(base)) {
      if (!entry.isFile || !entry.name.endsWith(".json") || entry.name === INDEX) continue;
      try {
        const record = JSON.parse(await readTextFile(`${base}/${entry.name}`));
        if (!record?.yol) continue;
        records.push({
          id: entry.name.replace(/\.json$/i, ""),
          yol: record.yol,
          imza: record.imza ?? "",
          belge: record.belge ?? fileNameOf(record.yol),
        });
      } catch {
        // One unreadable record must not cost the reader the other four hundred.
      }
    }
  } catch {
    // No folder yet, or no permission: an empty workshop, not an error.
  }
  return records;
}

async function readIndex() {
  if (index) return index;

  const base = await folder();
  try {
    const data = JSON.parse(await readTextFile(`${base}/${INDEX}`));
    if (data?.surum === VERSION && Array.isArray(data.kayitlar)) {
      index = data.kayitlar;
      return index;
    }
  } catch {
    // Missing or corrupt — the folder itself still knows.
  }

  index = await rebuild(base);
  await writeIndex();
  return index;
}

async function writeIndex() {
  try {
    const base = await folder();
    await writeTextFile(
      `${base}/${INDEX}`,
      JSON.stringify({ surum: VERSION, kayitlar: index ?? [] }, null, 2),
    );
  } catch (error) {
    // The index is a cache; losing it costs one rebuild, never a note.
    console.warn("atölye dizini yazılamadı:", error);
  }
}

/**
 * Changes the index and writes it out.
 *
 * The list handed to `change` is the one that exists NOW, never the snapshot a
 * caller took before its awaits: two tabs autosaving in the same breath would
 * otherwise each rebuild the index from a version that predates the other, and
 * the second write would quietly delete the first one's entry. The record files
 * would survive it — a rebuild finds them — but until then the reader's marks
 * would look lost, which is the worst way for this to fail.
 */
async function commit(change) {
  index = change(index ?? []);
  await writeIndex();
}

/**
 * The record for a document, or null. A hit by signature — the document moved —
 * writes its new address back before returning, so the next open is a plain
 * path lookup again.
 *
 * An entry whose file is gone is dropped rather than reported: the index is a
 * cache, and a cache that outlives what it points at must correct itself. The
 * alternative is a document that says "corrupt notes" forever over a record
 * that simply is not there — the wrong sentence, and an unfixable one.
 */
export async function findRecord(documentPath, signature) {
  const records = await readIndex();
  const found = matchRecord(records, documentPath, signature);
  if (!found) return null;

  const base = await folder();
  if (!(await exists(`${base}/${found.id}.json`))) {
    await commit((current) => withoutRecord(current, found.id));
    return null;
  }

  if (movedFrom(found, documentPath)) {
    const moved = { ...found, yol: documentPath, belge: fileNameOf(documentPath) };
    await commit((current) => withRecord(current, moved));
    await patchRecord(moved);
    return moved;
  }
  return found;
}

/** The stored sidecar of a record, or null if it cannot be read. */
export async function readRecord(id) {
  try {
    const base = await folder();
    const path = `${base}/${id}.json`;
    if (!(await exists(path))) return null;
    return JSON.parse(await readTextFile(path));
  } catch {
    return null;
  }
}

/** Keeps a record body's own copy of its address in step with the index. */
async function patchRecord(entry) {
  const body = await readRecord(entry.id);
  if (!body) return;
  const base = await folder();
  await writeTextFile(
    `${base}/${entry.id}.json`,
    JSON.stringify({ ...body, yol: entry.yol, belge: entry.belge }, null, 2),
  );
}

/**
 * Writes a document's sidecar into the workshop, making a record for it if this
 * is the first time. Returns the record's id.
 *
 * The body is written before the index, so a crash in between leaves a record
 * the rebuild can still find — the other order would leave an index pointing at
 * a file that was never written.
 */
export async function writeRecord(documentPath, signature, sidecar) {
  const records = await readIndex();
  const found = matchRecord(records, documentPath, signature);
  const id = found?.id ?? nextId(records, documentPath);

  const entry = {
    id,
    yol: documentPath,
    imza: signature ?? found?.imza ?? "",
    belge: fileNameOf(documentPath),
  };

  const base = await folder();
  await writeTextFile(
    `${base}/${id}.json`,
    JSON.stringify(
      {
        surum: sidecar.surum ?? VERSION,
        belge: entry.belge,
        yol: entry.yol,
        imza: entry.imza,
        isaretler: sidecar.isaretler ?? [],
      },
      null,
      2,
    ),
  );

  await commit((current) => withRecord(current, entry));
  return id;
}

/**
 * Drops a document's record entirely. This is what "the last mark was deleted"
 * means: a record that remembers nothing is not kept as an empty shell, because
 * five hundred read documents would then be five hundred empty shells.
 */
export async function dropRecord(documentPath, signature) {
  const records = await readIndex();
  const found = matchRecord(records, documentPath, signature);
  if (!found) return;

  try {
    const base = await folder();
    const path = `${base}/${found.id}.json`;
    if (await exists(path)) await remove(path);
  } catch {
    // If the body will not go, the index entry still must — a record pointing
    // at nothing is worse than a file nobody points at (the rebuild would
    // resurrect it, so this order matters).
  }

  await commit((current) => withoutRecord(current, found.id));
}

/** A rename is not a move: the path changed but the content did not. */
export async function notePathChanged(oldPath, newPath) {
  const records = await readIndex();
  const found = matchRecord(records, oldPath, null);
  if (!found) return;

  const moved = { ...found, yol: newPath, belge: fileNameOf(newPath) };
  await commit((current) => withRecord(current, moved));
  await patchRecord(moved);
}
