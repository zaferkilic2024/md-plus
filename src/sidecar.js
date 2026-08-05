// The sidecar: marks, comments and transfer records (KR-12).
//
// Nothing here is ever written into the .md (IS-07). The file stays exactly as
// the writer left it; MD Plus keeps its own notes about it, and since KR-92 it
// keeps them in one place — the workshop (`workshop.js` says where and why).
// This file is the policy over that store: where to look, and when a record
// should exist at all.
//
// **One place, no fallbacks** (Zafer, 5 Aug 2026). Notes written by versions
// before the workshop stay in the `.mdplus/` folders beside their documents and
// are not read: a compatibility door that must be tried on every document that
// has no record is a layer the app would carry forever, because the old records
// are scattered across the disk and nothing may go looking for them (KR-14).
// This is a fresh start, and it is said out loud in the release rather than
// worked around in the code.
//
// An anchor is not an offset. Offsets die the moment anyone edits the file in
// another editor — and IS-08 assumes they will. The anchor is the text itself:
// the quote, plus a slice of what came before and after, which is what tells two
// identical sentences apart (SD-06).

import { fileNameOf } from "./paths.js";
import { dropRecord, findRecord, readRecord, writeRecord } from "./workshop.js";

// The anchoring logic lives in anchor.js, free of Tauri so it can be tested
// on its own; re-exported here so callers see one sidecar API. The signature
// travels the same way — callers hand it in, because only they hold the text
// cheaply (the tab's `diskText`, the PDF's bytes at open).
export { makeAnchor, reanchor, resolveAnchor } from "./anchor.js";
export { signatureOf } from "./workshop-index.js";

const VERSION = 1;

/**
 * Reads what we know about a document: the workshop, by path, and failing that
 * by content signature — which is how a document that was moved or renamed
 * outside the app finds its notes again.
 */
export async function readSidecar(documentPath, signature = null) {
  const empty = { surum: VERSION, belge: fileNameOf(documentPath), isaretler: [] };

  try {
    const record = await findRecord(documentPath, signature);
    if (!record) return empty;

    const data = await readRecord(record.id);
    // SD-14: a record that will not parse is set aside and reported, never
    // silently overwritten.
    if (!data) return { ...empty, bozuk: true };
    // SD-15: a newer schema than we know is opened read-only.
    if (data.surum > VERSION) return { ...data, saltOkunur: true };
    return data;
  } catch {
    return { ...empty, bozuk: true };
  }
}

/**
 * Writes the sidecar to the workshop — and, when there is nothing left to
 * remember, removes the record instead of leaving an empty shell behind.
 *
 * That second half is the whole point of the move. A record used to be born
 * the moment a document was saved, whether or not a single mark was ever put
 * in it; five hundred documents read meant five hundred folders on the disk.
 * A record now begins with the first mark and ends with the last one.
 */
export async function writeSidecar(documentPath, sidecar, signature = null) {
  if (sidecar.saltOkunur) return;

  const marks = sidecar.isaretler ?? [];
  if (!marks.length) {
    await dropRecord(documentPath, signature);
    return;
  }

  await writeRecord(documentPath, signature, {
    surum: VERSION,
    isaretler: marks,
  });
}
