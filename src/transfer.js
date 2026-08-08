// Aktarma (UC-12, UC-13b).
//
// A full layer over the tabs, never a split inside them (KR-04): source on the
// left, target on the right, a thin bridge bar on top. The screen does not
// divide the writer's world in two — it is a place you go and come back from.
//
// The two documents are the *same* editors that live in the tabs, moved here
// and moved back on exit. Cloning them would mean the same file open twice, and
// then two truths about what it says (SD-08).
//
// The screen does exactly two things (KR-57): it travels between the marks of
// one document, and it sends them somewhere. Marking and commenting were taken
// out of it and given to the tab (KR-55) — you should not have to leave a
// document to highlight a sentence in it. What is left here is what genuinely
// needs two documents on screen at once. So the source is read-only.
//
// 28 Tem (KR-71, Zafer): a selection in the source opens the palette again —
// but only its narrowest form, `[işaretle · yorumla]`. Reading the two
// documents side by side is exactly when you notice the passage you meant to
// mark, and walking back to the tab to do it was the friction. Formatting is
// still not offered (the source is read-only) and neither is the AI. The TARGET
// panel keeps nothing at all: pieces land there, they are not marked there
// (B-18). UC-12-K7 narrows to that panel.

import { EditorView } from "@codemirror/view";
import { popover } from "./chrome.js";
import { setAppMode } from "./context.js";
import { closeAllSearch } from "./search.js";
import { setReadOnly } from "./surface.js";
import { iconAction } from "./strip.js";
import { passageMarkdown } from "./pdf-text.js";
import { citeText, fragmentFor, headingTrail, quotedPiece, withMove } from "./citation.js";
import { relativePath } from "./storage.js";
import { fileNameOf } from "./paths.js";
import { t } from "./i18n.js";

export class Transfer {
  /**
   * @param {object} deps
   * @param {() => any[]} deps.tabs        all open documents
   * @param {(tab: any) => void} deps.touch mark a document as changed
   */
  constructor({ tabs, touch, openDocument, say, pickFromDisk, createTarget }) {
    this.tabs = tabs;
    this.touch = touch;
    this.openDocument = openDocument;
    this.say = say;
    this.pickFromDisk = pickFromDisk;
    this.createTarget = createTarget;
    this.open = false;
    this.source = null;
    this.target = null;

    this.build();
  }

  /** The marks of the document on the left — the tab's, not a second copy. */
  get marks() {
    return this.source?.marks ?? null;
  }

  build() {
    this.dom = document.createElement("div");
    this.dom.className = "layer";
    this.dom.hidden = true;

    // ---- the bridge (KR-04) ----
    //
    // It is no longer a bar of its own across the top of a full-screen layer.
    // Aktarma shows no tabs — it works on one source and one target and
    // remembers nothing (KR-41) — so the bridge takes the tabs' PLACE, up in the
    // window's row, wearing the active tab's clothes: a paper capsule fused to
    // the row below it. The screen's shell is then identical to the tabs'
    // shell, which is the whole point (2 Ağu, Zafer: "panel ya da şerit ikiliği
    // istemiyorum").
    // Two boxes, not one: the slot spans the row (so its centre is the panels'
    // boundary) and the capsule sits in the middle of it (so it is a capsule and
    // not a white band across the whole strip).
    const bridge = document.createElement("div");
    bridge.className = "bridge-slot";
    this.bridge = bridge;

    const capsule = document.createElement("div");
    capsule.className = "bridge-capsule";
    bridge.append(capsule);

    // The way out is not built here any more: it is the document row's own back
    // arrow, which already means "back the way you came" (GLYPH.back, one
    // drawing one meaning). main.js sends it here while the layer is up.
    //
    // One document, full width, and its marks to travel between. Sending them
    // somewhere else is a second thing you may or may not ask for — so nothing
    // about a target is on screen until you do (KR-41).
    this.sourceName = document.createElement("span");
    this.sourceName.className = "source-name";

    this.aimButton = iconAction("send", t("transfer.pickTarget"), () => {
      // This door only picks a target; a piece left pending by a dismissed
      // "Taşı" menu must not ride along and land unasked.
      this.pendingSend = null;
      this.chooseTarget();
    });

    // Shown only once a target is open: just its name. No arrow — the send icon
    // to its left already says which way the text goes. Undo/redo are not here
    // either: they belong to the target's own text, and Ctrl+Z reaches them.
    this.aimed = document.createElement("div");
    this.aimed.className = "aimed";
    this.aimed.hidden = true;

    // The name is a name, not a control: changing the target is what the send
    // icon does, and one door is enough.
    this.targetPicker = document.createElement("span");
    this.targetPicker.className = "target-picker";

    // Closing the target belongs to the target: right next to its name.
    this.closeTargetButton = iconAction("close", t("transfer.closeTarget"), () => this.dropTarget());
    this.aimed.append(this.targetPicker, this.closeTargetButton);

    // ‹ n/m › is GONE (2 Ağu, Zafer). The same thing was being said three times
    // on one screen: travelling is F8, the list itself is the İşaretler icon in
    // the document row, and the number is in the status line. What was left was
    // spending width to repeat it.
    //
    // The source name sits in the LEFT half of the capsule and the target in the
    // right, so the arrow between them lands on the boundary between the panels
    // below — which half of the screen each name belongs to is then read, not
    // worked out.
    const left = document.createElement("div");
    left.className = "bridge-side left";
    left.append(this.sourceName);

    const right = document.createElement("div");
    right.className = "bridge-side right";
    right.append(this.aimed);

    capsule.append(left, this.aimButton, right);

    // ---- the two panels ----
    const panels = document.createElement("div");
    panels.className = "panels";

    this.sourcePanel = document.createElement("div");
    this.sourcePanel.className = "panel source";
    this.targetPanel = document.createElement("div");
    this.targetPanel.className = "panel target";
    panels.append(this.sourcePanel, this.targetPanel);

    // Where the text will land. While you are working on the left, the target's
    // real caret is not drawn — it has no focus — so sending felt like posting
    // into a slot you could not see.
    this.ghost = document.createElement("div");
    this.ghost.className = "ghost-caret";
    this.ghost.hidden = true;
    this.targetPanel.append(this.ghost);

    // Which panel the keys mean.
    //
    // Focus alone cannot answer it: clicking a mark's badge moves no focus at
    // all (the badge is a widget with ignoreEvent → true, or the caret would be
    // stolen from the text), so pressing a mark on the right and then F8 walked
    // the marks on the LEFT — the last thing focused. What is being asked is not
    // "where is the caret" but "which document am I working in", and that is
    // answered by the last thing done to either of them: a press or a focus,
    // whichever came last.
    // The signal is the PRESS, and only the press.
    //
    // Focus was tried alongside it and made the answer worse, not better: the
    // target's editor takes focus on its own — when it is bound into the panel,
    // when a piece lands in it, when it is scrolled to show the ghost caret —
    // so a focusin could arrive long after the reader last touched anything, and
    // it arrived last. Then pressing a mark on the LEFT walked the marks on the
    // right: the exact mirror of the bug this was meant to fix.
    //
    // A press is unambiguous and is always the reader's own doing. Capture
    // phase, so it is heard whether or not the thing pressed handles the event.
    for (const [panel, side] of [
      [this.sourcePanel, "source"],
      [this.targetPanel, "target"],
    ]) {
      panel.addEventListener("mousedown", () => {
        this.side = side;
      }, true);
    }

    // The layer is only the BODY now. The bridge lives in the window's row and
    // the way out lives in the document row — both of them put there by main.js,
    // because both of those rows are the shell's, not this screen's.
    this.dom.append(panels);
    document.body.append(this.dom);
  }

  /**
   * Shows where the next piece will land, as a faint caret in the target.
   *
   * The target's own caret is invisible whenever the left-hand side has focus,
   * which is exactly when you are deciding what to send — so the drop point was
   * a secret at the one moment you needed it.
   */
  showGhostCaret({ reveal = false } = {}) {
    // While the target has focus it draws its own, real caret. Two carets in one
    // document is one too many.
    if (!this.target || this.target.view.hasFocus) {
      this.ghost.hidden = true;
      return;
    }

    const view = this.target.view;
    const head = view.state.selection.main.head;

    // A ghost you cannot see is no help at the moment you are about to send. So
    // when a mark's strip opens — when sending is one click away — the target
    // scrolls to its own caret first.
    if (reveal) {
      view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "nearest" }) });
    }

    view.requestMeasure({
      read: () => ({
        coords: view.coordsAtPos(head),
        box: this.targetPanel.getBoundingClientRect(),
      }),
      write: ({ coords, box }) => {
        if (!coords) {
          this.ghost.hidden = true;
          return;
        }
        this.ghost.hidden = false;
        this.ghost.style.top = `${coords.top - box.top}px`;
        this.ghost.style.left = `${coords.left - box.left}px`;
        this.ghost.style.height = `${Math.max(14, coords.bottom - coords.top)}px`;
      },
    });
  }

  /** Redraws the bridge: who the source is, and where we are aiming. */
  fillBridge() {
    this.sourceName.textContent = this.source?.title ?? "";

    // The screen is split from the moment it opens: source on the left, an empty
    // panel on the right (Zafer, 17 Tem). The right panel is where the piece
    // goes, so it is on screen before there is a target — a full-width source
    // with a "move" button read as moving the document into itself. The target
    // is still not asked for at the door (KR-57): the panel simply waits, empty,
    // until "Taşı" or the bridge fills it.
    const aiming = Boolean(this.target);
    this.aimed.hidden = !aiming;

    // No chevron: the send icon to its left already says this is where the text
    // goes, and the name itself is the thing you click to change it.
    if (aiming) this.targetPicker.textContent = this.target.title;

    // The row below the bridge follows: a target that appears or goes takes a
    // search box with it.
    this.onRetarget?.();
  }

  /** Closes the target: back to one document, full width. Nothing is lost. */
  async dropTarget() {
    if (!this.target) return;
    this.unbind();
    this.target = null;
    await this.bind();
    this.fillBridge();
  }

  /**
   * One list, three ways to name a target: the documents already open (the usual
   * case, one click), a document on disk, or a new empty one. Aktarma is
   * therefore possible with a single document open — you write into a blank
   * page, which is the most natural way to use it.
   */
  chooseTarget() {
    // chrome.js's popover, not a hand-rolled copy. The copy this replaces had
    // re-grown the exact bug popover already fixed — a clamp against a
    // hand-written 240 instead of the menu's measured width — and it neither
    // closed on Esc nor toggled, because those fixes never reached it. One
    // component, so the next fix reaches everyone (18 Tem review).
    const aim = async (pick) => {
      const tab = await pick;
      if (tab && tab !== this.source) await this.retarget(tab);
      // The move that opened this menu, completed (B-23). Only that one: a
      // target chosen from the bridge icon carries no pending piece.
      const pending = this.pendingSend;
      this.pendingSend = null;
      if (pending && this.target) await this.sendMark(pending);
    };

    // UC-12/A3: never itself. And never a PDF — text is written INTO a target,
    // and nothing is ever written into a PDF (KR-68). It is not offered rather
    // than offered-and-refused: the app is as large as what it can do.
    const others = this.tabs().filter((tab) => tab !== this.source && tab.kind !== "pdf");
    this.targetMenu = popover(this.aimButton, [
      ...others.map((tab) => ({ label: tab.title, run: () => aim(tab) })),
      ...(others.length ? ["-"] : []),
      { label: t("transfer.pickFromDisk"), muted: true, run: () => aim(this.pickFromDisk()) },
      { label: t("transfer.newEmpty"), muted: true, run: () => aim(this.createTarget()) },
    ]);
    if (!this.targetMenu) return; // second press on the send icon toggled it shut

    // A heading, because this menu answers a question the writer just asked by
    // pressing "Taşı" on a mark with no target open: where to?
    const heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = t("transfer.chooseHeading");
    this.targetMenu.prepend(heading);
  }

  // ---- opening and closing -------------------------------------------------

  async show({ source, target }) {
    this.source = source;
    this.target = target ?? null;
    this.open = true;
    this.travelAt = null;
    this.pendingSend = null;
    // The screen is about the source; nothing has been touched yet.
    this.side = "source";

    // Crossing a layer sweeps the transients (B-22): a search box opened over
    // the tabs has no business floating over Aktarma. The mode flag is what the
    // palette reads to stay shut in here (B-18, context.js).
    setAppMode("aktarma");
    closeAllSearch();

    // The screen opens split — source left, empty target right. Nothing is asked
    // of the writer on the way in; the target is chosen at "Taşı", not the door.
    this.fillBridge();
    await this.bind();

    this.dom.hidden = false;
    // Let the layer paint before animating in, so the transition is seen.
    requestAnimationFrame(() => this.dom.classList.add("open"));
  }

  /** Swaps the target without leaving the layer. */
  async retarget(tab) {
    this.unbind();
    this.target = tab;
    await this.bind();
    this.fillBridge();
    this.onPair?.(this.source, this.target);
  }

  /**
   * Moves the editors into the panels and takes the source's marks in hand.
   *
   * A PDF source needs nothing special here (28 Tem): its marks answer the same
   * questions a document's do, so `this.marks` below is simply its store. The
   * free-selection shortcut that stood here before marks existed has gone —
   * with it, selecting a passage opened a "Taşı" strip while the palette was
   * opening on the same passage, which is two floating boxes on one piece of
   * text (B-31). A PDF now marks exactly the way a document does: select and
   * the palette offers to mark, press the mark and the strip offers to move.
   */
  async bind() {
    this.sourcePanel.append(this.source.host);
    this.source.host.hidden = false;
    // Moving a scroller in the DOM puts it back at the top (see restorePlace).
    // Choosing a target rebinds both panels, and the source came back blank.
    this.source.pdf?.restorePlace();
    // A PDF source has no CM surface to make read-only — it never had one to
    // begin with (KR-68). Every other line below asks the same question the same
    // way: `view` and `marks` are the two things a PDF source does not bring.
    if (this.source.view) setReadOnly(this.source.view, true); // UC-12-K4

    if (this.target) {
      this.targetPanel.append(this.target.host);
      this.target.host.hidden = false;
      setReadOnly(this.target.view, false);
    }

    // The marks are the tab's, and they are already painted where they belong —
    // this screen does not re-anchor them, it only turns their strip round to
    // the face that sends (KR-55, KR-56). A PDF has none yet: it reads, and the
    // bridge shows ‹0/0› by showing nothing.
    if (this.marks) {
      this.marks.face = "aktarma";
      this.marks.onSend = (record) => this.sendMark(record);
      this.marks.onOpen = () => this.showGhostCaret({ reveal: true });
      this.marks.repaint();
    }
    this.showTravelCount();
    this.showGhostCaret();

    // The target's caret moves while it has focus; the ghost has to know where
    // it was left when focus comes back to the left-hand side — and it must not
    // be drawn at all while the target is being typed into.
    this.target?.view.dom.addEventListener("mouseup", this.onTargetMove);
    this.target?.view.dom.addEventListener("keyup", this.onTargetMove);
    this.target?.view.dom.addEventListener("focusin", this.onTargetMove);
    this.target?.view.dom.addEventListener("focusout", this.onTargetMove);

    this.target?.view.focus();
  }

  unbind() {

    if (this.marks) {
      this.marks.strip.hide();
      this.marks.face = "sekme";
      this.marks.onSend = null;
      this.marks.onOpen = null;
      this.marks.repaint(); // nobody is standing on a mark any more
    }
    this.target?.view.dom.removeEventListener("mouseup", this.onTargetMove);
    this.target?.view.dom.removeEventListener("keyup", this.onTargetMove);
    this.target?.view.dom.removeEventListener("focusin", this.onTargetMove);
    this.target?.view.dom.removeEventListener("focusout", this.onTargetMove);
    this.ghost.hidden = true;
    if (this.source?.view) setReadOnly(this.source.view, false);

    // Take the editors back out of the panels. Without this, switching the pair
    // leaves the previous document sitting in the panel beside the new one.
    this.source?.host.remove();
    this.target?.host.remove();
  }

  /** UC-12-K2: one click back, nothing closed, nothing lost — except the
      transients that belong to this layer: the search box, the target menu. */
  close() {
    this.unbind();
    setAppMode("sekme");
    closeAllSearch(); // B-22: the box does not ride back to the tabs
    this.targetMenu?.close(); // Ctrl+Shift+A can shut the layer under an open menu
    this.targetMenu = null;
    this.dom.classList.remove("open");
    this.open = false;
    this.travelAt = null;
    this.pendingSend = null;
    this.onClose?.();
    setTimeout(() => {
      if (!this.open) this.dom.hidden = true;
    }, 300);
  }

  // ---- sending -------------------------------------------------------------

  // focusout fires before the new focus lands, so the ghost is drawn a tick late
  // — otherwise it would decide "the target still has focus" and hide itself.
  onTargetMove = () => requestAnimationFrame(() => this.showGhostCaret());

  /**
   * Sends a mark's text into the target — now, or again later (KR-37, UC-13b).
   *
   * The piece comes off the surface, at the mark's live range: what is on screen
   * is what gets sent, even if the writer has been editing inside the mark since
   * it was made (KR-56).
   */
  async sendMark(record) {
    if (!this.target) {
      // "Taşı" was pressed — the move is a PROMISE, not a menu (B-23). Choosing
      // the target used to only set it: the writer picked "Yeni boş belge" and
      // got an empty page, the piece still standing on the left. The record
      // waits here and the move finishes the moment a target exists.
      this.pendingSend = record;
      this.chooseTarget();
      return;
    }

    const at = this.marks.list().find((each) => each.id === record.id);
    if (!at) return;

    // The piece comes off the surface at the mark's live range, and lands by the
    // one rule both ways in share (see land). A PDF's range is a page and a span
    // of that page's text, and it is repaired on the way out — the same repair a
    // free selection gets, because it is the same rubble underneath.
    this.land(
      this.source.pdf
        ? passageMarkdown(this.source.pdf.partsOfRange(at.page, at.from, at.to))
        : this.source.view.state.sliceDoc(at.from, at.to),
      this.citeFor(at),
    );

    // The mark records EVERY document it was sent into — and nothing about the
    // text over there, whose fate we no longer follow (KR-33).
    //
    // It used to keep only the last one, overwriting on each move, while the
    // rule "a piece may be moved as many times as you like" had been in place
    // from the start. Nobody noticed because nothing showed the record; the
    // margin does now (Zafer, 3 Ağu: "10 tane hedef olursa ne yapacaksın?").
    record.aktarma = withMove(record, this.target.path);
    await this.marks.write();

    this.marks.strip.hide();
    this.showGhostCaret(); // it moved: the next piece lands after this one
    this.say(t("transfer.transferred", { title: this.target.title }));
  }

  /**
   * Where a moved piece says it came from (KR-81): the link, and the words
   * behind it.
   *
   * The link is relative to the TARGET, because the target is the document that
   * will hold it — an absolute path breaks the moment the folder moves (the
   * portability law).
   *
   * One thing has no address and gets no link: a source never saved to disk. The
   * quote still lands; only the citation stays behind. That is consistent rather
   * than unfortunate — an unsaved document's marks are not written either
   * (`marks.write` returns without a path).
   *
   * The target was checked here too, until it was measured (8 Ağu): all three
   * ways of naming one guarantee a path. The open-tabs list is already filtered
   * by `tab.path` (main.js), "pick from disk" came from disk, and "new empty
   * document" asks for a name immediately (`createTarget` → `saveTab` → save
   * dialog) and closes the tab again if that is cancelled. A test for a state
   * that cannot occur reads as a state that can.
   */
  citeFor(at) {
    const path = this.source.path;
    if (!path) return {};
    // A PDF says the page. A document says the headings it sits under — the same
    // question, answered in the terms each one has (see citation.js).
    const where = {
      page: this.source.pdf ? at.page : null,
      trail: this.source.pdf ? [] : headingTrail(this.source.view.state.doc.toString(), at.from),
    };
    return {
      // The place rides in the link itself, so the citation opens where the
      // piece came from and not just the file it came from.
      href: relativePath(this.target.path, path) + fragmentFor(where),
      cite: citeText({ name: fileNameOf(path), ...where }),
    };
  }

  /**
   * Drops a piece into the target at its caret (KR-17, KR-81).
   *
   * The piece lands in the source's own Markdown, unconverted — but as a QUOTE,
   * with its source under it (29 Tem): what lands in someone else's document is
   * a quotation, and it should be readable as one without asking anybody. KR-17
   * still holds where it was aimed — no format is rewritten on the way over,
   * nothing is asked, "raw or quoted?" is not a question the writer answers.
   *
   * It lands as its own block: a blank line before it unless it is at the very
   * start, and one after unless the document ends there. Without that it fuses
   * with whatever the cursor was sitting in.
   *
   * Shared by both ways in — a mark being moved, and a passage selected in a PDF
   * (28 Tem). Where a piece comes from is the caller's business; where it lands
   * is one rule.
   */
  land(piece, source = {}) {
    const target = this.target.view;
    const into = target.state.selection.main;
    const doc = target.state.doc;

    const needsBefore =
      into.from > 0 &&
      !/\n\n$/.test(doc.sliceString(Math.max(0, into.from - 2), into.from));
    const needsAfter =
      into.to < doc.length &&
      !/^\n\n/.test(doc.sliceString(into.to, Math.min(doc.length, into.to + 2)));

    const block = quotedPiece(piece, source);
    const insert = `${needsBefore ? "\n\n" : ""}${block}${needsAfter ? "\n\n" : ""}`;

    target.dispatch({
      changes: { from: into.from, to: into.to, insert },
      selection: { anchor: into.from + insert.length },
      scrollIntoView: true,
    });
    this.touch(this.target);
  }

  /** Re-labels the bridge in the current language (called on a language change).
      The menus are built fresh on open, so only the persistent bar needs this. */
  relocalize() {
    this.aimButton.title = t("transfer.pickTarget");
    this.aimButton.setAttribute("aria-label", t("transfer.pickTarget"));
    this.closeTargetButton.title = t("transfer.closeTarget");
    this.closeTargetButton.setAttribute("aria-label", t("transfer.closeTarget"));
  }

  // ---- travelling ----------------------------------------------------------

  showTravelCount() {
    // Nothing to draw any more — the counter left the bridge (2 Ağu). Travelling
    // itself is unchanged: F8 walks the marks and `travelAt` still remembers
    // where the walk got to.
    // `listing()`, not `list()`, wherever the count is asked for: on a PDF the
    // second one only knows the marks whose page happens to be drawn.
  }

  /**
   * Travels to the next mark, or the previous one (KR-38). The marks are the
   * reason this screen exists, and in a 4.000-word document they are needles:
   * scrolling to find the one you commented on is not reading, it is searching.
   */
  travelTo(step) {
    const rows = this.marks?.listing() ?? [];
    if (!rows.length) return;

    const at =
      this.travelAt == null
        ? step > 0
          ? 0
          : rows.length - 1
        : (this.travelAt + step + rows.length) % rows.length;

    this.travelAt = at;

    if (this.source.pdf) {
      // The store drives this one. A PDF's mark has no place until its page is
      // drawn, and drawing is asynchronous — so the page is fetched, the anchor
      // resolved, the passage brought on screen and the strip opened by the same
      // code the tab's own F8 uses. Landing on the top of the sheet was not
      // enough: at this zoom a page is taller than the window (Zafer, 28 Tem).
      this.marks.travelTo(rows[at].id);
      this.showTravelCount();
      return;
    }

    const spot = this.marks.list().find((each) => each.id === rows[at].id);
    if (!spot) return;

    // The one you are standing on takes a deeper shade of the marks' own colour
    // — not a second colour, there is still no palette (KR-11).
    this.marks.repaint({ etkin: spot.id });
    this.source.view.dispatch({
      effects: EditorView.scrollIntoView(spot.from, { y: "center" }),
    });

    // And its strip opens (UC-12/5, UC-12-K8). Travelling used to only show you
    // the mark, on the grounds that nothing should follow you around — but on
    // this screen you travel in order to send, and leaving Gönder one further
    // click away made the two things the screen does into three.
    //
    // A tick later: the strip is placed against the mark's coordinates, and the
    // scroll above has not happened yet.
    requestAnimationFrame(() => this.marks.open(spot.record));

    this.showTravelCount();
  }
}
