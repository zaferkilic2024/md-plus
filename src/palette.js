// The floating palette (UC-06, KR-03).
//
// This is the *only* way to reach formatting with the mouse — there is no "+"
// block-insert menu and no toolbar. It appears on a selection, holds the same
// eight buttons every time, and never covers the selection itself.

import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  setCallout,
  setHeading,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleList,
  toggleQuote,
} from "./commands.js";
import { jobInPalette, jobName, provider, reportJobs, textJobs } from "./ai.js";
import { appMode } from "./context.js";
import { GLYPH } from "./strip.js";
import { t } from "./i18n.js";

const icon = (paths) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${paths}</svg>`;

// Every live palette, and one shared "hidden on purpose" flag. A shortcut can
// then tuck the palette out of the way while you read the text under it, and
// bring it back — without collapsing the selection it is about.
const palettes = new Set();
let suppressed = false;

/** Toggle the selection palette's visibility (Alt+P). */
export function togglePalette() {
  suppressed = !suppressed;
  for (const p of palettes) p.reapply();
}

/**
 * Is the palette switched off right now?
 *
 * A PDF draws its own palette (pdf-marks.js) rather than joining this set — it
 * has no CodeMirror to hang a plugin on. But the switch is the READER's, not a
 * surface's: turning the palette off in a document and then having one bloom
 * over a PDF selection is the same app answering the same gesture two ways
 * (Zafer, 29 Tem). One flag, asked by both.
 */
export const palettesSuppressed = () => suppressed;

/** Put every palette away. Called when a mark's strip opens: two floating boxes
    over one passage, neither closing the other, is how you end up with the same
    verb twice on screen (Zafer, 28 Tem). */
export function hidePalettes() {
  for (const p of palettes) p.hide();
}

/**
 * Which AI jobs this menu carries: routed to a model, and about a passage
 * rather than the whole document (Başlık/Spot are the ⋯ menu's, KR-67).
 *
 * One function, read in two places on purpose — `buildSuggest` and
 * `refreshSuggest` must ask the SAME question, or the fingerprint below never
 * matches what was built and the palette rebuilds itself on every update.
 */
const shownHere = (job) => Boolean(provider(job)) && jobInPalette(job);

/** A cheap fingerprint of which jobs route where, so the palette rebuilds only
    when something actually changed (not on every selection). */
const imzaOf = (metin, rapor) =>
  [...metin, ...rapor].map((j) => `${j}:${provider(j)?.model ?? ""}`).join("|");

/**
 * Put an open submenu where it can actually be reached.
 *
 * The palette floats with the selection, so its submenu inherits that: select a
 * paragraph at the foot of the document and the menu opens below the bottom of
 * the window — every job in it out of reach. The same happens sideways when the
 * palette sits near an edge.
 *
 * Order matters and is the rule this project has already paid for twice: SHOW
 * first, then MEASURE, then place. A hidden box measures 0, and a number written
 * by hand ("the menu is about 240 wide") goes stale the moment the menu grows.
 * Both edges are clamped, not just the far one.
 */
const EDGE = 8;

function fitSubmenu(wrap, menu) {
  // Back to the default (below, centred) before measuring — otherwise the box
  // being measured still carries the previous opening's correction.
  menu.classList.remove("drop-up");
  menu.style.left = "";
  menu.style.transform = "";

  const kutu = wrap.getBoundingClientRect();
  const olcu = menu.getBoundingClientRect();

  // Downwards unless there is no room and upwards has some. Never flip into a
  // place that is just as unreachable.
  const asagiSigmaz = kutu.bottom + 6 + olcu.height > window.innerHeight - EDGE;
  if (asagiSigmaz && kutu.top - olcu.height - 6 > EDGE) menu.classList.add("drop-up");

  // Centred on the button, then clamped to the window on BOTH sides. `left` is
  // relative to .palette-menu, which is the positioned parent.
  const ortali = kutu.left + kutu.width / 2 - olcu.width / 2;
  const sol = Math.max(EDGE, Math.min(ortali, window.innerWidth - olcu.width - EDGE));
  menu.style.left = `${sol - kutu.left}px`;
  menu.style.transform = "none";
}

const BUTTONS = [
  { titleKey: "palette.bold", label: "B", style: "font-weight:700", run: toggleBold },
  { titleKey: "palette.italic", label: "I", style: "font-style:italic", run: toggleItalic },
  { titleKey: "palette.heading", heading: true },
  {
    titleKey: "palette.list",
    html: icon('<path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    run: toggleList,
  },
  {
    titleKey: "palette.quote",
    html: icon('<path d="M5 5v14"/><path d="M10 8h9M10 12h9M10 16h6"/>'),
    run: toggleQuote,
  },
  {
    titleKey: "palette.code",
    label: "</>",
    style: "font-family:var(--mono);font-size:12px",
    run: toggleCode,
  },
  { titleKey: "palette.callout", callout: true },
  { titleKey: "palette.link", html: icon('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>'), link: true },
  {
    titleKey: "palette.copy",
    html: icon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    run: (view) => {
      const sel = view.state.selection.main;
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (text) navigator.clipboard?.writeText(text);
    },
  },
];

const CALLOUTS = [
  { labelKey: "palette.calloutNote", type: "NOTE" },
  { labelKey: "palette.calloutWarning", type: "WARNING" },
  { labelKey: "palette.calloutTip", type: "TIP" },
];

class Palette {
  constructor(view, onLink, onSuggest, onMark) {
    this.view = view;
    this.onLink = onLink;
    this.onSuggest = onSuggest ?? (() => {});
    this.onMark = onMark;

    this.dom = document.createElement("div");
    this.dom.className = "palette";
    this.dom.hidden = true;
    // Taking focus would collapse the selection the palette is about to act on.
    this.dom.onmousedown = (event) => event.preventDefault();

    this.build();
    view.dom.append(this.dom);
    palettes.add(this);
  }

  /** CodeMirror calls this when the editor is torn down (a closed tab). */
  destroy() {
    palettes.delete(this);
    this.dom.remove();
  }

  /** Re-evaluate visibility against the current selection — used by the toggle,
      since flipping the flag is not itself an editor update. */
  reapply() {
    if (suppressed) return this.hide();
    const view = this.view;
    if (view.state.selection.main.empty) return this.hide();
    if (!this.allowedHere(view)) return this.hide();

    this.applyMode();
    this.refreshMark();
    // Two marks under one selection: nothing here can name which one it means,
    // so the box has nothing to say and does not open.
    if (appMode() === "aktarma" && this.cokIsaret) return this.hide();
    this.dropStrip();

    view.requestMeasure({
      read: (v) => this.measure(v),
      write: (position) => this.place(position),
    });
  }

  /**
   * May the palette open on this surface at all? (KR-71, 28 Tem 2026, Zafer.)
   *
   * The answer stopped being "not in Aktarma" and became a question about which
   * panel you are standing in:
   *
   *   sekme:   the writing surface — yes. A read-only tab, no.
   *   aktarma: the SOURCE (left, read-only) — yes, with its two verbs. The
   *            TARGET (right, writable) — no. That is the panel B-18 was about:
   *            pieces land there, they are not marked there.
   *
   * So on this screen the usual test is inverted, and deliberately: `editable`
   * here means "this is the target". Nothing is derived from it about what the
   * palette may show — that is `appMode()`'s to say (context.js, B-18/B-22).
   */
  allowedHere(view) {
    const editable = view.state.facet(EditorView.editable);
    // In Aktarma the only group left is marking, so with no mark store there is
    // nothing to open — an empty palette is a bug that looks like a decision.
    if (appMode() === "aktarma") return !editable && Boolean(this.onMark);
    return editable;
  }

  /**
   * The narrowest palette (Zafer, 28 Tem): in Aktarma it is `[işaretle ·
   * yorumla]` and nothing else. No format group — the source is read-only, and
   * a button that cannot act is worse than an absent one (KR-42's rule, applied
   * to formatting). No AI either: its text jobs could never be accepted there.
   *
   * Hidden, not rebuilt: the palette is built once per surface, and the same
   * surface is a tab one minute and Aktarma's source the next.
   */
  applyMode() {
    const dar = appMode() === "aktarma";
    for (const el of this.formatEls) el.hidden = dar;
    if (this.markCut) this.markCut.hidden = dar;
    for (const el of this.suggestEls) el.hidden = dar;
    // With the other groups gone, what is left is not a palette any more. It
    // wears the strip's clothes instead — named verbs, the same box "Taşı" opens
    // in — so the screen speaks one language (see buildMark).
    this.dom.classList.toggle("palette-strip", dar);
  }

  build() {
    // Everything above the mark group: the format buttons and their submenus.
    // Collected while building, so hiding them later needs no selector.
    this.formatEls = [];
    this.suggestEls = [];

    const ekle = (el) => {
      this.formatEls.push(el);
      this.dom.append(el);
    };

    for (const spec of BUTTONS) {
      if (spec.heading) {
        ekle(this.submenu("H", [1, 2, 3].map((level) => ({
          label: t("palette.headingN", { n: level }),
          run: setHeading(level),
        })).concat([{ label: t("palette.paragraph"), run: setHeading(0) }])));
        continue;
      }
      if (spec.callout) {
        ekle(
          this.submenu(
            icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14"/>'),
            CALLOUTS.map((each) => ({
              label: t(each.labelKey),
              run: setCallout(each.type),
            })),
          ),
        );
        continue;
      }

      const button = document.createElement("button");
      button.title = t(spec.titleKey);
      if (spec.html) button.innerHTML = spec.html;
      else button.textContent = spec.label;
      if (spec.style) button.setAttribute("style", spec.style);
      button.onclick = () => {
        if (spec.link) this.onLink(this.view);
        else spec.run(this.view);
        this.hide();
      };
      ekle(button);
    }

    this.buildMark();
    this.buildSuggest();
  }

  /**
   * İşaretle · Yorumla (KR-55) — the middle group of [biçim] │ [işaretle ·
   * yorumla] │ [YZ].
   *
   * This does not breach KR-03. What is forbidden there is a block-insert
   * palette ("+ Ekle"), a menu of things to put into the document. These act on
   * the selection, like every other button here, and put nothing anywhere: marks
   * never touch the file (IS-07).
   *
   * Two pairs, and only ever one of them on screen. Select plain text and the
   * palette offers to mark it; select text that is already marked and it offers
   * that mark's own verbs — comment it, or take it off. This is the whole way in
   * and out of a mark now: clicking one in the tab does nothing, so that reading
   * your own document does not set off boxes under the cursor.
   *
   * The two pairs share their slots, and the slots mean something. The first is
   * the mark itself — İşaretle becomes Sil, so putting a mark on and taking it
   * off are the same button in the same place. The second is the comment, and it
   * says Yorumla in both states, so it never moves at all. Built the obvious way
   * round (mark, comment / comment, delete), Sil landed exactly where İşaretle
   * had been a moment earlier: the same click, twice, meant two opposite things.
   */
  buildMark() {
    if (!this.onMark) return;

    const action = (title, glyph, run) => {
      const button = document.createElement("button");
      button.className = "palette-mark";
      button.title = title;
      button.innerHTML = icon(GLYPH[glyph]);
      button.onclick = () => {
        run();
        this.hide();
      };
      return button;
    };

    this.markCut = document.createElement("hr");

    // Slot 1: the mark. Slot 2: the comment.
    this.yeni = [
      action(t("palette.mark"), "pen", () => this.onMark.mark({})),
      action(t("palette.markComment"), "note", () => this.onMark.mark({ comment: true })),
    ];
    this.duran = [
      action(t("palette.markRemove"), "trash", () => this.onMark.remove(this.durur)),
      action(t("palette.comment"), "note", () => this.onMark.comment(this.durur)),
    ];

    // "Taşı" — Aktarma only, and only when the selection stands in exactly one
    // mark (KR-71, 28 Tem). It leads, and it is the one word among icons: the
    // reason you are on this screen. With the selection touching two marks it
    // does not appear at all — which mark would it mean?
    this.tasi = document.createElement("button");
    this.tasi.className = "palette-move";
    // The same arrow the strip's "Taşı" wears — one drawing, one meaning; the
    // verb must not change its face when it changes container.
    this.tasi.innerHTML = `${icon(GLYPH.send)}<span>${t("strip.move")}</span>`;
    this.tasi.hidden = true;
    this.tasi.onclick = () => {
      const durur = this.durur;
      this.hide();
      if (durur) this.onMark.send?.(durur);
    };

    // Interleaved, so each slot is one place on screen: [1 1] [2 2], with one of
    // each pair hidden. Appending pair after pair would put slot 2's buttons in
    // slot 1's place whenever the other pair is the visible one.
    // Hairlines between the verbs — Aktarma only, where this box is a strip of
    // its own and the three are separate offers. In the palette proper the
    // groups are already told apart by their own rules (`hr`).
    const ayirac = () => {
      const el = document.createElement("span");
      el.className = "palette-sep";
      el.hidden = true;
      return el;
    };
    this.sepler = [ayirac(), ayirac()];

    this.dom.append(
      this.markCut,
      this.tasi,
      this.sepler[0],
      this.yeni[0],
      this.duran[0],
      this.sepler[1],
      this.yeni[1],
      this.duran[1],
    );
    // Which pair belongs on screen is not asked here. This runs inside `new
    // EditorView`, before createSurface has even returned — so the document's
    // marks do not exist yet, and asking them anything throws. A throwing plugin
    // is disabled by CodeMirror without a word, which is to say: the palette
    // would simply never appear again. There is nothing to decide yet anyway;
    // the palette is hidden until a selection, and every selection asks.
    for (const button of this.duran) button.hidden = true;
  }

  /**
   * A selection wins the floor back from a strip left standing (a "Taşı" opened
   * by an earlier click). The comment being written in is exempt — that box is
   * the work, not something in its way (marks.js/closeStrip).
   *
   * AFTER the update, never inside it. Closing the strip repaints the marks, and
   * a repaint is a dispatch: CodeMirror forbids one while an update is in
   * progress, throws, and disables the plugin — which is to say the palette
   * would never appear again. Same rule as coordsAtPos, same reason.
   */
  dropStrip() {
    if (appMode() !== "aktarma") return;
    queueMicrotask(() => this.onMark?.closeStrip?.());
  }

  /** Which pair the selection is asking for. */
  refreshMark() {
    if (!this.onMark) return;

    // A selection touching a mark at all counts as standing in it — half a mark
    // is still that mark, and "Taşı" moves the whole of it, not the part you
    // happened to drag over (Zafer, 28 Tem).
    const degdikleri = this.onMark.findAll?.() ?? [];
    this.cokIsaret = degdikleri.length > 1;
    this.durur = this.cokIsaret ? null : (degdikleri[0] ?? null);

    for (const button of this.yeni) button.hidden = Boolean(this.durur) || this.cokIsaret;
    for (const button of this.duran) button.hidden = !this.durur;

    const aktarma = appMode() === "aktarma";
    this.tasi.hidden = !(aktarma && this.durur);
    // The first hairline only exists to part Taşı from the rest.
    this.sepler[0].hidden = this.tasi.hidden;
    this.sepler[1].hidden = !aktarma;
  }

  /**
   * The suggestion entry (KR-42). Note what this is NOT: a disabled button.
   * With no provider chosen it is never built at all — no grey control, no
   * tooltip explaining what you are missing, no invitation. The palette is
   * exactly the palette of v1.
   */
  buildSuggest() {
    // Each job carries its own route now (KR-50). Only jobs that have one show,
    // and each shows the model that will answer it — so "Tamamlayıcı paragraf"
    // and "Yazım" can name two different models on the same menu.
    // Only jobs that have a route. Scope no longer filters (Zafer, 18 Tem):
    // "Özet" run from HERE summarizes the selection — the palette is the
    // selection, so the selection is what the job gets. Same job, same model,
    // same Settings row; only the door decides the input. From the ⋯ menu and
    // Alt+O it still takes the whole document (jobScope, ai.js).
    const metinIsleri = textJobs().filter(shownHere);
    const raporIsleri = reportJobs().filter(shownHere);

    this.suggestImza = imzaOf(metinIsleri, raporIsleri);
    this.suggestEls = [];
    if (!metinIsleri.length && !raporIsleri.length) return;

    const girdi = (job) => ({
      label: jobName(job),
      // The model, right under the job — the price/where-it-goes, on the thing
      // you are about to click (KR-47).
      // The model, and only the model (Zafer, 17 Tem). It used to carry "· ağa
      // gider · ÜCRETLİ" too, which truncated to nonsense in a 205px menu — you
      // could read neither the warning nor the model. Those words are KR-53's
      // business now: one warning in one corner, not a fragment in every menu.
      hint: provider(job).model,
      run: (view) => this.onSuggest(view, job),
    });

    // Two groups, separated — above the line the model writes prose you may
    // take; below it, claims about the world you may only read (KR-49).
    const items = [...metinIsleri.map(girdi)];
    if (raporIsleri.length) {
      if (items.length) items.push("-");
      items.push(...raporIsleri.map(girdi));
    }

    // The AI spark (GLYPH.ai — one drawing, one meaning), not the word "Öneri"
    // (Zafer, 18 Tem). The chevron stays: it says the control opens something —
    // every other control on the palette does what it shows the moment you
    // press it; this one answers with a second menu.
    const menu = this.submenu(
      `${icon(GLYPH.ai)}<svg class="palette-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
      items,
    );
    menu.classList.add("palette-suggest");
    menu.querySelector("button")?.setAttribute("title", t("palette.aiTitle"));

    // Its own rule, named: the palette has two of them now, and rebuilding the
    // suggestion group used to take out whichever came first — which, once the
    // marking group arrived in front of it, was not this one.
    const cut = document.createElement("hr");
    cut.className = "suggest-cut";
    this.dom.append(cut, menu);
    // Kept so the AI group can be taken off in Aktarma without a rebuild.
    this.suggestEls = [cut, menu];
  }

  /** Keeps the palette in step with the setting, without rebuilding the rest.
      Same filter as buildSuggest — a drifted pair here rebuilds every update. */
  refreshSuggest() {
    const metinIsleri = textJobs().filter(shownHere);
    const raporIsleri = reportJobs().filter(shownHere);
    if (imzaOf(metinIsleri, raporIsleri) === this.suggestImza) return;

    this.dom.querySelector("hr.suggest-cut")?.remove();
    this.dom.querySelector(".palette-suggest")?.remove();
    this.buildSuggest();
  }

  /** A button that opens one small menu — a type picker, not a settings panel. */
  submenu(labelHtml, items) {
    const wrap = document.createElement("div");
    wrap.className = "palette-menu";

    const button = document.createElement("button");
    // `includes`, not `startsWith`: a label that is a word FOLLOWED by a glyph
    // ("Öneri" + its chevron) starts with a letter, so a startsWith test dropped
    // it into textContent and printed the raw <svg …> markup on the palette.
    if (labelHtml.includes("<")) button.innerHTML = labelHtml;
    else button.textContent = labelHtml;
    wrap.append(button);

    const menu = document.createElement("div");
    menu.className = "palette-submenu";
    menu.hidden = true;
    for (const item of items) {
      if (item === "-") {
        menu.append(document.createElement("hr"));
        continue;
      }
      const entry = document.createElement("button");

      if (item.hint) {
        // Job name on top; underneath, the model that will answer it (its price
        // and where it goes — KR-47), on the thing you are about to click.
        entry.classList.add("has-hint");
        const ad = document.createElement("span");
        ad.textContent = item.label;
        const ipucu = document.createElement("small");
        ipucu.textContent = item.hint;
        entry.append(ad, ipucu);
      } else {
        entry.textContent = item.label;
      }

      entry.onclick = () => {
        item.run(this.view);
        this.hide();
      };
      menu.append(entry);
    }
    wrap.append(menu);

    button.onclick = () => {
      const opening = menu.hidden;
      menu.hidden = !opening;
      if (opening) fitSubmenu(wrap, menu);
    };
    return wrap;
  }

  hide() {
    this.dom.hidden = true;
    for (const menu of this.dom.querySelectorAll(".palette-submenu")) {
      menu.hidden = true;
    }
  }

  /** Rebuilds the buttons in the current language (called on a language change).
      The palette is built once per surface, so it has to be told to re-read. */
  relocalize() {
    this.dom.replaceChildren();
    this.build();
    this.hide();
  }

  update(update) {
    // Tucked away by the shortcut: stay hidden, even through new selections,
    // until the writer brings it back.
    if (suppressed) return this.hide();
    if (update.state.selection.main.empty) return this.hide();
    if (!this.allowedHere(update.view)) return this.hide();

    // Which groups this screen carries — asked here, because a surface can go
    // read-only and back (Aktarma borrows the tab's) and the mode flips under it.
    this.applyMode();

    // The provider can be switched while the app is running, and the palette is
    // built once, at startup. Without this, turning the AI on in Settings did
    // nothing until you restarted — which looked exactly like a bug, because it
    // was one.
    this.refreshSuggest();

    // Whether this selection is standing in a mark decides which two mark
    // buttons it gets, and that answer changes with every selection.
    this.refreshMark();
    if (appMode() === "aktarma" && this.cokIsaret) return this.hide();
    this.dropStrip();

    // Reading the layout (coordsAtPos) is forbidden while an update is in
    // flight — CodeMirror throws, and a throwing plugin is disabled silently.
    // So the position is measured in CodeMirror's own measure phase instead.
    update.view.requestMeasure({
      read: (view) => this.measure(view),
      write: (position) => this.place(position),
    });
  }

  measure(view) {
    const range = view.state.selection.main;
    if (range.empty) return null;

    const start = view.coordsAtPos(range.from);
    const end = view.coordsAtPos(range.to);
    if (!start || !end) return null;

    const box = view.dom.getBoundingClientRect();
    return {
      centre: (start.left + end.right) / 2 - box.left,
      top: start.top - box.top,
      bottom: end.bottom - box.top,
      width: box.width,
    };
  }

  place(position) {
    if (!position) return this.hide();
    this.dom.hidden = false;

    // Above the selection; below it only when there is no room up there — but
    // never on top of the selection.
    const width = this.dom.offsetWidth;
    const height = this.dom.offsetHeight;
    const above = position.top - height - 8;

    this.dom.style.left = `${Math.max(4, Math.min(position.centre - width / 2, position.width - width - 4))}px`;
    this.dom.style.top =
      above > 0 ? `${above}px` : `${position.bottom + 10}px`;
  }
}

export const floatingPalette = (onLink, onSuggest, onMark) =>
  ViewPlugin.define((view) => new Palette(view, onLink, onSuggest, onMark));

/** Every live palette, re-labelled — the palettes are built once per surface,
    so a language change has to reach the ones already standing. */
export function relocalizePalettes() {
  for (const palette of palettes) palette.relocalize();
}
