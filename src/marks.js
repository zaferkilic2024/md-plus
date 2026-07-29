// The marks of one open document (KR-55, KR-56, UC-13, UC-14).
//
// Marking and commenting belong to the tab now. They used to live in Aktarma,
// which meant leaving the document to highlight a sentence you were reading —
// while the tab painted marks it would not let you make. The tab showed them and
// would not do them; this closes that gap. Aktarma keeps the other two jobs:
// travelling between marks, and sending them (KR-57).
//
// The rule that makes writing safe around a mark is KR-56, and it is worth
// saying plainly: while the document is open, an anchor is never asked where a
// mark is. See surface.js (the live range) and anchor.js (reanchor).

import { EditorView } from "@codemirror/view";
import { makeAnchor, reanchor, readSidecar, resolveAnchor, writeSidecar } from "./sidecar.js";
import { liveMarks, setMarks } from "./surface.js";
import { hidePalettes } from "./palette.js";
import { Strip } from "./strip.js";
import { t } from "./i18n.js";

const newId = () => `i_${Math.random().toString(36).slice(2, 8)}`;

export class MarkStore {
  /**
   * @param {object} tab   the document these belong to (its path and its view)
   * @param {object} deps
   * @param {(message: string) => void} deps.say
   * @param {() => Promise<boolean>} deps.ensureSaved  marks live beside the file
   */
  constructor(tab, { say, ensureSaved }) {
    this.tab = tab;
    this.say = say;
    this.ensureSaved = ensureSaved;

    /** The sidecar's records: id, anchor, comment, transfer. */
    this.records = [];
    this.sidecar = null;

    /** Which face the strip wears — Aktarma flips it while it holds the tab. */
    this.face = "sekme";
    this.strip = new Strip({ dom: tab.view.dom, focus: () => tab.view.focus() });

    /** Where travelling stands (F8 / the marks list) — the tab's own cursor
        through its marks; Aktarma keeps a separate one for its bridge. The
        shade is tracked apart from the position: a click puts the shade out,
        but F8 still resumes from where it left off. */
    this.travelAt = null;
    this.travelShade = null;

    // While a comment box is open, its mark shows its badge even if the comment
    // is still empty — so the box has a real badge to align to, and the writer
    // sees the mark took (Zafer). Closing the box with nothing written drops the
    // badge again (onHide → repaint, and an empty mark is not `yorumlu`).
    this.openId = null;
    this.strip.onHide = () => {
      if (this.openId != null) {
        this.openId = null;
        this.repaint();
      }
    };

    tab.view.dom.addEventListener("click", this.onClick);

    // The badge answers to hovering too (B-19): the comment opens as a preview
    // — the same strip, the same spot a click would use, so nothing jumps when
    // the click comes. Delegated to view.dom because badges are CodeMirror
    // widgets: rebuilt at will, so they can never hold their own listeners.
    this.hoverTimer = null;
    tab.view.dom.addEventListener("mouseover", this.onHover);
    tab.view.dom.addEventListener("mouseout", this.onHoverOut);
    this.strip.onLeave = () => this.settleHover();
  }

  destroy() {
    this.tab.view.dom.removeEventListener("click", this.onClick);
    this.tab.view.dom.removeEventListener("mouseover", this.onHover);
    this.tab.view.dom.removeEventListener("mouseout", this.onHoverOut);
    clearTimeout(this.hoverTimer);
  }

  // ---- the badge's hover face (B-19) ----------------------------------------

  onHover = (event) => {
    // On both faces: in Aktarma a comment is read-only but still READ (KR-57 —
    // "yorum yalnız okunur"), and this preview is where it is read; the strip's
    // Aktarma face itself carries no comment. The verbs stay face-bound: a
    // CLICK opens sekme's pen/trash or Aktarma's "Taşı".
    const badge = event.target.closest?.(".cm-rozet");
    if (!badge) return;
    clearTimeout(this.hoverTimer);

    // What is already open decides whether a hover may take over.
    if (!this.strip.dom.hidden) {
      // Never over a comment being written.
      if (this.strip.dom.querySelector("textarea")) return;

      const ayni = this.strip.mark?.id === badge.dataset.mark;
      const yorumDuruyor = Boolean(this.strip.dom.querySelector(".note-comment"));

      // Someone else's pinned strip stays put (two commented marks close
      // together, the hand slides across).
      if (!ayni && this.strip.pinned) return;
      // This badge's own comment is already on screen: nothing to redraw.
      if (ayni && yorumDuruyor) return;
      // Otherwise the badge wins — including over its own mark's "Taşı", which
      // used to swallow the hover and leave the comment unreadable while it
      // stood open (Zafer, 28 Tem).
    }
    const record = this.records.find((each) => each.id === badge.dataset.mark);
    if (!record?.yorum) return; // nothing to read; the verbs still take a click

    this.open(record, { anchor: badge.getBoundingClientRect(), preview: true });
  };

  onHoverOut = (event) => {
    if (!event.target.closest?.(".cm-rozet")) return;
    this.settleHover();
  };

  /**
   * The pointer left the badge or the strip. A beat later — long enough to
   * cross the gap between them, since the box opens 4px below the badge — if it
   * is on neither and nothing pins the strip open, the preview goes.
   */
  settleHover() {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => {
      const strip = this.strip;
      if (strip.dom.hidden || strip.pinned || strip.hovered || strip.writing) return;
      strip.hide();
    }, 120);
  }

  // ---- reading and writing the sidecar --------------------------------------

  /**
   * Places every mark the sidecar knows about — the one moment an anchor is
   * consulted (KR-56), because this is the one moment the file may have changed
   * behind our back (IS-08, UC-16).
   *
   * A mark whose anchor no longer resolves is DROPPED (KR-36). It used to
   * survive as "unresolved": kept, badged, listed, waiting to be re-attached by
   * hand. That was a standing invitation to accumulate rubbish — a mark whose
   * text is gone is, nine times out of ten, a mark whose reason is gone too. So
   * it goes, and the count is said once, out loud, so a lost comment is never
   * lost quietly.
   */
  async load() {
    if (!this.tab.path) return;

    this.sidecar = await readSidecar(this.tab.path);
    const text = this.tab.view.state.doc.toString();
    const placed = [];
    const kept = [];
    let dropped = 0;

    for (const record of this.sidecar.isaretler ?? []) {
      const at = resolveAnchor(record.cipa, text);
      if (!at) {
        dropped++;
        continue;
      }
      kept.push(record);
      placed.push({ id: record.id, ...at });
    }

    this.records = kept;
    this.travelAt = null;
    this.apply(placed);
    this.onCount?.(); // the strip's marks tool shows itself only with marks

    if (dropped) {
      await this.write();
      this.say(t("status.marksDropped", { n: dropped }));
    }
  }

  /**
   * Writes the sidecar as it stands. Anchors are deliberately not touched here:
   * they describe the text on disk, and between saves the text on disk is not
   * what is on screen (KR-56). Refreshing them is `save`'s job.
   */
  async write() {
    if (!this.tab.path) return;
    await writeSidecar(this.tab.path, { ...this.sidecar, isaretler: this.records });
  }

  /**
   * The other half of KR-56: every anchor rewritten from where its mark actually
   * is. This runs on save, beside the .md write, so that what the anchors
   * describe is exactly what landed on disk — which is what makes the mark be
   * there, in one piece and 40 words fatter, when the document is opened again
   * (UC-16-K5).
   */
  async save() {
    if (!this.tab.path || !this.records.length) return this.write();

    const state = this.tab.view.state;
    const text = state.doc.toString();
    const live = new Map(liveMarks(state).map((each) => [each.id, each]));
    const etkin = liveMarks(state).find((each) => each.etkin)?.id ?? null;

    const kept = [];
    const placed = [];
    let dropped = 0;
    let moved = false;

    for (const record of this.records) {
      const at = live.get(record.id);
      const now = reanchor(record.cipa, text, at);
      if (!now) {
        dropped++;
        continue;
      }
      record.cipa = now.cipa;
      kept.push(record);
      placed.push({ id: record.id, from: now.from, to: now.to });
      // A mark whose text was deleted and then brought back by Ctrl+Z is found
      // by its anchor, not by its range — its range is still collapsed (SD-17),
      // so the surface has to be told where it went.
      if (!at || at.from !== now.from || at.to !== now.to) moved = true;
    }

    this.records = kept;

    // Before the write, not after: `placed` describes the document as it was
    // read a few lines up, and the write goes to disk — the writer can get a
    // keystroke in while it does. Painting those positions afterwards would put
    // the marks where the text used to be.
    //
    // On the usual save there is nothing to paint at all: the marks are already
    // exactly where the surface has been carrying them.
    if (dropped || moved) this.apply(placed, { etkin });

    await this.write();
    if (dropped) this.say(t("status.marksDeleted", { n: dropped }));
  }

  // ---- the marks on the surface ---------------------------------------------

  /** Puts a set of positions on the surface, each with its comment. */
  apply(placed, { etkin = null } = {}) {
    const meta = new Map(this.records.map((record) => [record.id, record]));
    this.tab.view.dispatch({
      effects: setMarks.of(
        placed
          .filter((each) => meta.has(each.id))
          .map((each) => ({
            id: each.id,
            from: each.from,
            to: each.to,
            yorumlu: Boolean(meta.get(each.id).yorum) || this.openId === each.id,
            etkin: each.id === etkin,
          })),
      ),
    });
  }

  /** Repaints where they already are: nothing moves, the comments catch up. */
  repaint({ etkin = null } = {}) {
    // Whatever paints now IS the shade's state — a repaint without `etkin`
    // (opening a strip, marking) already put the travelling shade out, and the
    // flag must not claim otherwise.
    this.travelShade = etkin;
    this.apply(liveMarks(this.tab.view.state), { etkin });
  }

  /**
   * The marks as they stand, in document order: the live range joined to the
   * record it belongs to. A mark whose text has been deleted is not in here — it
   * has nowhere to be on screen — but it is still on the surface, waiting for
   * the next save to decide (SD-17).
   */
  list() {
    const meta = new Map(this.records.map((record) => [record.id, record]));
    return liveMarks(this.tab.view.state)
      .filter((each) => each.to > each.from && meta.has(each.id))
      .map((each) => ({ ...each, record: meta.get(each.id) }))
      .sort((a, b) => a.from - b.from);
  }

  /** The marks list's rows (chrome.js), the same shape a PDF answers with — so
      the strip's tool asks one question of both kinds of document. */
  listing() {
    return this.list().map((each) => ({
      id: each.id,
      record: each.record,
      text: this.tab.view.state.sliceDoc(each.from, each.to),
    }));
  }

  at(pos) {
    // Half-open, like every range in this codebase — and unlike the first
    // version, which took `pos <= to` and so answered "yes, that is the mark"
    // for the position just past its last character. In Aktarma that is the
    // whole empty right-hand side of a line: clicking anywhere in it opened
    // "Taşı" for a mark you were not pointing at (Zafer, 28 Tem). A click lands
    // on a mark when it lands ON it.
    return this.list().find((each) => pos >= each.from && pos < each.to);
  }

  // ---- travelling in the tab (18 Tem) ---------------------------------------
  //
  // The same language Aktarma speaks — a deeper shade of the marks' own colour
  // on the one you are standing on — because it is the same act: in a
  // 4.000-word document your marks are needles, here as there.

  /** F8 / Shift+F8: the next mark, or the previous one, wrapping. */
  travelStep(step) {
    const placed = this.list();
    if (!placed.length) return;
    const at =
      this.travelAt == null
        ? step > 0
          ? 0
          : placed.length - 1
        : (this.travelAt + step + placed.length) % placed.length;
    this.travelGo(placed, at);
  }

  /** A row in the marks list was chosen (chrome.js). */
  travelTo(id) {
    const placed = this.list();
    const at = placed.findIndex((each) => each.id === id);
    if (at !== -1) this.travelGo(placed, at);
  }

  travelGo(placed, at) {
    this.travelAt = at;
    const spot = placed[at];
    // The deeper shade is a "you are here", and it lives only as long as the
    // journey: the next click or keystroke elsewhere puts it out (Zafer,
    // 18 Tem). travelAt survives it — F8 resumes where it left off.
    this.repaint({ etkin: spot.id }); // repaint records the shade (travelShade)
    this.tab.view.dispatch({
      effects: EditorView.scrollIntoView(spot.from, { y: "center" }),
    });
  }

  /** Puts the travelling shade out, if it is lit. */
  settleTravelShade() {
    if (!this.travelShade) return;
    this.travelShade = null;
    this.repaint();
  }

  // ---- what the writer does -------------------------------------------------

  /**
   * Marks the selection (UC-13).
   *
   * Marking, commenting and sending are three separate acts (KR-37). They used
   * to be one: you selected text and pressed "Aktar", which marked it and sent
   * it in a single stroke — so a passage could only ever be sent once, because
   * the second time round it was already marked and marked text offered no
   * selection button. The selection only ever marks now.
   */
  async mark({ comment = false } = {}) {
    const view = this.tab.view;
    const range = view.state.selection.main;

    // SD-01: an empty or whitespace-only selection offers nothing. Silently.
    if (range.empty || !view.state.sliceDoc(range.from, range.to).trim()) return null;

    // Marks live beside the file (KR-15), so there has to be a file. Same
    // bargain as putting a link into a document that has never been saved.
    if (!this.tab.path && !(await this.ensureSaved())) return null;

    const record = {
      id: newId(),
      cipa: makeAnchor(view.state.doc.toString(), range.from, range.to),
    };
    this.records.push(record);
    this.apply([
      ...liveMarks(view.state),
      { id: record.id, from: range.from, to: range.to },
    ]);
    await this.write();
    this.onCount?.();

    // "İşaretle" marks and gets out of the way; "Yorumla" marks and opens the
    // strip on its writing face, because you already know you have something to
    // say.
    if (comment) this.open(record, { writing: true });
    return record;
  }

  /** Opens a mark's strip — its one line of verbs (KR-39). */
  open(record, { writing = false, anchor = null, preview = false, fromBadge = false } = {}) {
    const view = this.tab.view;
    const at = liveMarks(view.state).find((each) => each.id === record.id);
    if (!at || at.to <= at.from) return;

    // The strip takes the floor. Not on a hover, which is a glance and must not
    // sweep away the verbs you were reaching for.
    if (!preview) hidePalettes();

    // Show the badge now, so there is a real one to align to and the writer sees
    // the mark took. An empty mark drops it again on close (onHide).
    //
    // Not in Aktarma, though, and not for a mark with nothing to say: there a
    // click answers with "Taşı" and nothing else, so a comment badge blinking
    // into the margin beside it announces a comment that does not exist (Zafer,
    // 28 Tem). The badge is the comment's icon; it appears when there is one.
    if (this.face !== "aktarma" || writing || record.yorum) {
      this.openId = record.id;
      this.repaint();
    }

    // Where the strip anchors is the face's affair (B-21, strip.js/place).
    //
    // sekme: its top-right corner meets the badge. From a click on the badge we
    // have its rect; otherwise the badge was just drawn but its measured position
    // may lag a frame, so we compute its spot instead of reading a stale rect:
    // the mark's first line (vertical), the line's right edge + the badge's own
    // -34px margin (horizontal).
    //
    // aktarma: it opens at the mark itself — the caller may hand in the click
    // point; travelling hands in nothing and the mark's first line serves.
    //
    // …unless a COMMENT is what is about to open (28 Tem). Then the badge is the
    // anchor on either face, because the badge is where the writer just pressed
    // and where the comment lives. Anchored at the mark's first character
    // instead, the box appeared at the far left of the line while the icon that
    // summoned it sat in the right margin — the same "the box appeared far away"
    // this comment already warns about, met again from the other side.
    const commentBox = writing || Boolean(record.yorum);
    let coords = anchor;
    if (!coords) {
      const line = view.coordsAtPos(at.from);
      if (!line) return;
      if (this.face === "aktarma" && !commentBox) {
        coords = line;
      } else {
        const box = view.dom.getBoundingClientRect();
        const dom = view.domAtPos(at.from);
        const node = dom.node.nodeType === 3 ? dom.node.parentElement : dom.node;
        const lineEl = node?.closest?.(".cm-line");
        const lineRight = lineEl ? lineEl.getBoundingClientRect().right : box.right - 46;
        coords = { top: line.top, bottom: line.bottom, right: lineRight + 34 };
      }
    }

    this.strip.show({
      mark: record,
      coords,
      face: this.face,
      writing,
      preview,
      fromBadge,
      on: {
        send: () => this.onSend?.(record),
        comment: (text) => this.comment(record, text),
        remove: () => this.remove(record),
      },
    });
    this.onOpen?.(record);
  }

  /** UC-14/A1: dropping the comment leaves the mark standing (KR-37). */
  async comment(record, text) {
    if (text) record.yorum = { metin: text, guncelleme: new Date().toISOString() };
    else delete record.yorum;
    await this.write();
    // Not while the box is being typed in. The 600ms autosave used to repaint
    // mid-writing; a repaint is a dispatch, a dispatch schedules a measure, and
    // CodeMirror's enforceCursorAssoc can steal focus during a measure (the
    // badge trap, surface.js) — the writer pressed Enter and found themselves
    // in the document (B-24, seen once). The badge needs nothing meanwhile
    // (openId keeps it up); the close repaints (onHide).
    if (!this.strip.writing) this.repaint();
  }

  /** UC-15: the mark goes. The text it was sent to is never touched (KR-33). */
  async remove(record) {
    this.records = this.records.filter((each) => each !== record);
    await this.write();
    this.repaint();
    this.strip.hide();
    this.onCount?.();
  }

  /**
   * What a click on a mark does — and it is not the same thing on both screens.
   *
   * In the tab, nothing. A click there is where the caret goes: the writer is
   * reading and writing their own document, and a box appearing under the cursor
   * every time they touched a marked passage turned their own marks into
   * tripwires (Zafer, 16 Tem). So the strip has a door you knock on deliberately
   * — the badge — and the rest is the palette's job: select any of the mark and
   * it offers to comment it or remove it.
   *
   * In Aktarma the surface is read-only, so a click is not a caret and there is
   * nothing to interrupt; the mark opens its strip, which is what that screen is
   * for (UC-13b).
   */
  onClick = (event) => {
    const view = this.tab.view;

    // The strip and the palette float inside the editor's own DOM, so their
    // clicks arrive here too — and would be read as a click on whatever text
    // happens to lie under them. Left alone, pressing the pencil re-opened the
    // strip and then this shut it again, in that order.
    if (event.target.closest?.(".note, .palette")) return;

    // The badge hangs out in the margin, off the text, so asking what document
    // position is under it answers with the nearest line — not with the mark it
    // belongs to. It says which mark it is; take its word for it.
    const badge = event.target.closest?.(".cm-rozet");

    // A selection is the palette's business, and in Aktarma the palette already
    // carries "Taşı" for the mark it stands in (KR-71). Without this the two
    // arrived together — the same verb twice, in two boxes, from one gesture
    // (Zafer, 28 Tem). A click on the badge is exempt: that is the comment's
    // door and it opens whatever is selected.
    if (!badge && !view.state.selection.main.empty) return;

    const id = badge?.dataset.mark;
    const found = id
      ? this.list().find((each) => each.id === id)
      : this.face === "aktarma"
        ? this.at(view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? -1)
        : null;

    if (!found) {
      this.strip.hide();
      // On both faces (Zafer, 29 Tem). The shade used to be left alone in
      // Aktarma, as the bridge's property — but it is a "you are here", and a
      // press elsewhere is attention moved wherever you are standing. Where the
      // journey STANDS is the separate thing, and that still survives: the
      // bridge's ‹n/m› carries on from the same mark.
      this.settleTravelShade();
      return;
    }
    // Opened from the badge → open UNDER the badge (where the click was), not at
    // the mark's text start, which sits in the margin's opposite corner and read
    // as "the box appeared far away". The badge's own rect is the anchor. In
    // Aktarma the anchor is the click itself: "Taşı" belongs beside the mark you
    // pressed, not off in the right margin (B-21).
    const anchor = badge
      ? badge.getBoundingClientRect()
      : this.face === "aktarma"
        ? {
            left: event.clientX,
            right: event.clientX,
            top: event.clientY,
            bottom: event.clientY,
          }
        : null;
    // A click on the BADGE is a click on the comment, on either screen: it opens
    // what the comment says, with the verbs that belong to a comment. A click on
    // the marked TEXT is a click on the piece — in Aktarma that answers "Taşı".
    // Two icons, two subjects; the strip does not have to guess which you meant.
    this.open(found.record, { ...(anchor ? { anchor } : {}), fromBadge: Boolean(badge) });
  };

  /**
   * The mark the selection is standing in, if any (UC-13/A2).
   *
   * This is what lets the palette offer a mark's own verbs instead of offering
   * to mark it a second time — which is what it used to do: selecting inside a
   * marked passage and pressing İşaretle laid a second mark over the first.
   */
  selected() {
    const range = this.tab.view.state.selection.main;
    return (
      this.list().find((each) => range.from < each.to && range.to > each.from)
        ?.record ?? null
    );
  }

  /** Every mark the selection touches. One is a subject; two are a question the
      palette cannot answer, so it asks for the count, not just the first. */
  selectedMarks() {
    const range = this.tab.view.state.selection.main;
    return this.list()
      .filter((each) => range.from < each.to && range.to > each.from)
      .map((each) => each.record);
  }

  /** Hand a mark to whoever is listening for sends — Aktarma, and only it. */
  send(record) {
    this.onSend?.(record);
  }

  /** The other direction of the same rule: a palette opening puts the strip
      away. Never over a comment being written — that box is not in the way of
      anything, it IS the work. */
  closeStrip() {
    if (this.strip.dom.hidden) return;
    if (this.strip.dom.querySelector("textarea")) return;
    this.strip.hide();
  }

  /** The strip is about a mark, not about writing: typing puts it away — and
      so does it put out the travelling shade (writing is attention moved). */
  onEdit() {
    this.settleTravelShade();
    // Not while it is being written in: a comment box must not vanish because
    // the document changed underneath it (an autosave repaint, a stray key).
    if (this.strip.dom.hidden || this.strip.dom.querySelector("textarea")) return;
    this.strip.hide();
  }
}
