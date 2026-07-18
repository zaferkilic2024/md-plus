// The suggestion card: waiting, then a decision.
//
// One slot, three states — waiting, suggestion, whisper — because they are the
// same thing at different moments, and a second box would be a second place to
// look.
//
// The shape of this card comes straight out of the exam we ran on real Turkish
// academic text (14 July 2026). Three findings, three design consequences:
//
//   The wait is 12-14 s on a local model.   → the seconds count up, in the open,
//                                             and Vazgeç never leaves (KR-48).
//   The model invents things.               → the control line marks what to look
//                                             at twice, and NEVER says "clean":
//                                             one exam output had zero flags and a
//                                             mangled definition (KR-44).
//   The model breaks formulas and format.   → that output never arrives here at
//                                             all; ai.js refuses it (KR-45).
//
// Not here, deliberately: a progress bar (we do not know the progress), a "try
// again" button (a slot machine lever next to an unreliable model — asking again
// means selecting again), a streaming typewriter (you cannot judge half a
// paragraph), a confidence score, and any "written by AI" mark on the text
// (KR-44: that is the tracking we tore out in KR-33, wearing a new hat).

import { suggest, jobName } from "./ai.js";

const icon = (paths) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const TICK = '<path d="M20 6L9 17l-5-5"/>';
const CROSS = '<path d="M18 6L6 18M6 6l12 12"/>';
const COPY = '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>';

/** A quiet icon button that copies `text`, flashing a tick when it lands. */
function copyButton(text) {
  const button = document.createElement("button");
  button.className = "icon-action suggestion-copy";
  button.title = "Kopyala";
  button.innerHTML = icon(COPY);
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    button.innerHTML = icon(TICK);
    button.classList.add("copied");
    setTimeout(() => {
      button.innerHTML = icon(COPY);
      button.classList.remove("copied");
    }, 1200);
  };
  return button;
}

export class Suggestion {
  constructor() {
    this.dom = document.createElement("div");
    this.dom.className = "suggestion";
    this.dom.hidden = true;
    document.body.append(this.dom);

    this.controller = null;
    this.timer = null;
  }

  /**
   * Asks, waits in the open, then shows what came back.
   *
   * @param {object} [options]
   * @param {string} [options.source]  the text to work on. Given only by jobs
   *   that are about the whole document ("Özet", from the ⋯ menu) rather than
   *   about a selection — those have no range to put an answer back into, and do
   *   not want one: they are report jobs, and a report never enters the document
   *   (KR-49).
   */
  async run(view, job, { source: whole = null } = {}) {
    const range = view.state.selection.main;
    const source = whole ?? view.state.sliceDoc(range.from, range.to);
    if (!source.trim()) return;

    this.close();
    this.view = view;
    this.range = whole ? null : { from: range.from, to: range.to };
    this.job = job;
    this.source = source;

    // The paragraph this is about must not move under it. If the writer edits it
    // while waiting, the suggestion is about a text that no longer exists — same
    // reasoning as an anchor that no longer resolves (KR-36).
    this.docAtStart = view.state.doc.toString();

    this.showWaiting();

    // Escape closes the card in every state — waiting, suggestion, report. It is
    // the one key that must always work, because it is the way out.
    //
    // But not when something is open ON TOP of it: the card listens in the
    // capture phase (so a running job can always be cancelled), which means it
    // would otherwise swallow the Escape meant to close a settings panel or menu
    // above it — cancelling the job instead of closing the panel. So it yields
    // when a higher overlay is present.
    this.onKey = (event) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".settings-panel, .popover")) return;
      event.preventDefault();
      this.close();
    };
    window.addEventListener("keydown", this.onKey, true);

    this.controller = new AbortController();
    const sonuc = await suggest(job, source, { signal: this.controller.signal });
    this.controller = null;
    clearInterval(this.timer);

    if (sonuc.iptal) return this.close();

    if (view.state.doc.toString() !== this.docAtStart) {
      return this.whisper("Metin değişti — öneri düştü.");
    }
    if (sonuc.hata) return this.whisper(sonuc.hata);
    if (sonuc.engel) return this.whisper(sonuc.engel);
    if (sonuc.rapor) return this.showReport(sonuc);

    this.showSuggestion(sonuc);
  }

  /**
   * A claim about the world (KR-49). It has no "accept" button, because there is
   * nothing to accept: this text never enters the document — that read-only shape
   * stays. What is gone is the wording: the amber warning box, then the small
   * "iddia" tag, are both pulled out with the rest of the app's AI warnings (one
   * global notice will replace them, see YAPILACAKLAR). The header now matches the
   * text cards: job, time, tokens and model on top; body below; buttons at foot.
   */
  showReport({ rapor, sure, kullanim, model }) {
    this.dom.replaceChildren();
    this.dom.hidden = false;
    this.dom.className = "suggestion report";

    const kontrol = document.createElement("div");
    kontrol.className = "suggestion-control";
    this.makeDraggable(kontrol);

    const baslik = document.createElement("span");
    baslik.className = "suggestion-title";
    baslik.textContent = jobName(this.job);

    const olcu = document.createElement("span");
    olcu.className = "suggestion-measure";
    olcu.textContent = `${(sure / 1000).toFixed(0)} sn${tokenSaydir(kullanim)}`;

    // No claim warning on the card any more (Zafer, 16 Tem 2026): the AI warnings
    // are being pulled out app-wide, to be replaced by one notice in a corner of
    // the app once it is complete. See YAPILACAKLAR. The report stays read-only
    // (no "accept"), which is the behaviour KR-49 turned on; only the words go.
    kontrol.append(baslik, olcu, modelEtiketi(model));

    const govde = document.createElement("div");
    govde.className = "suggestion-body report-body";
    govde.textContent = rapor;

    const alt = document.createElement("div");
    alt.className = "suggestion-actions";

    // The same quiet ✕ as the suggestion card — reject, close and cancel are one
    // gesture. And here it is the ONLY action beside copy: no accept, so not a
    // single blue on the card. That absence is KR-49's whole point, said in
    // colour rather than in a sentence.
    const kapat = document.createElement("button");
    kapat.className = "icon-action suggestion-drop";
    kapat.title = "Kapat — rapor belgeye giremez";
    kapat.innerHTML = icon(CROSS);
    kapat.onclick = () => this.close();

    alt.append(copyButton(rapor), kapat);
    this.dom.append(kontrol, govde, alt);
    this.fit();
  }

  // ---- states ---------------------------------------------------------------

  /** The wait is not hidden and not faked: it is counted (KR-48). */
  showWaiting() {
    this.dom.replaceChildren();
    this.dom.hidden = false;
    this.dom.className = "suggestion waiting";

    const nabiz = document.createElement("span");
    nabiz.className = "pulse";

    const said = document.createElement("span");
    said.className = "waiting-said";

    const basladi = Date.now();
    const yaz = () => {
      const sn = Math.round((Date.now() - basladi) / 1000);
      said.textContent = `${jobName(this.job)} yazılıyor… ${sn} sn`;
    };
    yaz();
    this.timer = setInterval(yaz, 1000);

    // The waiting card's cancel is a ✕ too: stopping a wait, rejecting a
    // suggestion and closing a report are the same gesture in all three states —
    // nothing enters the document.
    const vazgec = document.createElement("button");
    vazgec.className = "icon-action suggestion-cancel";
    vazgec.title = "Vazgeç — isteği durdur";
    vazgec.innerHTML = icon(CROSS);
    vazgec.onclick = () => {
      this.controller?.abort();
      this.close();
    };

    this.dom.append(nabiz, said, vazgec);
    this.fit();
  }

  /**
   * The suggestion, below the writer's own text, in the same measure and the
   * same type. Not side by side: half of a 730px column is 34 characters, and
   * nothing lines up with what it replaces. Stacked, the eye scans down and
   * finds the difference.
   */
  showSuggestion({ metin, bayraklar, kelime, sure, kullanim, model }) {
    this.dom.replaceChildren();
    this.dom.hidden = false;
    this.dom.className = "suggestion open";
    this.suggested = metin;

    // ---- control line: where to look twice. Never a verdict. ----
    const kontrol = document.createElement("div");
    kontrol.className = "suggestion-control";
    this.makeDraggable(kontrol);

    // The job name is the card's title — its own element, coloured like an
    // inactive document tab (#6b7280) in style.css, distinct from the fainter
    // stats beside it.
    const baslik = document.createElement("span");
    baslik.className = "suggestion-title";
    baslik.textContent = jobName(this.job);

    const olcu = document.createElement("span");
    olcu.className = "suggestion-measure";
    const kaynakKelime = (this.source.trim().match(/\S+/g) ?? []).length;
    olcu.textContent =
      (this.job === "continue"
        ? `${kelime} kelime`
        : `${kaynakKelime} → ${kelime} kelime`) +
      ` · ${(sure / 1000).toFixed(0)} sn` +
      tokenSaydir(kullanim);
    kontrol.append(baslik, olcu);

    for (const bayrak of bayraklar) {
      const rozet = document.createElement("span");
      rozet.className = "suggestion-flag";
      rozet.textContent = bayrak.soz;
      kontrol.append(rozet);
    }

    // The model that produced this, at the far right of the line — so you always
    // know which one you are judging (what the writer asked for, twice).
    kontrol.append(modelEtiketi(model));

    // ---- the text itself, with the flagged words underlined ----
    const govde = document.createElement("div");
    govde.className = "suggestion-body";
    govde.innerHTML = mark(metin, bayraklar);

    // ---- the decision ----
    const eylemler = document.createElement("div");
    eylemler.className = "suggestion-actions";

    // Accept and reject are icons now — "no written buttons" binds here too.
    // Both are the same quiet 26px box; the hierarchy comes from COLOUR and
    // ORDER: accept is the one accent blue and leads, reject is grey and trails,
    // copy sits far left. Once the words went, the heaviest thing on the card
    // became what it always should have been — the text.
    const al = document.createElement("button");
    al.className = "icon-action suggestion-take";
    al.title =
      this.job === "continue"
        ? "Kabul et — metin belgeye eklenir"
        : "Kabul et — metin belgeye girer";
    al.innerHTML = icon(TICK);
    al.onclick = () => this.accept();

    // Reject and close are the same icon because they are the same gesture: "let
    // this go, nothing enters the document." Two words ("Reddet" / "Kapat") were
    // describing one behaviour; the icon admitted it.
    const birak = document.createElement("button");
    birak.className = "icon-action suggestion-drop";
    birak.title = "Reddet — kart kapanır, belge değişmez";
    birak.innerHTML = icon(CROSS);
    birak.onclick = () => this.close();

    // Copy on the left; the accept/dismiss pair sits at the right.
    eylemler.append(copyButton(metin), al, birak);

    this.dom.append(kontrol, govde, eylemler);
    this.fit();
  }

  /**
   * When something goes wrong. It used to fade on its own in six seconds with no
   * close button — fine for a one-line hiccup, wrong for the message it most
   * often carries: a rate-limit notice with a link, long, and needing to be
   * read. So it waits to be dismissed now, and can always be.
   */
  whisper(text) {
    this.dom.replaceChildren();
    this.dom.hidden = false;
    this.dom.className = "suggestion whisper";

    const said = document.createElement("p");
    said.className = "whisper-text";
    said.textContent = text;

    const kapat = document.createElement("button");
    kapat.className = "icon-action suggestion-drop";
    kapat.title = "Kapat";
    kapat.innerHTML = icon(CROSS);
    kapat.onclick = () => this.close();

    this.dom.append(said, kapat);
    this.fit();
  }

  // ---- the decision itself ----------------------------------------------------

  /**
   * Nothing reaches the .md until here (KR-44). And when it does, it is one
   * ordinary, undoable edit — no trace is kept that a model wrote it.
   */
  accept() {
    const view = this.view;

    if (this.job === "continue") {
      const insert = `\n\n${this.suggested}`;
      view.dispatch({
        changes: { from: this.range.to, insert },
        selection: { anchor: this.range.to + insert.length },
      });
    } else {
      view.dispatch({
        changes: { from: this.range.from, to: this.range.to, insert: this.suggested },
        selection: { anchor: this.range.from + this.suggested.length },
      });
    }

    this.close();
    view.focus();
  }

  close() {
    clearInterval(this.timer);
    this.controller?.abort();
    this.controller = null;
    if (this.onKey) {
      window.removeEventListener("keydown", this.onKey, true);
      this.onKey = null;
    }
    this.dom.hidden = true;
    this.dom.replaceChildren();
  }

  /**
   * Centres the card on the screen and keeps it there — both axes, whatever grew
   * inside it, whichever state it is in.
   *
   * It used to open at the selection, which sat wherever you happened to be in
   * the line — usually off to the right, which is what Zafer found distracting.
   * A focused overlay reads better dead-centre, and it never drifts.
   *
   * Called after every state change, because each one has a different size.
   */
  fit() {
    if (this.dom.hidden) return;

    requestAnimationFrame(() => {
      const bosluk = 12;

      // Ceilings first, then measure. Measuring an unconstrained card gives the
      // size it *wants*, not the size it will *have*; a tall report then computed
      // a position for a card twice its real height and hung off the bottom.
      this.dom.style.maxWidth = `${window.innerWidth - 2 * bosluk}px`;
      this.dom.style.maxHeight = `${window.innerHeight - 2 * bosluk}px`;

      const en = this.dom.offsetWidth;
      const boy = this.dom.offsetHeight;

      const left = Math.max(bosluk, (window.innerWidth - en) / 2);
      const top = Math.max(bosluk, (window.innerHeight - boy) / 2);

      this.dom.style.top = `${top}px`;
      this.dom.style.left = `${left}px`;
    });
  }

  /**
   * Lets the card be dragged by its header bar, so you can slide it off the text
   * to compare the suggestion with what is underneath. Once you have moved it,
   * nothing re-centres it (fit() only runs on state changes, which are done by
   * the time you grab the bar).
   */
  makeDraggable(handle) {
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); // don't start a text selection while dragging
      const rect = this.dom.getBoundingClientRect();
      const dx = event.clientX - rect.left;
      const dy = event.clientY - rect.top;

      const onMove = (move) => {
        const bosluk = 4;
        const en = this.dom.offsetWidth;
        const boy = this.dom.offsetHeight;
        const left = Math.max(bosluk, Math.min(move.clientX - dx, window.innerWidth - en - bosluk));
        const top = Math.max(bosluk, Math.min(move.clientY - dy, window.innerHeight - boy - bosluk));
        this.dom.style.left = `${left}px`;
        this.dom.style.top = `${top}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    });
  }
}

/**
 * What the call cost, in the only unit that is billed. Shown for every provider,
 * not just the paid one — knowing the size of a call is worth something even when
 * it is free, and it is the only honest answer to "how much is this eating?".
 */
/** The model's name, pushed to the far right of the control line. */
function modelEtiketi(model) {
  const el = document.createElement("span");
  el.className = "suggestion-model";
  el.textContent = model ?? "";
  el.title = model ?? "";
  return el;
}

function tokenSaydir(kullanim) {
  if (!kullanim || (!kullanim.giren && !kullanim.cikan)) return "";
  const bin = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  let out = ` · ${bin(kullanim.giren)}↑ ${bin(kullanim.cikan)}↓ token`;

  // A prepaid quota is still a budget. Whether the money left your pocket today
  // or last month, the call has a price, and you should see it.
  if (kullanim.bedel) out += ` · ${(kullanim.bedel * 100).toFixed(1)}¢`;

  return out;
}

const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Underlines the words the control line is warning about, in the text itself —
 * so "invented date: 1930" is not a riddle to solve by re-reading.
 */
function mark(text, bayraklar) {
  const kelimeler = bayraklar
    .filter((b) => b.tur === "uydurulan-sayi" || b.tur === "uydurulan-ad")
    .flatMap((b) => b.kelimeler);

  let out = escape(text);
  for (const kelime of [...new Set(kelimeler)]) {
    const kalip = new RegExp(`(?<![\\w])${escape(kelime).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g");
    out = out.replace(kalip, `<u class="suspect">${escape(kelime)}</u>`);
  }
  return out;
}
