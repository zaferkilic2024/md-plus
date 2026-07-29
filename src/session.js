// The session: which documents are open, which one is in front, and where the
// reader had got to in each (UC-02-K1, UC-04).
//
// Unlike marks and comments — which live beside their document (KR-15) — the
// tab list belongs to no document at all, so it cannot live next to one: on
// startup there would be no folder to look in. It goes in the app's own data
// folder instead.
//
// "Where you were" is not a scroll offset. A scroll offset is meaningless once
// the file has been edited elsewhere; the anchor is the text of the topmost
// visible line, and it is searched for on reopening (UC-04-K1). If the document
// has changed past recognition, the file simply opens at the top — silently,
// no warning (UC-04/A1).

import { appDataDir } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const VERSION = 1;
const FILE = "oturum.json";

async function sessionPath() {
  const folder = await appDataDir();
  if (!(await exists(folder))) await mkdir(folder, { recursive: true });
  return `${folder}/${FILE}`;
}

export async function readSession() {
  try {
    const path = await sessionPath();
    if (!(await exists(path))) return null;
    const data = JSON.parse(await readTextFile(path));
    // An unknown version is not ours to interpret; start clean rather than
    // guess at it (the same rule the sidecar follows, ISTERLER 3.3).
    if (data.surum !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export async function writeSession(session) {
  try {
    await writeTextFile(
      await sessionPath(),
      JSON.stringify({ surum: VERSION, ...session }, null, 2),
    );
  } catch (error) {
    // Losing the session is a nuisance, never a reason to interrupt writing.
    console.warn("oturum kaydedilemedi:", error);
  }
}
