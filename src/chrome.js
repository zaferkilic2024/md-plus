// The strip around the tabs: contents, open, settings, and the ⋯ menu.
//
// The division is not cosmetic. ⋯ acts on the document you are standing in
// (save it, print it, transfer out of it, close it). Settings act on the app and
// outlive every document, so they get their own icon — burying them in a
// document menu would say they belong to the document, which they do not.
//
// Nothing here is a button in the web-app sense — no filled rectangles, no
// bordered boxes, no keyboard-shortcut pills. They are quiet icons that answer
// when hovered. Every action still has its shortcut; the strip only makes sure
// no action is reachable *only* by knowing one.

import { EditorView } from "@codemirror/view";
import { openSettings } from "./settings-panel.js";
import { goster } from "./shortcuts.js";
import { GLYPH } from "./strip.js";
import { documentJobs, jobName, jobShortcut, provider } from "./ai.js";
import { t } from "./i18n.js";

const icon = (paths, size = 15) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS = {
  contents: '<path d="M4 6h16M4 12h11M4 18h7"/>',
  // A marked passage among lines of prose: the block IS the mark. Not the
  // note bubble (that means "comment", and a markless comment cannot exist
  // here) and not the tapering lines (those are İçindekiler).
  marks: '<path d="M4 5.5h16"/><rect x="4" y="9.5" width="9.5" height="5" rx="1.5"/><path d="M17 12h3"/><path d="M4 18.5h16"/>',
  open: '<path d="M3 8.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7.2L10 4.6a1.6 1.6 0 0 0-1.3-.6H5a2 2 0 0 0-2 2z"/>',
  // Borrowed, not redrawn: the magnifier on the strip and the magnifier in the
  // search box are the same idea, so they are the same path. Two dictionaries
  // each holding their own copy is how we ended up with two speech bubbles.
  search: GLYPH.search,
  chevron: GLYPH.chevron,
  back: GLYPH.back, // borrowed: one arrow for "back the way you came"
  // Three sliders with knobs — the "adjust" icon. It reads as settings more
  // plainly than the old radial (which looked like a sun/brightness), and it
  // echoes the sliders the reading panel now uses.
  settings:
    '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  more: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
};

function tool(name, title, onClick) {
  const button = document.createElement("button");
  button.className = "tool";
  button.title = title;
  button.innerHTML = icon(ICONS[name], 17);
  button.onclick = onClick;
  return button;
}

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

  const box = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const EDGE = 6;
  menu.style.top = `${box.bottom + 4}px`;
  menu.style.left = `${Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE))}px`;

  // Not on this click — the one that opened it.
  setTimeout(() => {
    window.addEventListener("mousedown", onOutside, true);
    window.addEventListener("keydown", onEscape, true);
  });

  return menu;
}

/**
 * The Son açılanlar rows — one object, two homes (KR-58): under the strip's
 * chevron, and out in the open on the empty screen. Same rows, same grammar,
 * same order; only the box around them differs, so only the box is the caller's.
 *
 * `isOpen(path)` decides whether a row carries the tab silhouette. Not a word,
 * not a new colour, and not a dot — the dot means "unsaved" in the stack, and a
 * second meaning cannot be loaded onto it. The silhouette says, before you
 * click, "this one is already on screen; I'll take you there" (UC-20-K3).
 */
export function recentRows(container, entries, { onPick, isOpen = () => false, place }) {
  const heading = document.createElement("div");
  heading.className = "menu-heading";
  heading.textContent = t("recents.heading");
  container.append(heading);

  for (const entry of entries) {
    const row = document.createElement("button");
    row.className = "recent-row";
    // The one place the full path is written without being asked for.
    row.title = entry.path;

    const name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = entry.name;
    row.append(name);

    // The location on the right, if the caller asked for one (Zafer, 18 Tem).
    // The two homes differ on purpose: the empty screen shows the full folder
    // path (place returns it, CSS trims it from the LEFT), the strip's chevron
    // shows nothing — just names. A bare column of names read as a tower, but
    // only the empty screen has the width to cure it. No date, no size either.
    const where = place?.(entry);
    if (where) {
      const loc = document.createElement("span");
      loc.className = "recent-where";
      loc.textContent = where;
      row.append(loc);
    }

    if (isOpen(entry.path)) {
      const open = document.createElement("span");
      open.className = "recent-open";
      open.title = t("recents.openHint");
      open.innerHTML = icon(
        '<path d="M2 18.5h20"/><path d="M3.5 18.5v-5a1.8 1.8 0 0 1 1.8-1.8h7a1.8 1.8 0 0 1 1.8 1.8v5"/>',
        15,
      );
      row.append(open);
    }

    row.onclick = () => onPick(entry.path, row);
    container.append(row);
  }
}

/**
 * The row says why it is going, in its own place, and then goes (UC-20-K4).
 *
 * No curtain, no alert box, no "Tamam": the reader already spent a click and
 * does not owe a second one. No red either — nothing was deleted, something was
 * not found. The full path is written here because that is the only question
 * being asked: where did you think it was?
 */
export function sayMissing(row, path) {
  const gone = document.createElement("div");
  gone.className = "recent-missing";
  gone.innerHTML = `<div class="recent-missing-line">${t("recents.missing")}</div><div class="recent-missing-path"></div>`;
  gone.querySelector(".recent-missing-path").textContent = path;
  row.replaceWith(gone);
  setTimeout(() => gone.remove(), 1400);
}

/** The headings of a document, in order, with their level. */
function outlineOf(text) {
  const headings = [];
  const lines = text.split("\n");
  let inCode = false;

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (inCode) return;
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, title: match[2].trim(), line: index });
    }
  });
  return headings;
}

export function createChrome({ onCommand, activeTab, onSearch, onBack }) {
  const left = document.createElement("div");
  left.className = "strip-left";

  // The way back along a followed link (18 Tem). It stands at the head of the
  // strip and STAYS there, going pale when there is nowhere to go back to
  // (29 Tem, Zafer: "ok çıkması güzel oluyor ama tablar kayıyor").
  //
  // It was born-and-gone at first, on the recents chevron's rule that absence is
  // absence. That rule is right for a chevron, which nothing lines up against,
  // and wrong here: coming and going shifted every tab sideways under the hand
  // that was reaching for one. KR-64 settled the same argument for İçindekiler
  // and İşaretler, for the same reason, and this is the third case of it.
  const back = tool("back", t("menu.back"), () => onBack());
  back.disabled = true;
  left.append(back);

  const contents = tool("contents", t("menu.contents"), () => {
    const tab = activeTab();
    // A PDF has an outline of its own kind and this is not it (Faz 2). The tool
    // is already greyed for it; this is the door staying shut.
    if (!tab?.view) return;

    const headings = outlineOf(tab.view.state.doc.toString());
    const menu = popover(contents, []);
    if (!menu) return; // a second click on İçindekiler toggled it shut
    menu.classList.add("outline");

    if (headings.length === 0) {
      const none = document.createElement("p");
      none.className = "outline-empty";
      none.textContent = t("menu.noHeadings");
      menu.append(none);
      return;
    }

    for (const heading of headings) {
      const entry = document.createElement("button");
      entry.className = `outline-${heading.level}`;
      entry.textContent = heading.title;
      entry.onclick = () => {
        const view = tab.view;
        const line = view.state.doc.line(heading.line + 1);

        // `y: "start"` puts the heading at the top of the screen, where the text
        // you came to read follows it. CodeMirror's default is "nearest", which
        // parks it on the bottom edge with everything below it hidden.
        //
        // The jump is instant, and it stays instant. Gliding there was tried
        // three ways and none of them held: CodeMirror scrolls to an estimate,
        // measures, then corrects itself — that second write to scrollTop kills
        // any animation in progress. Computing the offset ourselves to avoid the
        // second write is worse: an undrawn line only has an estimated height, so
        // it lands near the heading rather than on it. Correct beats pretty.
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 12 }),
        });
        view.focus();

        menu.close();
      };
      menu.append(entry);
    }
  });
  // Passive until the document has a heading, active once it does (Zafer, 18
  // Tem) — İşaretler' twin on the other side: a fixed anchor that greys instead
  // of vanishing, so the strip never shoves the tabs. updateContentsTool below
  // flips it, on tab switches and on every edit that could add or drop a heading.
  contents.disabled = true;
  left.append(contents);

  // The marks of the open document, as a list — İçindekiler's twin (18 Tem):
  // headings are the document's own outline, marks are the reader's. Rows show
  // the marked text's first words (a comment carries the bubble); a click
  // travels there, the same deeper shade Aktarma uses saying "you are here".
  //
  // ALWAYS on the strip, PASSIVE when the document has no marks (Zafer, 18 Tem) —
  // not hidden. A tool that appears and vanishes as marks come and go shoves the
  // tabs sideways under the reader's hand; a fixed, greyed anchor holds the row
  // still. (İçindekiler sits to its left and never moves either.)
  const marksTool = tool("marks", t("menu.marks"), () => {
    const tab = activeTab();
    if (!tab?.marks) return;

    // Two kinds of document, one list — and one question: `listing()`. Each
    // store knows where its own words come from (a CodeMirror state; a page's
    // text, or the anchor itself while that page is still undrawn). Asking
    // `list()` here used to hide a PDF's marks until their page happened to be
    // on screen, which greyed the tool on a document that plainly had marks.
    const menu = popover(
      marksTool,
      tab.marks.listing().map(({ record, text }) => ({
        icon: record.yorum ? "note" : undefined,
        label: snippetOf(text),
        run: () => tab.marks.travelTo(record.id),
      })),
    );
    if (!menu) return; // second click toggled it shut
    menu.classList.add("marklist");
  });
  marksTool.disabled = true;
  left.append(marksTool);

  /** The strip redraws this itself: on tab switches and whenever a mark is
      made, removed or loaded (marks.js/onCount). Greyed, not hidden — the row
      must not shift. */
  const updateMarksTool = () => {
    marksTool.disabled = !activeTab()?.marks?.listing().length;
  };

  /** İçindekiler greys when the document carries no heading. Called on tab
      switches (renderTabs) and on every edit (main.js/onChange): a heading can
      appear the moment "# " is typed. outlineOf is a light line scan, the same
      cost the decoration plugins already pay on docChanged. */
  const updateContentsTool = () => {
    const tab = activeTab();
    contents.disabled = !tab?.view || outlineOf(tab.view.state.doc.toString()).length === 0;
  };

  const setCanGoBack = (can) => {
    back.disabled = !can;
  };

  // The document-acting tools, hidden on the opening screen where there is no
  // document under them. İçindekiler and the marks list are on the left; search
  // and ⋯ on the right (built below). Ayarlar is NOT among them — it acts on the
  // app and outlives every document. The marks list is not hidden here either:
  // it stays put and only greys (updateMarksTool), and the whole strip is gone
  // on the opening screen anyway.
  const setHasDocument = (has) => {
    contents.hidden = !has;
    search.hidden = !has;
    more.hidden = !has;
  };

  // The far right of the strip: nothing here has any business with the tabs,
  // which is why it sits on the other side of the second separator. "Belge aç"
  // is no longer among them — it makes tabs, so it moved to the strip's tail.
  const right = document.createElement("div");
  right.className = "strip-right";

  // Ctrl+F used to be the only way in. An action reachable only by knowing its
  // shortcut is an action most people do not have.
  const search = tool("search", t("menu.search"), onSearch);

  // Settings belong to the app, not to a document — so they are not hidden in
  // the ⋯ menu, which is entirely about the document you are standing in.
  const settings = tool("settings", t("menu.settings"), () => openSettings(settings));

  // ⋯ acts on this document, and only on this document.
  const more = tool("more", t("menu.docMenu"), () => {
    const tab = activeTab();

    // A PDF is read, not written (KR-68), so almost nothing in the menu below
    // means anything for it. It gets the entries that do — which today is one.
    // Not a menu of greyed-out rows: the app is exactly as large as what it can
    // do here (KR-42's rule, applied to a document kind instead of to a model).
    if (tab?.kind === "pdf") {
      popover(more, [
        // Aktarma is open to a PDF as of 28 Tem: it goes in on the left, to be
        // read, while a document is written on the right. It cannot be a target
        // — nothing is ever written into a PDF (KR-68).
        {
          icon: "transfer",
          label: t("menu.transfer"),
          key: "Ctrl+Shift+A",
          run: () => onCommand("transfer"),
        },
        "-",
        { icon: "close", label: t("menu.closeTab"), key: "Ctrl+W", run: () => onCommand("close") },
      ]);
      return;
    }

    // The document-wide AI jobs. Note what this is NOT: a greyed-out entry. With
    // no model routed to it, "Özet" is not in the menu at all — the app is
    // exactly v1 when the AI is off (KR-42), here as everywhere.
    const yzIsleri = documentJobs()
      .filter((job) => provider(job))
      .map((job) => ({
        // Keyed by job id, so a job without a drawing of its own simply has no
        // icon rather than borrowing someone else's. Today: summarize.
        icon: GLYPH[job] ? job : undefined,
        label: jobName(job),
        key: jobShortcut(job) ? goster(jobShortcut(job)) : undefined,
        run: () => onCommand(job),
        disabled: !tab,
      }));

    popover(more, [
      { icon: "save", label: t("menu.save"), key: "Ctrl+S", run: () => onCommand("save"), disabled: !tab },
      {
        icon: "saveAs",
        label: t("menu.saveAs"),
        key: "Ctrl+Shift+S",
        run: () => onCommand("saveAs"),
        disabled: !tab,
      },
      { icon: "rename", label: t("menu.rename"), run: () => onCommand("rename"), disabled: !tab },
      "-",
      // Two different acts, so two entries. "PDF'e bas" was the wrong word for
      // both of them: nothing is pressed onto anything — a file is written to
      // disk. Printing is the one that puts ink on paper.
      { icon: "printer", label: t("menu.print"), key: "Ctrl+P", run: () => onCommand("printPaper"), disabled: !tab },
      { icon: "sheet", label: t("menu.savePdf"), key: "Ctrl+Shift+P", run: () => onCommand("print"), disabled: !tab },
      // It used to be off with no marks (B-17): back then the screen could only
      // travel and send, so it would have opened onto its own pointlessness.
      // KR-71 gave it the marking palette back, and an unmarked document is now
      // the ordinary reason to go in — you mark while reading the two side by
      // side. A document is all it needs (28 Tem, Zafer).
      {
        icon: "transfer",
        label: t("menu.transfer"),
        key: "Ctrl+Shift+A",
        run: () => onCommand("transfer"),
        disabled: !tab,
      },
      ...(yzIsleri.length ? ["-", ...yzIsleri] : []),
      "-",
      // The same ✕ that closes a card, dismisses a suggestion and drops a tab
      // from the stack. One gesture, one glyph.
      { icon: "close", label: t("menu.closeTab"), key: "Ctrl+W", run: () => onCommand("close"), disabled: !tab },
    ]);
  });

  right.append(search, more, settings);
  return { left, right, updateMarksTool, updateContentsTool, setCanGoBack, setHasDocument };
}

/**
 * A mark's first words, fit for a one-line menu row: the words, not their
 * syntax — `**` and `[](…)` in a menu are noise, the row is a signpost, not a
 * source view (Zafer, 18 Tem). Display only; the document is never touched.
 * Escaped at the end, because popover rows are built with innerHTML and this
 * is DOCUMENT text — the one caller whose label the writer types.
 */
function snippetOf(text) {
  const plain = text
    // Block markers at line starts: headings, quotes, list bullets.
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    // An image reads as its alt text, a link as its text.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/\*+/g, "")
    // Underscores only at word edges (emphasis) — the ones inside
    // dosya_adi.md are spelling, not syntax.
    .replace(/(^|\s)_+/g, "$1")
    .replace(/_+(\s|$)/g, "$1");

  const flat = plain.replace(/\s+/g, " ").trim();
  const cut = flat.length > 48 ? `${flat.slice(0, 48)}…` : flat;
  return cut.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
