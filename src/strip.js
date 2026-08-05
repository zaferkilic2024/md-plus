// The strip a mark opens: one component, two faces (KR-55).
//
// The strip is the same object in both places — two of them would drift apart,
// and then a mark would mean one thing on the left of the screen and another on
// the right — and each face carries only the verbs of the screen it stands on:
//
//   sekme:   [yorum düz metin / "Yorumla"] · ✎ · 🗑   — no move
//   aktarma: "Taşı"                                   — no comment, no ✎, no 🗑
//
// KR-71 (28 Tem) put marking and commenting back on this screen, but in the
// PALETTE, not here — so this division survived it intact. The alternative was
// tried for an hour: comment tools on the strip as well, and the same three
// verbs then lived in two containers, each changing shape with the state.
// One verb, one place.
//
// "Gönder" was wrong (Zafer, 17 Tem): nothing is *sent* anywhere, a
// piece is *moved* into another document. It is just "Taşı" — where to is
// answered by the split layout (an empty target panel is on screen from the
// start), not by the word, so the word does not have to change with the target.
//
// A strip, not a form: one line unless you ask it to grow. It used to be a card
// with a comment box in it, which meant the commonest thing you want from a mark
// arrived as a small icon under an empty textarea nobody asked for.

import { t } from "./i18n.js";

export const icon = (paths, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">${paths}</svg>`;

/**
 * The actions on a mark used to be words on a link. A note is a small thing; a
 * stack of sentences inside it reads like a form. They are quiet icons now: they
 * say their name when hovered (B-06).
 */
export const GLYPH = {
  check: '<path d="M20 6L9 17l-5-5"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  send: '<path d="M4 12h13M12 6l6 6-6 6"/><path d="M21 4v16"/>',
  pen: '<path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  // The long thin arrow back the way you came — one meaning, two doors: out of
  // Aktarma (transfer.js) and back along a followed link (chrome.js, 18 Tem).
  back: '<path d="M21 12H3"/><path d="M10.5 4.5L3 12l7.5 7.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>',
  // A marked passage among lines of prose: the block IS the mark. It was drawn
  // in chrome.js's own ICONS, which is fine for the strip and wrong for
  // everyone else — popover looks the name up in GLYPH, so "işaretlerde ara"
  // came out with no icon at all. One dictionary (this one); chrome re-exports.
  marks: '<path d="M4 5.5h16"/><rect x="4" y="9.5" width="9.5" height="5" rx="1.5"/><path d="M17 12h3"/><path d="M4 18.5h16"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  // The app's own page: what it is, what it can do, where its source is.
  //
  // NOT a house. Every creative-suite launcher on this desktop wears one, and
  // beside our own icon it would read as somebody else's home button (Zafer,
  // 2 Ağu). What the page actually does is answer questions about the app, so
  // it wears the drawing that means exactly that and nothing else here.
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/>',
  // Source code: the two brackets every developer reads without being told.
  code: '<path d="M9 6.5L3.5 12 9 17.5M15 6.5L20.5 12 15 17.5"/>',
  // An issue: the note bubble with a question in it — not the warning triangle,
  // which is this app's one warning and means something else entirely (KR-53).
  issue: '<path d="M12 3.5c-4.7 0-8.5 3.1-8.5 7 0 2.2 1.2 4.2 3.1 5.4-.1 1.5-.8 2.9-2 4 2-.2 3.9-1 5.4-2.2.6.1 1.3.2 2 .2 4.7 0 8.5-3.1 8.5-7s-3.8-7.4-8.5-7.4z"/><path d="M12 8.6v3.2"/><path d="M12 14.4h.01"/>',
  // A licence: a page with a seal on it.
  // Karşılama ekranının alt satırı için (6 Ağu). İkisinin de anlamı boştu:
  // küre = dil, kalp = açık kaynak. Başka hiçbir yerde kullanılmazlar.
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  heart:
    '<path d="M12 20s-7-4.6-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7C19 15.4 12 20 12 20z"/>',
  license: '<path d="M6 3.5h8l4 4v7"/><path d="M6 3.5v17h6"/><circle cx="17" cy="17.5" r="3"/><path d="M15.4 20l-.4 3 2-1 2 1-.4-3"/>',
  // The app's one warning (KR-53). Nowhere else — if a second thing ever wants
  // this triangle, the answer is that there is only one warning.
  warn: '<path d="M12 4.2L2.6 20h18.8z"/><path d="M12 10v4.2"/><path d="M12 17.4h.01"/>',
  // Yapay zekâ: an open-centred burst — four rays and four short diagonals.
  // Deliberately NOT a robot (Zafer, 18 Tem: "android olmasın"), and not a
  // four-point star either: with the echo star it was muddy at 15px ("boğuk"),
  // and without it, a lone four-point star IS the Gemini logo. The burst says
  // "spark" without wearing anyone's badge. One drawing, one meaning: the only
  // glyph that says "the model speaks here".
  ai: '<path d="M12 3.5V9M12 15v5.5M3.5 12H9M15 12h5.5"/><path d="M6.3 6.3l1.9 1.9M15.8 15.8l1.9 1.9M17.7 6.3l-1.9 1.9M8.2 15.8l-1.9 1.9"/>',

  // ---- the ⋯ menu (17 Tem) ----
  //
  // Every one of these had to dodge a meaning already taken. The three that
  // worried me were Kaydet / Farklı kaydet / Adını değiştir: drawn from the same
  // family they become three near-identical floppies, and the eye has to work
  // HARDER, not less. So they are told apart by their difference, not their
  // likeness — the arrow lands on a line, the arrow lands on a NEW line (+), and
  // renaming is not an arrow at all but a tag: a name is a label tied to a thing.
  // Notably NOT the pen — the pen already means "edit this comment" (strip.js),
  // and a glyph with two meanings is worse than no glyph.
  save: '<path d="M12 3v11M8 10l4 4 4-4"/><path d="M4 20h16"/>',
  saveAs: '<path d="M11 3v11M7 10l4 4 4-4"/><path d="M3 20h16"/><path d="M17 4h5M19.5 1.5v5"/>',
  rename: '<path d="M3 11.5V4a1 1 0 0 1 1-1h7.5L21 12.5 12.5 21z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  // The page is the FILE (PDF olarak kaydet); the printer is the MACHINE
  // (Yazdır). Two acts, two glyphs — the page never promises paper and the
  // printer never pretends to be a file.
  sheet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  printer:
    '<path d="M7 9V3h10v6"/><path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  // Carrying a piece INTO the other document — the Aktarma screen. Deliberately
  // not `send`: send is one mark going across (the strip's word), this is the
  // screen where that happens.
  transfer: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M3 12h11M10.5 8.5L14 12l-3.5 3.5"/>',
  // Long made short: two rules with the text pressed together between them.
  // Not tapering lines — those are already İçindekiler on the tab strip.
  summarize: '<path d="M4 4h16M4 20h16"/><path d="M8 9.5l4-2.5 4 2.5M8 14.5l4 2.5 4-2.5"/>',
  // Başlık ve Spot (28 Tem) — komşu iki iş, bilerek AYRI okunuyor.
  //
  // Başlık: üstte kısa bir satır, altında gövde. Başlık gövdeden kısadır; ikonun
  // söylediği tek şey bu. Özet'e benzemez — Özet'in iki cetveli metni ARASINA
  // sıkıştırır (uzunu kısaltmak), burada kısa satır metnin ÜSTÜNDEDİR (metni
  // adlandırmak).
  title: '<path d="M4.5 6.5h9"/><path d="M4.5 13h15M4.5 18h11"/>',
  // Spot: gövdenin üstündeki, kenarından işaretlenmiş giriş bloğu. Dikey çubuk
  // "bu parça öne çıkar" der — alıntı çizgisinin akrabası ama alıntı değil,
  // çünkü yanındaki iki satır bloğun kendisidir, ondan sonrası gövdedir.
  spot: '<path d="M4.5 4.5v7"/><path d="M8.5 6h11M8.5 10h8"/><path d="M4.5 16.5h15M4.5 20.5h10"/>',
  // Two lanes swapping: "this out, that in". The one glyph for replacing.
  swap: '<path d="M4 8h13M13.5 4.5L17 8l-3.5 3.5"/><path d="M20 16H7M10.5 12.5L7 16l3.5 3.5"/>',
  // The round bubble, drawn once and worn everywhere a comment is named: the
  // palette's "Yorumla", the strip, and the margin badge. It was two different
  // bubbles — a rectangular one on the palette, a round one in the margin — for
  // the same idea, which is the drift this whole tour is about.
  note: '<path d="M12 3.2c-4.7 0-8.5 3.3-8.5 7.4 0 2.3 1.2 4.4 3.1 5.7-.1 1.6-.8 3.1-2 4.2 2-.2 3.9-1 5.4-2.3.6.1 1.3.2 2 .2 4.7 0 8.5-3.3 8.5-7.4S16.7 3.2 12 3.2z"/>',
};

export function iconAction(glyph, name, onClick, className = "") {
  const button = document.createElement("button");
  button.className = `icon-action ${className}`.trim();
  button.innerHTML = icon(GLYPH[glyph]);
  button.title = name;
  button.setAttribute("aria-label", name);
  button.onclick = onClick;
  return button;
}

/** The one action with a name. Its weight comes from the word and from being
    first — not from a fill and a border. */
function namedAction(glyph, name, onClick) {
  const button = document.createElement("button");
  button.className = "note-named";
  button.innerHTML = `${icon(GLYPH[glyph])}<span>${name}</span>`;
  button.onclick = onClick;
  return button;
}

const spacer = () =>
  Object.assign(document.createElement("span"), { className: "note-spacer" });

export class Strip {
  /**
   * The strip floats inside a surface, and it only ever asks that surface three
   * things: give me a box to live in, tell me where you are, take the focus back.
   * That is deliberately not "an EditorView" — a PDF is a surface too (28 Tem),
   * and one component with two faces must not become two components because one
   * of the screens is drawn on canvas.
   *
   * @param {{ dom: HTMLElement, focus: () => void }} surface
   */
  constructor(surface) {
    this.surface = surface;
    this.dom = document.createElement("div");
    this.dom.className = "note";
    this.dom.hidden = true;
    // Taking focus would collapse the selection, and shut the strip on its way.
    this.dom.onmousedown = (event) => {
      if (event.target.closest("textarea")) return;
      event.preventDefault();
    };

    // The strip swallows its own clicks, on the way out.
    //
    // It floats inside the editor's DOM, and the editor watches for clicks on
    // marks (marks.js/onClick) — so every press in here arrives there too.
    // Asking `event.target` where it came from is no defence: a press that
    // rebuilds the strip (the pencil does) leaves its own button detached before
    // the click has finished bubbling, and a detached button is inside nothing.
    // So the editor decided the click had landed on bare text and shut the strip
    // — the pencil opened the writing surface and lost it in the same gesture.
    // The listener is on the strip itself, which is still standing, so it fires
    // whatever became of the button.
    this.dom.addEventListener("click", (event) => event.stopPropagation());

    // Hovering the badge opens the strip as a preview (B-19); the pointer must
    // be able to travel into it without it vanishing, and out of it to close it.
    // The owner (marks.js) decides what leaving means — it can see the badge.
    this.hovered = false;
    this.pinned = false;
    this.dom.addEventListener("mouseenter", () => {
      this.hovered = true;
    });
    this.dom.addEventListener("mouseleave", () => {
      this.hovered = false;
      this.onLeave?.();
    });

    surface.dom.append(this.dom);
  }

  /** A comment is being typed: the strip must not vanish out from under it. */
  get writing() {
    return Boolean(this.dom.querySelector("textarea"));
  }

  /**
   * @param {object} spec
   * @param {{id: string, yorum?: {metin: string}}} spec.mark  its sidecar record
   * @param {{left: number, right: number, top: number, bottom: number}} spec.coords
   * @param {"sekme" | "aktarma"} spec.face
   * @param {boolean} [spec.writing]  open straight onto the writing surface
   * @param {boolean} [spec.preview]  opened by hovering the badge, not a click —
   *   same box, same spot (B-19: hover and click used to be two geometries);
   *   the only difference is that it closes when the pointer leaves.
   * @param {boolean} [spec.fromBadge]  the click landed on the badge, not on the
   *   marked text — so the subject is the comment, not the piece.
   * @param {{send: Function, comment: Function, remove: Function}} spec.on
   */
  show({ mark, coords, face, writing = false, preview = false, fromBadge = false, bare = false, on }) {
    this.mark = mark;
    this.coords = coords;
    this.face = face;
    this.fromBadge = fromBadge;
    this.on = on;
    this.pinned = !preview;

    // Aktarma's own face is one button wide (`width: max-content`). Anything
    // that carries a comment — reading it, writing it — needs the full box, on
    // either screen.
    // `bare`: one line even when the mark carries a comment. The comment belongs
    // to the badge — pressing the marked TEXT is a question about the piece, and
    // answering it with the comment box is answering something that was not
    // asked (Zafer, 28 Tem).
    const asNote = writing || (!bare && mark.yorum && (face === "sekme" || preview || fromBadge));

    this.dom.replaceChildren();
    this.dom.hidden = false;
    this.dom.className = face === "aktarma" && !asNote ? "note note-aktarma" : "note";

    if (writing) {
      this.dom.append(this.writingRow(mark, on));
      this.place(coords); // after content, so offsetWidth is real
      this.dom.querySelector("textarea").focus();
      return;
    }

    // A commented mark opens as its comment: the full text, wrapping, in the
    // frame the hover bubble used to own — hover and click now show the same
    // box in the same place (B-19). The verbs sit under it and only surface
    // while the pointer is on the box (.note-tools, style.css): read first,
    // tools when reached for.
    //
    // The badge behaves the SAME on both screens (Zafer, 28 Tem): hover it and
    // the comment is there to read, click it and its own verbs are there to
    // use. It is the comment's icon, so it answers about the comment — in
    // Aktarma too, where it used to answer "Taşı" and send you back to the tab
    // to fix a typo.
    //
    // What stays this screen's own is the marked TEXT: click that and you get
    // Taşı, the one thing you came here for. Two icons, two subjects.
    if (!bare && mark.yorum && (face === "sekme" || preview || fromBadge)) {
      const said = document.createElement("p");
      said.className = "note-comment";
      said.textContent = mark.yorum.metin;
      this.dom.append(said);

      // The verbs are hidden by `.note-tools` (opacity, so the box does not grow
      // under the hand that hovers it — 18 Tem) and surface when the pointer is
      // on the box. Always built, hover or click, on BOTH faces: a comment
      // behaves the same wherever you meet it (Zafer, 28 Tem). Every attempt to
      // give Aktarma its own variant of this box produced a third behaviour to
      // learn.
      const tools = document.createElement("div");
      tools.className = "note-row note-tools";
      tools.append(
        spacer(),
        iconAction("pen", t("strip.editComment"), () => this.write()),
        iconAction("trash", t("strip.removeMark"), () => on.remove(), "danger"),
      );
      this.dom.append(tools);

      this.place(coords);
      return;
    }

    const row = document.createElement("div");
    row.className = "note-row";

    if (face === "aktarma") {
      // One verb: "Taşı". The screen is split from the start (an empty target
      // panel on the right), so where the piece goes is answered by the layout,
      // not the button. With no target yet, pressing it asks which document; with
      // one, it moves the piece in. Never "Yine taşı": we do not follow what
      // happens over there (KR-33), so if the writer deleted it by hand, "yine"
      // would be a claim we cannot make.
      row.append(namedAction("send", t("strip.move"), () => on.send()));
      // No comment verbs here, even though commenting came back to this screen
      // (KR-71): it came back to the PALETTE. A mark clicked in Aktarma answers
      // with the one thing this screen is for.
    } else {
      row.append(
        namedAction("note", t("strip.comment"), () => this.write()),
        spacer(),
        iconAction(
          "trash",
          t("strip.removeMark"),
          () => on.remove(),
          "danger",
        ),
      );
    }

    this.dom.append(row);
    this.place(coords); // after content, so offsetWidth is real
  }

  /** The strip, grown into a writing surface. Asked for, never volunteered. */
  write() {
    this.show({
      mark: this.mark,
      coords: this.coords,
      face: this.face,
      writing: true,
      fromBadge: this.fromBadge,
      on: this.on,
    });
  }

  writingRow(mark, on) {
    const wrap = document.createElement("div");
    wrap.className = "note-writing";

    const field = document.createElement("textarea");
    field.placeholder = t("strip.commentPlaceholder");
    // What was there when the box opened — what "vazgeç" puts back. The comment
    // saves itself as you type, so giving up is not "don't save": it is undoing
    // what has already been saved, and that needs the old text in hand.
    const before = mark.yorum?.metin ?? "";
    field.value = before;
    field.rows = 3;

    // The comment saves itself, like the document does. A "Kaydet" button here
    // would be the one place in the app where writing has to be confirmed.
    let timer = null;
    const commit = () => {
      clearTimeout(timer);
      on.comment(field.value.trim());
    };
    field.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(commit, 600);
    };
    field.onblur = commit;
    field.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.hide();
      }
    };

    // Giving up has to disarm both of the things that save on their own — the
    // 600ms timer and the blur — or the box would write the very text it was
    // just told to throw away, on its way out.
    const cancel = () => {
      clearTimeout(timer);
      field.onblur = null;
      if (field.value.trim() !== before) on.comment(before);
      this.hide();
    };

    const actions = document.createElement("div");
    actions.className = "note-row";
    actions.append(
      spacer(),
      // ✕ first, ✓ last: the hand travels to where it is going to commit, and
      // the same ✕ that closes a card and rejects a suggestion (one gesture,
      // one glyph) is the one that gives up here.
      iconAction("close", t("strip.cancel"), cancel),
      iconAction("check", t("strip.done"), () => {
        commit();
        this.hide();
      }),
    );

    wrap.append(field, actions);
    return wrap;
  }

  /**
   * Where the strip stands is the face's decision (B-21 — one rule for both
   * faces put the Aktarma "Taşı" under the badge in the right margin, far from
   * the mark that was clicked):
   *
   *   sekme:   its TOP-RIGHT corner sits at the anchor (the badge): the badge
   *            shows at the box's top-right, the box grows down-and-left
   *            (Zafer). The badge's place is fixed, so the box moves to meet it.
   *   aktarma: it opens at the mark itself — below the line, left edge at the
   *            point you clicked or travelled to.
   *
   * offsetWidth is read here because place() runs after the content is appended.
   */
  place(coords) {
    const host = this.surface.dom;
    const box = host.getBoundingClientRect();
    const width = this.dom.offsetWidth || 260;
    // The strip is positioned against the host's CONTENT box, but `coords` are
    // screen coordinates — so however far the host has been scrolled has to be
    // added back. It is zero on a CodeMirror surface (there the scrolling is
    // done by a child, .cm-scroller) and it is not on a PDF, where the host IS
    // the scroller: without this the strip opened a screenful above the passage,
    // out of sight, and reads as "Taşı çıkmıyor" (Zafer, 28 Tem).
    const top = coords.bottom - box.top + host.scrollTop + 4;
    // One rule now: the box's LEFT edge meets the anchor, and it opens
    // rightward. It used to hang its right edge off `coords.right` instead,
    // because the comment badge lived in the RIGHT margin and a box opening
    // rightward from there would have run off the surface.
    //
    // 3 Ağu moved the comment badge to the left margin (the right one now
    // carries "where this passage went"), and the old rule quietly went wrong
    // with it: the box lined its right edge up with the badge, so it opened
    // over the prose and read as belonging to the OTHER badge — the one it has
    // nothing to do with (Zafer: "yorumun kutusu künye rozetinin altında
    // çıktı").
    //
    // Aktarma's bare "Taşı" always used this rule (B-21: beside the mark you
    // pressed). Both faces say the same thing now, which is one rule fewer.
    const left = coords.left - box.left + host.scrollLeft;
    this.dom.style.top = `${Math.max(host.scrollTop + 8, top)}px`;
    // Both edges, against the MEASURED width (the hand-written-number clamp is
    // a documented trap): a preview anchored on a margin badge opens rightward
    // and would otherwise hang off the surface.
    const edge = host.scrollLeft + 8;
    this.dom.style.left = `${Math.max(edge, Math.min(left, host.scrollLeft + box.width - width - 8))}px`;
  }

  /** Closes the strip, committing whatever was typed into it. */
  hide() {
    const mine = this.dom.contains(document.activeElement);
    this.dom.querySelector("textarea")?.blur(); // its blur writes the comment out
    this.dom.hidden = true;
    this.mark = null;
    this.pinned = false;
    this.hovered = false; // hiding under the pointer fires no mouseleave
    if (mine) this.surface.focus();
    // After the blur has (or has not) written a comment: let the owner drop a
    // badge that was only there for the open box (see marks.js openId).
    this.onHide?.();
  }
}
