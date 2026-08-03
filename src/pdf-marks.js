/**
 * A PDF's marks (KR-55, KR-68, Faz 2).
 *
 * Deliberately NOT a second kind of mark. The record is the one `marks.js`
 * writes, the sidecar is the one `sidecar.js` reads, and the anchor is the one
 * `anchor.js` resolves — because the anchor was never an offset in the first
 * place (KR-16): it is the quote plus its context, and that works just as well
 * on a page of a PDF as on a paragraph of Markdown. One field is added, `sayfa`,
 * because a PDF's text is built one page at a time and a page is also the thing
 * you cite.
 *
 * What differs is only what a mark IS on screen: in a document it is a range
 * CodeMirror decorates; here it is a set of rectangles painted under the text
 * mesh, because a PDF page is a picture and the words in front of it are
 * transparent (see pdf.js/paintPage).
 *
 * The class answers the same questions MarkStore does — list, mark, open, remove,
 * repaint, write — so Aktarma can borrow it without knowing which kind of
 * document it is standing on.
 */

import { GLYPH, Strip, icon } from "./strip.js";
import { palettesSuppressed } from "./palette.js";
import { makeAnchor, readSidecar, resolveAnchor, writeSidecar } from "./sidecar.js";
import { t } from "./i18n.js";
import { movedTo } from "./citation.js";
import { pointAnchor, popover } from "./popover.js";
import { fileNameOf } from "./paths.js";

/** A click, as a box the strip can be hung on. */
const pointRect = (event) => ({
  left: event.clientX,
  right: event.clientX,
  top: event.clientY,
  bottom: event.clientY,
});

const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class PdfMarkStore {
  /** @param {{ path: string, pdf: any }} tab the PDF tab this belongs to */
  constructor(tab, { say, onFollowTarget } = {}) {
    this.tab = tab;
    this.pdf = tab.pdf;
    this.say = say ?? (() => {});
    this.onFollowTarget = onFollowTarget;
    this.records = [];
    this.placed = new Map(); // id -> { page, from, to }
    this.face = "sekme";
    this.openId = null;
    // Two fields, not one — the documents' rule (marks.js): `activeId` is the
    // deeper shade, which is a "you are here" and dies with the next press;
    // `travelAt` is WHERE F8 stands, which survives it and resumes from there.
    // Keeping the position in the shade meant the shade could never be put out.
    this.activeId = null;
    this.travelAt = null;

    this.strip = new Strip({ dom: this.pdf.dom, focus: () => this.pdf.focus() });
    this.strip.onHide = () => {
      this.openId = null;
      this.repaint();
    };

    this.onMouseUp = (event) => this.onPress(event);
    this.pdf.dom.addEventListener("mouseup", this.onMouseUp);

    // Hovering a badge opens the strip as a PREVIEW, in the very spot a click
    // would open it (B-19): one box, one geometry. The pointer may travel into
    // it — that is what `hovered` is for — and leaving closes it unless a click
    // pinned it or a comment is being written.
    this.onHover = (event) => {
      // The comment's badge only — the arrow in the other margin is about where
      // the passage went, and hovering it must not open a comment.
      const badge = event.target.closest?.(".pdf-badge:not(.pdf-badge-sent)");
      if (badge) {
        clearTimeout(this.leaveTimer);
        const spot = this.byId(badge.dataset.mark);
        if (spot && spot.record.yorum && this.openId !== spot.id) {
          this.open(spot.record, { preview: true, fromBadge: true });
        }
        return;
      }
      // The pointer travelling INTO the box must not close it. Asked of the DOM,
      // not of the strip's `hovered` flag: mouseover reaches us before the
      // strip's own mouseenter has set it, so the flag is still false exactly
      // when it matters (Zafer, 28 Tem: "tıklamak isterken kutu kayboluyor").
      if (this.strip.dom.contains(event.target)) return;
      if (this.strip.pinned || this.strip.writing || this.strip.hovered) return;
      // A moment's grace for the gap between the badge and the box: leaving the
      // badge diagonally crosses bare page, and closing on that first frame
      // makes the box unreachable.
      clearTimeout(this.leaveTimer);
      this.leaveTimer = setTimeout(() => {
        if (!this.strip.pinned && !this.strip.writing && !this.strip.hovered && this.openId) {
          this.strip.hide();
        }
      }, 220);
    };
    this.pdf.dom.addEventListener("mouseover", this.onHover);
    this.strip.onLeave = () => {
      if (!this.strip.pinned && !this.strip.writing) this.strip.hide();
    };

    // The selection is remembered WHILE it is being made, not asked for after.
    //
    // pdf.js's own selection machinery moves its filler <div> back into place on
    // pointerup (see pdf.js/restLayer), and when the drag ended inside that
    // filler — which is most of the time, since it covers the page — moving it
    // collapses the selection. By the time our mouseup handler looks, there is
    // sometimes nothing there and sometimes there is: exactly the "kararsızlık"
    // Zafer saw. So the range is caught on the way past, and cleared when a new
    // press starts.
    this.onDown = () => {
      this.lastRange = null;
    };
    this.onSelectionChange = () => {
      const range = this.pdf.selectionRange();
      if (range) this.lastRange = range;
    };
    this.pdf.dom.addEventListener("mousedown", this.onDown);
    document.addEventListener("selectionchange", this.onSelectionChange);
  }

  /** Loads the sidecar. Anchors are resolved lazily, page by page, as pages are
      drawn — a mark cannot be found in text that has not been extracted yet. */
  async load() {
    const sidecar = await readSidecar(this.tab.path);
    this.records = sidecar.isaretler ?? [];
    this.sidecar = sidecar;
    this.resolveDrawn();
    this.repaint();
    this.onCount?.();
  }

  /** Binds every mark whose page is on screen. Cheap, and safe to repeat: a
      resolved mark is not resolved twice. */
  resolveDrawn() {
    for (const page of this.pdf.drawnPages()) {
      const text = this.pdf.textOfPage(page);
      if (!text) continue;
      for (const record of this.records) {
        if (record.sayfa !== page || this.placed.has(record.id)) continue;
        const at = resolveAnchor(record.cipa, text);
        // KR-16: what cannot be found is not deleted, it is unresolved. A PDF
        // does not change under us, so this means the extraction changed — and
        // silently dropping the reader's marks would be the worse answer.
        if (at) this.placed.set(record.id, { page, ...at });
      }
    }
  }

  /** Every mark that is currently on a drawn page, in reading order. */
  list() {
    return this.records
      .filter((record) => this.placed.has(record.id))
      .map((record) => ({ id: record.id, record, ...this.placed.get(record.id) }))
      .sort((a, b) => a.page - b.page || a.from - b.from);
  }

  at(page, from) {
    return this.list().find((each) => each.page === page && from >= each.from && from < each.to);
  }

  byId(id) {
    return this.list().find((each) => each.id === id);
  }

  /** Paints every drawn page: the marks it holds, and which one is standing out. */
  repaint({ etkin = this.activeId } = {}) {
    this.activeId = etkin ?? null;
    const marks = this.list();
    for (const page of this.pdf.drawnPages()) {
      this.pdf.paintPage(
        page,
        marks
          .filter((each) => each.page === page)
          .map((each) => ({
            id: each.id,
            from: each.from,
            to: each.to,
            active: each.id === this.activeId || each.id === this.openId,
            // A mark whose box is open wears a badge even with nothing written
            // in it yet: the box aligns to a real badge, and the writer sees
            // where the comment will live. It goes again on close if nothing
            // was written (onHide → repaint).
            note: Boolean(each.record.yorum?.metin) || each.id === this.openId,
            // The same second glyph a document's badge grew (3 Ağu): where this
            // passage was moved. Behaviour parity with .md is not a nicety here
            // — it has broken five separate ways in one round before, each for
            // its own reason, and every one of them started as "the PDF draws
            // its own badge, so it only needs the obvious half".
            moved: movedTo(each.record).length,
          })),
      );
    }
  }

  /** A page has just been drawn: its marks can now be found and painted. */
  onPagePainted() {
    this.resolveDrawn();
    this.repaint();
  }

  /**
   * Marks the current selection (UC-13). The anchor is built from the page's
   * text, so it survives everything except the page itself changing.
   */
  async mark({ comment = false, range = null } = {}) {
    range ??= this.pdf.selectionRange() ?? this.lastRange;
    if (!range) return null;
    const text = this.pdf.textOfPage(range.page);
    if (!text) return null;

    const record = {
      id: newId(),
      sayfa: range.page,
      cipa: makeAnchor(text, range.from, range.to),
    };
    this.records.push(record);
    this.placed.set(record.id, { page: range.page, from: range.from, to: range.to });

    window.getSelection()?.removeAllRanges();
    await this.write();
    this.repaint();
    this.onCount?.();
    if (comment) this.open(record, { writing: true });
    return record;
  }

  /**
   * Opens a mark's strip.
   *
   * Against the BADGE when the badge is what was pressed, against the passage
   * otherwise — the documents' rule (B-21, marks.js): a comment belongs to the
   * icon you just pressed, and a box that opens a column away from it reads as
   * belonging to something else (Zafer, 28 Tem: "kutu açılıyor ama rozetin
   * uzağında").
   */
  open(record, { writing = false, preview = false, fromBadge = false, bare = false, anchor = null } = {}) {
    const spot = this.byId(record.id);
    if (!spot) return;

    // The badge is drawn FIRST, then the box is hung on it: while a comment is
    // being written the mark wears a badge even though it has no comment yet
    // (see repaint), otherwise the box has nothing to align to and opens down at
    // the passage with the badge appearing afterwards, somewhere else (Zafer,
    // 28 Tem). marks.js solves it the same way, for the same reason.
    //
    // ONLY THEN. Pressing a piece in Aktarma opens "Taşı" and no box at all, and
    // it was conjuring a badge beside the passage anyway — a comment icon
    // standing for a comment that does not exist (Zafer, 29 Tem: "yorum seçersem
    // orada rozet görünmeliydi sadece"). The badge is the comment's; nothing
    // else may borrow it.
    this.openId = writing || fromBadge || preview ? record.id : null;
    // The piece you pressed still stands out while its strip is up — that was
    // riding on openId, and it is the shade's job, not the badge's.
    this.repaint({ etkin: record.id });

    // Where it opens, in order: the point that was pressed (Aktarma's "Taşı"
    // belongs beside the piece you pressed, B-21), then the badge (a comment
    // belongs to its icon), then the passage.
    const wantsBadge = fromBadge || writing;
    const badge = wantsBadge ? this.pdf.badgeRect(record.id) : null;
    const box = anchor ?? badge ?? this.pdf.rectOfRange(spot.page, spot.from, spot.to);
    if (!box) return;
    this.strip.show({
      mark: record,
      coords: box,
      face: this.face,
      writing,
      preview,
      fromBadge,
      bare,
      on: {
        send: () => this.onSend?.(record),
        comment: async (text) => {
          record.yorum = text ? { metin: text } : undefined;
          await this.write();
          this.repaint();
        },
        remove: () => this.remove(record),
      },
    });
  }

  closeStrip() {
    this.strip.hide();
    this.hidePalette();
  }

  /**
   * Goes to a mark and opens it — the marks list's door, and F8's (18 Tem).
   * A PDF travels by page, which is also what the mark is filed under.
   */
  async travelTo(id) {
    // Asked of the RECORDS, not of `list()`. A PDF resolves its anchors page by
    // page as pages are drawn, so a mark three pages down is not in `list()` at
    // all — travelling could only ever reach what was already on screen, which
    // is the one thing travelling is not for (Zafer, 28 Tem). Its page is drawn
    // first; only then does it have a place.
    const record = this.records.find((each) => each.id === id);
    if (!record) return;
    this.travelAt = id;
    await this.pdf.showPage(record.sayfa);
    this.resolveDrawn();

    const spot = this.byId(id);
    if (!spot) {
      // Unresolved (KR-16): the page is shown, because that is still where the
      // mark was made, but there is nothing to stand on.
      this.repaint();
      return;
    }
    this.pdf.revealRange(spot.page, spot.from, spot.to);
    this.repaint({ etkin: id });

    // In the tab, travelling SHOWS you the mark and stops there — nothing
    // follows you around (Zafer, 28 Tem: "öyle bir şey yok md tarafında"). Only
    // on Aktarma does the strip come with it, because there you travel in order
    // to send and leaving "Taşı" one more click away makes the two things that
    // screen does into three (UC-12/5).
    if (this.face !== "aktarma") {
      this.strip.hide();
      return;
    }
    // A tick later: the page has to be where it is going before the strip is
    // placed against it.
    requestAnimationFrame(() => this.open(spot.record));
  }

  /**
   * Every mark of the document in reading order — drawn pages or not. `list()`
   * answers "what is paintable right now"; this answers "what does this PDF
   * have", which is what travelling and the marks list ask.
   */
  all() {
    const where = (record) => this.placed.get(record.id);
    return [...this.records].sort(
      (a, b) => a.sayfa - b.sayfa || (where(a)?.from ?? Infinity) - (where(b)?.from ?? Infinity),
    );
  }

  /** The marks list's rows (chrome.js). An undrawn page has no text to quote
      from, so the label comes off the anchor — which IS the marked text (KR-16). */
  listing() {
    return this.all().map((record) => {
      const spot = this.placed.get(record.id);
      const page = spot ? (this.pdf.textOfPage(spot.page) ?? "") : "";
      return {
        id: record.id,
        record,
        text: spot ? page.slice(spot.from, spot.to) : (record.cipa?.metin ?? ""),
      };
    });
  }

  /** F8 / Shift+F8: the next mark, or the previous. Asked of `travelAt`, not of
      the shade: the shade goes out on the first click elsewhere, and F8 must
      still carry on from the mark it left off at. */
  travelStep(step) {
    const marks = this.all();
    if (!marks.length) return;
    const at = marks.findIndex((each) => each.id === this.travelAt);
    const next = at === -1 ? (step > 0 ? 0 : marks.length - 1) : (at + step + marks.length) % marks.length;
    this.travelTo(marks[next].id);
  }

  /** Puts the travelling shade out, if it is lit (marks.js/settleTravelShade).
      A press is attention moved: what you are looking at is where you pressed,
      not where F8 left you. */
  settleTravelShade() {
    if (!this.activeId) return;
    this.repaint({ etkin: null });
  }

  // ---- the selection palette ------------------------------------------------
  //
  // The narrowest form of the palette the documents get: `[işaretle · yorumla]`
  // and nothing else. Not the strip with a third face — the strip answers a
  // mark that already exists, the palette answers a selection that is not one
  // yet, and that division is why each of them stays one line long. Same class,
  // same glyphs, same two words, so it is the same object in the reader's eyes
  // (KR-55: marking and commenting, and ONLY those, wherever you read).
  //
  // Formatting is not here and never will be: a PDF cannot be written to
  // (KR-68). Nor is the AI — it works on a document's text.

  /**
   * @param {DOMRect} box  what the palette is about
   * @param {{glyph: string, name: string, run: Function}[]} actions
   */
  showPalette(box, actions) {
    // Alt+P is the reader's switch, not a surface's (Zafer, 29 Tem): a palette
    // turned off in a document must not bloom over a PDF selection. The right
    // click still works — that is a different gesture and it was never hidden.
    if (palettesSuppressed()) return;
    this.palette ??= this.buildPalette();

    // Narrow by nature: a PDF has no format group and no AI group, so what is
    // left is not a palette any more and wears the strip's clothes — paper
    // ground, hairlines between the verbs (palette.js/setNarrow). Without this
    // it stayed the dark palette while a document showed the light strip, and
    // the same gesture looked like two different objects.
    this.palette.className = "palette pdf-palette palette-strip";

    const buttons = actions.map((each) => this.paletteButton(each));
    const between = this.face === "aktarma";
    this.palette.replaceChildren(
      ...buttons.flatMap((button, at) =>
        between && at > 0
          ? [Object.assign(document.createElement("span"), { className: "palette-sep" }), button]
          : [button],
      ),
    );

    const host = this.pdf.dom;
    const page = host.getBoundingClientRect();
    this.palette.hidden = false;
    // Above the selection, and inside the surface: the same clamp the strip
    // uses, in the surface's own scrolled coordinates.
    const width = this.palette.offsetWidth || 90;
    const top = box.top - page.top + host.scrollTop - this.palette.offsetHeight - 8;
    const left = box.left - page.left + host.scrollLeft;
    this.palette.style.top = `${Math.max(host.scrollTop + 8, top)}px`;
    this.palette.style.left = `${Math.max(
      host.scrollLeft + 8,
      Math.min(left, host.scrollLeft + page.width - width - 8),
    )}px`;
  }

  hidePalette() {
    if (this.palette) this.palette.hidden = true;
  }

  buildPalette() {
    const dom = document.createElement("div");
    dom.className = "palette pdf-palette";
    dom.hidden = true;
    // Taking focus would drop the selection the palette is about.
    dom.onmousedown = (event) => event.preventDefault();
    dom.addEventListener("click", (event) => event.stopPropagation());
    this.pdf.dom.append(dom);
    return dom;
  }

  paletteButton({ glyph, name, run, word = false }) {
    const el = document.createElement("button");
    el.className = word ? "palette-move" : "palette-mark";
    el.title = name;
    el.innerHTML = word ? `${icon(GLYPH[glyph])}<span>${name}</span>` : icon(GLYPH[glyph]);
    el.setAttribute("aria-label", name);
    el.onclick = () => {
      this.hidePalette();
      run();
    };
    return el;
  }

  /**
   * What the palette offers — the documents' set, in the documents' ORDER
   * (palette.js/buildMark). The slots mean something and must not be improvised:
   *
   *   slot 1 — the mark itself: İşaretle becomes Sil, so putting a mark on and
   *            taking it off are the same button in the same place.
   *   slot 2 — the comment: says Yorumla in both states, so it never moves.
   *
   * In Aktarma "Taşı" leads, and it is the one WORD among icons — the reason you
   * are on that screen (KR-71).
   */
  paletteActions(spot) {
    if (!spot) {
      return [
        // The range the palette was opened for, not whatever the selection has
        // become by the time the button is pressed.
        { glyph: "pen", name: t("palette.mark"), run: () => this.mark({ range: this.pending }) },
        {
          glyph: "note",
          name: t("palette.markComment"),
          run: () => this.mark({ comment: true, range: this.pending }),
        },
      ];
    }

    const actions = [];
    if (this.face === "aktarma") {
      actions.push({
        glyph: "send",
        name: t("strip.move"),
        word: true,
        run: () => this.onSend?.(spot.record),
      });
    }
    actions.push(
      { glyph: "trash", name: t("palette.markRemove"), run: () => this.remove(spot.record) },
      { glyph: "note", name: t("palette.comment"), run: () => this.open(spot.record, { writing: true }) },
    );
    return actions;
  }

  /**
   * What a press on the page means (KR-73: what you clicked decides).
   *
   * A mark under the pointer opens its strip; a fresh selection opens the
   * palette; anything else closes both. Aktarma sets `face` before this runs,
   * so the same press answers with "Taşı" over there and with the comment tools
   * here — one component, two faces, one rule.
   */
  onPress(event) {
    if (this.strip.dom.contains(event.target)) return;
    if (this.palette?.contains(event.target)) return;

    // Every press ends the journey's shade — the badge's too, and on BOTH faces
    // (Zafer, 29 Tem: "‹ › ile gelip başka yere tıkladığımda sönümlenmiyor").
    // The shade is a "you are here" and a press is attention moved; where the
    // journey stands is a separate thing and survives it, exactly as F8's does
    // in the tab. The bridge's ‹n/m› therefore keeps counting from where it was.
    this.settleTravelShade();

    requestAnimationFrame(() => {
      // A SELECTION beats everything under the pointer. Marking is a drag and a
      // drag ends somewhere: if the release happened to land on a mark, asking
      // "what is under the pointer" answered about that mark and opened its
      // comment box instead of the palette — so a marked passage could only be
      // acted on by selecting it exactly end to end (Zafer, 28 Tem).
      const live = this.pdf.selectionRange() ?? this.lastRange;
      const badge = event.target.closest?.(".pdf-badge");

      // The arrow half of the badge asks a different question from the bubble:
      // "where did this passage go", not "what did I write about it". Same door,
      // same behaviour, same order as a document's (marks.js/onClick).
      if (!live && badge?.classList.contains("pdf-badge-sent")) {
        const spot = this.byId(badge.dataset.mark);
        const hedefler = movedTo(spot?.record);
        if (!hedefler.length) return;

        // The pressed point, not the badge: a badge is redrawn with its page
        // and its position is written a frame late, so its rect is either stale
        // or zero depending on when you ask (marks.js says this at more length).
        const at = pointAnchor(event);
        this.hidePalette();
        this.strip.hide();

        if (hedefler.length === 1) {
          this.onFollowTarget?.(hedefler.at(-1).hedefBelge);
          return;
        }
        popover(
          at,
          [...hedefler].reverse().map((each) => ({
            label: fileNameOf(each.hedefBelge),
            run: () => this.onFollowTarget?.(each.hedefBelge),
          })),
        );
        return;
      }
      // In the TAB, only the badge opens anything: pressing marked text does
      // nothing at all, exactly as in a document (marks.js/onClick returns null
      // there). Aktarma is the screen where pressing the piece means something —
      // "Taşı" — and that is the only place it answers.
      const onPiece = this.face === "aktarma" ? this.pdf.markAt(event.clientX, event.clientY) : null;
      const id = live ? null : (badge?.dataset.mark ?? onPiece);
      if (id) {
        const spot = this.byId(id);
        this.hidePalette();
        if (spot) {
          // Pressing the passage asks about the piece; the comment is the
          // badge's business.
          this.open(spot.record, {
            fromBadge: Boolean(badge),
            bare: !badge,
            anchor: badge ? null : pointRect(event),
          });
          this.strip.pinned = true;
        }
        return;
      }

      const range = this.pdf.selectionRange() ?? this.lastRange;
      if (!range) {
        this.hidePalette();
        this.strip.hide();
        return;
      }
      this.pending = range;
      // Which mark the selection is standing in, if any.
      const spot = this.at(range.page, range.from);

      this.strip.hide();
      const box = this.pdf.rectOfRange(range.page, range.from, range.to);
      if (box) this.showPalette(box, this.paletteActions(spot));
    });
  }

  async remove(record) {
    // Travelling stands on an id here (a document stands on an index), so the
    // deleted mark's id is a place that no longer exists: travelStep would find
    // -1 and start over at the first mark. It stands on the one BEFORE instead —
    // then the next F8 goes where it would have gone anyway.
    if (this.travelAt === record.id) {
      const order = this.all();
      const at = order.findIndex((each) => each.id === record.id);
      this.travelAt = at > 0 ? order[at - 1].id : null;
    }
    this.records = this.records.filter((each) => each.id !== record.id);
    this.placed.delete(record.id);
    this.strip.hide();
    await this.write();
    this.repaint();
    this.onCount?.();
  }

  /** Marks live beside the PDF, in .mdplus/ — never inside it (KR-15, KR-68). */
  async write() {
    await writeSidecar(this.tab.path, { ...this.sidecar, isaretler: this.records });
  }

  destroy() {
    this.pdf.dom.removeEventListener("mouseup", this.onMouseUp);
    this.pdf.dom.removeEventListener("mousedown", this.onDown);
    this.pdf.dom.removeEventListener("mouseover", this.onHover);
    document.removeEventListener("selectionchange", this.onSelectionChange);
    this.strip.hide();
    this.strip.dom.remove();
    this.palette?.remove();
  }
}
