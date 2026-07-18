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
import { jobName, provider, reportJobs, textJobs } from "./ai.js";
import { appMode } from "./context.js";
import { GLYPH } from "./strip.js";

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

/** A cheap fingerprint of which jobs route where, so the palette rebuilds only
    when something actually changed (not on every selection). */
const imzaOf = (metin, rapor) =>
  [...metin, ...rapor].map((j) => `${j}:${provider(j)?.model ?? ""}`).join("|");

const BUTTONS = [
  { title: "Kalın", label: "B", style: "font-weight:700", run: toggleBold },
  { title: "İtalik", label: "I", style: "font-style:italic", run: toggleItalic },
  { title: "Başlık", heading: true },
  {
    title: "Liste",
    html: icon('<path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    run: toggleList,
  },
  {
    title: "Alıntı",
    html: icon('<path d="M5 5v14"/><path d="M10 8h9M10 12h9M10 16h6"/>'),
    run: toggleQuote,
  },
  {
    title: "Kod",
    label: "</>",
    style: "font-family:var(--mono);font-size:12px",
    run: toggleCode,
  },
  { title: "Callout", callout: true },
  { title: "Link", html: icon('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>'), link: true },
  {
    title: "Kopyala",
    html: icon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    run: (view) => {
      const sel = view.state.selection.main;
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (text) navigator.clipboard?.writeText(text);
    },
  },
];

const CALLOUTS = [
  { label: "Not", type: "NOTE" },
  { label: "Uyarı", type: "WARNING" },
  { label: "İpucu", type: "TIP" },
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
    if (!view.state.facet(EditorView.editable)) return this.hide();
    if (appMode() === "aktarma") return this.hide(); // KR-57, B-18 — see update()

    this.refreshMark();
    view.requestMeasure({
      read: (v) => this.measure(v),
      write: (position) => this.place(position),
    });
  }

  build() {
    for (const spec of BUTTONS) {
      if (spec.heading) {
        this.dom.append(this.submenu("H", [1, 2, 3].map((level) => ({
          label: `Başlık ${level}`,
          run: setHeading(level),
        })).concat([{ label: "Paragraf", run: setHeading(0) }])));
        continue;
      }
      if (spec.callout) {
        this.dom.append(
          this.submenu(
            icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14"/>'),
            CALLOUTS.map((each) => ({
              label: each.label,
              run: setCallout(each.type),
            })),
          ),
        );
        continue;
      }

      const button = document.createElement("button");
      button.title = spec.title;
      if (spec.html) button.innerHTML = spec.html;
      else button.textContent = spec.label;
      if (spec.style) button.setAttribute("style", spec.style);
      button.onclick = () => {
        if (spec.link) this.onLink(this.view);
        else spec.run(this.view);
        this.hide();
      };
      this.dom.append(button);
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
      action("İşaretle · Ctrl+Enter", "pen", () => this.onMark.mark({})),
      action("İşaretle ve yorumla", "note", () => this.onMark.mark({ comment: true })),
    ];
    this.duran = [
      action("İşareti sil", "trash", () => this.onMark.remove(this.durur)),
      action("Yorumla", "note", () => this.onMark.comment(this.durur)),
    ];

    // Interleaved, so each slot is one place on screen: [1 1] [2 2], with one of
    // each pair hidden. Appending pair after pair would put slot 2's buttons in
    // slot 1's place whenever the other pair is the visible one.
    this.dom.append(
      this.markCut,
      this.yeni[0],
      this.duran[0],
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

  /** Which pair the selection is asking for. */
  refreshMark() {
    if (!this.onMark) return;
    this.durur = this.onMark.find();
    for (const button of this.yeni) button.hidden = Boolean(this.durur);
    for (const button of this.duran) button.hidden = !this.durur;
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
    const enabled = (job) => provider(job);
    const metinIsleri = textJobs().filter(enabled);
    const raporIsleri = reportJobs().filter(enabled);

    this.suggestImza = imzaOf(metinIsleri, raporIsleri);
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
    menu.querySelector("button")?.setAttribute("title", "Yapay zekâ önerileri");

    // Its own rule, named: the palette has two of them now, and rebuilding the
    // suggestion group used to take out whichever came first — which, once the
    // marking group arrived in front of it, was not this one.
    const cut = document.createElement("hr");
    cut.className = "suggest-cut";
    this.dom.append(cut, menu);
  }

  /** Keeps the palette in step with the setting, without rebuilding the rest.
      Same filter as buildSuggest — a drifted pair here rebuilds every update. */
  refreshSuggest() {
    const metinIsleri = textJobs().filter(provider);
    const raporIsleri = reportJobs().filter(provider);
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
      menu.hidden = !menu.hidden;
    };
    return wrap;
  }

  hide() {
    this.dom.hidden = true;
    for (const menu of this.dom.querySelectorAll(".palette-submenu")) {
      menu.hidden = true;
    }
  }

  update(update) {
    // Tucked away by the shortcut: stay hidden, even through new selections,
    // until the writer brings it back.
    if (suppressed) return this.hide();
    if (update.state.selection.main.empty) return this.hide();
    // The source document in Aktarma is not ours to format (UC-12-K4).
    if (!update.view.state.facet(EditorView.editable)) return this.hide();
    // No palette anywhere inside Aktarma (KR-57; Zafer, 18 Tem). The editable
    // check above only covered the read-only source — the target is writable,
    // so the palette opened over it and offered to mark (B-18). Formatting and
    // marking are the tab's work; this screen only travels and sends.
    if (appMode() === "aktarma") return this.hide();

    // The provider can be switched while the app is running, and the palette is
    // built once, at startup. Without this, turning the AI on in Settings did
    // nothing until you restarted — which looked exactly like a bug, because it
    // was one.
    this.refreshSuggest();

    // Whether this selection is standing in a mark decides which two mark
    // buttons it gets, and that answer changes with every selection.
    this.refreshMark();

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
