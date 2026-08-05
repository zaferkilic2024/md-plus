// The home page — what this app is, what it can do, and where its source is.
//
// It is the welcome screen, reachable at any time (Zafer, 2 Ağu). The screen a
// reader sees on first run should not be a screen they can never see again: it
// is the only place the app describes itself, and describing itself is exactly
// what an app has to keep doing for someone who opened it three weeks ago.
//
// So this is not a second welcome screen. Since 6 Ağu it is literally the same
// one: `about.js` holds the block both screens are made of, and this page is
// that block plus a way back. What differs is only what an EMPTY window needs —
// the ways in, the drag hint, the shelf of recent documents.

import { createEmptyState } from "./empty.js";
import { createAboutBlock } from "./about.js";
import { GLYPH, icon } from "./strip.js";
import { t } from "./i18n.js";

/**
 * The layer. It starts under the window's own row — the same rule Aktarma
 * follows — so the window can still be moved, resized and closed while it is up.
 */
export function createHome({ onClose }) {
  const layer = document.createElement("div");
  layer.className = "home-layer";

  const sheet = document.createElement("div");
  sheet.className = "home-sheet";

  // The head of the opening screen — mark, title, promise — and then exactly
  // the block that screen carries below it. The two are the same page now
  // (Zafer, 6 Ağu); only the ways in and the back arrow differ.
  sheet.append(createEmptyState({ ways: false }));
  sheet.append(createAboutBlock());

  layer.append(sheet);

  // The way out, said in words.
  //
  // A ✕ in the corner was there first, and pressing the button again closes it
  // too — but neither is a way OUT that anyone would look for: nobody opens a
  // page and then hunts for the button they came in by (Zafer, 2 Ağu). So it is
  // the arrow that already means "back the way you came" (Aktarma's exit, the
  // link stack's), and it carries its name — one of the handful of places a word
  // earns its place over a drawing.
  const back = document.createElement("button");
  back.className = "home-back";
  back.innerHTML = `${icon(GLYPH.back, 17)}<span>${t("home.back")}</span>`;
  back.onclick = () => onClose();
  layer.append(back);

  // Escape closes it, and a press on the paper around the sheet does too: it is
  // a page you looked at, not a form you have to answer.
  layer.addEventListener("mousedown", (event) => {
    if (event.target === layer) onClose();
  });

  return layer;
}
