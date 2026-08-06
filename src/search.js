// Belge içi arama (V2-2, UC-18).
//
// Ctrl+F, and what you get is a strip and ‹ n/m › — the same object, the same
// language as travelling between marks in Aktarma (KR-38). Finding the third of
// eight things is the same act whether the things are marks or words, so it
// should not be a second vocabulary.
//
// There is NO search across the folder (KR-14). That door stays shut: a folder
// search wants a result list, a result list wants a library screen, and a
// library screen is the app we are not writing.
//
// The matching is written here rather than taken from @codemirror/search, and
// not to avoid a dependency: CodeMirror folds case with toLowerCase(), which is
// wrong in Turkish. "İSTER" lowercases to "i̇ster" (i + combining dot) and "ISTER"
// to "ıster" only under a Turkish locale. A reader searching "ister" in their own
// language must find "İSTER" in their own heading.

import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { GLYPH, icon, iconAction } from "./strip.js";
import { popover } from "./popover.js";
import { t } from "./i18n.js";

/** Turkish-correct folding: İ→i, I→ı. The whole reason this is hand-written. */
const fold = (text) => text.toLocaleLowerCase("tr");

/** The box's own arrows: the strip's chevrons, filled, for a 16px slot. */
const solid = (path) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">${path}</svg>`;
const SOLID = {
  prev: solid('<path d="M15.5 5L8.5 12l7 7z"/>'),
  next: solid('<path d="M8.5 5l7 7-7 7z"/>'),
  // Points UP while only the find row is showing, DOWN once the replace row is
  // open (Zafer, 2 Ağu). It is drawn down and rotated by CSS, so the two states
  // are one glyph turning rather than two drawings.
  swap: solid('<path d="M5 8.5L12 15.5l7-7z"/>'),
};

/**
 * Every occurrence of `needle` in `haystack`, folded. Plain text, never a regex:
 * a writer searching for "$x^2$" or "(1)" is searching for those characters, and
 * a regex would either explode or quietly mean something else.
 *
 * Matches never overlap: after one is found the search resumes at its END. This
 * used to resume one character in, so "aa" in "aaaa" came back three times where
 * every other editor says two. As a counter it was merely wrong; as the input to
 * Değiştir it was fatal — overlapping ranges are not a legal ChangeSet, and
 * "tümünü değiştir" would have thrown on the first doubled letter.
 */
export function findAll(haystack, needle) {
  const found = [];
  if (!needle) return found;

  // Folding can change length (İ → i + combining dot), which would slide every
  // position after it. Fold per character and keep a map back to the original.
  let flat = "";
  const at = [];
  for (let i = 0; i < haystack.length; i++) {
    const folded = fold(haystack[i]);
    for (let k = 0; k < folded.length; k++) at.push(i);
    flat += folded;
  }
  at.push(haystack.length);

  const target = fold(needle);
  for (
    let i = flat.indexOf(target);
    i !== -1;
    i = flat.indexOf(target, i + target.length)
  ) {
    found.push({ from: at[i], to: at[i + target.length] });
  }
  return found;
}

/**
 * The changes that replace every hit — one list, applied as ONE transaction.
 *
 * This is the whole reason it is a list and not a loop: replacing 60 words in 60
 * dispatches would put 60 steps on the undo stack, and the writer who wanted
 * their word back would press Ctrl+Z sixty times. One replace-all is one act, so
 * it is one entry in history. Applied together the offsets also cannot drift —
 * a ChangeSet is resolved against the original document, so nothing has to be
 * walked backwards to keep the positions honest.
 *
 * Pure, and separate from the strip, so it can be examined at a terminal: this
 * is the one function here that WRITES to the writer's document.
 */
export function replacements(hits, insert) {
  return hits.map(({ from, to }) => ({ from, to, insert }));
}

/**
 * The glyph in front of a field, saying what the field is for.
 *
 * This is what makes a bare input read as an input. A line under it was tried
 * and it was worse: an underline is a form's convention, and this strip is not a
 * form — it made the box look like paperwork. A frame each would have been three
 * borders deep. The icon says "this one finds, that one replaces" and takes the
 * eye straight to where the words go, without drawing a single new box.
 */
const lead = (glyph) => {
  const span = document.createElement("span");
  span.className = "search-lead";
  span.innerHTML = icon(GLYPH[glyph]);
  return span;
};

const setHits = StateEffect.define();

const hit = Decoration.mark({ class: "cm-bulgu" });
const onIt = Decoration.mark({ class: "cm-bulgu cm-bulgu-etkin" });

const hitsField = StateField.define({
  create: () => ({ needle: "", hits: [], at: 0 }),
  update(state, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setHits)) return effect.value;
    }
    if (!transaction.docChanged || !state.needle) return state;

    // The writer typed, so the results follow the document. They used to be
    // thrown away here, on the grounds that recomputing would "fight the
    // writer's typing" — it does not: the thing that fights typing is SCROLLING
    // to a hit, and nothing here scrolls. What the old rule actually did was
    // make the strip lie. Write a third "aaa" while searching "aaa" and the
    // count still said 2, the new one unpainted, until you touched the box.
    // Results are about the document; when it changes, so do they.
    //
    // The needle is kept in the state for exactly this: the field is the one
    // thing that is still here when the writer's next keystroke arrives.
    const hits = findAll(transaction.newDoc.toString(), state.needle);
    return {
      needle: state.needle,
      hits,
      // Stay on the one you were on if it still exists; never point past the end.
      at: Math.min(state.at, Math.max(0, hits.length - 1)),
    };
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const { hits, at } = state.field(field);
      return Decoration.set(
        hits.map((each, index) => (index === at ? onIt : hit).range(each.from, each.to)),
        true,
      );
    }),
});

class Search {
  /**
   * One box, two kinds of surface. `view` is a CodeMirror surface; `pdf` is a
   * PDF one, which has no view at all (KR-68: a PDF is not a CM surface and does
   * not pretend to be). Everything below asks `this.pdf` first and falls through
   * to the document path — the same shape pdf-marks.js takes, and for the same
   * reason: the box must not become two boxes.
   */
  constructor(view, pdf = null) {
    this.view = view;
    this.pdf = pdf;
    this.hits = [];
    this.at = 0;
    // Every PDF search is async (a page's text may still be in the worker), so
    // a slow answer must not overwrite a newer question.
    this.token = 0;

    // Where the marks live, for the "işaretlerde" scope. Handed in at render
    // time (searchBoxOf) rather than found from here: a view knows nothing about
    // the tab it belongs to, and inventing a way back would be a second truth.
    this.marks = null;
    this.scope = "text";
    this.markHits = [];

    // The box is a fixture of the document row now, not a strip that floats over
    // the text: it is always there, and Ctrl+F only puts the cursor in it.
    this.dom = document.createElement("div");
    this.dom.className = "search-box";
    this.dom.addEventListener("click", (event) => event.stopPropagation());
    this.dom.onmousedown = (event) => {
      if (event.target.closest("input, button")) return;
      event.preventDefault();
    };

    // The scope, said by the icon itself: an empty glass searches the text, the
    // mark's own glyph searches the marks. The chevron only says "this can
    // change" — the meaning is already in the drawing.
    this.scopeButton = document.createElement("button");
    this.scopeButton.className = "search-scope";
    this.scopeButton.onclick = () => this.pickScope();

    this.field = document.createElement("input");
    this.field.type = "text";
    this.field.placeholder = t("search.placeholder");
    this.field.oninput = () => {
      this.clearNote(); // a new question; the last answer is no longer about it
      this.run();
    };
    this.field.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.clear();
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.go(event.shiftKey ? -1 : 1);
      }
    };

    this.count = document.createElement("span");
    this.count.className = "search-count";

    // Solid triangles, not the strip's outlined chevrons. At 16px inside a 26px
    // box a 1.7-weight stroke is three grey hairs; filled, the same arrow reads
    // at a glance (Zafer, 2 Ağu). Same meaning, same direction — only the weight
    // changes, and it changes because the size did.
    this.prevButton = iconAction("prev", t("search.prev"), () => this.go(-1));
    this.nextButton = iconAction("next", t("search.next"), () => this.go(1));
    this.prevButton.innerHTML = SOLID.prev;
    this.nextButton.innerHTML = SOLID.next;
    this.closeButton = iconAction("close", t("search.close"), () => this.clear());

    const find = document.createElement("div");
    find.className = "search-row";
    find.append(
      this.scopeButton,
      this.field,
      this.count,
      this.prevButton,
      this.nextButton,
      this.closeButton,
    );

    // The replace row is not shown to everyone who searches. Ctrl+F is a reading
    // act — you are looking for something — and most of the time it ends there.
    // Ctrl+H is a writing act, and asks for this row by name.
    this.swapRow = document.createElement("div");
    this.swapRow.className = "search-row search-swap";
    // NOT hidden: the box around it (swapBox) is what opens and shuts now. It
    // was left hidden here and the panel opened as a bare 1px line — the frame
    // was there, its contents were not.

    this.swapField = document.createElement("input");
    this.swapField.type = "text";
    this.swapField.placeholder = t("search.replacePlaceholder");
    this.swapField.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        // Ctrl+Enter is the whole document, Enter is this one — the same
        // "commit bigger" that Ctrl carries everywhere else in the app.
        if (event.ctrlKey) this.replaceAll();
        else this.replaceOne();
      }
    };

    // These two are named, and named on purpose. There is no honest glyph for
    // "replace all" — a drawing of it is a rebus. They follow the settled
    // exception (`Gönder` / `Yorumla`): no fill, no border; the weight comes from
    // the word. Destructive-ish, so the wider one does not lead: "Tümü" sits
    // second, where the hand does not land by accident.
    this.swapOne = document.createElement("button");
    this.swapOne.className = "note-named";
    this.swapOne.textContent = t("search.replaceOne");
    this.swapOne.title = t("search.replaceOneTitle");
    this.swapOne.onclick = () => this.replaceOne();

    this.swapAll = document.createElement("button");
    this.swapAll.className = "note-named";
    this.swapAll.textContent = t("search.replaceAll");
    this.swapAll.title = t("search.replaceAllTitle");
    this.swapAll.onclick = () => this.replaceAll();

    this.swapRow.append(lead("swap"), this.swapField, this.swapOne, this.swapAll);

    // "60 değiştirildi" used to go into the counter, which is 40px wide and
    // already answering a different question. It gets its own line under the
    // replace row: the one place in this box where a sentence can be a sentence.
    this.note = document.createElement("div");
    this.note.className = "search-note";
    this.note.hidden = true;

    this.swapBox = document.createElement("div");
    this.swapBox.className = "search-swap-box";
    this.swapBox.hidden = true;
    this.swapBox.append(this.swapRow, this.note);

    // The way in, for the hand rather than the shortcut. Ctrl+H was the only
    // door to replace, and this app's own rule is that no action is reachable
    // only by knowing a key. It is the same chevron the palette wears when a
    // word opens something — it just turns to face the way it went.
    this.toggle = document.createElement("button");
    this.toggle.className = "search-toggle";
    this.toggle.innerHTML = SOLID.swap;
    // Asks the box that actually opens and shuts. It used to ask `swapRow`,
    // which stopped being the thing that hides — so the answer was always
    // "already open" and every click meant "close".
    this.toggle.onclick = () => this.showSwap(this.swapBox.hidden);

    find.append(this.toggle);
    this.dom.append(find, this.swapBox);
    // NOT appended to view.dom any more: the box lives in the document row, and
    // main.js puts it there for whichever tab is in front (searchBoxOf).
    //
    // Collapsed to begin with. The chevron's visibility is NOT settled here —
    // at construction every surface is still editable (Aktarma takes the source
    // read-only afterwards), so an answer given now would be a guess. It is
    // asked in refreshWritable, when it can change and when it matters.
    this.showSwap(false);
    this.showScope();
  }

  /** The two scopes, as a menu under the icon. Two entries, so the icon could
      have simply toggled — but then the second scope would exist only for
      whoever clicked and noticed. A menu says what there is. */
  pickScope() {
    const menu = popover(this.scopeButton, [
      {
        icon: "search",
        label: t("search.scopeText"),
        active: this.scope === "text",
        run: () => this.setScope("text"),
      },
      {
        icon: "marks",
        label: t("search.scopeMarks"),
        active: this.scope === "marks",
        run: () => this.setScope("marks"),
      },
    ]);
    menu?.classList.add("scope-menu");
  }

  setScope(scope) {
    this.scope = scope;
    this.showScope();
    this.refreshWritable();
    this.run();
    this.field.focus();
  }

  /** The icon IS the answer, so it is the icon that changes. */
  showScope() {
    const marks = this.scope === "marks";
    this.scopeButton.innerHTML =
      icon(marks ? GLYPH.marks : GLYPH.search) + icon(GLYPH.chevron, 9);
    this.scopeButton.classList.toggle("on-marks", marks);
    this.scopeButton.title = marks ? t("search.scopeMarks") : t("search.scopeText");
    this.field.placeholder = marks
      ? t("search.placeholderMarks")
      : t("search.placeholder");
  }

  /**
   * Whether this surface can be rewritten is not settled once — it changes
   * under the strip's feet.
   *
   * Aktarma builds no source of its own: it BORROWS the tab's view and makes it
   * read-only for as long as it is up (transfer.js), then hands it back. So one
   * surface is writable, then not, then writable again, and a chevron decided at
   * construction — or worse, inside a click handler — just says whatever it last
   * heard. That is the whole bug: the chevron stayed in Aktarma where there was
   * nothing to replace, vanished when clicked (the click was the first time
   * anyone asked), and was still missing back in the tab, because Ctrl+F never
   * asked at all. Only Ctrl+H did, which is why Ctrl+H "fixed" it.
   *
   * So: ask when it can change (the facet moved) and when it matters (the strip
   * opens). Never offer a door that opens onto a wall (KR-22).
   */
  refreshWritable() {
    this.toggle.hidden = !this.writable || this.scope !== "text";
    if (this.toggle.hidden) this.showSwap(false);
  }

  /** Opens or shuts the replace half, and turns the chevron to say which.
      Never over the marks: a mark is a place in the document, not a word to be
      swapped, and its note is not the document's text at all. */
  showSwap(show) {
    const on = show && this.writable && this.scope === "text";
    this.swapBox.hidden = !on;
    if (!on) this.clearNote();
    // The box and the row below it are drawn as one object while it is open.
    this.dom.classList.toggle("swapping", on);
    this.toggle.classList.toggle("open", on);
    this.toggle.title = on ? t("search.closeReplace") : t("search.openReplace");
    if (on) {
      this.swapField.select();
      this.swapField.focus();
    }
  }

  /**
   * There is nothing in this document to look through (Zafer, 6 Aug).
   *
   * The same face Aktarma's empty target half wears (`inertSearchBox`): the box
   * stays exactly where it is and goes pale, because a box that vanishes takes
   * the row's balance with it (KR-64). Any search in progress is dropped — the
   * text it was pointing into is gone.
   */
  setInert(on) {
    if (this.inert === on) return;
    this.inert = on;
    this.dom.classList.toggle("inert", on);
    this.field.disabled = on;
    if (!on) return;

    // Deleting the last character is what turns this on, and that arrives from
    // inside CodeMirror's own update (main.js/onChange) — where dispatching is
    // forbidden and would take the plugin down with it (B-31). `clear` both
    // dispatches and can take focus, so it waits for the update to finish, and
    // goes quiet: the writer is in the document, not in this box.
    queueMicrotask(() => {
      if (this.inert) this.clear({ quiet: true });
    });
  }

  /** Aktarma's source is read-only, and a read-only surface is not asked to be
      rewritten (KR-22). The row simply is not there. */
  get writable() {
    // Nothing is ever written into a PDF (KR-68), so the replace half of the
    // box simply does not exist there.
    if (this.pdf) return false;
    return this.view.state.facet(EditorView.editable);
  }

  destroy() {
    this.dom.remove();
  }

  open({ swap = false } = {}) {
    // Ctrl+F into an empty document: the box is pale and there is nothing to
    // find, so the keystroke lands nowhere rather than in a dead field.
    if (this.inert) return;
    this.refreshWritable();

    // Whatever is selected is what you are almost certainly looking for.
    const picked = this.pdf
      ? this.pdf.selectedText()
      : (() => {
          const range = this.view.state.selection.main;
          return range.empty ? "" : this.view.state.sliceDoc(range.from, range.to);
        })();
    if (picked && picked.length < 100) this.field.value = picked.replace(/\s+/g, " ").trim();
    this.run();

    // Ctrl+H asks for the row; Ctrl+F never takes it away again (closing the
    // strip does — see close). On a read-only source Ctrl+H is simply Ctrl+F:
    // there is no row to ask for.
    if (swap && this.writable) {
      // showSwap lands the cursor in "Yerine…" — which is right when the word to
      // find is already in hand, and wrong when the box is empty and that is the
      // question still open.
      this.showSwap(true);
      if (!this.field.value) {
        this.field.select();
        this.field.focus();
      }
      return;
    }

    this.field.select();
    this.field.focus();
  }

  /**
   * The one hit you are standing on. The strip then steps to the next one on its
   * own: replacing is a walk, and stopping to press ‹ › between every step would
   * be asking the writer to do the counting.
   */
  replaceOne() {
    if (!this.writable || !this.hits.length) return;

    const target = this.hits[this.at];
    const insert = this.swapField.value;
    const landed = this.at;

    this.view.dispatch({
      changes: { from: target.from, to: target.to, insert },
      // The mark it may have been sitting inside travels with it (KR-56):
      // marksField maps every mark through these changes, exactly as it does
      // through typing. Replacing text under a mark is not different from
      // writing under it.
    });

    // The document changed, so the old positions are gone — ask again rather
    // than doing arithmetic on them.
    this.hits = findAll(this.view.state.doc.toString(), this.field.value);
    // Stay where you were: the hit that was here is gone, so this index is now
    // the NEXT one. If it was the last, wrap.
    this.at = this.hits.length ? Math.min(landed, this.hits.length - 1) : 0;
    this.paint({ reveal: this.hits.length > 0 });
  }

  /**
   * Every hit, in one transaction — one act, one entry in the undo stack. A
   * writer who replaces 60 words and regrets it presses Ctrl+Z once.
   */
  replaceAll() {
    if (!this.writable || !this.hits.length) return;

    const count = this.hits.length;
    this.view.dispatch({ changes: replacements(this.hits, this.swapField.value) });

    this.hits = findAll(this.view.state.doc.toString(), this.field.value);
    this.at = 0;
    this.paint();

    // Say what happened. Replacing 60 words silently is the app changing the
    // document more than any other single act, and saying nothing about it.
    this.said(t("search.replaced", { n: count }));
  }

  /** Re-reads its labels in the current language (called on a language change). */
  relocalize() {
    this.showScope(); // sets the placeholder and the scope title
    this.prevButton.title = t("search.prev");
    this.nextButton.title = t("search.next");
    this.closeButton.title = t("search.close");
    this.swapField.placeholder = t("search.replacePlaceholder");
    this.swapOne.textContent = t("search.replaceOne");
    this.swapOne.title = t("search.replaceOneTitle");
    this.swapAll.textContent = t("search.replaceAll");
    this.swapAll.title = t("search.replaceAllTitle");
    this.showSwap(!this.swapRow.hidden); // refreshes the toggle title
  }

  /** A word from the box, under the replace row, gone on the next keystroke. */
  said(text) {
    this.note.textContent = text;
    this.note.hidden = false;
  }

  clearNote() {
    this.note.textContent = "";
    this.note.hidden = true;
  }

  /**
   * Escape and ✕. The box no longer goes away — it is part of the row — so what
   * ends is the SEARCH: the word, the highlights, the count. `quiet`: another
   * document is being searched, so do not pull the focus back here.
   */
  clear({ quiet = false } = {}) {
    const wasEmpty = !this.field.value && this.swapBox.hidden;
    this.field.value = "";
    // Through showSwap, NOT by hiding the row inside it: hiding the row left the
    // panel opening as an empty frame ever after — the box would open and there
    // would be nothing in it.
    this.showSwap(false);
    this.hits = [];
    this.markHits = [];
    this.at = 0;
    this.token++; // any answer still in flight is now stale
    // The needle goes with it: with nothing being looked for, nothing should be
    // recounting anything on every keystroke.
    if (this.pdf) this.pdf.clearHits();
    else this.view.dispatch({ effects: setHits.of({ needle: "", hits: [], at: 0 }) });
    this.tell();
    if (!quiet && !wasEmpty) (this.pdf ?? this.view).focus();
  }

  run() {
    if (this.pdf && this.scope === "text") {
      this.runPdf();
      return;
    }

    if (this.scope === "marks") {
      const needle = fold(this.field.value);
      // A mark is its passage AND its note: someone who wrote "bunu tezin
      // ikinci bölümüne" is looking for those words, not for the quotation.
      this.markHits = !needle
        ? []
        : (this.marks?.listing() ?? []).filter(({ record, text }) =>
            fold(`${text} ${record.yorum ?? ""}`).includes(needle),
          );
      this.at = 0;
      // No highlights of our own: the marks are already painted, and travelling
      // to one shades it (marks.js/travelShade). Two paints, one meaning.
      // Guarded: a PDF has no view, and this line threw the moment the scope was
      // switched to marks on one.
      this.view?.dispatch({ effects: setHits.of({ needle: "", hits: [], at: 0 }) });
      this.tell();
      // Land on the first one, exactly as the text scope does (paint reveals).
      // Without this the first Enter stepped to the SECOND hit: `at` was already
      // 0 and nobody had gone there.
      if (this.markHits.length) this.marks?.travelTo(this.markHits[0].record.id);
      return;
    }

    this.hits = findAll(this.view.state.doc.toString(), this.field.value);
    this.at = 0;
    this.paint({ reveal: this.hits.length > 0 });
  }

  /**
   * The whole PDF, not the pages on screen. A page's text is asked for whether
   * or not it is drawn (pdf.textForSearch) — a search that only found what was
   * already visible would be answering a question nobody asked.
   *
   * Hits are `{page, from, to}`: a PDF has no document-wide offset, and inventing
   * one would be a second coordinate system to keep in step with the first.
   */
  async runPdf() {
    const token = ++this.token;
    const needle = this.field.value;
    this.pdf.clearHits();

    if (!needle) {
      this.hits = [];
      this.at = 0;
      this.tell();
      return;
    }

    const found = [];
    for (let page = 1; page <= this.pdf.pageCount; page++) {
      const text = await this.pdf.textForSearch(page);
      if (token !== this.token) return; // a newer keystroke won
      for (const hit of findAll(text, needle)) found.push({ page, ...hit });
    }

    this.hits = found;
    this.at = 0;
    this.tell();
    this.paintPdf();
    // Not a jump on every keystroke: typing is still asking the question. The
    // first hit is walked to only when the reader says so (Enter, or ›).
  }

  /** The hits on the pages that happen to be drawn. The rest paint themselves
      when their page is (onPaint → repaintSearch). */
  paintPdf() {
    if (!this.pdf) return;
    const byPage = new Map();
    this.hits.forEach((hit, index) => {
      if (!byPage.has(hit.page)) byPage.set(hit.page, []);
      byPage.get(hit.page).push({ ...hit, active: index === this.at });
    });
    for (const [page, ranges] of byPage) this.pdf.paintHits(page, ranges);
  }

  /** A page was just drawn — anything found on it is painted now. */
  repaintPage(page) {
    if (!this.pdf || !this.hits.length) return;
    const ranges = this.hits
      .map((hit, index) => ({ ...hit, active: index === this.at }))
      .filter((hit) => hit.page === page);
    if (ranges.length) this.pdf.paintHits(page, ranges);
  }

  /** ‹ n/m › — the same counter as travelling between marks (KR-38). */
  go(step) {
    if (this.pdf && this.scope === "text") {
      if (!this.hits.length) return;
      this.at = (this.at + step + this.hits.length) % this.hits.length;
      this.goPdf();
      return;
    }

    if (this.scope === "marks") {
      if (!this.markHits.length) return;
      this.at = (this.at + step + this.markHits.length) % this.markHits.length;
      this.marks?.travelTo(this.markHits[this.at].record.id);
      this.tell();
      return;
    }

    if (!this.hits.length) return;
    this.at = (this.at + step + this.hits.length) % this.hits.length;
    this.paint({ reveal: true, land: true });
  }

  /**
   * Walks to the current hit: draw its page first, THEN put the range on
   * screen. `goTo` alone stops at the top of a page, and at this zoom a page is
   * taller than the window — the same thing that had to be fixed for F8 (B-32).
   */
  async goPdf() {
    const hit = this.hits[this.at];
    if (!hit) return;
    this.tell();
    await this.pdf.showPage(hit.page);
    this.pdf.revealRange(hit.page, hit.from, hit.to);
    this.paintPdf();
  }

  /**
   * @param {boolean} reveal  scroll the current hit into view
   * @param {boolean} land    put the CURSOR on it as well
   *
   * `land` is what makes a hit inside hidden text visible (Zafer, 6 Ağu). The
   * writing surface shows raw Markdown only on the line holding the cursor, so
   * a match inside a link's target — `](tez.md)` — was scrolled to and then not
   * shown: the screen moved and nothing appeared. Landing the cursor opens that
   * line the way any other visit would, and the reader sees what was found.
   *
   * Only while WALKING the hits (‹ › / Enter), never while typing in the box:
   * moving the cursor on every keystroke would drag the document out from under
   * a writer who is still deciding what to look for.
   */
  paint({ reveal = false, land = false } = {}) {
    const hit = this.hits[this.at];
    const effects = [
      setHits.of({ needle: this.field.value, hits: this.hits, at: this.at }),
    ];
    if (reveal && hit) {
      effects.push(EditorView.scrollIntoView(hit.from, { y: "center" }));
    }
    this.view.dispatch({
      effects,
      // The cursor, not a selection: selecting the hit would arm the palette and
      // put a floating box over the very thing being looked at.
      ...(land && hit ? { selection: { anchor: hit.from } } : {}),
    });
    this.tell();
  }

  /**
   * The writer typed and the field recounted itself — take the new count and say
   * it. Reading only: the field already did the work, and dispatching from
   * inside an update is not ours to do.
   */
  sync() {
    if (!this.field.value) return;
    if (this.scope === "marks") {
      this.run(); // an edit can make or break a mark's words
      return;
    }
    const state = this.view.state.field(hitsField);
    this.hits = state.hits;
    this.at = state.at;
    this.tell();
  }

  /** The counter — ‹ n/m ›, or nothing at all. */
  tell() {
    const found = this.scope === "marks" ? this.markHits : this.hits;
    // "0/0" would be a lie about a search that has not been made yet.
    this.count.textContent = this.field.value
      ? `${found.length ? this.at + 1 : 0}/${found.length}`
      : "";
    this.count.classList.toggle("none", Boolean(this.field.value) && !found.length);
    // Nothing to step through, nothing to press.
    this.prevButton.disabled = !found.length;
    this.nextButton.disabled = !found.length;
  }
}

// Every live searcher. A Map, not a WeakMap: opening one has to be able to shut
// the others, and that means walking them.
const searchers = new Map();

export const documentSearch = ViewPlugin.define((view) => {
  const search = new Search(view);
  searchers.set(view, search);
  return {
    update(update) {
      // The field recounted itself through the change; the strip just reads the
      // new number off it. Replacing dispatches on its own and paints as it goes.
      if (update.docChanged) search.sync();

      // Aktarma just took this view read-only, or gave it back. If the strip is
      // standing open while that happens, the chevron has to answer at once —
      // waiting for the next Ctrl+F is how it went stale in the first place.
      if (
        update.startState.facet(EditorView.editable) !==
        update.state.facet(EditorView.editable)
      ) {
        search.refreshWritable();
      }
    },
    destroy() {
      searchers.delete(view);
      search.destroy();
    },
  };
});

export const searchField = hitsField;

/**
 * Ctrl+F, and there is exactly ONE search box on screen (Zafer, 16 Tem).
 *
 * There used to be one per surface, which is one per *thing that can hold text*:
 * the tab, the source in Aktarma, the target beside it. Split the screen and two
 * boxes appeared, each with its own count, each answering a different question —
 * "arap saçına dönüyor". Searching is one act: it is about the document you are
 * reading, and you are reading one document at a time.
 *
 * Never a folder (KR-14).
 */
export function openSearch(view, { swap = false } = {}) {
  for (const [each, search] of searchers) {
    if (each !== view) search.clear({ quiet: true });
  }
  searchers.get(view)?.open({ swap });
  return true;
}

/**
 * The box for this view, ready to be put in the document row — and told where
 * this tab's marks are, for the "işaretlerde" scope. Called on every render, so
 * a tab that gains or loses its store is never left holding a stale one.
 */
export function searchBoxOf(view, marks = null) {
  const search = searchers.get(view);
  if (!search) return null;
  search.marks = marks;
  return search.dom;
}

/** Told from outside, because "is this document empty?" is the document row's
    question and the box has no view onto anything but its own text. */
export function setSearchInert(view, on) {
  searchers.get(view)?.setInert(on);
}

/**
 * A box that is there and cannot be used: Aktarma's target half before a target
 * is open. The row is split down the middle, so an empty right half read as
 * something missing rather than something waiting — and the two halves stopped
 * balancing. Passive, not absent (KR-64's rule: a thing that comes and goes
 * moves everything beside it).
 */
export function inertSearchBox() {
  const box = document.createElement("div");
  box.className = "search-box inert";
  const row = document.createElement("div");
  row.className = "search-row";
  const glass = document.createElement("span");
  glass.className = "search-scope";
  glass.innerHTML = icon(GLYPH.search);
  const field = document.createElement("input");
  field.disabled = true;
  field.placeholder = t("search.placeholder");
  row.append(glass, field);
  box.append(row);
  return box;
}

/**
 * A PDF's search box. There is no ViewPlugin to build it — a PDF has no view —
 * so the tab makes one when the surface is created and hands it back on close.
 * Keyed by the surface, so the same tab always gets the same box.
 */
export function createPdfSearch(pdf) {
  const search = new Search(null, pdf);
  searchers.set(pdf, search);
  return {
    dom: search.dom,
    /** A page finished drawing: paint whatever was found on it. */
    onPaint: (page) => search.repaintPage(page),
    setMarks: (marks) => {
      search.marks = marks;
    },
    open: (options) => search.open(options),
    relocalize: () => search.relocalize(),
    destroy: () => searchers.delete(pdf),
  };
}

/**
 * Ctrl+H — the same strip, with the replace row asked for by name (UC-21).
 *
 * Not a second box and not a second screen: find and replace are one act with
 * two halves, and the half you are looking at is already open. Ctrl+F on a strip
 * that is already showing the replace row leaves it showing — closing it would
 * be answering a question nobody asked.
 */
export function openReplace(view) {
  return openSearch(view, { swap: true });
}

/**
 * Every search box, shut. Called on the way into and out of Aktarma (B-22):
 * the box belongs to the screen you opened it on, and a layer change is the
 * moment transient things get swept — otherwise a search opened over the
 * target came back to the tabs still standing.
 */
export function closeAllSearch() {
  for (const search of searchers.values()) search.clear({ quiet: true });
}

/** Every search box, re-labelled — the boxes are built once per surface, so a
    language change has to reach the ones already standing. */
export function relocalizeSearch() {
  for (const search of searchers.values()) search.relocalize();
}
