import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { createSurface, scrollToAnchor, suggestion, topLineText } from "./surface.js";
import { documentJobs } from "./ai.js";
import { MarkStore } from "./marks.js";
import { openReplace, openSearch } from "./search.js";
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
  readDocument,
  relativePath,
  renameDocument,
  resolveAgainst,
  samePath,
  titleOf,
  writeDocument,
} from "./storage.js";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Transfer } from "./transfer.js";
import { printDocument, printPaper } from "./print.js";
import { createEmptyState, sayNotMarkdown } from "./empty.js";
import { createChrome, popover, recentRows, sayMissing, ICONS } from "./chrome.js";
import { forget, remember, renamePath, rows } from "./recents.js";
import { loadSettings } from "./settings.js";

const tabsEl = document.getElementById("tabs");
const bodyEl = document.getElementById("body");

const statusEl = document.getElementById("status");

// KR-23: autosave 2 s after the user stops typing. Configurable here, never in
// the UI.
const AUTOSAVE_MS = 2000;

/**
 * @typedef {{
 *   path: string | null,   // null until the document has been saved once
 *   title: string,
 *   host: HTMLDivElement,  // wrapper we may hide; see renderBody
 *   view: import("@codemirror/view").EditorView,
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
const chrome = createChrome({
  activeTab: () => activeTab(),
  onBack: () => goBack(),
  onSearch: () => {
    const tab = searchTarget();
    if (tab) openSearch(tab.view);
  },
  onCommand: (command) => {
    const tab = activeTab();
    if (!tab) return;
    if (command === "save") saveTab(tab);
    else if (command === "saveAs") saveTab(tab, { askForPath: true });
    else if (command === "rename") renameCurrent(tab);
    else if (command === "print") printCurrent();
    else if (command === "printPaper") printPaperCurrent();
    else if (command === "transfer") openTransfer();
    else if (command === "close") closeTab(activeIndex);
    // A document-wide AI job ("Özet"). The card opens in the middle of the
    // screen like every other report — and like every other report, it can be
    // read and copied but never accepted into the document (KR-49).
    else if (documentJobs().includes(command)) {
      suggestion.run(tab.view, command, { source: tab.view.state.doc.toString() });
    }
  },
});

function renderTabs() {
  tabsEl.replaceChildren();
  tabsEl.append(chrome.left);

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
    el.append(title);

    // A dirty tab shows its dot, but it must still be closable — the dot used to
    // take the ✕'s place, which left no way to close it by mouse at all.
    if (tab.dirty) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.title = "kaydedilmemiş";
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
  add.title = "Yeni belge · Ctrl+N";
  add.onclick = newDocument;
  tabsEl.append(add);

  // "Belge aç" is back on the strip. It had been dropped in favour of "+", and
  // the result was this: with one document open, the only way to open a second
  // was to know Ctrl+O. Two different jobs, two icons — but one group, because
  // both of them make tabs.
  const openDoc = document.createElement("div");
  openDoc.className = "tab-open";
  openDoc.title = "Belge aç · Ctrl+O";
  openDoc.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS.open}</svg>`;
  openDoc.onclick = () => openDocument();
  tabsEl.append(openDoc);

  // The folder's 15px appendix. Absent until there is a history to show — its
  // appearance is the list's announcement (KR-58).
  const recent = document.createElement("div");
  recent.className = "tab-recent";
  recent.title = "Son açılan belgeler";
  recent.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS.chevron}</svg>`;
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
  stack.title = "Tüm belgeler";
  stack.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
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

  tabsEl.append(chrome.right);

  // Whichever tab you are reading has to be the one you can see.
  activeEl?.scrollIntoView({ block: "nearest", inline: "nearest" });

  // The conditional tools on the left: back (only with somewhere to go back
  // to) and the marks list (only with marks to list).
  chrome.setCanGoBack(backStack.length > 0);
  chrome.updateMarksTool();
  chrome.updateContentsTool();

  // On the opening screen (no document) the tools that act ON a document have
  // nothing to act on: İçindekiler, search and the ⋯ menu all go (Zafer, 18
  // Tem). Only Ayarlar stays — it belongs to the app, not the document.
  chrome.setHasDocument(tabs.length > 0);

  // …and with no document there is no tab strip at all: the whole row goes, so
  // the welcome screen opens straight under the window frame (Zafer, 18 Tem).
  // The ways in live in the welcome body, not here. (`hidden` needs the CSS rule
  // below it — .tabs sets display:flex, which would otherwise beat [hidden].)
  tabsEl.hidden = tabs.length === 0;

  measureTabs();
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
    if (!each.host.isConnected) bodyEl.append(each.host);
    each.host.hidden = each !== tab;
  }

  if (tab) {
    tab.view.focus();
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

  // The whole list can be swept away (Zafer, 18 Tem). Quiet, at the foot of the
  // rows: a faint word, not a red button. Clearing empties the history, so the
  // empty screen re-renders back to its first-run face — the four cards return.
  const clear = document.createElement("button");
  clear.className = "recents-clear";
  clear.textContent = "Listeyi temizle";
  clear.onclick = () => clearRecents();
  list.append(clear);
  return list;
}

/** Empties the last-opened history everywhere it shows, and persists it. */
function clearRecents() {
  recents = [];
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
  const words = tab.view.state.doc.toString().split(/\s+/).filter(Boolean).length;
  const state = tab.saving
    ? "kaydediliyor…"
    : tab.dirty
      ? "kaydedilmedi"
      : tab.path
        ? "kaydedildi"
        : "";
  const parts = [`${words.toLocaleString("tr")} kelime`];
  if (state) parts.push(state);
  if (tab.backupFailed) parts.push("yedek alınamadı");
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
      `"${tab.title}" kaydedilmedi. Ne yapılsın?`,
      [
        { label: "Kaydet", value: "save", primary: true },
        { label: "Kaydetme", value: "discard" },
        { label: "Vazgeç", value: "cancel" },
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
  tab.marks.destroy();
  tab.view.destroy();
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
    title: path ? titleOf(path) : "Adsız",
    dirty: false,
    saving: false,
    timer: null,
    host,
    view: null,
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
      mark: (options) => tab.marks.mark(options),
      comment: (record) => tab.marks.open(record, { writing: true }),
      remove: (record) => tab.marks.remove(record),
    },
    onScroll: saveSession,
    onFollowLink: (target) => followLink(tab, target),
    // V2-1: the mirror reads the target off disk every time it is opened; the
    // text is never copied into this document (that is what Aktarma is for).
    onEmbed: {
      resolve: (target) => resolveAgainst(tab.path, target),
      read: (path) => readDocument(path),
      folderOf: (path) => folderOf(path),
    },
    onPasteImage: (view, file) => pasteImage(tab, view, file),
    onChange: () => {
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
      // Only the strip and the status line may change on a keystroke — never
      // the editor itself.
      if (wasClean) renderTabs();
      renderStatus();
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
    // Marks live in .mdplus/ beside the file (KR-15), so a document that has
    // never been saved has nowhere to keep them.
    ensureSaved: async () => {
      await saveTab(tab);
      return Boolean(tab.path);
    },
  });

  // The marks tool on the strip follows this document's mark count.
  tab.marks.onCount = () => chrome.updateMarksTool();

  tabs.push(tab);
  activate(tabs.length - 1);

  if (path) tab.marks.load();

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

  const yeniAd = await askText("Yeni ad:", fileNameOf(tab.path));
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
    statusEl.textContent = `adı değişti: ${tab.title}`;
  } catch (error) {
    statusEl.textContent = error.message ?? "adı değiştirilemedi";
  }
}

async function saveTab(tab, { askForPath = false } = {}) {
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
    // Their links already read gorseller/… , so the text needs no rewriting.
    if (wasDraft) await adoptDraftImages(path);

    const { backupFailed } = await writeDocument(
      path,
      tab.view.state.doc.toString(),
    );
    tab.path = path;
    tab.title = titleOf(path);
    tab.dirty = false;
    tab.backupFailed = backupFailed;

    // Now that the text is on disk, the anchors are rewritten from where the
    // marks actually stand — which is how a mark survives the writer typing
    // inside it (KR-56, UC-16-K5). It has to be after the .md write and only
    // after a successful one: an anchor describes the text on disk.
    await tab.marks.save();

    // UC-20-K7: a draft has no path, so it was never in the list. Saving it is
    // the moment its path is born — and that is when it enters, at the top.
    if (wasDraft) noteOpened(path);
  } catch (error) {
    // UC-10/A1: the text stays in memory; the user is told, not silently lost.
    console.error(error);
    statusEl.textContent = `kaydedilemedi: ${error}`;
    tab.saving = false;
    flushQueuedSave(tab);
    return;
  }
  tab.saving = false;
  render();
  flushQueuedSave(tab);
}

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

/** Writes the image link at the cursor, having copied the file into gorseller/. */
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
    statusEl.textContent = `görsel eklenemedi: ${error}`;
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
    if (/\.md$/i.test(path)) {
      await openDocument(path);
    } else if (IMAGE_FILE.test(path) && activeTab()) {
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
    filters: [{ name: "Markdown", extensions: ["md"] }],
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

  createTab({ path, text: await readDocument(path) });
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
        statusEl.textContent = `bulunamadı: ${path}`;
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
  clear.textContent = "Listeyi temizle";
  clear.onclick = () => {
    menu.close();
    clearRecents();
  };
  menu.append(clear);
}

/**
 * UC-09: Ctrl+click a link, land in the target document. A missing target says
 * so and stops — it does not offer to create the file (KR-21).
 */
async function followLink(tab, target) {
  const path = resolveAgainst(tab.path, target);
  if (!(await documentExists(path))) {
    statusEl.textContent = `bulunamadı: ${target}`;
    return;
  }
  // The way back (18 Tem): where you stood when you left. ONLY link follows
  // write here — switching tabs or opening from a list is not a journey, and
  // recording those would make this a second session history, not a "back".
  if (tab.path) {
    backStack.push({ path: tab.path, anchor: topLineText(tab.view) });
    if (backStack.length > 50) backStack.shift();
  }
  openDocument(path);
}

/** The stack a followed link leaves behind: (document, the line you were on).
    In memory only — a restart starts you fresh, like Aktarma (KR-41's spirit). */
const backStack = [];

/** Alt+← or the strip's back arrow: return to where the last link was followed
    from — the document AND the line. */
async function goBack() {
  const entry = backStack.pop();
  renderTabs(); // the arrow may have just run out of places to go
  if (!entry) return;

  const at = tabs.findIndex((tab) => samePath(tab.path, entry.path));
  if (at !== -1) {
    activate(at);
  } else {
    // The tab was closed since; coming back reopens it (an open like any
    // other — it counts to Son açılanlar, KR-59).
    if (!(await documentExists(entry.path))) {
      statusEl.textContent = `bulunamadı: ${entry.path}`;
      return;
    }
    await openDocument(entry.path);
  }

  const tab = activeTab();
  if (tab && samePath(tab.path, entry.path)) {
    // Wait for the editor to lay out before hunting for the anchor line.
    requestAnimationFrame(() => scrollToAnchor(tab.view, entry.anchor));
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
transfer.onClose = () => renderBody();
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

  // No marks, no Aktarma (B-17): both of the screen's jobs — travelling between
  // marks and sending them (KR-57) — are about marks it would not have. The
  // menu entry is disabled too; this guard is for the shortcut.
  if (!source.marks.list().length) {
    statusEl.textContent =
      "Bu belgede işaret yok — taşımadan önce metni seçip işaretleyin.";
    return;
  }

  // The source has to exist on disk: its marks live beside it (KR-15).
  if (!source.path) {
    await saveTab(source);
    if (!source.path) return;
  }

  // The screen opens on one document, remembering nothing. It used to reopen
  // with the target you last used, which meant that going in to mark a passage
  // silently reopened a document you were done with — the screen is for marking
  // first, and a target is something you ask for (KR-37).
  await transfer.show({ source, target: null });
}

let lastPair = { source: null, target: null };

/**
 * Which document Ctrl+F means.
 *
 * In the tabs it is never in doubt. Inside Aktarma there are two documents on
 * screen, so it is whichever one you are actually in — and if you are in neither
 * (the layer opens with nothing focused), it is the source: the document the
 * screen is about. The target is where text lands, not where you read.
 */
function searchTarget() {
  if (!transfer.open) return activeTab();
  const inTarget = transfer.target?.view.dom.contains(document.activeElement);
  return inTarget ? transfer.target : transfer.source;
}

/** UC-11. Inside Aktarma it is the target — the document being written. */
async function printCurrent() {
  const tab = transfer.open ? transfer.target : activeTab();
  if (!tab) return;

  statusEl.textContent = "PDF hazırlanıyor…";
  const result = await printDocument({
    markdown: tab.view.state.doc.toString(),
    folder: tab.path ? folderOf(tab.path) : draftFolderSync(),
    title: tab.title,
    save,
    toPdf: (path) => invoke("pdfe_bas", { yol: path }),
  });

  statusEl.textContent = result.ok
    ? `PDF yazıldı: ${fileNameOf(result.path)}`
    : result.error
      ? `PDF üretilemedi: ${result.error}`
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
  if (!tab) return;

  statusEl.textContent = "Yazdırılıyor…";
  const result = await printPaper({
    markdown: tab.view.state.doc.toString(),
    folder: tab.path ? folderOf(tab.path) : draftFolderSync(),
  });

  // Nothing to report when it worked: the paper is the report. Cancelling the
  // dialog is not a failure either — it is the writer changing their mind.
  statusEl.textContent = result.error ? `yazdırılamadı: ${result.error}` : "";
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
          kayitliYer: topLineText(tab.view),
        })),
      // The path, not the index: `sekmeler` above filters unsaved drafts out,
      // so an index counted over ALL tabs pointed at the wrong one whenever a
      // draft sat before the active tab (18 Tem review).
      aktifYol: activeTab()?.path ?? null,
      // UC-12/A2: the pair you were working on survives a restart, not just a
      // trip back to the tabs.
      sonAktarma: { kaynak: lastPair.source, hedef: lastPair.target },
      // KR-58: the app's own list, in the app's own folder. Not one byte of it
      // goes into a .md or a .mdplus/ (UC-20-K8).
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
  // Alt+← — back along the followed link. Not inside Aktarma: the tab strip is
  // out of reach there (SD-16), and so is switching documents under the layer.
  if (event.altKey && !event.ctrlKey && event.key === "ArrowLeft") {
    if (transfer.open) return;
    event.preventDefault();
    goBack();
    return;
  }

  // F8 / Shift+F8 — the next mark, or the previous (the marks list's keyboard
  // door). Aktarma travels with its own bridge; this one is the tab's.
  if (event.key === "F8" && !event.ctrlKey && !event.altKey) {
    if (transfer.open) return;
    event.preventDefault();
    activeTab()?.marks.travelStep(event.shiftKey ? -1 : 1);
    return;
  }

  if (!event.ctrlKey) return;

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
    if (tab) openSearch(tab.view);
    return;
  }

  // Ctrl+H — the same strip, the replace row asked for by name (UC-21). Bound
  // out here for the same two reasons as Ctrl+F, and next to it so the pair
  // cannot drift apart. The WebView has no Ctrl+H of its own to lose.
  if (event.key === "h") {
    event.preventDefault();
    const tab = searchTarget();
    if (tab) openReplace(tab.view);
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

render();
// Typography first: the documents should appear already set the way you left
// them, not reflow a moment after they open.
loadSettings()
  .then(initDraftFolder)
  .then(restoreSession);
