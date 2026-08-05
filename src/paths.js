// Path helpers — pure, Tauri-free, testable.
//
// These lived as three private copies (storage.js, sidecar.js, recents.js),
// which is how the app ended up with two definitions of "same file". One home
// now; storage.js re-exports the common ones so its callers keep one import.

export const separator = (path) => (path.includes("\\") ? "\\" : "/");

export const folderOf = (path) => path.slice(0, path.lastIndexOf(separator(path)));

export const fileNameOf = (path) => path.slice(path.lastIndexOf(separator(path)) + 1);

export const titleOf = (path) => fileNameOf(path).replace(/\.md$/i, "");

/**
 * Whether two paths name the same file. Windows' file system is
 * case-insensitive, so `C:\Notlar\a.md` and `c:\notlar\A.md` are one document —
 * comparing them with `===` opened the same file in two tabs (two truths about
 * what it says, the door SD-08 closed) and let it into Son açılanlar twice.
 */
export const samePath = (a, b) =>
  Boolean(a) && Boolean(b) && a.toLowerCase() === b.toLowerCase();
