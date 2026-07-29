// Gömülü belge (V2-1, UC-19) — link genişletme.
//
// Zafer, 14 Temmuz: "gömülü belge, iki kişi arasında bilgi paylaşımının en pratik
// yolu. Sınırlarımızı çizeriz; gömülü belgeler için usturuplu bir istisna yazarız."
//
// TAŞINABİLİRLİK — istisna burada ve tam olarak şu kadardır:
//
//   Gömme bir GÖRÜNÜM KİPİDİR, bir sözdizimi değil.
//
// Dosyada duran şey canonical linktir (`[metin](belge.md)`, KR-13) ve bu bir
// linktir: GitHub'da tıklanır, başka editörde tıklanır, bozulmaz. Obsidian'ın
// `![[not]]`i reddedildi (standart değil, başka okuyucuda ham metin), `![](x.md)`
// de reddedildi (standart Markdown'da `![…]` bir görseldir; `.md` verilince kırık
// resim çıkar). Genişletilmiş olma bilgisi dosyaya YAZILMAZ — bu oturumda,
// bellekte yaşar. İstisna dosyada değil, ekrandadır: dosyanı başkası açtığında
// eksik bir şey görmez, çalışan bir link görür.
//
// KOPYA DEĞİL, AYNA. Metin kopyalanmaz, hedef diskten okunur. Aktarma'nın zıddıdır
// ve onunla çakışmaz: Aktarma kopyadır (parça senin metnine katılır, KR-17), gömme
// aynadır. Belge tek başına ayakta duracaksa aktar; birlikte yaşayacaksa göm.
//
// NEDEN KART, NEDEN AKIŞIN İÇİNDE DEĞİL (16 Tem 2026, Zafer):
// Önce akışa gömüldü — CodeMirror'ın blok widget'ı olarak. Blok widget'ları
// satırlar ARASINA çizilir ve Markdown'da bir satır bütün bir paragraftır; yani
// paragrafın üçüncü kelimesindeki bir link, belgeyi paragrafın dibinde açıyordu.
// Bu bir kusur değil, sınırın kendisiydi: bir belge cümlenin ortasında açılamaz —
// "Ayrıntı için [Determinizm] › ——koca belge—— sayfasına bak." Ekranı gömmeye
// kaydırmayı denedim; Zafer haklı olarak reddetti: "ee sonra tıkladığım yere nasıl
// geleceğim?" Kart bu çelişkiyi çözer, çünkü akışın İÇİNDE değil ÜSTÜNDE durur:
// linkin hemen altında açılır, cümleyi bölmez, metni zıplatmaz (KR-06), ve seni
// okuduğun yerden hiçbir yere götürmez.
//
// Kısıtlar (kararlaştırıldı):
//   1. Gömülü içerik SALT OKUNURDUR (SD-08: bir belgenin tek doğrusu).
//   2. TEK SEVİYE. Gömülünün içindeki linkler gömülmez; yoksa A→B→A sonsuz döngü.
//   3. VARSAYILAN KAPALI. Sessiz bir ok açar, aynı ok kapatır.
//   4. Kırık linkte "bulunamadı" der; dosya OLUŞTURULMAZ (KR-21).

import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { mapMark } from "./anchor.js";
import { isCiteFace } from "./citation.js";
import { t } from "./i18n.js";

/**
 * A link is what MARKDOWN says is a link — not what a regex of ours says.
 *
 * This used to be `/\[([^\]]*)\]\(([^)]+\.md)\)/`, which is more generous than
 * Markdown itself, and a promise the file cannot keep. Two ways it lied:
 *
 *   [Determiniz](G:\My Drive\x.md)   — the space ends the link destination, so
 *                                      CommonMark reads this as the text
 *                                      "[Determiniz]" followed by literal
 *                                      "(G:\My...)". Our arrow appeared beside a
 *                                      link that no other reader will ever see —
 *                                      straight through the portability law.
 *                                      (`(<G:\My Drive\x.md>)` is the real one.)
 *   ```[a](belge.md)```              — a link inside a code fence is not a link;
 *                                      it is an example OF one.
 *
 * The parser already knows all of this, and it is the same parser that decides
 * whether to paint the link blue. One truth, one answer.
 */
function eachLink(view, from, to, run) {
  syntaxTree(view.state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== "URL") return;
      const link = node.node.parent;
      // An Image (`![alt](x.png)`) has a URL too, and is not a door.
      if (!link || link.name !== "Link") return;

      // `<…>` is how Markdown carries a destination with spaces in it.
      const target = view.state.sliceDoc(node.from, node.to).replace(/^<|>$/g, "");
      if (!/\.md$/i.test(target)) return;

      // A moved piece's citation is not one of these doors (KR-81). It is a
      // glyph, and the underline that says "there is a document behind this"
      // would be drawn under an emoji — a smudge, not an affordance. It opens
      // in a TAB on a plain click (surface.js), not in a card under itself.
      const face = /^\[([^\]]*)\]/.exec(view.state.sliceDoc(link.from, link.to));
      if (face && isCiteFace(face[1])) return;

      run(link.from, link.to, target);
    },
  });
}

const setOpen = StateEffect.define();

/**
 * Which link is open — one at a time, because there is one card.
 *
 * A live range over the link's own text, not an offset: the writer keeps typing
 * above it and an offset would slide off by the second paragraph. Same helper as
 * the marks (KR-56).
 */
const openField = StateField.define({
  create: () => null,
  update(open, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setOpen)) return effect.value;
    }
    if (!open || !transaction.docChanged) return open;
    const moved = mapMark(open, transaction.changes);
    return moved.to > moved.from ? moved : null; // the link was typed away
  },
});

/** The one card, for the whole app — like the suggestion card, and for the same
    reason: two of them on screen would be two places to look. */
class EmbedCard {
  constructor() {
    this.dom = document.createElement("div");
    this.dom.className = "embed-card";
    this.dom.hidden = true;
    document.body.append(this.dom);

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.dom.hidden) this.close();
    });
  }

  /** @param {{coords: DOMRect, target: string, deps: object}} spec */
  show({ coords, target, deps }) {
    this.close({ quiet: true });
    this.dom.replaceChildren();
    this.dom.hidden = false;
    this.dom.classList.remove("missing");

    const bar = document.createElement("div");
    bar.className = "embed-bar";

    const name = document.createElement("span");
    name.textContent = target;

    const shut = document.createElement("button");
    shut.className = "icon-action";
    shut.title = "Kapat (Esc)";
    shut.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    shut.onclick = () => this.close();

    bar.append(name, shut);
    this.dom.append(bar);
    this.drag(bar);

    const body = document.createElement("div");
    body.className = "embed-body";
    this.dom.append(body);

    const path = deps.resolve(target);
    deps
      .read(path)
      .then((text) => {
        const host = document.createElement("div");
        host.className = "host embed-host";
        body.append(host);
        // The same surface the tabs use, made read-only: an embedded document is
        // typeset exactly like a real one — its formulas, its images, its
        // headings — because it IS one. A second renderer here would be a second
        // truth about what Markdown looks like.
        this.view = deps.makeSurface({ parent: host, doc: text, path });
        this.place(coords);
      })
      .catch(() => {
        // KR-21: nothing is created, nothing is guessed.
        this.dom.classList.add("missing");
        body.textContent = t("status.notFound", { path: target });
        this.place(coords);
      });

    this.place(coords);
  }

  /**
   * Under the link, where you pressed. Not centred like the suggestion card: that
   * one is about a decision and wants your whole attention; this one is about a
   * word on a line, and belongs under that word.
   */
  place(coords) {
    requestAnimationFrame(() => {
      if (this.dom.hidden) return;
      const gap = 8;

      // Ceilings first, then measure, then position — measuring an unconstrained
      // card gives the size it WANTS, not the size it will have, and the position
      // computed from that hangs off the screen. (Same trap as the AI card.)
      this.dom.style.maxWidth = `${Math.min(720, window.innerWidth - 2 * gap)}px`;
      this.dom.style.maxHeight = `${Math.min(440, window.innerHeight - 2 * gap)}px`;

      const width = this.dom.offsetWidth;
      const height = this.dom.offsetHeight;

      // Below the link, unless there is no room down there — then above it. Never
      // on top of the link itself: you have to be able to see what you opened.
      const below = coords.bottom + gap;
      const top =
        below + height <= window.innerHeight - gap
          ? below
          : Math.max(gap, coords.top - height - gap);

      this.dom.style.top = `${top}px`;
      this.dom.style.left = `${Math.max(gap, Math.min(coords.left, window.innerWidth - width - gap))}px`;
    });
  }

  /** Slide it off the text to compare the two documents. */
  drag(handle) {
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      const box = this.dom.getBoundingClientRect();
      const dx = event.clientX - box.left;
      const dy = event.clientY - box.top;

      const onMove = (move) => {
        const gap = 4;
        this.dom.style.left = `${Math.max(gap, Math.min(move.clientX - dx, window.innerWidth - this.dom.offsetWidth - gap))}px`;
        this.dom.style.top = `${Math.max(gap, Math.min(move.clientY - dy, window.innerHeight - this.dom.offsetHeight - gap))}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    });
  }

  close({ quiet = false } = {}) {
    this.view?.destroy();
    this.view = null;
    this.dom.hidden = true;
    // The arrow has to stop pointing down when the card goes.
    if (!quiet) this.onClose?.();
  }
}

const card = new EmbedCard();

/**
 * Opening is the LINK's job now — no arrow, no icon (Zafer, 16 Tem).
 *
 * First there was a chevron beside every link, always on. Then a ↗ that appeared
 * on hover. Both were wrong for the same reason, and the second made it obvious:
 * a widget occupies width even at zero opacity, so it pushed the words apart —
 * "küçük ok kelime ile arasını açtı". The prose was being rearranged to make room
 * for a control that says what the link already says.
 *
 * So nothing is drawn. The link underlines under the cursor, the way links do,
 * and clicking it opens the document. The caret still lands where you clicked —
 * this is a writing surface, so the link stays editable (Esc shuts the card).
 */
function openLinkAt(view, pos, deps) {
  const line = view.state.doc.lineAt(pos);
  let found = null;
  eachLink(view, line.from, line.to, (at, end, target) => {
    if (pos >= at && pos <= end) found = { at, end, target };
  });
  if (!found) return false;

  const open = view.state.field(openField);
  if (open && open.from === found.at && open.to === found.end) {
    card.close({ quiet: true });
    view.dispatch({ effects: setOpen.of(null) });
    return true;
  }

  // Anchored where you clicked, NOT at the link's first character.
  //
  // That `[` may not exist. Off the cursor's line, inline-format replaces the
  // brackets and the URL outright (Decoration.replace — they are gone from the
  // layout, not merely transparent), so asking where the `[` is drawn answers
  // nothing and the card refused to open. The click then put the caret on the
  // line, the raw marks came back, and the SECOND click worked — which is
  // exactly the two-click dance Zafer hit. Where the reader clicked is on screen
  // by definition.
  const coords = view.coordsAtPos(pos);
  if (!coords) return false;

  card.onClose = () => view.dispatch({ effects: setOpen.of(null) });
  card.show({ coords, target: found.target, deps });
  view.dispatch({ effects: setOpen.of({ from: found.at, to: found.end }) });
  return true;
}

export function embedding(deps) {
  if (deps.nested) return [];

  // Where the mouse went down, and where on screen — see the handlers below.
  let pressedAt = null;
  let pressedXY = null;

  const arrows = (view) => {
    const open = view.state.field(openField);
    const decorations = [];

    for (const { from, to } of view.visibleRanges) {
      eachLink(view, from, to, (at, end) => {
        const acik = Boolean(open && open.from === at && open.to === end);
        // A mark, and only a mark: it adds no element to the line, so the words
        // sit exactly where they sat before anything was embeddable.
        decorations.push(
          Decoration.mark({ class: "cm-embed-link" + (acik ? " acik" : "") }).range(
            at,
            end,
          ),
        );
      });
    }
    return Decoration.set(decorations, true);
  };

  return [
    openField,
    EditorView.domEventHandlers({
      /**
       * The position is read on MOUSEDOWN, and this is the whole fix.
       *
       * By the time `click` arrives, mousedown has already put the caret on the
       * line — which makes the line active, brings the raw `[…](….md)` back, and
       * REWRAPS the paragraph. The text slides, so the point under the mouse is
       * now a different character: measured, a click on the link's text came back
       * as position 73 before and 67 after. Six characters earlier — and near the
       * start of a link that lands OUTSIDE it, so the link was not found and no
       * card opened. Click again and it worked, because the line was already open
       * and nothing moved. That is the "two clicks" Zafer hit, and it is also why
       * the far end of the link worked on the first click while the text did not:
       * out there the same slide still leaves you inside the link.
       *
       * Ctrl+click never had the bug for exactly this reason — UC-09 is handled
       * in mousedown (surface.js), before anything moves.
       */
      mousedown: (event, view) => {
        // Ctrl+click belongs to UC-09: that one opens the document as a tab.
        pressedAt =
          event.ctrlKey || event.metaKey
            ? null
            : view.posAtCoords({ x: event.clientX, y: event.clientY });
        pressedXY = { x: event.clientX, y: event.clientY };
        return false;
      },

      /**
       * `mouseup`, NOT `click`. This is the bug, and it took six wrong guesses.
       *
       * MEASURED, in the running app: pressing on a link logs `mousedown pos =
       * 3354` and then nothing. No click. Ever. The handler was simply never
       * called, which is why the card did not open and why a second press did —
       * by then the line is already raw and the press behaves like any other.
       *
       * A click event only fires if mousedown and mouseup end up on the same
       * element (or on one still in the document). Pressing a link is exactly
       * where that breaks: the caret lands, the line goes active, inline-format
       * brings the raw `[…](….md)` back, and the line's DOM is rebuilt under the
       * pointer. That is the likely reason — the reason is NOT proven, the
       * missing click IS. It also fits the sharpest clue we had (Zafer): pressing
       * just RIGHT of a link always worked first time, out where the pointer sits
       * on plain text that no rebuild disturbs.
       *
       * mouseup does not care: it fires on whatever is under the pointer.
       *
       * Ctrl+click was never affected, for the same reason nothing else affects
       * it: UC-09 lives in mousedown (surface.js).
       */
      mouseup: (event, view) => {
        const pos = pressedAt;
        const from = pressedXY;
        pressedAt = null;
        pressedXY = null;
        if (pos == null || !from) return false;

        // A drag is a selection, not a press: releasing at the end of one must
        // not open anything. (mouseup fires for those too; click did not.)
        if (Math.abs(event.clientX - from.x) > 3 || Math.abs(event.clientY - from.y) > 3) {
          return false;
        }

        // Not `return true`: the caret must still land where it was pressed.
        openLinkAt(view, pos, deps);
        return false;
      },
    }),
    ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = arrows(view);
        }
        update(update) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.state.field(openField) !== update.startState.field(openField)
          ) {
            this.decorations = arrows(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
