// The home page — what this app is, what it can do, and where its source is.
//
// It is the welcome screen, reachable at any time (Zafer, 2 Ağu). The screen a
// reader sees on first run should not be a screen they can never see again: it
// is the only place the app describes itself, and describing itself is exactly
// what an app has to keep doing for someone who opened it three weeks ago.
//
// So this is not a second welcome screen. It is the same one — createEmptyState
// draws the top of it — with the part that only makes sense when you already
// have the app: what it does, that it is open source, and how to reach it.

import { open as openExternal } from "@tauri-apps/plugin-shell";
import { getVersion } from "@tauri-apps/api/app";
import { createEmptyState } from "./empty.js";
import { GLYPH, icon } from "./strip.js";
import { t } from "./i18n.js";

const REPO = "https://github.com/zaferkilic2024/md-plus";

/** The three doors, in the order someone actually needs them. */
const LINKS = [
  { key: "home.repo", url: REPO, glyph: GLYPH.code },
  { key: "home.issues", url: `${REPO}/issues`, glyph: GLYPH.issue },
  { key: "home.license", url: `${REPO}/blob/main/LICENSE`, glyph: GLYPH.license },
];

/**
 * The layer. It starts under the window's own row — the same rule Aktarma
 * follows — so the window can still be moved, resized and closed while it is up.
 */
export function createHome({ onClose }) {
  const layer = document.createElement("div");
  layer.className = "home-layer";

  const sheet = document.createElement("div");
  sheet.className = "home-sheet";

  // Only the head of the welcome screen: the mark, the promise, the line under
  // it. No "new / open", no drag hint, no cards — the reader is already inside
  // the app with a document open behind this page, and every one of those is
  // waiting for them on the opening screen anyway.
  sheet.append(createEmptyState({ ways: false }));

  // What it can do, in one line each. Not the cards again — the cards are four
  // ideas, these are the things a reader asks "can it…?" about.
  const can = document.createElement("div");
  can.className = "home-can";
  can.innerHTML = `<h3>${t("home.canTitle")}</h3><ul>${[
    "home.can1",
    "home.can2",
    "home.can3",
    "home.can4",
    "home.can5",
  ]
    .map((key) => `<li>${t(key)}</li>`)
    .join("")}</ul>`;
  sheet.append(can);

  const about = document.createElement("div");
  about.className = "home-about";
  about.innerHTML = `
    <div class="home-rule"></div>
    <p class="home-open">${t("home.openSource")}</p>
    <div class="home-links"></div>
    <p class="home-version"></p>`;

  const links = about.querySelector(".home-links");
  for (const link of LINKS) {
    const button = document.createElement("button");
    button.className = "home-link";
    button.innerHTML = `${icon(link.glyph, 15)}<span>${t(link.key)}</span>`;
    // Opened in the reader's browser, not in here: this app is offline and has
    // no business rendering a web page (the embed card is for .md, KR-…).
    button.onclick = () => openExternal(link.url).catch(() => {});
    button.title = link.url;
    links.append(button);
  }

  getVersion()
    .then((version) => {
      about.querySelector(".home-version").textContent = `MD Plus ${version}`;
    })
    .catch(() => {});

  sheet.append(about);
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
