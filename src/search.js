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
import { t } from "./i18n.js";

/** Turkish-correct folding: İ→i, I→ı. The whole reason this is hand-written. */
const fold = (text) => text.toLocaleLowerCase("tr");

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
  constructor(view) {
    this.view = view;
    this.hits = [];
    this.at = 0;

    this.dom = document.createElement("div");
    this.dom.className = "search";
    this.dom.hidden = true;
    // Its own clicks are its own: the editor listens for clicks on marks, and
    // this floats inside it (see the trap in CLAUDE.md).
    this.dom.addEventListener("click", (event) => event.stopPropagation());
    this.dom.onmousedown = (event) => {
      if (event.target.closest("input")) return;
      event.preventDefault();
    };

    this.field = document.createElement("input");
    this.field.type = "text";
    this.field.placeholder = t("search.placeholder");
    this.field.oninput = () => this.run();
    this.field.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.go(event.shiftKey ? -1 : 1);
      }
    };

    this.count = document.createElement("span");
    this.count.className = "search-count";

    this.prevButton = iconAction("prev", t("search.prev"), () => this.go(-1));
    this.nextButton = iconAction("next", t("search.next"), () => this.go(1));
    this.closeButton = iconAction("close", t("search.close"), () => this.close());

    const find = document.createElement("div");
    find.className = "search-row";
    find.append(lead("search"), this.field, this.count, this.prevButton, this.nextButton, this.closeButton);

    // The replace row is not shown to everyone who searches. Ctrl+F is a reading
    // act — you are looking for something — and most of the time it ends there.
    // Ctrl+H is a writing act, and asks for this row by name.
    this.swapRow = document.createElement("div");
    this.swapRow.className = "search-row search-swap";
    this.swapRow.hidden = true;

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

    // The way in, for the hand rather than the shortcut. Ctrl+H was the only
    // door to replace, and this app's own rule is that no action is reachable
    // only by knowing a key. It is the same chevron the palette wears when a
    // word opens something — it just turns to face the way it went.
    this.toggle = document.createElement("button");
    this.toggle.className = "search-toggle";
    this.toggle.innerHTML = icon(GLYPH.chevron);
    this.toggle.onclick = () => this.showSwap(this.swapRow.hidden);

    const rows = document.createElement("div");
    rows.className = "search-rows";
    rows.append(find, this.swapRow);

    this.dom.append(this.toggle, rows);
    view.dom.append(this.dom);
    // Collapsed to begin with. The chevron's visibility is NOT settled here —
    // at construction every surface is still editable (Aktarma takes the source
    // read-only afterwards), so an answer given now would be a guess. It is
    // asked in refreshWritable, when it can change and when it matters.
    this.showSwap(false);
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
    this.toggle.hidden = !this.writable;
    if (!this.writable) this.showSwap(false);
  }

  /** Opens or shuts the replace half, and turns the chevron to say which. */
  showSwap(show) {
    const on = show && this.writable;
    this.swapRow.hidden = !on;
    this.toggle.classList.toggle("open", on);
    this.toggle.title = on ? t("search.closeReplace") : t("search.openReplace");
    if (on) {
      this.swapField.select();
      this.swapField.focus();
    }
  }

  /** Aktarma's source is read-only, and a read-only surface is not asked to be
      rewritten (KR-22). The row simply is not there. */
  get writable() {
    return this.view.state.facet(EditorView.editable);
  }

  destroy() {
    this.dom.remove();
  }

  open({ swap = false } = {}) {
    this.dom.hidden = false;

    this.refreshWritable();

    // Whatever is selected is what you are almost certainly looking for.
    const range = this.view.state.selection.main;
    if (!range.empty && range.to - range.from < 100) {
      this.field.value = this.view.state.sliceDoc(range.from, range.to);
    }
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
    this.field.placeholder = t("search.placeholder");
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

  /** A word from the strip, in the strip, gone on the next keystroke. */
  said(text) {
    this.count.textContent = text;
    this.count.classList.remove("none");
  }

  /** `quiet`: being closed because another document is being searched — do not
      grab focus on the way out, the writer is looking somewhere else. */
  close({ quiet = false } = {}) {
    if (this.dom.hidden) return;
    this.dom.hidden = true;
    this.swapRow.hidden = true;
    this.hits = [];
    // The needle goes with it: with the strip shut, nothing should be recounting
    // anything on every keystroke.
    this.view.dispatch({ effects: setHits.of({ needle: "", hits: [], at: 0 }) });
    if (!quiet) this.view.focus();
  }

  run() {
    this.hits = findAll(this.view.state.doc.toString(), this.field.value);
    this.at = 0;
    this.paint({ reveal: this.hits.length > 0 });
  }

  /** ‹ n/m › — the same counter as travelling between marks (KR-38). */
  go(step) {
    if (!this.hits.length) return;
    this.at = (this.at + step + this.hits.length) % this.hits.length;
    this.paint({ reveal: true });
  }

  paint({ reveal = false } = {}) {
    const effects = [
      setHits.of({ needle: this.field.value, hits: this.hits, at: this.at }),
    ];
    if (reveal) {
      effects.push(
        EditorView.scrollIntoView(this.hits[this.at].from, { y: "center" }),
      );
    }
    this.view.dispatch({ effects });
    this.tell();
  }

  /**
   * The writer typed and the field recounted itself — take the new count and say
   * it. Reading only: the field already did the work, and dispatching from
   * inside an update is not ours to do.
   */
  sync() {
    if (this.dom.hidden) return;
    const state = this.view.state.field(hitsField);
    this.hits = state.hits;
    this.at = state.at;
    this.tell();
  }

  /** The counter — ‹ n/m ›, or nothing at all. */
  tell() {
    // "0/0" would be a lie about a search that has not been made yet.
    this.count.textContent = this.field.value
      ? `${this.hits.length ? this.at + 1 : 0}/${this.hits.length}`
      : "";
    this.count.classList.toggle("none", Boolean(this.field.value) && !this.hits.length);
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
    if (each !== view) search.close({ quiet: true });
  }
  searchers.get(view)?.open({ swap });
  return true;
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
  for (const search of searchers.values()) search.close({ quiet: true });
}

/** Every search box, re-labelled — the boxes are built once per surface, so a
    language change has to reach the ones already standing. */
export function relocalizeSearch() {
  for (const search of searchers.values()) search.relocalize();
}
