// The strip a mark opens: one component, two faces (KR-55).
//
// Marking and commenting are the tab's job; sending is Aktarma's (KR-57). The
// strip is the same object in both places — two of them would drift apart, and
// then a mark would mean one thing on the left of the screen and another on the
// right — and each face carries only the verbs of the screen it is standing on:
//
//   sekme:   [yorum düz metin / "Yorumla"] · ✎ · 🗑   — no move
//   aktarma: "Taşı"                                   — no comment, no ✎, no 🗑
//
// The Aktarma face is one verb and nothing else. It used to also echo the
// comment as read-only text — but this screen does not do comments (KR-57), and
// a two-word crumb of one is just noise beside the only thing you came here to
// do. And "Gönder" was wrong (Zafer, 17 Tem): nothing is *sent* anywhere, a
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
  chevron: '<path d="M6 9l6 6 6-6"/>',
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
  /** @param {import("@codemirror/view").EditorView} view the surface it floats on */
  constructor(view) {
    this.view = view;
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

    view.dom.append(this.dom);
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
   * @param {{send: Function, comment: Function, remove: Function}} spec.on
   */
  show({ mark, coords, face, writing = false, preview = false, on }) {
    this.mark = mark;
    this.coords = coords;
    this.face = face;
    this.on = on;
    this.pinned = !preview;

    this.dom.replaceChildren();
    this.dom.hidden = false;
    // The Aktarma face is one button, so it need not reserve the tab face's
    // width for a comment that is no longer there.
    this.dom.className = face === "aktarma" ? "note note-aktarma" : "note";

    if (writing) {
      this.dom.append(this.writingRow(mark, on));
      this.place(coords); // after content, so offsetWidth is real
      this.dom.querySelector("textarea").focus();
      return;
    }

    // A commented mark opens as its comment: the full text, wrapping, in the
    // frame the hover bubble used to own — hover and click now show the same
    // box in the same place (B-19). On the tab face the verbs sit under it and
    // only surface while the pointer is on the box (.note-tools, style.css):
    // read first, tools when reached for. In Aktarma the comment appears only
    // as a hover preview and carries no verbs at all — read-only there (KR-57),
    // and editing has one place, which is not that screen (KR-55, UC-12-K8);
    // a click there opens "Taşı" below.
    if (mark.yorum && (face === "sekme" || preview)) {
      const said = document.createElement("p");
      said.className = "note-comment";
      said.textContent = mark.yorum.metin;
      this.dom.append(said);

      if (face === "sekme") {
        const tools = document.createElement("div");
        tools.className = "note-row note-tools";
        tools.append(
          spacer(),
          iconAction("pen", t("strip.editComment"), () => this.write()),
          iconAction(
            "trash",
            t("strip.removeMark"),
            () => on.remove(),
            "danger",
          ),
        );
        this.dom.append(tools);
      }

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
      // No comment here: Aktarma neither writes nor reads comments (KR-57).
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
      on: this.on,
    });
  }

  writingRow(mark, on) {
    const wrap = document.createElement("div");
    wrap.className = "note-writing";

    const field = document.createElement("textarea");
    field.placeholder = t("strip.commentPlaceholder");
    field.value = mark.yorum?.metin ?? "";
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

    const actions = document.createElement("div");
    actions.className = "note-row";
    actions.append(
      spacer(),
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
    const box = this.view.dom.getBoundingClientRect();
    const width = this.dom.offsetWidth || 260;
    const top = coords.bottom - box.top + 4;
    const left =
      this.face === "aktarma"
        ? coords.left - box.left
        : coords.right - box.left - width;
    this.dom.style.top = `${Math.max(8, top)}px`;
    // Both edges, against the MEASURED width (the hand-written-number clamp is
    // a documented trap): a preview anchored on a margin badge opens rightward
    // and would otherwise hang off the surface.
    this.dom.style.left = `${Math.max(8, Math.min(left, box.width - width - 8))}px`;
  }

  /** Closes the strip, committing whatever was typed into it. */
  hide() {
    const mine = this.dom.contains(document.activeElement);
    this.dom.querySelector("textarea")?.blur(); // its blur writes the comment out
    this.dom.hidden = true;
    this.mark = null;
    this.pinned = false;
    this.hovered = false; // hiding under the pointer fires no mouseleave
    if (mine) this.view.focus();
    // After the blur has (or has not) written a comment: let the owner drop a
    // badge that was only there for the open box (see marks.js openId).
    this.onHide?.();
  }
}
