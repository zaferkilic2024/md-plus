// The app's one small menu, and the glyph helper it shares.
//
// It lived in chrome.js, which is fine until something outside the strip wants
// a menu: search.js does now (the scope picker), and importing chrome.js pulls
// in ai.js behind it — whose `import.meta.glob` is a Vite-only form that throws
// the moment a Node test touches the chain. A menu is not the tab strip's
// property; it is a shape the whole app uses (chrome, right-click, search).

import { GLYPH } from "./strip.js";
import { t } from "./i18n.js";

export const icon = (paths, size = 15) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

// The open popover per anchor, so a second click on the same control toggles it
// shut instead of stacking a second menu on top of the first.
const openMenus = new Map();

/**
 * A small menu anchored under the control that opened it — never a panel across
 * the screen. Closes on the next click anywhere, and a second click on the
 * control that opened it closes it too (toggle).
 */
export function popover(anchor, items) {
  // Already open for this control? This click is the "close" half of the toggle.
  const acik = openMenus.get(anchor);
  if (acik) {
    acik();
    return null;
  }

  const menu = document.createElement("div");
  menu.className = "popover";

  for (const item of items) {
    if (item === "-") {
      menu.append(document.createElement("hr"));
      continue;
    }
    // A caption over a group of rows — what the rows below are answers to
    // ("Çevir", then the two directions). Not clickable, so not a button.
    if (item.heading) {
      const heading = document.createElement("div");
      heading.className = "menu-heading";
      heading.textContent = item.heading;
      if (item.key) heading.append(Object.assign(document.createElement("kbd"), { textContent: item.key }));
      menu.append(heading);
      continue;
    }
    const entry = document.createElement("button");
    // An <i>, not a <span>: the rule below that ellipsises a long file name is
    // `.popover button > span`, and it would squeeze the glyph to nothing.
    entry.innerHTML =
      (item.icon ? `<i class="popover-icon">${icon(GLYPH[item.icon])}</i>` : "") +
      `<span class="popover-label">${item.label}</span>` +
      (item.dirty ? `<i class="popover-dot" title="${t("tab.unsaved")}"></i>` : "") +
      (item.key ? `<kbd>${item.key}</kbd>` : "");
    entry.disabled = Boolean(item.disabled);
    entry.classList.toggle("current", Boolean(item.active));
    entry.classList.toggle("muted", Boolean(item.muted));
    entry.onclick = () => {
      close();
      item.run();
    };

    // An item can carry its own ✕ (the tab stack uses it: a tab scrolled out of
    // sight has no reachable close button of its own).
    if (!item.drop) {
      menu.append(entry);
      continue;
    }

    const row = document.createElement("div");
    row.className = "popover-row";

    const drop = document.createElement("button");
    drop.className = "popover-drop";
    drop.innerHTML = icon('<path d="M18 6L6 18M6 6l12 12"/>', 13);
    drop.title = t("menu.close");
    drop.onclick = (event) => {
      event.stopPropagation();
      close();
      item.drop();
    };

    row.append(entry, drop);
    menu.append(row);
  }

  function close() {
    menu.remove();
    openMenus.delete(anchor);
    window.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("keydown", onEscape, true);
  }
  function onOutside(event) {
    // Ignore the anchor itself: its own click toggles the menu shut. Without
    // this, the mousedown closed it and the click immediately reopened it.
    if (menu.contains(event.target) || anchor.contains(event.target)) return;
    close();
  }
  function onEscape(event) {
    if (event.key === "Escape") close();
  }

  // Callers that dismiss the menu on their own (the outline navigates and goes)
  // use this, so the toggle bookkeeping stays correct.
  menu.close = close;
  openMenus.set(anchor, close);

  // Position AFTER appending, and from the menu's measured width — not from a
  // number typed in by hand. The clamp used to be `innerWidth - 240`, written
  // when the menu was about that wide; the box later grew to 300 and the number
  // stayed behind, so a menu opened near the right edge (the tab stack lives at
  // the far right, exactly where this bites) hung 60px off the window and took
  // each row's ✕ with it. Measure the thing you are placing.
  document.body.append(menu);

  const EDGE = 6;
  /**
   * Places the menu against its anchor, from its MEASURED width.
   *
   * Exposed, because some callers open the menu empty and fill it afterwards
   * (the recents list, the outline): measured while empty, the width is the
   * min-width, and a menu that then grows past it hangs off the right of the
   * window. Those callers call this again when they are done.
   */
  const place = () => {
    // Never wider than the window it has to fit in — the clamp below can only
    // choose a left edge, it cannot make a 300px menu fit in 200px.
    menu.style.maxWidth = `${window.innerWidth - EDGE * 2}px`;
    const box = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    menu.style.top = `${box.bottom + 4}px`;
    menu.style.left = `${Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE))}px`;
  };
  menu.place = place;
  place();

  // Not on this click — the one that opened it.
  setTimeout(() => {
    window.addEventListener("mousedown", onOutside, true);
    window.addEventListener("keydown", onEscape, true);
  });

  return menu;
}

