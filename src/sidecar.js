// The sidecar: marks, comments and transfer records (KR-12, KR-15).
//
// Nothing here is ever written into the .md (IS-07). The file stays exactly as
// the writer left it; MD Plus keeps its own notes beside it, in .mdplus/.
//
// An anchor is not an offset. Offsets die the moment anyone edits the file in
// another editor — and IS-08 assumes they will. The anchor is the text itself:
// the quote, plus a slice of what came before and after, which is what tells two
// identical sentences apart (SD-06).

import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { SIDECAR_DIR, fileNameOf, folderOf, separator } from "./paths.js";

// The anchoring logic lives in anchor.js, free of Tauri so it can be tested
// on its own; re-exported here so callers see one sidecar API.
export { makeAnchor, reanchor, resolveAnchor } from "./anchor.js";

const VERSION = 1;
const CONTEXT = 64;

function sidecarPathOf(documentPath) {
  const sep = separator(documentPath);
  return `${folderOf(documentPath)}${sep}${SIDECAR_DIR}${sep}${fileNameOf(documentPath)}.json`;
}

export async function readSidecar(documentPath) {
  const empty = { surum: VERSION, belge: fileNameOf(documentPath), isaretler: [] };
  try {
    const path = sidecarPathOf(documentPath);
    if (!(await exists(path))) return empty;

    const data = JSON.parse(await readTextFile(path));

    // SD-15: a newer schema than we know is opened read-only, never rewritten.
    if (data.surum > VERSION) return { ...data, saltOkunur: true };
    return data;
  } catch {
    // SD-14: a corrupt sidecar must not take the app down, and must not be
    // silently overwritten either — it is set aside and reported.
    return { ...empty, bozuk: true };
  }
}

export async function writeSidecar(documentPath, sidecar) {
  if (sidecar.saltOkunur) return;

  const sep = separator(documentPath);
  const folder = `${folderOf(documentPath)}${sep}${SIDECAR_DIR}`;
  if (!(await exists(folder))) await mkdir(folder, { recursive: true });

  await writeTextFile(
    sidecarPathOf(documentPath),
    JSON.stringify(
      {
        surum: VERSION,
        belge: fileNameOf(documentPath),
        isaretler: sidecar.isaretler,
      },
      null,
      2,
    ),
  );
}

