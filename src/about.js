// What the app is: the cards, the language line, and the open-source footer.
//
// Its own module because TWO screens are made of it (Zafer, 6 Aug): the about
// page, and the opening screen. Not a copy in each — the same block, so the
// screen someone meets on first run and the screen they can open three weeks
// later cannot drift apart. `home.js` imports it and `empty.js` imports it;
// putting it in either of those would have made them import each other.

import { open as openExternal } from "@tauri-apps/plugin-shell";
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
 * What the app can do: five columns, one line of text each.
 *
 * Boxes were tried first and were the wrong shape — five cards is five frames
 * to read past, and the screen stopped fitting in a window. Without them the
 * same five things are one band across the page, and each one is short enough
 * to take in without reading. The sentences are that short on purpose: this is
 * a screen someone glances at, not a manual.
 *
 */
/**
 * The five drawings on the welcome band.
 *
 * These are NOT the app's icon vocabulary (strip.js/GLYPH) and are not meant to
 * be: those are controls, one stroke weight and one colour, and they live on
 * things you press. These are illustrations on the one screen that has nothing
 * to press — drawn from the reference exactly, two-tone, with the colours
 * measured off it rather than guessed: line #B2BCC8, navy #1E4272, gold
 * #F3DDA8. They appear here and nowhere else, which is the whole reason a
 * second palette is allowed to exist.
 */
const LINE = "#B2BCC8";
const NAVY = "#1E4272";
const GOLD = "#F3DDA8";

const art = (inner) =>
  `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ART = {
  write: art(
    `<path d="M4 6h16M4 10.5h16M4 15h10" stroke="${LINE}" stroke-width="1.7"/>` +
      `<path d="M4 19.5h7" stroke="${NAVY}" stroke-width="2.6"/>`,
  ),
  read: art(
    `<path d="M3 6h13M3 10.5h8M3 15h6" stroke="${LINE}" stroke-width="1.7"/>` +
      `<circle cx="15.6" cy="14.6" r="4.7" stroke="${LINE}" stroke-width="1.7"/>` +
      `<path d="M19.1 18.1L21.8 20.8" stroke="${NAVY}" stroke-width="2"/>`,
  ),
  mark: art(
    `<path d="M4 6h16M4 15h13M4 19.5h8" stroke="${LINE}" stroke-width="1.7"/>` +
      `<path d="M5 10.6h8.5" stroke="${GOLD}" stroke-width="4.2"/>`,
  ),
  ai: art(
    `<path d="M3 7h10M3 11.5h7M3 16h9" stroke="${LINE}" stroke-width="1.7"/>` +
      `<path d="M17.6 3.6l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z" fill="${GOLD}"/>` +
      `<path d="M15.4 13.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" fill="${GOLD}"/>`,
  ),
  transfer: art(
    `<rect x="2.4" y="5.4" width="7.2" height="13.2" rx="1.5" stroke="${LINE}" stroke-width="1.7"/>` +
      `<rect x="14.4" y="5.4" width="7.2" height="13.2" rx="1.5" stroke="${LINE}" stroke-width="1.7"/>` +
      `<path d="M10.4 12h3.2M12.2 10.2l1.8 1.8-1.8 1.8" stroke="${NAVY}" stroke-width="1.8"/>`,
  ),
};

const CARDS = [
  { title: "home.card.write", body: "home.can1", art: ART.write },
  { title: "home.card.read", body: "home.can2", art: ART.read },
  { title: "home.card.mark", body: "home.can3", art: ART.mark },
  { title: "home.card.ai", body: "home.can5", art: ART.ai },
  { title: "home.card.transfer", body: "home.can4", art: ART.transfer },
];

/** The state, at the end of the promise rather than beside the title: a pill
    next to a heading competes with it, and this word is a footnote to the
    sentence, not a second title. The window corner says it too — there it is a
    label on the app, here it is part of what the page is saying. */
export function betaBadge() {
  const badge = document.createElement("span");
  badge.className = "home-beta";
  badge.textContent = "beta";
  return badge;
}

/**
 * The block itself. Returns a fragment so the caller decides what it sits in.
 */
export function createAboutBlock() {
  const parts = document.createDocumentFragment();

  // One card per thing a reader asks "can it…?" about. It was a bullet list;
  // the titles are what make it skimmable by someone hunting for one answer.
  const cards = document.createElement("div");
  cards.className = "home-cards";
  for (const card of CARDS) {
    const box = document.createElement("div");
    box.className = "home-card";
    box.innerHTML =
      `<div class="home-card-icon">${card.art}</div>` +
      `<h3>${t(card.title)}</h3><p>${t(card.body)}</p>`;
    cards.append(box);
  }
  parts.append(cards);

  // One footer line: what language it speaks, that it is open, and the three
  // doors. Each of these was its own paragraph and each was one short fact —
  // stacked, they took a third of the screen to say almost nothing.
  const about = document.createElement("div");
  about.className = "home-about";
  about.innerHTML = `
    <div class="home-rule"></div>
    <div class="home-links"></div>
    <p class="home-vibe"><span>${t("home.vibe")}</span></p>`;

  const links = about.querySelector(".home-links");
  // Two statements before the three doors: what it speaks, and what it is.
  // Fainter than the doors, because you read them once and never again.
  for (const [glyph, key] of [
    [GLYPH.globe, "home.card.lang"],
    [GLYPH.heart, "home.openSource"],
  ]) {
    const note = document.createElement("span");
    note.className = "home-foot-note";
    note.innerHTML = `${icon(glyph, 14)}<span>${t(key)}</span>`;
    links.append(note);
  }

  for (const link of LINKS) {
    const button = document.createElement("button");
    button.className = "home-link";
    button.innerHTML = `${icon(link.glyph, 15)}<span>${t(link.key)}</span>`;
    // Opened in the reader's browser, not in here: this app is offline and has
    // no business rendering a web page.
    button.onclick = () => openExternal(link.url).catch(() => {});
    button.title = link.url;
    links.append(button);
  }

  parts.append(about);
  return parts;
}
