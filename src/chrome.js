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
import { fileNameOf } from "./paths.js";
import { documentJobs, jobName, jobShortcut, provider } from "./ai.js";
import { t } from "./i18n.js";
import { icon, popover } from "./popover.js";

// Re-exported: callers have always asked chrome for the menu, and where it is
// defined is not their business.
export { popover };


export const ICONS = {
  contents: '<path d="M4 6h16M4 12h11M4 18h7"/>',
  // Borrowed, not redrawn — it lives in GLYPH now, because the menu builder
  // reads that dictionary and only that one. (A marked passage among lines of
  // prose: the block IS the mark. Not the note bubble, which means "comment",
  // and not the tapering lines, which are İçindekiler.)
  marks: GLYPH.marks,
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
  about: GLYPH.about, // borrowed: one drawing, one meaning
};

function tool(name, title, onClick) {
  const button = document.createElement("button");
  button.className = "tool";
  button.title = title;
  button.innerHTML = icon(ICONS[name], 19);
  button.onclick = onClick;
  return button;
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

/**
 * `withBack: false` builds the same left-hand group without the way back — for
 * Aktarma's target panel, which has İçindekiler and İşaretler of its own (there
 * is a document in it) but no journey to return from. Everything else about the
 * group is identical, because it is the same group.
 */
export function createChrome({
  onCommand,
  activeTab,
  onBack,
  onFollowTarget,
  withBack = true,
}) {
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
  if (withBack) left.append(back);

  const contents = tool("contents", t("menu.contents"), () => {
    const tab = activeTab();
    if (!tab) return;

    // A PDF answers the same question with what it has: its own outline where
    // the file carries one, its pages where it does not. One icon, one question
    // — "what is in here, take me there" — and two kinds of answer, because the
    // two kinds of document are structured differently, not because they are
    // two different tools (2 Ağu, Zafer).
    if (tab.kind === "pdf") {
      if (!tab.pdf) return;
      const rows = tab.pdf.contents();
      const menu = popover(contents, []);
      if (!menu) return;
      menu.classList.add("outline");

      // With no outline of its own the list is the pages themselves, and a
      // column of "Sayfa 1 · Sayfa 2" is a list of numbers, not of contents
      // (Zafer, 2 Ağu: "güdük oldu"). So each row carries the page, small.
      // Rendered only as it comes into view — a 400-page book would otherwise
      // draw 400 pictures to answer one question.
      const pictures = !rows[0]?.title;
      const watcher = pictures
        ? new IntersectionObserver(
            (entries, self) => {
              for (const seen of entries) {
                if (!seen.isIntersecting) continue;
                self.unobserve(seen.target);
                const page = Number(seen.target.dataset.page);
                tab.pdf.thumbnail(page).then((canvas) => {
                  if (canvas) seen.target.querySelector(".page-shot")?.replaceChildren(canvas);
                });
              }
            },
            { root: menu, rootMargin: "120px" },
          )
        : null;

      for (const row of rows) {
        const entry = document.createElement("button");
        entry.className = pictures ? "outline-page" : `outline-${row.level}`;
        entry.dataset.page = String(row.page);
        if (pictures) {
          const shot = document.createElement("div");
          shot.className = "page-shot";
          const label = document.createElement("span");
          label.textContent = t("menu.pdfPage", { n: row.page });
          entry.append(shot, label);
        } else {
          entry.textContent = row.title;
        }
        entry.onclick = () => {
          // The place, not just the page: an outline entry points at a heading
          // partway down its page, and stopping at the top of that page reads as
          // the contents having taken you somewhere else.
          tab.pdf.goTo(row.page, { y: row.y });
          menu.close();
        };
        menu.append(entry);
        watcher?.observe(entry);
      }

      // Open ON where the reader is. A contents list that always starts at page
      // one asks them to find themselves in it first — and in a 400-page book
      // that is a scroll, not a glance. With an outline it is the last entry at
      // or before this page: the section you are inside, not the next one down.
      const here = tab.pdf.page;
      let mark = null;
      for (const entry of menu.querySelectorAll("[data-page]")) {
        if (Number(entry.dataset.page) <= here) mark = entry;
        else break;
      }
      mark?.classList.add("current");
      // After the menu is placed, or the scroll happens in a box that is not
      // where it will end up.
      requestAnimationFrame(() => mark?.scrollIntoView({ block: "center" }));
      return;
    }

    if (!tab.view) return;
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
    // Where a mark WENT, beside what it says (3 Ağu). The record has carried
    // this since the first sidecar was written — `aktarma.hedefBelge`, the
    // document a piece was moved into — and until now nothing showed it. So the
    // question "which passages did I take out of this source, and where did
    // they land?" had no answer anywhere in the app, while the answer sat in a
    // file next to the document.
    //
    // No new screen, no new record, no new store: a second word on a row that
    // was already there. Reading it left to right gives the whole sentence —
    // the passage, then the document it became part of.
    const menu = popover(
      marksTool,
      tab.marks.listing().map(({ record, text }) => {
        const hedef = record.aktarma?.hedefBelge;
        return {
          icon: record.yorum ? "note" : undefined,
          label: snippetOf(text),
          run: () => tab.marks.travelTo(record.id),
          // The file name alone on the row; the whole path waits in the tooltip.
          // A relative path ("notlar/2026/denge.md") would push the passage off
          // its own row, and the passage is what the row is about.
          trail: hedef ? fileNameOf(hedef) : undefined,
          trailTitle: hedef,
          trailRun: () => onFollowTarget?.(hedef, null),
        };
      }),
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
    // A PDF always has something to list — at worst its pages — so the tool is
    // live the moment one is open.
    if (tab?.kind === "pdf") {
      contents.disabled = !tab.pdf;
      return;
    }
    contents.disabled = !tab?.view || outlineOf(tab.view.state.doc.toString()).length === 0;
  };

  const setCanGoBack = (can) => {
    back.disabled = !can;
  };

  // Kept for the language rebuild, but the opening screen no longer needs it:
  // the document row is removed whole when there is no document (main.js), so
  // there is nothing left to hide one icon at a time.
  const setHasDocument = () => {};

  // The right-hand end of the DOCUMENT row. Everything here acts on the
  // document in front of you; settings left this group entirely (below), for
  // the row above — the one that belongs to the app.
  const right = document.createElement("div");
  right.className = "strip-right";

  // No search icon here any more: the box itself stands in this row (search.js),
  // which is the shorter way of saying the same thing — you do not click to be
  // given a place to type, you type.

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

  right.append(more);

  // Settings belongs to the app, so it rides in the app's row — beside the
  // window's own controls, above the tabs. It is the one icon that means the
  // same thing with no document open, which is exactly why it cannot live in a
  // row that disappears with the document.
  // The app's page rides beside the app's MARK, at the far left — not beside
  // Settings, where the two of them crowded each other and the window controls.
  // main.js puts it there; this only builds it.
  const about = tool("about", t("home.title"), () => onCommand("home"));

  const appTools = document.createElement("div");
  appTools.className = "app-tools";
  appTools.append(settings);

  return {
    left,
    right,
    appTools,
    about,
    updateMarksTool,
    updateContentsTool,
    setCanGoBack,
    setHasDocument,
  };
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
