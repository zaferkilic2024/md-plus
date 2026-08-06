import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { createSurface, scrollToAnchor, suggestion, topLineText } from "./surface.js";
import { documentJobs, jobOptions, provider, refreshCliAvailability } from "./ai.js";
import { MarkStore } from "./marks.js";
import {
  createPdfSearch,
  inertSearchBox,
  openReplace,
  openSearch,
  searchBoxOf,
  setSearchInert,
} from "./search.js";
import { askChoice, askText } from "./confirm.js";
import { readSession, writeSession } from "./session.js";
import { insertLink } from "./commands.js";
import {
  adoptDraftImages,
  documentExists,
  draftFolderSync,
  fileNameOf,
  folderOf,
  importImage,
  initDraftFolder,
  pastedImageName,
  readBytes,
  readDocument,
  relativePath,
  renameDocument,
  resolveAgainst,
  samePath,
  titleOf,
  writeDocument,
} from "./storage.js";
import { signatureOf } from "./workshop-index.js";
import { movedTo, pageOfFragment, slugify, splitTarget } from "./citation.js";
import { openContextMenu } from "./context-menu.js";
import { passageMarkdown } from "./pdf-text.js";
import { createPdfSurface, isPdfPath } from "./pdf.js";
import { PdfMarkStore } from "./pdf-marks.js";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Transfer } from "./transfer.js";
import { printDocument, printPaper } from "./print.js";
import { createEmptyState, sayNotMarkdown } from "./empty.js";
import { createChrome, popover, recentRows, sayMissing, ICONS } from "./chrome.js";
import { createWindowControls, dragRegion, wireResizeEdges } from "./window-frame.js";
import { createDocTools, isEmptyDoc } from "./doc-tools.js";
import { createDocInfo, statsOf } from "./doc-info.js";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { attachToTop } from "./to-top.js";
import { createHome } from "./home.js";
import brandIcon from "../src-tauri/icons/128x128.png";
import { clearExcept, forget, remember, renamePath, rows } from "./recents.js";
import { effectiveLang, loadSettings } from "./settings.js";
import { setLang, t } from "./i18n.js";
import { relocalizePalettes, togglePalette } from "./palette.js";
import { relocalizeSearch } from "./search.js";

// The window's row (the title bar we draw ourselves) and, under it, the row
// that belongs to whichever document is open.
const tabsEl = document.getElementById("window-row");
const docRowEl = document.getElementById("doc-row");
const bodyEl = document.getElementById("body");

const statusEl = document.getElementById("status");

/**
 * The frame does not scroll. Ever (29 Tem, Zafer: "sekme kaymamalı hiçbir
 * şekilde").
 *
 * The strip and the status line are the window's frame, not the top and bottom
 * of a page — but the browser does not know that, and `EditorView.scrollIntoView`
 * does not stop at the editor's own scroller: it walks UP and scrolls every
 * ancestor that can be scrolled, so that the editor ends up visible on the page.
 * Let the document be a hair taller than the window and the whole frame slides
 * up with the text, tab strip and all, "sanki sayfanın bir parçasıymış gibi".
 *
 * `overflow: hidden` does not settle it — a hidden overflow is still a scroll
 * container, and scrollIntoView scrolls it just the same. So the frame is pinned
 * back the moment anything moves it. (It was always so; it only became visible
 * when "back" started finding its line every time — before, a blank anchor
 * scrolled nothing, and the bug had nothing to ride in on.)
 */
addEventListener(
  "scroll",
  (event) => {
    // Capture, because a scroll event does not bubble: this is the only way to
    // hear the one .body might take. Only the two frame boxes are pinned —
    // every real scroller (the editor's, a PDF's) is left alone.
    const root = document.scrollingElement ?? document.documentElement;
    for (const frame of [root, bodyEl]) {
      if (event.target !== frame && event.target !== document) continue;
      if (frame.scrollTop) frame.scrollTop = 0;
      if (frame.scrollLeft) frame.scrollLeft = 0;
    }
  },
  true,
);

// KR-23: autosave 2 s after the user stops typing. Configurable here, never in
// the UI.
const AUTOSAVE_MS = 2000;

/**
 * @typedef {{
 *   path: string | null,   // null until the document has been saved once
 *   title: string,
 *   kind: "md" | "pdf",
 *   host: HTMLDivElement,  // wrapper we may hide; see renderBody
 *   view: import("@codemirror/view").EditorView | null,  // null on a PDF tab
 *   pdf: import("./pdf.js").PdfSurface | null,
 *   dirty: boolean,
 *   saving: boolean,
 *   timer: number | null,
 * }} Tab
 */
/** @type {Tab[]} */
const tabs = [];
let activeIndex = -1;
let nextTabId = 1;

// The last ten documents opened (KR-58). Full paths, newest first; the rules
// that move them live in recents.js, the disk in session.js.
/** @type {string[]} */
let recents = [];

const activeTab = () => tabs[activeIndex] ?? null;

/**
 * A PDF is read, never written (KR-68). Everything downstream of this — saving,
 * printing, the format palette, the AI jobs, Aktarma's target side — is a door
 * that must be closed rather than stubbed: a PDF tab has `view: null` on
 * purpose, so a forgotten path fails loudly here instead of writing something
 * into a file that cannot take it.
 */
const isPdfTab = (tab) => tab?.kind === "pdf";

/**
 * Moves a tab to its final position and keeps the same document active.
 *
 * `to` is where the tab now STANDS (the DOM already reflowed during the drag,
 * B-16), counted after removal — not a gap index measured beforehand.
 *
 * activeIndex is a position, and positions shift when the array is spliced — so
 * we follow the active TAB, not its index: grab the object, move things, then
 * ask where that object landed. The reordering is saved like any other session
 * change (UC-02), so the order the writer arranged comes back on restart.
 */
function reorderTabs(from, to) {
  if (to === from) return; // the drag went out and came home; the DOM matches
  const stayActive = tabs[activeIndex];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  activeIndex = Math.max(0, tabs.indexOf(stayActive));
  render();
  saveSession();
}

function render() {
  renderTabs();
  renderBody();
  renderStatus();
}

// The strip: contents on the left; search, ⋯ and settings on the right. "Belge
// aç" is not here — it makes tabs, so it sits in the strip's tail beside "+"
// (see renderTabs). No action lives only in a shortcut.
const chromeDeps = {
  // In Aktarma this group belongs to the LEFT panel, so it must answer about the
  // source — not about whichever tab happens to be active. Opening a target
  // opens it as a tab and activates it, so `activeTab()` in here was the target:
  // the source panel's İçindekiler and İşaretler were listing the other
  // document, and picking from that list moved the right-hand panel.
  activeTab: () => (transfer.open ? transfer.source : activeTab()),
  // One arrow, two exits — and they are the same sentence: leave where you went
  // and come back. Inside Aktarma it leaves the screen; in the tabs it walks the
  // link stack back (KR-82).
  onBack: () => (transfer.open ? transfer.close() : goBack()),
  onSearch: () => {
    const tab = searchTarget();
    if (tab?.view) openSearch(tab.view);
    else tab?.search?.open();
  },
  // A mark's target, from the marks list. The same door a link goes through —
  // because that is what this is: the record kept when the piece was moved
  // names a document, and following it is following a link. The way back is
  // written on the way out, so Alt+← returns to the mark.
  onFollowTarget: (path, at) => {
    const tab = transfer.open ? transfer.source : activeTab();
    if (tab && path) followLink(tab, path, at);
  },
  onDocInfo: (anchor) => showDocInfo(anchor),
  onCommand: (command) => {
    // Home is the app's, not the document's: it opens with nothing open, which
    // is the case it is most needed in.
    if (command === "home") return toggleHome();
    const tab = activeTab();
    if (!tab) return;
    if (command === "close") return closeTab(activeIndex);
    // Aktarma takes a PDF on its left-hand side (28 Tem): it is a reading panel,
    // and reading is what a PDF is for.
    if (command === "transfer") return openTransfer();
    // Everything below writes, prints or asks a model about the text — none of
    // which a PDF has (KR-68).
    if (isPdfTab(tab)) return;
    if (command === "save") saveTab(tab);
    else if (command === "saveAs") saveTab(tab, { askForPath: true });
    else if (command === "rename") renameCurrent(tab);
    else if (command === "print") printCurrent();
    else if (command === "printPaper") printPaperCurrent();
    // A document-wide AI job ("Özet"). The card opens in the middle of the
    // screen like every other report — and like every other report, it can be
    // read and copied but never accepted into the document (KR-49).
    else if (documentJobs().includes(command)) {
      suggestion.run(tab.view, command, { source: tab.view.state.doc.toString() });
    }
  },
};

// The strip is built once, but a language change has to rebuild it (its icons'
// tooltips are set at creation). So it is `let`, and applyLanguage swaps it.
let chrome = createChrome(chromeDeps);

// Aktarma's right-hand panel holds a document too, so it gets the same two
// tools — its own İçindekiler and its own İşaretler, answering about the target
// rather than the source. A second instance, not a second implementation.
// No back arrow: the way out belongs to the screen, and it is on the left.
let targetChrome = createChrome({
  activeTab: () => (transfer.open ? transfer.target : null),
  onCommand: () => {},
  onBack: () => {},
  withBack: false,
});

// Built once and re-used across renders: the middle button listens for the
// window's own resize events, and rebuilding it every render would stack a new
// listener each time. Only a language change replaces it (applyLanguage).
let windowControls = createWindowControls();
wireResizeEdges();

// The document row's middle: what THIS kind of document can do. Rebuilt on
// every render (the kind can change with the tab), but kept as one object so
// the page counter can be nudged without rebuilding the row on every scroll.
let docTools = createDocTools({
  activeTab,
  onCommand: (command) => chromeDeps.onCommand(command),
});

/**
 * A language change (Settings) reaches every corner of a shell that was built
 * once. render() covers the empty screen, the tab strip and the status line; the
 * pieces that live longer than a render — the chrome strip, and each surface's
 * palette and search box — are rebuilt or re-labelled here. No reload, so an
 * unsaved draft survives the switch.
 */
function applyLanguage() {
  setLang(effectiveLang());
  chrome = createChrome(chromeDeps);
  targetChrome = createChrome({
    activeTab: () => (transfer.open ? transfer.target : null),
    onCommand: () => {},
    onBack: () => {},
    // The target's marks have targets of their own, and its list offers the
    // same jump. Without this the name would be drawn and do nothing when
    // clicked — a control that lies about being one.
    onFollowTarget: (path, at) => chromeDeps.onFollowTarget(path, at),
    withBack: false,
  });
  windowControls.dispose();
  windowControls = createWindowControls();
  docTools = createDocTools({
    activeTab,
    onCommand: (command) => chromeDeps.onCommand(command),
  });
  relocalizePalettes();
  relocalizeSearch();
  transfer.relocalize();
  render();
}

window.addEventListener("dil-degisti", applyLanguage);

// A setting changed. The document row asks the settings a question at BUILD
// time — "does this job have a model?" — and then keeps the answer, so binding
// or removing a model left Özet · Başlık · Spot exactly as they were drawn
// (Zafer, 6 Aug: "menüde pasifleştiler ama orada diri duruyorlar"). The menus
// looked right only because a popover is built fresh every time it opens.
//
// settings.js has always announced this; nothing was listening.
window.addEventListener("ayar-degisti", () => docTools.refresh());

/** The app's own page, while it is up. Declared here because renderTabs asks. */
let homeLayer = null;

function renderTabs() {
  tabsEl.replaceChildren();

  // The brand marks the window's corner, where the platform used to put the
  // app's name. It is not a button: nothing opens from it.
  const brand = document.createElement("div");
  brand.className = "brand";
  brand.setAttribute("data-tauri-drag-region", "");
  // The application's own icon — the one on the taskbar and in the installer.
  // A second drawing of the brand in here would be a second brand: whatever the
  // window's corner shows has to be what the reader already knows the app by.
  // "beta" belongs to the app, not to any document — so it goes here, in the
  // corner the app already owns, and nowhere else. It is a label, not a badge:
  // no fill, no border, no accent (the accent means navigation and active
  // state, and one word wearing it would be the lone blue button all over
  // again). It rides inside the drag region so the corner stays draggable.
  brand.innerHTML =
    `<img class="brand-icon" src="${brandIcon}" alt="" draggable="false">` +
    `<span class="brand-beta">beta</span>`;
  // The mark and the app's own page are ONE group, and the group is separated
  // from the tabs. Loose in the row they read as a third and fourth tab: the
  // eye had nothing telling it where the app ended and the documents began.
  const mark = document.createElement("div");
  mark.className = "app-mark";
  // A hairline between the chip and the app's page: the same 1px of --n4 the
  // group already ends with, and the same one the palette parts its verbs with.
  const seam = document.createElement("span");
  seam.className = "brand-seam";
  mark.append(brand, seam, chrome.about);
  tabsEl.append(mark);

  // Hakkında is a layer of the APP, not of a document (Zafer, 6 Ağu). While it
  // is up the row carries the app's own corner and the window's controls and
  // nothing else: no tabs to switch to under a page you are reading, and no
  // bridge belonging to a screen you cannot see. The mark stays because it is
  // the way back out — the same button you came in by.
  if (homeLayer) {
    tabsEl.append(dragRegion(), chrome.appTools, windowControls);
    return;
  }

  // Aktarma has no tabs (KR-41: one source, one target, nothing remembered), so
  // its bridge takes their place — same row, same seam with the paper below.
  // Everything after this point (drag region, settings, window controls) is the
  // window's and is identical in both modes.
  if (transfer.open) {
    tabsEl.append(transfer.bridge, dragRegion(), chrome.appTools, windowControls);
    renderTransferRow();
    return;
  }

  // The tabs scroll among themselves. Without this box they grow the strip until
  // it pushes the icons on either side out of the window.
  const scroller = document.createElement("div");
  scroller.className = "tab-scroll";

  let activeEl = null;

  tabs.forEach((tab, index) => {
    const el = document.createElement("div");
    el.className = "tab" + (index === activeIndex ? " active" : "");
    el.dataset.index = index;

    // Drag to reorder — POINTER-based, not HTML5 `draggable`. Tauri's own
    // drag-drop (onDragDropEvent, how a .md gets opened) takes the WebView's
    // native drag, which silently kills HTML5 draggable. So we track the
    // pointer ourselves: it never touches the OS drag, so file-drop still works.
    //
    // A press that does not move is a click (activate). A press that moves past
    // a few pixels is a drag. That is why there is no separate onclick: the
    // mouseup decides which it was.
    el.onmousedown = (event) => {
      if (event.button !== 0 || event.target.closest(".close")) return;
      const startX = event.clientX;
      // The pointer's baseline for the transform. Re-based every time the tab
      // is re-slotted, so the tab stays under the hand through the reflow.
      let grabX = event.clientX;
      let dragging = false;

      const onMove = (move) => {
        if (!dragging && Math.abs(move.clientX - startX) < 5) return;
        if (!dragging) {
          dragging = true;
          el.classList.add("dragging");
        }

        // The row reflows LIVE (B-16): the neighbours step aside as the tab
        // passes, so none of them is ever buried under the one in hand — a tab
        // that fully covered another made it "disappear". Which gap? The first
        // tab whose midpoint is right of the pointer. Equal-width tabs (CSS)
        // keep the test stable — no jitter at the boundary.
        const others = [...scroller.querySelectorAll(".tab")].filter(
          (each) => each !== el,
        );
        let before = null;
        for (const other of others) {
          const rect = other.getBoundingClientRect();
          if (move.clientX < rect.left + rect.width / 2) {
            before = other;
            break;
          }
        }
        if (el.nextElementSibling !== before) {
          const wasAt = el.offsetLeft;
          scroller.insertBefore(el, before); // null lands it at the end
          grabX += el.offsetLeft - wasAt; // layout moved under the pointer
        }

        // The tab follows the pointer — that is the weight the old version was
        // missing: it stayed put and only a line moved, so it felt like nothing
        // was being lifted.
        el.style.transform = `translateX(${move.clientX - grabX}px)`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        el.style.transform = "";
        el.classList.remove("dragging");
        if (!dragging) {
          activate(index);
          return;
        }
        // The DOM already stands in the final order; the array follows it.
        reorderTabs(index, [...scroller.querySelectorAll(".tab")].indexOf(el));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    const title = document.createElement("span");
    title.className = "name";
    title.textContent = tab.title;
    // The FULL path, on the tab itself (Zafer, 6 Ağu). Until now the app said
    // where a document lived in exactly one place — the last-opened list — and
    // that list is history: clear it, or open an eleventh document, and the path
    // of the thing in front of you was nowhere at all. The tab is where the
    // question is asked, so it is where the answer belongs. An unsaved draft
    // says it has no path yet rather than showing a bare name.
    el.title = tab.path || t("tab.unsavedPath");
    el.append(title);

    // A dirty tab shows its dot, but it must still be closable — the dot used to
    // take the ✕'s place, which left no way to close it by mouse at all.
    if (tab.dirty) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.title = t("tab.unsaved");
      el.append(dot);
    }

    const close = document.createElement("span");
    close.className = "close";
    close.textContent = "✕";
    close.onclick = (event) => {
      event.stopPropagation();
      closeTab(index);
    };
    el.append(close);

    if (index === activeIndex) activeEl = el;
    scroller.append(el);
  });

  tabsEl.append(scroller);

  // Outside the scrolling box, not in it: inside, "+" scrolled away with the
  // tabs and the way to open a document went with it.
  const add = document.createElement("div");
  add.className = "tab-add";
  add.textContent = "+";
  add.title = t("tab.newTitle");
  add.onclick = newDocument;
  tabsEl.append(add);

  // "Belge aç" is back on the strip. It had been dropped in favour of "+", and
  // the result was this: with one document open, the only way to open a second
  // was to know Ctrl+O. Two different jobs, two icons — but one group, because
  // both of them make tabs.
  const openDoc = document.createElement("div");
  openDoc.className = "tab-open";
  openDoc.title = t("tab.openTitle");
  openDoc.innerHTML = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS.open}</svg>`;
  openDoc.onclick = () => openDocument();
  tabsEl.append(openDoc);

  // The folder's 15px appendix. Absent until there is a history to show — its
  // appearance is the list's announcement (KR-58).
  const recent = document.createElement("div");
  recent.className = "tab-recent";
  recent.title = t("tab.recentTitle");
  recent.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS.chevron}</svg>`;
  recent.hidden = recents.length === 0;
  openDoc.classList.toggle("alone", recents.length === 0);
  recent.onclick = () => openRecents(recent);
  tabsEl.append(recent);

  // Once the tabs no longer fit, the ones that scrolled out of sight are out of
  // reach: the strip has no scrollbar, by design. So the moment they overflow, a
  // chevron appears and stacks all of them in a list — the tabs you cannot see
  // are still one click away, and the strip stays quiet while they do fit.
  const stack = document.createElement("div");
  stack.className = "tab-stack";
  stack.hidden = true;
  stack.title = t("tab.allTitle");
  stack.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
  stack.onclick = () =>
    popover(
      stack,
      tabs.map((tab, index) => ({
        label: tab.title,
        active: index === activeIndex,
        dirty: tab.dirty,
        run: () => activate(index),
        drop: () => closeTab(tabs.indexOf(tab)),
      })),
    );
  tabsEl.append(stack);

  // Everything past this point is the WINDOW's, not the tabs': the strip you
  // grab to move it (and double-click to maximise), then settings, then the
  // three controls hard against the corner.
  tabsEl.append(dragRegion(), chrome.appTools, windowControls);

  // The document row is rebuilt with the tabs, because what is in it depends on
  // which document is in front. Empty screen: no row at all — the welcome
  // screen opens straight under the window's own row (KR-63's rule, applied to
  // the row that inherited the job).
  // Left: where you are and how to get around. Then a gap, then the search box
  // at the head of the right-hand group, then ⋯ at the very end.
  //
  // The box comes from the surface it searches (one per view), so a PDF — which
  // has no CodeMirror view — simply gets no box today. It is not a greyed one:
  // the app is exactly as large as what it can do here (KR-42). PDF search is
  // its own job.
  const front = activeTab();
  const searchBox = front?.view
    ? searchBoxOf(front.view, front.marks)
    : (front?.search?.dom ?? null);
  // Nothing to look through in an empty document (Zafer, 6 Aug) — the box goes
  // pale in place, wearing the same face as Aktarma's empty target half.
  if (front?.view) setSearchInert(front.view, isEmptyDoc(front));
  const gap = document.createElement("div");
  gap.className = "doc-gap";
  docTools.refresh();
  docRowEl.replaceChildren(
    chrome.left,
    gap,
    ...(searchBox ? [searchBox] : []),
    docTools.dom,
    chrome.right,
  );
  docRowEl.hidden = tabs.length === 0;

  // Whichever tab you are reading has to be the one you can see.
  activeEl?.scrollIntoView({ block: "nearest", inline: "nearest" });

  // The conditional tools on the left: back (only with somewhere to go back
  // to) and the marks list (only with marks to list).
  chrome.setCanGoBack((activeTab()?.backStack?.length ?? 0) > 0);
  chrome.updateMarksTool();
  chrome.updateContentsTool();

  measureTabs();
}

/**
 * Aktarma's document row. The same row as the tabs', in the same place, with
 * the same left-hand group — only its middle differs, because the body below it
 * is two panels rather than one.
 *
 * Each panel gets its OWN search box, at its own end of the row: with two
 * documents on screen a single box asks "which of them am I searching?" on
 * every keystroke. The row is split where the panels are, so the boxes sit over
 * what they search. No ⋯ here: the document menu saves, prints and closes, none
 * of which is this screen's business, and "which document?" has two answers.
 */
function renderTransferRow() {
  // fillBridge runs while the screen is still being set up, before `open` is
  // true — the row it would draw then belongs to nobody.
  if (!transfer.open) return;
  docRowEl.hidden = false;

  const leftHalf = document.createElement("div");
  leftHalf.className = "row-half left";
  leftHalf.append(chrome.left);

  const sourceBox = transfer.source?.view
    ? searchBoxOf(transfer.source.view, transfer.source.marks)
    : (transfer.source?.search?.dom ?? null);
  if (sourceBox) {
    leftHalf.append(sourceBox);
    sourceBox.classList.add("in-source");
  }
  leftHalf.append(Object.assign(document.createElement("div"), { className: "doc-gap" }));

  // The target's half reads the same way as the source's, from the dividing
  // line outwards: its tools first, then its search box, then space.
  const rightHalf = document.createElement("div");
  rightHalf.className = "row-half right";
  rightHalf.append(targetChrome.left);
  rightHalf.append(
    transfer.target?.view
      ? searchBoxOf(transfer.target.view, transfer.target.marks)
      : inertSearchBox(),
  );
  rightHalf.append(Object.assign(document.createElement("div"), { className: "doc-gap" }));

  // A half of the ROW is as much "that document" as the panel under it: its
  // İçindekiler, its İşaretler, its search box. Picking from the source's marks
  // list is working in the source — but that list hangs off the row, not off the
  // panel, so pressing it left `side` at whatever it was before and F8 then
  // walked the other document.
  leftHalf.addEventListener("mousedown", () => { transfer.side = "source"; }, true);
  rightHalf.addEventListener("mousedown", () => { transfer.side = "target"; }, true);

  docRowEl.replaceChildren(leftHalf, rightHalf);
  targetChrome.updateMarksTool();
  targetChrome.updateContentsTool();
  // The way out of Aktarma is the row's own back arrow — same drawing, same
  // sentence ("back the way you came"), so the screen needs no arrow of its own.
  chrome.setCanGoBack(true);
  chrome.updateMarksTool();
  chrome.updateContentsTool();
}

/** Shows the stack only while the tabs actually overflow their box. */
function measureTabs() {
  const scroller = tabsEl.querySelector(".tab-scroll");
  const stack = tabsEl.querySelector(".tab-stack");
  if (!scroller || !stack) return;

  requestAnimationFrame(() => {
    stack.hidden = scroller.scrollWidth <= scroller.clientWidth + 1;
  });
}

// The strip can start overflowing without a single tab being opened: the window
// only has to get narrower.
window.addEventListener("resize", measureTabs);

// Every open document keeps its editor in the DOM and only toggles visibility.
// Detaching and re-appending it on each switch would throw away the scroll
// position and the focus, and re-measuring 4.000+ words would blow the 200 ms
// tab-switch budget (IS-11).
function renderBody() {
  // While Aktarma is up the editors live in its panels, not here. Re-homing
  // them mid-transfer would rip the source out from under the layer.
  if (transfer.open) return;

  const tab = activeTab();
  const mine = new Set(tabs.map((each) => each.host));

  // The body holds exactly the open documents and nothing else. Anything else
  // in here is a leftover — a stale editor from a hot reload, say — and would
  // otherwise sit visible next to the real one.
  for (const child of [...bodyEl.children]) {
    if (!mine.has(child)) child.remove();
  }

  // Visibility is toggled on the host, not on the editor: CodeMirror's base
  // theme sets `display: flex !important` on .cm-editor, which beats an inline
  // display:none and leaves every document on screen at once.
  for (const each of tabs) {
    const returning = !each.host.isConnected;
    if (returning) bodyEl.append(each.host);
    each.host.hidden = each !== tab;
    // Coming home from Aktarma: a scroller that was moved in the DOM is back at
    // the top and says nothing about it (pdf.js/restorePlace). After the line
    // above, so the surface can be measured — a hidden one cannot answer.
    if (returning) each.pdf?.restorePlace();
  }

  if (tab) {
    (tab.view ?? tab.pdf)?.focus();
  } else {
    bodyEl.append(
      createEmptyState({
        onOpen: () => openDocument(),
        onNew: newDocument,
        recents: emptyRecents(),
      }),
    );
  }
}

/**
 * The empty screen's copy of the last-opened list — same rows and order as the
 * strip's chevron, standing out in the open under the two ways in. Returns null
 * when there is nothing yet (first run), and the empty screen draws no box and
 * no heading for it (UC-20/A3). Fewer than ten is just a shorter list.
 */
function emptyRecents() {
  if (recents.length === 0) return null;

  const list = document.createElement("div");
  list.className = "empty-recents";
  recentRows(list, rows(recents), {
    // The empty screen has room, so it carries the full folder path on the right
    // (CSS trims it from the left with a leading …). The strip's chevron does not
    // (openRecents passes no place): there the two lists must not look the same.
    place: (entry) => folderOf(entry.path),
    onPick: async (path, row) => {
      if (!(await documentExists(path))) {
        sayMissing(row, path);
        recents = forget(recents, path);
        saveSession();
        return;
      }
      openDocument(path);
    },
  });

  // The list can be swept away (Zafer, 18 Tem). Quiet, at the foot of the rows:
  // a faint word, not a red button. It clears the HISTORY — documents open
  // right now keep their rows (6 Ağu; see clearRecents).
  const clear = document.createElement("button");
  clear.className = "recents-clear";
  clear.textContent = t("recents.clear");
  clear.onclick = () => clearRecents();
  list.append(clear);
  return list;
}

/**
 * Empties the last-opened history everywhere it shows, and persists it.
 *
 * The documents OPEN right now keep their rows (Zafer, 6 Ağu): the list says
 * where you have been, and what is in front of you is not the past. Without
 * this the strip and the list contradicted each other — five tabs, no history —
 * and a restart did not settle it, because restoring a session does not write
 * to this list (KR-59).
 */
function clearRecents() {
  recents = clearExcept(
    recents,
    tabs.map((tab) => tab.path).filter(Boolean),
  );
  saveSession();
  renderTabs(); // the chevron's appendix goes with the history
  renderBody(); // the empty screen, if up, drops the shelf for the four cards
}

function renderStatus() {
  const tab = activeTab();
  if (!tab) {
    statusEl.textContent = "";
    return;
  }
  // A PDF has no word count to give and nothing to say about saving: the one
  // number that means anything while reading one is where you are in it.
  if (isPdfTab(tab)) {
    // Where you are, then how big it is. The scale is against the size the
    // document opened at, so "%100" is exactly what Ctrl+0 brings back; the
    // gesture that moves it (Ctrl+wheel) has no visible control, which is why
    // the number has to be readable somewhere.
    statusEl.textContent = tab.pdf
      ? [
          t("status.pdfPage", { n: tab.pdf.page, total: tab.pdf.pageCount }),
          t("status.pdfZoom", { n: tab.pdf.zoomPercent }),
        ].join(" · ")
      : t("status.pdfLoading");
    return;
  }

  const words = tab.view.state.doc.toString().split(/\s+/).filter(Boolean).length;
  const state = tab.saving
    ? t("status.saving")
    : tab.dirty
      ? t("status.unsaved")
      : tab.path
        ? t("status.saved")
        : "";
  const parts = [t("status.wordCount", { n: words.toLocaleString(effectiveLang()) })];
  if (state) parts.push(state);
  statusEl.textContent = parts.join(" · ");
}

function activate(index) {
  activeIndex = index;
  render();
  saveSession();
}

async function closeTab(index) {
  const tab = tabs[index];
  if (!tab) return;

  // UC-02/A1, UC-02-K3, UC-02-K4: unsaved work is never dropped silently, and
  // "Vazgeç" really cancels.
  if (tab.dirty) {
    const answer = await askChoice(
      t("dialog.savePrompt", { title: tab.title }),
      [
        { label: t("dialog.save"), value: "save", primary: true },
        { label: t("dialog.dontSave"), value: "discard" },
        { label: t("dialog.cancel"), value: "cancel" },
      ],
    );
    if (answer === "cancel") return;
    if (answer === "save") {
      await saveTab(tab);
      // The save may have been cancelled at the file dialog — then the tab is
      // still dirty and must stay open.
      if (tab.dirty) return;
    }
  }

  const at = tabs.indexOf(tab);
  if (at === -1) return;
  tabs.splice(at, 1);
  if (tab.timer) clearTimeout(tab.timer);
  tab.marks?.destroy();
  tab.toTop?.destroy();
  tab.view?.destroy();
  tab.search?.destroy();
  tab.pdf?.destroy();
  tab.host.remove();
  if (activeIndex >= tabs.length) activeIndex = tabs.length - 1;
  render();
  saveSession();
}

function createTab({ path, text }) {
  const host = document.createElement("div");
  host.className = "host";

  /** @type {Tab} */
  const tab = {
    id: nextTabId++,
    path,
    title: path ? titleOf(path) : t("tab.untitled"),
    dirty: false,
    saving: false,
    timer: null,
    host,
    view: null,
    // What was on disk the last time we read it or wrote it. The whole of
    // checkExternalChange rests on this one string (see it for why it is the
    // text and not an mtime).
    diskText: text,
  };

  tab.view = createSurface({
    parent: host,
    doc: text,
    // Read live: an unsaved document's images sit in the draft folder until the
    // first save moves them next to the file.
    documentFolder: () => (tab.path ? folderOf(tab.path) : draftFolderSync()),
    onLink: (view) => linkTo(tab, view),
    // UC-13: marking is done here now, in the document itself (KR-55). The
    // palette asks `find` which mark the selection is standing in, because that
    // decides whether it offers to make one or to work on the one already there.
    onMark: {
      // Guarded: the surface is built before the marks are (they need its view),
      // so anything the editor runs on the way up finds this empty.
      find: () => tab.marks?.selected() ?? null,
      // Every mark the selection touches — the palette needs the COUNT: with two
      // under one selection there is no "this mark" to move (KR-71, 28 Tem).
      findAll: () => tab.marks?.selectedMarks() ?? [],
      // Aktarma listens for this; in the tabs nothing does, and the button that
      // would call it is not built there.
      send: (record) => tab.marks?.send(record),
      closeStrip: () => tab.marks?.closeStrip(),
      mark: (options) => tab.marks.mark(options),
      comment: (record) => tab.marks.open(record, { writing: true }),
      remove: (record) => tab.marks.remove(record),
    },
    onScroll: saveSession,
    onFollowLink: (target, at) => followLink(tab, target, at),
    // V2-1: the mirror reads the target off disk every time it is opened; the
    // text is never copied into this document (that is what Aktarma is for).
    onEmbed: {
      resolve: (target) => resolveAgainst(tab.path, target),
      read: (path) => readDocument(path),
      folderOf: (path) => folderOf(path),
    },
    onPasteImage: (view, file) => pasteImage(tab, view, file),
    onChange: () => {
      // A reload is a change the writer did not make: it must not dirty the tab,
      // schedule an autosave, or move the marks. What follows the reload is
      // handled by reloadTab itself.
      if (tab.reloading) return;
      const wasClean = !tab.dirty;
      tab.dirty = true;
      tab.marks?.onEdit();
      if (tab.timer) clearTimeout(tab.timer);
      // An unsaved document has nowhere to go; it waits for an explicit Ctrl+S
      // rather than nagging with a dialog while the user is still typing.
      if (tab.path) tab.timer = setTimeout(() => saveTab(tab), AUTOSAVE_MS);
      // İçindekiler may switch active↔passive on this very keystroke ("# " typed
      // or deleted), so it is refreshed every change, not only on the clean→dirty
      // flip below.
      chrome.updateContentsTool();
      // Same reason, the other side of the row: the first character typed into
      // an empty document turns printing, PDF, the AI jobs and Aktarma back on
      // (Zafer, 6 Aug). Flags only — the row is not rebuilt on a keystroke.
      docTools.updateEnabled();
      if (tab.view) setSearchInert(tab.view, isEmptyDoc(tab));
      // Only the strip and the status line may change on a keystroke — never
      // the editor itself.
      if (wasClean) renderTabs();
      renderStatus();
    },
  });

  // The way back to the top of a long read. Attached to the surface's own
  // scroller — in a document that is CodeMirror's, not the host's.
  tab.toTop = attachToTop({
    host,
    scroller: tab.view.scrollDOM,
    toTop: () => {
      tab.view.scrollDOM.scrollTo({ top: 0, behavior: "smooth" });
      saveSession();
    },
  });

  // A document's marks belong to the document, wherever it is on screen: they
  // are made and commented here (KR-55) and Aktarma borrows them to travel and
  // to send (KR-57). They used to be loaded by Aktarma, so a fresh launch showed
  // a marked-up document bare until you went in there and came back.
  tab.marks = new MarkStore(tab, {
    say: (message) => {
      statusEl.textContent = message;
    },
    // A record in the workshop is found by path first, so a document that has
    // never been saved has no address to be filed under.
    ensureSaved: async () => {
      await saveTab(tab);
      return Boolean(tab.path);
    },
    // The arrow on a badge: the documents this passage was moved into.
    onFollowTarget: (path) => chromeDeps.onFollowTarget(path, null),
  });

  // The marks tool on the strip follows this document's mark count.
  tab.marks.onCount = () => chrome.updateMarksTool();

  tabs.push(tab);
  activate(tabs.length - 1);

  if (path) tab.marks.load();

  return tab;
}

/**
 * A PDF tab: the same strip, the same tab, a different surface (KR-68, UC-22).
 *
 * The tab is created and shown BEFORE the file is parsed, because parsing a
 * 2 MB book takes long enough to look like nothing happened. The status line
 * says it is loading, and the pages arrive into a tab that is already there.
 *
 * No MarkStore yet — marking a PDF is Faz 2. It is left off rather than left
 * empty: marks.load() would go looking for anchors in a document that has no
 * text offsets to anchor to.
 */
async function createPdfTab(path) {
  const host = document.createElement("div");
  host.className = "host";

  /** @type {Tab} */
  const tab = {
    id: nextTabId++,
    path,
    title: titleOf(path),
    kind: "pdf",
    dirty: false,
    saving: false,
    timer: null,
    host,
    view: null,
    pdf: null,
  };

  tabs.push(tab);
  activate(tabs.length - 1);

  try {
    const data = await readBytes(path);
    // Taken here because this is the one moment the bytes are in hand: the
    // workshop needs it to find this PDF's notes again after it is moved, and
    // reading a 30 MB file a second time just to ask would be a poor trade.
    tab.signature = signatureOf(data);
    // Same reason, same moment: a PDF has no text for us to weigh, so its size
    // is the only honest answer to "how big is this?" — and the bytes are in
    // hand exactly once (Zafer, 6 Ağu: the info card was saying 0).
    tab.bytes = data.length ?? data.byteLength ?? 0;

    tab.pdf = await createPdfSurface({
      parent: host,
      data,
      // The page counter follows the scroll — in the status line, and in the
      // document row's own counter (nudged, not rebuilt: rebuilding the row on
      // every scroll event would tear down the box being typed into).
      onPage: (page, total) => {
        if (activeTab() !== tab) return;
        renderStatus();
        docTools.setPage(page, total);
      },
      onZoom: () => {
        if (activeTab() === tab) renderStatus();
      },
      // A page is drawn late and lazily, so its marks — and any search hits on
      // it — can only be found and painted once it exists (Faz 2).
      onPaint: (page) => {
        tab.marks?.onPagePainted();
        tab.search?.onPaint(page);
      },
    });
  } catch (error) {
    console.warn(error);
    statusEl.textContent = t("status.pdfOpenFailed", { name: fileNameOf(path) });
    return tab;
  }

  // The right button belongs to this app on a PDF too (KR-84) — until now the
  // webview answered it with reload and spell check, which are nobody's idea of
  // a reading menu.
  tab.pdf.dom.addEventListener("contextmenu", (event) =>
    openContextMenu({
      event,
      text: passageMarkdown(tab.pdf.selectedParts()),
      onJob: (job, options) => runPdfJob(tab, job, options),
    }),
  );

  // A PDF's marks go to the workshop, exactly as a document's do.
  // The same store interface as a document's, so Aktarma can borrow it without
  // asking which kind of thing it is standing on.
  tab.marks = new PdfMarkStore(tab, {
    say: (message) => {
      statusEl.textContent = message;
    },
    // The arrow on a badge, exactly as a document's (behaviour parity).
    onFollowTarget: (path) => chromeDeps.onFollowTarget(path, null),
  });
  tab.marks.onCount = () => chrome.updateMarksTool();
  await tab.marks.load();

  // The same box a document gets, over a surface that is not a document. A PDF
  // has no view, so nothing builds it for us (search.js's plugin is a CM one).
  tab.search = createPdfSearch(tab.pdf);
  tab.search.setMarks(tab.marks);

  // A PDF's "top" is page 1, not scrollTop 0 — goTo tells the counter and the
  // saved place where the reader went, which a bare scroll would not.
  tab.toTop = attachToTop({
    host,
    scroller: tab.pdf.dom,
    dark: true,
    toTop: () => tab.pdf.goTo(1),
  });
  renderTabs(); // the row was drawn before the box existed

  // The tab may have been closed, or another one activated, while it parsed.
  if (activeTab() === tab) {
    tab.pdf.focus();
    renderStatus();
  }
  return tab;
}

/**
 * Renames the open document on disk and updates the tab at once — the strip must
 * show the new name the instant it lands, not on the next reload.
 */
async function renameCurrent(tab) {
  if (!tab.path) {
    // An unsaved document has no name to change yet; naming it IS saving it.
    await saveTab(tab, { askForPath: true });
    return;
  }

  const yeniAd = await askText(t("dialog.newName"), fileNameOf(tab.path));
  if (!yeniAd) return;

  try {
    const oldPath = tab.path;
    tab.path = await renameDocument(tab.path, yeniAd);
    tab.title = titleOf(tab.path);
    // Son açılanlar follows the rename: the old path would sit in the list
    // until clicked, say "bulunamadı" and drop — a stumble of our own making.
    recents = renamePath(recents, oldPath, tab.path);
    renderTabs();
    saveSession();
    statusEl.textContent = t("status.renamed", { name: tab.title });
  } catch (error) {
    statusEl.textContent = error.message ?? t("status.renameFailed");
  }
}

async function saveTab(tab, { askForPath = false } = {}) {
  // KR-68: a PDF is a source. Ctrl+S on one is not an error to report, it is
  // simply nothing — there is no unsaved state for it to be about.
  if (isPdfTab(tab)) return;

  // One write at a time (18 Tem review): Ctrl+S landing while the autosave is
  // mid-write would start a second writeDocument over the same file — and the
  // backup read inside it races the first write. The late save is queued, not
  // dropped: it runs when the one in flight finishes, with the fresher text.
  if (tab.saving) {
    tab.queuedSave = { askForPath };
    return;
  }

  if (tab.timer) {
    clearTimeout(tab.timer);
    tab.timer = null;
  }

  let path = tab.path;
  if (!path || askForPath) {
    path = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    if (!/\.md$/i.test(path)) path += ".md";
  }

  const wasDraft = !tab.path;

  tab.saving = true;
  renderStatus();
  try {
    // UC-05-K2: images added before the first save follow the document home.
    // Their links DO need rewriting now: the folder is named after the
    // document (`tez.images/`), and while it was a draft there was no name to
    // use. Done before the text is read below, so the file is right on its
    // first write rather than corrected on the second.
    if (wasDraft) {
      const moved = await adoptDraftImages(path);
      if (moved && moved.from !== moved.to) retargetImageLinks(tab.view, moved);
    }

    const written = tab.view.state.doc.toString();
    await writeDocument(path, written);
    // What is on disk is now what we just put there — so the watcher below does
    // not read our own write back as somebody else's change.
    tab.diskText = written;
    tab.path = path;
    tab.title = titleOf(path);
    tab.dirty = false;

    // Now that the text is on disk, the anchors are rewritten from where the
    // marks actually stand — which is how a mark survives the writer typing
    // inside it (KR-56, UC-16-K5). It has to be after the .md write and only
    // after a successful one: an anchor describes the text on disk.
    await tab.marks.save();

    // UC-20-K7: a draft has no path, so it was never in the list. Saving it is
    // the moment its path is born — and that is when it enters, at the top.
    if (wasDraft) noteOpened(path);
  } catch (error) {
    // The text stays in memory; the user is told, not silently lost.
    console.error(error);
    statusEl.textContent = t("status.saveFailed", { error });
    tab.saving = false;
    flushQueuedSave(tab);
    return;
  }
  tab.saving = false;
  render();
  flushQueuedSave(tab);
}

// ---- the file changing behind our back --------------------------------------
//
// A document is a file, and a file has other suitors: another editor, a git
// pull, a script, the same document open on the other machine of a synced
// folder. Until now the app assumed it was alone with it — and the first save
// after somebody else's edit silently threw that edit away.
//
// Asked by CONTENT, not by mtime. An mtime moves for things that are not
// changes (a touch, a backup tool, a sync client rewriting identical bytes) and
// on Windows it also moves for our own writes with a delay that varies —
// producing exactly the false alarm that teaches a writer to dismiss the
// question without reading it. Comparing the text asks the only question that
// matters, and a .md is small enough that the answer is cheap.
//
// Asked on FOCUS, because that is when the answer can have changed and the
// writer is there to hear it: you leave, you edit elsewhere, you come back. No
// watcher, no polling, no new capability in the Rust shell.

/** Puts the file on disk back into the tab, and rebinds its marks (KR-16). */
async function reloadTab(tab, text) {
  tab.reloading = true;
  tab.view.dispatch({
    changes: { from: 0, to: tab.view.state.doc.length, insert: text },
  });
  tab.reloading = false;
  tab.diskText = text;
  tab.dirty = false;
  if (tab.timer) {
    clearTimeout(tab.timer);
    tab.timer = null;
  }
  // The one place anchors are consulted (KR-56) is the one place they are needed:
  // the text under the marks has just been replaced. This is what the two-stage
  // reanchoring was written for, and until today it had no real exam.
  await tab.marks.load();
  chrome.updateContentsTool();
  render();
}

async function checkExternalChange(tab) {
  if (!tab.path || isPdfTab(tab) || tab.saving || tab.reloading) return;

  let text;
  try {
    text = await readDocument(tab.path);
  } catch {
    // Unreadable right now — deleted, locked, half-written by whoever is
    // writing it. That is not a change we can act on, and guessing at one would
    // be worse than waiting: the next focus asks again.
    return;
  }
  if (text === tab.diskText) return;

  // Nothing of the writer's to lose: take the new text. Announced, never
  // silent — the document under their eyes just changed.
  if (!tab.dirty) {
    await reloadTab(tab, text);
    statusEl.textContent = t("status.externalReloaded", { name: tab.title });
    return;
  }

  // Both sides have edits. Two answers, and no third: a diff screen is another
  // product (18 Tem).
  const answer = await askChoice(t("dialog.externalChanged", { name: tab.title }), [
    { label: t("dialog.keepMine"), value: "mine" },
    { label: t("dialog.reload"), value: "reload", primary: true },
  ]);
  if (answer === "reload") {
    await reloadTab(tab, text);
    statusEl.textContent = t("status.externalReloaded", { name: tab.title });
    return;
  }
  // "Mine" is an answer, not a postponement: the question is not asked again for
  // this version of the file, and the next save writes over it.
  tab.diskText = text;
  statusEl.textContent = t("status.externalKept", { name: tab.title });
}

let checking = false;
async function checkAllForExternalChanges() {
  if (checking) return; // focus can fire twice; the dialogs must not stack
  checking = true;
  try {
    // The tab being read comes first, then the rest in their strip order — so
    // the first question is about the document in front of you.
    const order = [activeTab(), ...tabs.filter((tab) => tab !== activeTab())];
    for (const tab of order) {
      if (tab) await checkExternalChange(tab);
    }
  } finally {
    checking = false;
  }
}

// Both doors, because they are not the same door: the DOM's `focus` fires when
// the web view takes the caret back (alt-tab inside the app's own window), the
// shell's when the OS window becomes the front one — and depending on where the
// pointer went, only one of them may fire. Two runs cost one file read; a missed
// one costs an overwritten edit.
window.addEventListener("focus", checkAllForExternalChanges);
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (focused) checkAllForExternalChanges();
});

/** The save that arrived while another was writing (see the gate above). */
function flushQueuedSave(tab) {
  const queued = tab.queuedSave;
  tab.queuedSave = null;
  if (queued) saveTab(tab, queued);
}

function newDocument() {
  return createTab({ path: null, text: "" });
}

// ---- images (UC-08) --------------------------------------------------------

/**
 * Points a draft's image links at the folder the document has just been given.
 *
 * One dispatch, not one per link: a loop would put N steps on the undo stack
 * for something the writer never typed, and the offsets would slide under it.
 * Only `](images/` is touched — the exact shape this app writes — so a link the
 * writer typed by hand at a folder of their own with the same name is left
 * alone.
 */
function retargetImageLinks(view, { from, to }) {
  const text = view.state.doc.toString();
  const needle = `](${from}/`;
  const changes = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    changes.push({ from: at, to: at + needle.length, insert: `](${to}/` });
  }
  if (changes.length) view.dispatch({ changes });
}

/** Writes the image link at the cursor, having copied the file in beside the
    document (`tez.images/`). */
async function placeImage(tab, view, source) {
  try {
    const link = await importImage({ documentPath: tab.path, ...source });
    const at = view.state.selection.main;
    const markdown = `![](${link})`;
    view.dispatch({
      changes: { from: at.from, to: at.to, insert: markdown },
      // Land after the link, not before it — otherwise whatever is typed next
      // ends up in front of the image.
      selection: { anchor: at.from + markdown.length },
      scrollIntoView: true,
    });
    view.focus();
  } catch (error) {
    // SD-13: say what went wrong; never "rescue" it by embedding base64.
    statusEl.textContent = t("status.imageFailed", { error });
  }
}

async function pasteImage(tab, view, file) {
  await placeImage(tab, view, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    // Clipboard images all arrive called "image.png"; give them a name that
    // says when they came from (UC-08/A3).
    name: pastedImageName(file.type),
  });
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

// Files dropped on the window arrive through Tauri, not the DOM.
getCurrentWebview().onDragDropEvent(async (event) => {
  // While dragging, the whole screen says it will take the file.
  if (event.payload.type === "over") {
    document.body.classList.add("dragging");
    return;
  }
  document.body.classList.remove("dragging");
  if (event.payload.type !== "drop") return;

  for (const path of event.payload.paths) {
    if (/\.md$/i.test(path) || isPdfPath(path)) {
      await openDocument(path);
    } else if (IMAGE_FILE.test(path) && activeTab()?.view) {
      const tab = activeTab();
      await placeImage(tab, tab.view, { sourcePath: path });
    } else {
      // UC-01/A2: anything else is refused, and says why.
      sayNotMarkdown(bodyEl, path.split(/[\\/]/).pop());
    }
  }
});

/**
 * UC-09: pick the target document, drop a relative link. The target has to be
 * relative to *this* document, which an unsaved one does not have — so it is
 * saved first rather than writing a path that would be wrong the moment the
 * file lands somewhere else.
 */
async function linkTo(tab, view) {
  if (!tab.path) {
    await saveTab(tab);
    if (!tab.path) return;
  }

  const target = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!target) return;

  insertLink(view, relativePath(tab.path, target));
}

async function openDocument(path) {
  path ??= await open({
    multiple: false,
    // PDF opens here too — it is read like any other document (KR-68). Saving
    // still offers Markdown only: nothing is ever written back to a PDF.
    filters: [
      { name: t("dialog.documents"), extensions: ["md", "pdf"] },
      { name: "Markdown", extensions: ["md"] },
      { name: "PDF", extensions: ["pdf"] },
    ],
  });
  if (!path) return;

  // UC-01/A1: an already-open document does not get a second tab. samePath, not
  // ===: Windows paths differ in case without differing in file (SD-08).
  const existing = tabs.findIndex((tab) => samePath(tab.path, path));
  if (existing !== -1) {
    // It still counts as opening it (UC-20-K2): the list is a history of what
    // you reached for, not of what got a new tab.
    noteOpened(path);
    return activate(existing);
  }

  if (isPdfPath(path)) await createPdfTab(path);
  else createTab({ path, text: await readDocument(path) });
  noteOpened(path);
}

/**
 * A document was opened — the one event that moves the list (KR-59). Called
 * from every door: Ctrl+O, drag-and-drop, following a link, the list itself,
 * and a draft's first save (UC-20-K7, the moment its path is born).
 *
 * Session restore deliberately does NOT call this (UC-20-K5).
 */
function noteOpened(path) {
  const before = recents;
  recents = remember(recents, path);
  if (recents !== before) {
    renderTabs();
    saveSession();
  }
}

/**
 * The list under the strip's chevron. It does not stat the disk to draw itself
 * (KR-59, SD-20): a row is never greyed out and never quietly vanishes. A file's
 * absence is learned when it is CLICKED — which is also the only moment anyone
 * is asking. (Checking ten paths at every launch is a library's job, KR-14, and
 * one unplugged network drive would freeze the app on startup.)
 */
function openRecents(anchor) {
  const menu = popover(anchor, []);
  if (!menu) return; // second click on the chevron toggled it shut
  menu.classList.add("recents");

  recentRows(menu, rows(recents), {
    isOpen: (path) => tabs.some((tab) => samePath(tab.path, path)),
    onPick: async (path, row) => {
      if (!(await documentExists(path))) {
        // Not red — nothing was deleted, something was not found. No file is
        // created, here or anywhere (KR-21, UC-20-K4).
        sayMissing(row, path);
        statusEl.textContent = t("status.notFound", { path });
        recents = forget(recents, path);
        saveSession();
        return;
      }
      menu.close();
      openDocument(path);
    },
  });

  // While documents are open the history is reached only here, so its broom
  // lives here too (Zafer, 18 Tem): at the very foot of the list, a faint word
  // under a hairline. Clearing closes the menu and drops the chevron.
  menu.append(document.createElement("hr"));
  const clear = document.createElement("button");
  clear.className = "recents-clear";
  clear.textContent = t("recents.clear");
  clear.onclick = () => {
    menu.close();
    clearRecents();
  };
  menu.append(clear);

  // The menu was measured while it was still empty — the rows and the 300px
  // width arrived after. Now that it is whole, place it again, or a window
  // narrow enough leaves its right-hand side off the screen.
  menu.place();
}

/**
 * UC-09: Ctrl+click a link, land in the target document. A missing target says
 * so and stops — it does not offer to create the file (KR-21).
 */
async function followLink(tab, target, at = null) {
  // `belge.md#yöntem` is not the name of a file — the disk would say "not found"
  // for a document that is right there. The place is asked for AFTER the file is
  // open (see landOn).
  const { path: named, fragment } = splitTarget(target);
  const path = resolveAgainst(tab.path, named);
  if (!(await documentExists(path))) {
    statusEl.textContent = t("status.notFound", { path: named });
    return;
  }
  // The way back (18 Tem): where you stood when you left. ONLY link follows
  // write here — switching tabs or opening from a list is not a journey, and
  // recording those would make this a second session history, not a "back".
  const leaving = placeLeft(tab, at);

  const cameFrom = tab.path;
  await openDocument(path);

  // Written onto the tab we ARRIVED at, not into one stack for the whole app
  // (3 Ağu, Zafer). "Back" is a promise made to a document: it means "return
  // to where you came into THIS one from". Kept globally, the promise was made
  // in one tab and honoured in another — walk to a third tab that nobody
  // linked into and the arrow was still lit, offering to leave for a document
  // you had not come from (Zafer: "geri oku bir önceki belgedeki gibi
  // çalışıyor").
  //
  // The alternative — recording tab switches too, so Back rewinds everything
  // that happened — is the second session history KR-82 already turned down.
  // Switching tabs is a glance, not a journey; twenty glances would mean twenty
  // presses, and the arrow would stop meaning "where I came from".
  const arrived = activeTab();
  if (leaving && arrived) {
    arrived.backStack ??= [];
    arrived.backStack.push(leaving);
    if (arrived.backStack.length > 50) arrived.backStack.shift();
    // AND THE ROW IS REDRAWN. `openDocument` already drew it — before this
    // push existed — so the arrow was decided against an empty stack and then
    // never asked again: the way back was recorded and invisible (Zafer, 3 Ağu:
    // "rozetten hedefe gidince geri oku çıkmıyor artık"). While the stack was
    // global this could not happen; the entry went in first and the draw came
    // after. Moving it onto the arriving tab reversed the order, and the order
    // was load-bearing.
    renderTabs();
  }

  // A citation's link can only name a HEADING (`belge.md#bölüm`) — the thing
  // that actually addresses the passage is the mark's id, and that can never be
  // written into the .md (the portability law). So arriving at a 4.000-word
  // source used to mean arriving at a section, which in a long document reads
  // as not arriving (Zafer, 3 Ağu: "işaret odaklanamadı").
  //
  // But the app knows something the link cannot say: the source's own record
  // remembers which documents each passage was moved into. Coming from one of
  // them, the mark is findable — no new syntax, nothing added to the file, just
  // the sidecar answering a question it could always answer.
  //
  // Only when it is unambiguous. Several passages may have gone to the same
  // document, and picking one of them at random would be worse than the heading:
  // wrong with confidence. Then the heading stands.
  if (!landOnMovedMark(cameFrom)) landOn(fragment);
}

/**
 * The passage this document sent to `target`, if exactly one did.
 *
 * @returns {boolean} whether it travelled there
 */
function landOnMovedMark(target) {
  const store = activeTab()?.marks;
  if (!target || !store?.records) return false;

  const hits = store.records.filter((record) =>
    movedTo(record).some((each) => samePath(each.hedefBelge, target)),
  );
  if (hits.length !== 1) return false;

  // The same door the marks list and F8 use: it scrolls there AND shades the
  // mark, which is what says "this is the one you asked about".
  store.travelTo(hits[0].id);
  return true;
}

/**
 * The place a link named, once its document is open (29 Tem): a PDF page, or a
 * heading in a document. The citation of a moved piece carries one, so clicking
 * it arrives where the piece came FROM — not at the top of the file it came from,
 * which in a 4.000-word source is the same as not arriving.
 *
 * Silence is the right answer to a fragment nobody recognises: the document is
 * open, which is most of what was asked. A link written by hand may say anything.
 */
function landOn(fragment) {
  if (!fragment) return;
  const tab = activeTab();
  if (!tab) return;

  const page = pageOfFragment(fragment);
  if (page && tab.pdf) {
    // A tick later: the surface has just been laid out, and it is the layout
    // that knows where page 12 begins.
    requestAnimationFrame(() => tab.pdf.goTo(page));
    return;
  }
  if (!tab.view) return;

  const doc = tab.view.state.doc;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (!heading || slugify(heading[1]) !== fragment) continue;
    // Through the same door the way back uses: the heading line IS its own
    // anchor, and `near` settles it if the document says it twice.
    requestAnimationFrame(() => scrollToAnchor(tab.view, line.text.trim(), { near: line.from }));
    return;
  }
}

/**
 * The PDF the reader is standing on: the active tab's, or — while Aktarma is up
 * — its source, which is the same tab borrowed by the layer.
 */
function readingPdf() {
  const tab = transfer.open ? transfer.source : activeTab();
  return isPdfTab(tab) && tab?.pdf ? tab : null;
}

/**
 * Runs an AI job on what is selected in a PDF (KR-83).
 *
 * The text goes through `passageMarkdown` first. A PDF's line breaks are
 * typesetting, not meaning: hand the model the raw selection and it translates
 * rubble — the same repair the transfer does, for the same reason.
 *
 * Both "no" answers are spoken. A PDF's only door to this job is a key and a
 * right click, and a key that answers with silence reads as a broken app.
 */
function runPdfJob(tab, job, options) {
  if (!provider(job)) {
    suggestion.whisper(t("ai.err.off"));
    return;
  }
  const text = passageMarkdown(tab.pdf.selectedParts());
  if (!text.trim()) {
    suggestion.whisper(t("ai.err.noSelection"));
    return;
  }
  suggestion.run(null, job, { source: text, options });
}

/**
 * The place a document is being left FROM, as the back stack keeps it.
 *
 * Two shapes, because two kinds of document have two kinds of "where":
 *
 *   .md  — the line you CLICKED, not the one at the top of the window (29 Tem).
 *          "Back" is a promise about the place you left, and after a transfer
 *          that place is a citation glyph halfway down the page; the top line
 *          is a different sentence, sometimes a blank one, and blank anchors
 *          nothing (Zafer: "geri dediğimde tıkladığım yere dönmedi"). The
 *          offset rides along so a line that says the same thing twice is not
 *          a coin toss.
 *   .pdf  — the page. A PDF has no lines, but it does have a place, and this is
 *          the same resolution its session remembers.
 *
 * Each tab keeps its own stack (`tab.backStack`), in memory only — a restart
 * starts you fresh, like Aktarma (KR-41's spirit).
 */
function placeLeft(tab, at = null) {
  if (!tab?.path) return null;
  if (tab.view) {
    const line = at == null ? null : tab.view.state.doc.lineAt(at);
    return {
      path: tab.path,
      anchor: line ? line.text.trim() : topLineText(tab.view),
      near: line ? line.from : 0,
      spot: line != null,
    };
  }
  if (tab.pdf) return { path: tab.path, page: tab.pdf.page ?? 1 };
  return null;
}

/**
 * Alt+← or the strip's back arrow: return to where the link into THIS document
 * was followed from — the document AND the place.
 *
 * "This document" is the whole of it. The stack belongs to the tab you are
 * standing in, so a tab nobody linked into has nowhere to go and says so with
 * a dead arrow; and a tab that does have somewhere keeps it while you wander
 * off to others and come back.
 */
async function goBack() {
  const entry = activeTab()?.backStack?.pop();
  renderTabs(); // the arrow may have just run out of places to go
  if (!entry) return;

  const at = tabs.findIndex((tab) => samePath(tab.path, entry.path));
  if (at !== -1) {
    activate(at);
  } else {
    // The tab was closed since; coming back reopens it (an open like any
    // other — it counts to Son açılanlar, KR-59).
    if (!(await documentExists(entry.path))) {
      statusEl.textContent = t("status.notFound", { path: entry.path });
      return;
    }
    await openDocument(entry.path);
  }

  const tab = activeTab();
  if (tab && samePath(tab.path, entry.path) && entry.page && tab.pdf) {
    // A PDF comes back to its page — a tick later, because it is the layout
    // that knows where page 12 begins (the same wait landOn takes).
    requestAnimationFrame(() => tab.pdf.goTo(entry.page));
  } else if (tab && samePath(tab.path, entry.path) && tab.view) {
    // Wait for the editor to lay out before hunting for the anchor line.
    // A line you clicked comes back to the MIDDLE — that is where you were
    // looking. A top-of-window anchor comes back to the top, because that is
    // what it was.
    requestAnimationFrame(() =>
      scrollToAnchor(tab.view, entry.anchor, {
        near: entry.near ?? 0,
        y: entry.spot ? "center" : "start",
      }),
    );
  }
}

// ---- Aktarma (UC-12) --------------------------------------------------------

const transfer = new Transfer({
  tabs: () => tabs.filter((tab) => tab.path),
  touch: (tab) => {
    tab.dirty = true;
    if (tab.timer) clearTimeout(tab.timer);
    if (tab.path) tab.timer = setTimeout(() => saveTab(tab), AUTOSAVE_MS);
    renderTabs();
  },
  openDocument: (path) => openDocument(path),
  say: (message) => {
    statusEl.textContent = message;
  },
  // A target picked from disk, opened as a tab like any other document.
  pickFromDisk: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return null;
    await openDocument(path);
    return tabs.find((tab) => samePath(tab.path, path)) ?? null;
  },
  // A blank target: the most natural way to transfer — out of a full document,
  // into an empty one.
  createTarget: async () => {
    const tab = newDocument();
    await saveTab(tab);
    if (tab.path) return tab;

    // The save dialog was cancelled: no file was named, so there is no document
    // — and there should be no tab either. Leaving it behind meant that backing
    // out of Aktarma silently opened a blank "Adsız" document you never asked
    // for.
    await closeTab(tabs.indexOf(tab));
    return null;
  },
});
// Leaving puts the tabs back in the window's row and the tab's own tools back
// in the row below — both of which renderTabs owns.
transfer.onClose = () => {
  renderBody();
  renderTabs();
};
// A target opened or dropped: the bridge's right-hand side changed, and so did
// whether there is a second search box in the row.
transfer.onRetarget = () => renderTransferRow();
transfer.onPair = (source, target) => {
  lastPair = { source: source.path, target: target.path };
  saveSession();
};

/**
 * The source is the document you are in — it is not chosen from a list, because
 * you are already standing in it. Only the target is a question, and Aktarma can
 * answer it with a blank page, so one open document is enough to start.
 */
async function openTransfer() {
  const source = activeTab();
  if (!source) return;

  // "No marks, no Aktarma" is gone (28 Tem, Zafer). B-17 put that guard here
  // when the screen could only travel and send — with nothing to travel between
  // it was an empty room. KR-71 gave it back the marking palette, so now you
  // open it precisely to mark: read the two documents side by side, mark what
  // you find, move it across. The rule had started eating itself — you could not
  // get in to do the thing you can only do inside. An empty bridge reads ‹0/0›,
  // which is the truth and needs no sentence.
  //
  // A PDF is already on disk and carries no marks yet (Faz 2), so there is
  // nothing to save and nothing to ask. It comes in as a reader: the left panel
  // reads, the right panel writes (Zafer, 28 Tem — "soldan okuyup sağda yazmak").
  //
  // The source has to exist on disk: its marks are filed under its path.
  if (!isPdfTab(source) && !source.path) {
    await saveTab(source);
    if (!source.path) return;
  }

  // The screen opens on one document, remembering nothing. It used to reopen
  // with the target you last used, which meant that going in to mark a passage
  // silently reopened a document you were done with — the screen is for marking
  // first, and a target is something you ask for (KR-37).
  await transfer.show({ source, target: null });
  // The shell's two rows are the shell's, so they are drawn from here: the
  // bridge takes the tabs' place and the row below splits with the panels.
  renderTabs();
}

let lastPair = { source: null, target: null };

/**
 * Which document a key that says "in this document" means — Ctrl+F, Ctrl+H, F8.
 *
 * In the tabs it is never in doubt. Inside Aktarma there are two documents on
 * screen, so it is whichever one you are actually in — and if you are in neither
 * (the layer opens with nothing focused), it is the source: the document the
 * screen is about. The target is where text lands, not where you read.
 *
 * One answer for all of them on purpose. Search landing in one document while
 * F8 walked another would be two screens pretending to be one.
 */
function searchTarget() {
  if (!transfer.open) return activeTab();
  // `side`, not focus: pressing a mark's badge moves no focus, so focus goes
  // stale exactly when the reader has just said which document they mean.
  return transfer.side === "target" && transfer.target ? transfer.target : transfer.source;
}

/**
 * The home page, over whatever is open. A layer rather than a tab: it is not a
 * document — it cannot be marked, saved or transferred — and a tab that could do
 * none of those things would be a tab that lies.
 */
/**
 * ⋯ → Belge bilgisi. The card lends the menu's paper; the numbers come from
 * here, because only main.js can see both the text and the marks.
 *
 * A PDF answers with an empty text on purpose: we hold its pages, not its words
 * (KR-68), and `statsOf` drops the lines it cannot honestly fill.
 */
async function showDocInfo(anchor) {
  const tab = activeTab();
  if (!tab) return;

  const stats = statsOf({
    text: tab.view ? tab.view.state.doc.toString() : "",
    marks: tab.marks?.listing() ?? [],
    isPdf: isPdfTab(tab),
    // Measured when the PDF was opened; a document weighs its own text.
    bytes: isPdfTab(tab) ? (tab.bytes ?? 0) : null,
  });

  const card = createDocInfo({
    path: tab.path ?? null,
    stats,
    // The folder, not the file: opening the file would just open this app again
    // (or worse, whatever else claims .md). `openPath` is the same door the
    // about page's links go through — nothing new is asked of the OS.
    // Never swallow this: the first version caught and dropped the error, so a
    // refused path looked exactly like a working one (Zafer: "klasör açmak
    // çalışmıyor" — and the reason was invisible).
    onOpenFolder: () =>
      openPath(folderOf(tab.path)).catch((error) => console.warn("klasör açılamadı:", error)),
  });
  popover(anchor, [{ node: card }]);
}

function toggleHome() {
  if (homeLayer) {
    closeHome();
    return;
  }
  homeLayer = createHome({ onClose: closeHome });
  document.body.append(homeLayer);
  // The row has to be redrawn, not just covered: see renderTabs.
  renderTabs();
}

function closeHome() {
  if (!homeLayer) return;
  homeLayer.remove();
  homeLayer = null;
  renderTabs();
}

/** UC-11. Inside Aktarma it is the target — the document being written. */
async function printCurrent() {
  const tab = transfer.open ? transfer.target : activeTab();
  if (!tab?.view) return; // KR-68: a PDF is printed by whatever opened it, not by us

  statusEl.textContent = t("status.pdfPreparing");
  const result = await printDocument({
    markdown: tab.view.state.doc.toString(),
    folder: tab.path ? folderOf(tab.path) : draftFolderSync(),
    title: tab.title,
    save,
    toPdf: (path) => invoke("pdfe_bas", { yol: path }),
  });

  statusEl.textContent = result.ok
    ? t("status.pdfWritten", { name: fileNameOf(result.path) })
    : result.error
      ? t("status.pdfFailed", { error: result.error })
      : "";
}

/**
 * Yazdır — the same sheet, handed to a printer instead of a file.
 *
 * The dialog belongs to this one: which printer, how many copies, which pages
 * are the writer's questions, and no app should answer them on their behalf.
 */
async function printPaperCurrent() {
  const tab = transfer.open ? transfer.target : activeTab();
  if (!tab?.view) return;

  statusEl.textContent = t("status.printing");
  const result = await printPaper({
    markdown: tab.view.state.doc.toString(),
    folder: tab.path ? folderOf(tab.path) : draftFolderSync(),
  });

  // Nothing to report when it worked: the paper is the report. Cancelling the
  // dialog is not a failure either — it is the writer changing their mind.
  statusEl.textContent = result.error ? t("status.printFailed", { error: result.error }) : "";
}

// ---- session (UC-02-K1, UC-04) ----------------------------------------------

let sessionTimer = null;

function saveSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    writeSession({
      sekmeler: tabs
        .filter((tab) => tab.path)
        .map((tab) => ({
          yol: tab.path,
          kayitliYer: tab.view ? topLineText(tab.view) : "",
          // A PDF comes back to the page you were reading, not to a line of
          // text it does not have.
          sayfa: tab.pdf?.page ?? null,
        })),
      // The path, not the index: `sekmeler` above filters unsaved drafts out,
      // so an index counted over ALL tabs pointed at the wrong one whenever a
      // draft sat before the active tab (18 Tem review).
      aktifYol: activeTab()?.path ?? null,
      // UC-12/A2: the pair you were working on survives a restart, not just a
      // trip back to the tabs.
      sonAktarma: { kaynak: lastPair.source, hedef: lastPair.target },
      // KR-58: the app's own list, in the app's own folder. Not one byte of it
      // goes into a .md or anywhere near the reader's folders (UC-20-K8).
      sonAcilanlar: recents,
    });
  }, 500);
}

async function restoreSession() {
  const session = await readSession();
  if (!session) return;

  // Before the early return below: a writer who closed every tab still has a
  // history, and the empty screen is the one screen that most wants to show it.
  //
  // Restoring is not opening (KR-59, UC-20-K5) — the list comes back in the
  // order it was left in, and the five tabs coming up do not resort it.
  recents = Array.isArray(session.sonAcilanlar) ? session.sonAcilanlar : [];

  // The opening screen was drawn once at boot (render() below), before the disk
  // read here finished — so it drew the first-run cards with an empty history.
  // Now that the history has arrived, redraw: with no tabs to restore, the empty
  // screen must show the shelf, not the cards (Zafer, 18 Tem: "son açılan dosya
  // olmasına rağmen reklam kutuları göründü").
  if (!session.sekmeler?.length) {
    render();
    return;
  }

  if (session.sonAktarma) {
    lastPair = {
      source: session.sonAktarma.kaynak,
      target: session.sonAktarma.hedef,
    };
  }

  // All reads at once — five tabs used to queue on the disk one after another
  // at every launch. The editors are still built in order (DOM work), but by
  // then every text has arrived.
  const loaded = await Promise.all(
    session.sekmeler.map(async (entry) => {
      try {
        // A PDF is not read here: its bytes are big and createPdfTab reads them
        // itself. Only its existence is confirmed, so a deleted one drops out
        // of the session like any other.
        if (isPdfPath(entry.yol)) {
          return (await documentExists(entry.yol)) ? { entry, text: null } : null;
        }
        return { entry, text: await readDocument(entry.yol) };
      } catch {
        // A document that has been moved or deleted just drops out of the
        // session; it is not an error worth stopping the launch for.
        return null;
      }
    }),
  );
  for (const each of loaded) {
    if (!each) continue;
    if (isPdfPath(each.entry.yol)) {
      createPdfTab(each.entry.yol).then((tab) => {
        if (each.entry.sayfa) tab.pdf?.goTo(each.entry.sayfa);
      });
      continue;
    }
    const tab = createTab({ path: each.entry.yol, text: each.text });
    // Wait for the editor to lay out before hunting for the anchor line.
    requestAnimationFrame(() => scrollToAnchor(tab.view, each.entry.kayitliYer));
  }

  const wanted = tabs.findIndex((tab) => samePath(tab.path, session.aktifYol));
  if (wanted !== -1) activate(wanted);
  // Older sessions carried an index; honour it once so an update loses nothing.
  else if (tabs[session.aktifSekme]) activate(session.aktifSekme);
}

window.addEventListener("keydown", (event) => {
  // The home page is the top of the stack while it is up: Escape closes it and
  // nothing under it hears the key.
  if (homeLayer && event.key === "Escape") {
    event.preventDefault();
    closeHome();
    return;
  }
  // Alt+← — back along the followed link. Not inside Aktarma: the tab strip is
  // out of reach there (SD-16), and so is switching documents under the layer.
  if (event.altKey && !event.ctrlKey && event.key === "ArrowLeft") {
    if (transfer.open) return;
    event.preventDefault();
    goBack();
    return;
  }

  // The AI job shortcuts live in the editor's keymap (surface.js), which a PDF
  // has none of — so the one job a PDF can use answers here instead. It is the
  // same key, the same card, the same job: only the door differs, because a PDF
  // is not an editor (KR-68, KR-83).
  if (event.altKey && !event.ctrlKey && event.key.toLowerCase() === "c") {
    const reading = readingPdf();
    if (!reading) return;
    event.preventDefault();
    runPdfJob(reading, "translate", jobOptions("translate"));
    return;
  }

  // Same reason, same door: Alt+P lives in the editor's keymap, and a PDF has no
  // editor — so the switch could be thrown in a document but never from the PDF
  // it also governs. An open PDF palette goes out with it (the CM ones re-apply
  // themselves; this one is not in that set).
  if (event.altKey && !event.ctrlKey && event.key.toLowerCase() === "p") {
    const reading = readingPdf();
    if (!reading) return;
    event.preventDefault();
    togglePalette();
    reading.marks?.hidePalette();
    return;
  }

  // PageUp / PageDown on a PDF: one whole page, not one windowful. The reader
  // asked for the page — the browser's own scroll lands mid-paragraph and the
  // page number under it becomes a guess.
  const paging = { PageDown: 1, PageUp: -1 };
  const arrows = { ArrowDown: 1, ArrowUp: -1 };
  if ((paging[event.key] || arrows[event.key]) && !event.ctrlKey && !event.altKey) {
    const reading = readingPdf();
    if (!reading?.pdf) return;
    // Not while typing in the row's own page field or search box.
    if (event.target instanceof HTMLInputElement) return;

    // ↑ ↓ turn pages only when the page is being held WHOLE on screen — that is
    // the state in which a document reads as a deck of slides rather than a
    // scroll, and turning is the only movement left that makes sense. Outside
    // it they stay the ordinary scroll, because there the reader is halfway
    // down a page and wants the next line, not the next page.
    const step = paging[event.key] ?? (reading.pdf.fitted ? arrows[event.key] : 0);
    if (!step) return;

    event.preventDefault();
    const pdf = reading.pdf;
    pdf.goTo(Math.min(Math.max(1, pdf.page + step), pdf.pageCount));
    return;
  }

  // F8 / Shift+F8 — the next mark, or the previous (the marks list's keyboard
  // door).
  //
  // Which document, when two are on screen? The same answer Ctrl+F gives, and
  // for the same reason: whichever one you are actually in, and the source if
  // you are in neither (the layer opens with nothing focused). Two keys that
  // both mean "in this document" cannot disagree about which document that is.
  //
  // It used to return early inside Aktarma, because travelling was the bridge's
  // ‹n/m›. That counter is gone (2 Ağu) — this is now the only way through the
  // marks there, so it had better work there.
  if (event.key === "F8" && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    searchTarget()?.marks?.travelStep(event.shiftKey ? -1 : 1);
    return;
  }

  if (!event.ctrlKey) return;

  // Zoom — a PDF only. A document's point size is a setting (Ayarlar → Okuma),
  // because prose reflows and a chosen size is meant to stick; a PDF page is a
  // fixed picture, so its size is a gesture you make while reading and drop
  // when you leave. Ctrl+wheel does the same thing on the surface itself.
  const reading = activeTab();
  if (isPdfTab(reading) && reading.pdf) {
    if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      reading.pdf.zoomIn();
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      reading.pdf.zoomOut();
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      reading.pdf.zoomReset();
      return;
    }
  }

  if (event.shiftKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    if (transfer.open) transfer.close();
    else openTransfer();
    return;
  }

  // V2-2: one search box, on the document being read (UC-18). Bound here rather
  // than in the editor's keymap for two reasons: Aktarma opens with nothing
  // focused, so an editor-level binding never ran and the WebView's own find bar
  // answered instead; and only out here is it knowable WHICH of the documents on
  // screen the writer means.
  if (event.key === "f") {
    event.preventDefault();
    const tab = searchTarget();
    if (tab?.view) openSearch(tab.view);
    else tab?.search?.open();
    return;
  }

  // Ctrl+H — the same strip, the replace row asked for by name (UC-21). Bound
  // out here for the same two reasons as Ctrl+F, and next to it so the pair
  // cannot drift apart. The WebView has no Ctrl+H of its own to lose.
  if (event.key === "h") {
    event.preventDefault();
    const tab = searchTarget();
    if (tab?.view) openReplace(tab.view);
    return;
  }

  // Printing is handled everywhere, including inside Aktarma. It cannot simply
  // be ignored there: the WebView would run its own Ctrl+P, and since the print
  // stylesheet hides the app, that prints a blank page. (Our own paper printing
  // uses that same stylesheet on purpose — but only after laying the typeset
  // sheet down for it to find.)
  //
  // Ctrl+P is paper, as it is in every other application; the PDF file moved one
  // key over. It had Ctrl+P while it was the only thing here, which was fine
  // right up until printing actually arrived.
  if (event.key === "p") {
    event.preventDefault();
    if (event.shiftKey) printCurrent();
    else printPaperCurrent();
    return;
  }

  // While Aktarma is up, the tab strip is out of reach (SD-16).
  if (transfer.open) return;

  if (event.key === "o") {
    event.preventDefault();
    openDocument();
  } else if (event.key === "n") {
    event.preventDefault();
    newDocument();
  } else if (event.key === "s") {
    event.preventDefault();
    const tab = activeTab();
    if (tab) saveTab(tab, { askForPath: event.shiftKey });
  } else if (event.key === "w") {
    event.preventDefault();
    if (activeTab()) closeTab(activeIndex);
  } else if (event.key >= "1" && event.key <= "9") {
    const index = Number(event.key) - 1;
    if (tabs[index]) {
      event.preventDefault();
      activate(index);
    }
  }
});

// First paint in the OS language: settings.dil defaults to null, so effectiveLang
// resolves to detectLang() even before the settings file is read. applyLanguage
// rebuilds the shell (chrome, transfer bar) that was constructed in the default
// language at import time, then renders.
applyLanguage();
// Typography and the stored language override arrive with the settings file;
// re-apply so the documents appear already set the way you left them.
loadSettings()
  .then(() => applyLanguage())
  .then(initDraftFolder)
  .then(restoreSession);

// Which CLI agents are on this machine — asked once, and deliberately not
// awaited by anything above: the answer is wanted by the time someone opens
// Settings, and nobody opens Settings in the first second. Until it lands,
// every provider is offered (an unasked question must not read as a "no").
// It cannot reject; probeAgent answers false for anything that goes wrong.
refreshCliAvailability();
