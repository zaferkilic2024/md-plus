// The window's own frame, drawn by us (tauri.conf: decorations = false).
//
// Why draw it at all: the platform's title bar is a second row above the tabs
// that says the app's name and nothing else. Merging the two gives that row
// back to the document — but the price is that everything the OS used to do for
// free is now ours: dragging the window, double-click to maximise, the three
// controls, and the eight edges you grab to resize.
//
// Nothing here knows anything about documents. It is the shell's outermost ring.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "./i18n.js";

const appWindow = getCurrentWindow();

// Drawn at 12px in a 12-box, not scaled down from the 24-box the rest of the app
// uses: these three are hairlines by convention on Windows, and a 1.7-weight
// stroke shrunk to this size reads as a smudge.
const FRAME_GLYPH = {
  minimize: '<path d="M1 6h10"/>',
  maximize: '<rect x="1.5" y="1.5" width="9" height="9"/>',
  // Two overlapping sheets: the window steps back off the full screen.
  restore: '<path d="M3.5 3.5V1.5h7v7h-2"/><rect x="1.5" y="3.5" width="7" height="7"/>',
  close: '<path d="M1.5 1.5l9 9M10.5 1.5l-9 9"/>',
};

const frameIcon = (name) =>
  `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1">${FRAME_GLYPH[name]}</svg>`;

/**
 * The three window controls, in the platform's order and at the platform's
 * width. They sit hard against the top-right corner on purpose: that corner is
 * an infinitely large target (Fitts), and pulling them one pixel inward throws
 * that away.
 *
 * The close button's hover is NEUTRAL, not the Windows red (Zafer, 2 Ağu). Red
 * in this app means "this is being deleted", and closing a window deletes
 * nothing — an unsaved document is asked about, never dropped.
 */
export function createWindowControls() {
  const box = document.createElement("div");
  box.className = "window-controls";

  const button = (name, title, onClick) => {
    const el = document.createElement("button");
    el.className = `window-control ${name}`;
    el.title = title;
    el.innerHTML = frameIcon(name);
    el.onclick = onClick;
    box.append(el);
    return el;
  };

  button("minimize", t("window.minimize"), () => appWindow.minimize());
  const maximize = button("maximize", t("window.maximize"), () =>
    appWindow.toggleMaximize(),
  );
  button("close", t("window.close"), () => appWindow.close());

  // The middle button is the only one whose meaning changes, so it is the only
  // one that has to be told when the window does.
  const syncMaximize = async () => {
    const full = await appWindow.isMaximized();
    maximize.innerHTML = frameIcon(full ? "restore" : "maximize");
    maximize.title = full ? t("window.restore") : t("window.maximize");
    document.body.classList.toggle("maximized", full);
  };
  syncMaximize();
  // Kept so a rebuilt bar (language change) can drop the old listener; without
  // this each switch leaves another one pointing at a detached button.
  const listening = appWindow.onResized(syncMaximize);
  box.dispose = () => listening.then((off) => off());

  return box;
}

/**
 * The strip you grab to move the window. Tauri answers `data-tauri-drag-region`
 * itself — including double-click to maximise — so this is an attribute, not a
 * listener. Anything with its own click (a tab, an icon) must NOT carry it.
 */
export function dragRegion() {
  const el = document.createElement("div");
  el.className = "drag-region";
  el.setAttribute("data-tauri-drag-region", "");
  return el;
}

/**
 * The eight invisible edges. Each hands the drag straight to the OS, so the
 * resize feels native — no mousemove loop of ours is involved.
 *
 * Maximised, they are switched off in CSS: a window that fills the screen has
 * no outside to drag towards, and the strips would otherwise sit on top of the
 * controls at the very top-right pixel.
 */
export function wireResizeEdges() {
  for (const edge of document.querySelectorAll("[data-resize]")) {
    edge.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      appWindow.startResizeDragging(edge.dataset.resize);
    });
  }
}
