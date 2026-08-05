// Where MD Plus keeps its own things — one folder, one answer.
//
//   ~/.mdplus/
//     settings.json        preferences, AI connections (never a key: secrets.js)
//     session.json         open tabs, where you were, recent documents
//     drafts/              images pasted into a document not yet saved
//     annotations/         marks and comments, one file per document
//       index.json         path · signature · name — a cache, rebuildable
//       <id>.json
//
// Two rules decided this shape, both Zafer's, both on 5 Aug 2026.
//
// **Names are readable to a stranger.** The folder was briefly called `atolye`
// and the files `ayarlar.json` / `oturum.json` / `taslak`: *"the man in Finland
// says — what on earth is an atölye?"* Turkish is the language of the product's
// thinking; it is not a language to write on someone else's disk. Names here are
// English. (This is not the i18n question: a path cannot be translated, because
// switching language would move every file.)
//
// **Notes are not app plumbing.** Document annotations went into their own
// subfolder rather than being tipped in beside settings and session. Someone
// backing up their comments should be able to point at one folder.
//
// The old locations are read once and moved, so nobody has to do anything.

import { appDataDir, homeDir } from "@tauri-apps/api/path";
import { copyFile, exists, mkdir, readDir, remove, rename } from "@tauri-apps/plugin-fs";

const HOME_DIR = ".mdplus";

export const SETTINGS_FILE = "settings.json";
export const SESSION_FILE = "session.json";
export const DRAFTS_DIR = "drafts";
export const ANNOTATIONS_DIR = "annotations";

/** What each of these used to be called, and where. */
const LEGACY = [
  { from: "ayarlar.json", to: SETTINGS_FILE },
  { from: "oturum.json", to: SESSION_FILE },
  { from: "taslak", to: DRAFTS_DIR, directory: true },
];

/**
 * One promise for the whole of "the folder is there and the old files are in
 * it", memoised. Not a `root` variable set before the migration finishes: the
 * second caller would then be handed the path while `ayarlar.json` was still on
 * its way to `settings.json`, read the file that was not there yet, and start
 * the reader on defaults. Everyone awaits the same promise.
 */
let ready = null;

export function appFolder() {
  ready =
    ready ??
    (async () => {
      const path = `${await homeDir()}/${HOME_DIR}`;
      if (!(await exists(path))) await mkdir(path, { recursive: true });
      await migrate(path);
      return path;
    })();
  return ready;
}

/** A subfolder of ours, made on demand. */
export async function appSubfolder(name) {
  const path = `${await appFolder()}/${name}`;
  if (!(await exists(path))) await mkdir(path, { recursive: true });
  return path;
}

/**
 * Brings across what earlier versions wrote, and does it once.
 *
 * A move, not a copy, and only when the destination is absent: a half-finished
 * migration that runs again must never overwrite the newer file with the older
 * one. Anything that fails is left where it is — the app then starts with
 * defaults, which is a bad day, not a lost file.
 */
async function migrate(path) {
  try {
    const old = await appDataDir();
    if (!(await exists(old))) return;

    for (const item of LEGACY) {
      const source = `${old}/${item.from}`;
      const target = `${path}/${item.to}`;
      if (!(await exists(source)) || (await exists(target))) continue;
      try {
        await rename(source, target);
      } catch {
        // Renaming across volumes fails on Windows; the home folder and
        // %APPDATA% are usually on one drive, but "usually" is not a plan.
        if (item.directory) await copyFolder(source, target);
        else await copyFile(source, target);
        try {
          await remove(source, { recursive: Boolean(item.directory) });
        } catch {
          // The copy is what mattered; a leftover original is untidy, not lost.
        }
      }
    }
  } catch {
    // No old folder, or no permission to look: nothing to bring across.
  }

  // The annotations lived directly in this folder for one afternoon, between
  // the workshop landing and the folder being given its shape. Two files, one
  // machine — but leaving them would have meant marks that silently stopped
  // being found.
  try {
    const notes = `${path}/${ANNOTATIONS_DIR}`;
    if (!(await exists(`${path}/dizin.json`))) return;
    if (!(await exists(notes))) await mkdir(notes, { recursive: true });
    for (const entry of await readDir(path)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      if (entry.name === SETTINGS_FILE || entry.name === SESSION_FILE) continue;
      const target = `${notes}/${entry.name === "dizin.json" ? "index.json" : entry.name}`;
      if (!(await exists(target))) await rename(`${path}/${entry.name}`, target);
    }
  } catch {
    // Same rule: what cannot be moved stays readable where it is.
  }
}

async function copyFolder(source, target) {
  if (!(await exists(target))) await mkdir(target, { recursive: true });
  for (const entry of await readDir(source)) {
    if (entry.isFile) await copyFile(`${source}/${entry.name}`, `${target}/${entry.name}`);
    else if (entry.isDirectory) await copyFolder(`${source}/${entry.name}`, `${target}/${entry.name}`);
  }
}
