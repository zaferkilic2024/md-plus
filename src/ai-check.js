// What a model gives back, and whether it may be shown at all.
//
// Kept free of Tauri and of the DOM on purpose — like anchor.js. This is the
// layer that stands between a model and the writer's document, so it has to be
// testable without launching anything.
//
// The exam we ran on real Turkish academic text (14 July 2026) is the whole
// reason this file exists:
//
//   gemma3:4b  invented three LaTeX formulas in a paragraph that had none,
//              invented the date "1930", tripled the length of the text, and
//              both deleted and added bold marks.
//   gemma4:e2b was cleaner but silently dropped bold.
//
// So a suggestion is never trusted. Two kinds of check:
//
//   HARD GATE  — the output damaged something that is not the model's to touch:
//                the PORTABILITY of the .md (formulas, HTML, links). Not shown at
//                all; the app says why (KR-45). Formatting is NOT here any more —
//                bold/italic changes are the writer's to judge (17 Tem, Zafer).
//   SOFT FLAG  — the output may have drifted (a number that was not in the
//                source, a name that vanished, length that ran away). Shown,
//                but marked. The writer judges (KR-44).
//
// The line between them: a hard gate is something the writer cannot be expected
// to notice. Nobody proofreads LaTeX by eye.

import { t } from "./i18n.js";

/** Formulas, exactly as written. `$…$` is the only maths MD Plus writes. */
const formulasOf = (text) => (text.match(/\$[^$\n]+\$/g) ?? []).map((f) => f.trim());

/** Links, by target: `[text](belge.md)` — the canonical form (KR-13). */
const linksOf = (text) => (text.match(/\[[^\]]*\]\([^)]*\)/g) ?? []).map((l) => l.trim());

// boldCount/italicCount kaldırıldı (17 Tem): kalın/italik değişimi artık veto
// değil, yazarın gözünün işi (bkz. hardGate sonu).

const HTML = /<\/?[a-z][^>]*>/i;

/**
 * A list job's answer, split into the candidates it actually contains.
 *
 * "Tam üç satır, numarasız, tırnaksız" is what the prompt asks for; it is not
 * what always arrives. Models number their lists, bullet them, quote them, and
 * hang a `## ` on a title because it is a title. None of that is the candidate —
 * so the ornament comes off here, once, instead of in the writer's clipboard.
 *
 * What this does NOT do: pad to three, cut to three, or renumber. If two came,
 * two are shown. Making up the missing third would be the app writing (KR-44),
 * and the app does not write.
 *
 * Kept in this file for the reason the file exists: it is about the gap between
 * what we asked for and what the model sent, and it must be testable without a
 * DOM. (CRLF-safe — every .md written on Windows is.)
 */
export function candidateLines(text) {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        // Numbering ("1.", "2)"), bullets ("-", "*", "•") and heading marks.
        .replace(/^#{1,6}\s+/, "")
        .replace(/^(\d+[.)]|[-*•])\s+/, "")
        // Quotes the model wrapped the title in, both plain and typographic.
        .replace(/^["'“”‘’«]+|["'“”‘’»]+$/g, "")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * May this suggestion be shown to the writer at all?
 *
 * Returns null when it may, or a sentence saying what the model broke. The
 * sentence is shown as-is: the app admits the failure rather than quietly
 * handing over a damaged paragraph (KR-45).
 */
export function hardGate(source, suggestion, { kind = "rewrite" } = {}) {
  if (!suggestion.trim()) return t("aicheck.empty");

  // The one thing that can never reach a .md, whoever wrote it (portability law).
  if (HTML.test(suggestion)) {
    return t("aicheck.html");
  }

  // A new paragraph is allowed to be new — including its maths.
  //
  // This used to be a hard gate: any formula in a continuation was refused,
  // because gemma3:4b had invented three of them for a paragraph that had none.
  // But then Gemini Pro wrote a genuinely good paragraph containing "$2+2=4$" as
  // a rhetorical example, and the gate killed it. The rule was catching the
  // innocent with the guilty.
  //
  // So: a formula in a new paragraph is a FLAG, not a wall. The writer is shown
  // the paragraph and told a formula was added — they can read "$2+2=4$" and
  // judge it in a second. Only a rewrite must carry the source's maths across
  // untouched, because there the writer is not expecting maths to change at all.
  if (kind === "continue") return null;

  // A rewrite carries the source's formal skeleton across, untouched.
  const before = formulasOf(source);
  const after = formulasOf(suggestion);
  if (before.join("") !== after.join("")) {
    return after.length > before.length
      ? t("aicheck.formulaAdded")
      : t("aicheck.formulaChanged");
  }

  const linksBefore = linksOf(source);
  const linksAfter = linksOf(suggestion);
  if (linksBefore.join("") !== linksAfter.join("")) {
    return t("aicheck.linkChanged");
  }

  // Kalın/italik değişimi ARTIK veto DEĞİL (17 Tem 2026, Zafer). Eskiden sert
  // kapı, kalın ya da italik sayısı değişince öneriyi düşürürdü. Zafer: "italik
  // ve bold değişimlerini veto etme; nasıl olsa görüyorum ve karşılaştırıyorum,
  // bozuyorsa zaten kabul etmem." Biçim, formül/HTML/link gibi taşınabilirliği
  // bozan bir şey değil; okunur bir farktır ve karar yazarındır. Yumuşak bayrak
  // da eklenmedi: "görüyorum" diyen yazara işaret gürültüdür.
  return null;
}

/**
 * Proper names. Sentence-initial words are dropped: without that, "Bugün",
 * "Her", "Eğer" all count as names and every check cries wolf. What survives is
 * the kind of thing that matters — "John Nash", "Morgenstern".
 */
function namesOf(text) {
  const names = new Set();
  // Split into sentences, then ignore each sentence's first word.
  for (const sentence of text.split(/(?<=[.!?…:])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    for (let at = 1; at < words.length; at++) {
      const word = words[at].replace(/^[^\wÇĞİÖŞÜçğıöşü]+|[^\wÇĞİÖŞÜçğıöşü]+$/g, "");
      if (/^[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}$/.test(word)) names.add(word);
    }
  }
  return [...names];
}

/** Years and other figures. These are what a model invents most quietly. */
const numbersOf = (text) => [...new Set(text.match(/\b\d[\d.,]*\b/g) ?? [])];

/**
 * What the writer should look at twice. Never a verdict — the control line does
 * not say "clean", because the exam produced an output with zero flags whose
 * definition was nonetheless mangled. Flags narrow where to look; the judgement
 * stays in the writer's eye.
 */
export function flags(source, suggestion, { kind = "rewrite" } = {}) {
  const found = [];

  // A new paragraph may bring maths with it — but never silently.
  if (kind === "continue") {
    const eklenen = formulasOf(suggestion);
    if (eklenen.length) {
      found.push({
        tur: "eklenen-formul",
        kelimeler: [],
        soz: t("aicheck.flag.formulaAdded", { list: eklenen.join(" ") }),
      });
    }
  }

  // Proofreading has exactly one licence: fix a misspelt word. Not swap it for a
  // better one, not tidy the sentence, not "improve" anything. So every word that
  // changed is named — the prompt asks for restraint, this checks for it.
  if (kind === "proofread") {
    const degisen = changedWords(source, suggestion);
    if (degisen.length) {
      // Eight, not four: a real spelling pass produces more pairs than you would
      // think, because "bir kaç" → "birkaç" turns two words into one and counts
      // twice. Below the threshold the writer reads the corrections themselves;
      // above it, the number is the warning.
      found.push({
        tur: "degisen-kelime",
        kelimeler: degisen.map((d) => d.sonra),
        soz:
          degisen.length <= 8
            ? degisen.map((d) => `${d.once} → ${d.sonra}`).join(", ")
            : t("aicheck.flag.wordsChanged", { n: degisen.length }),
      });
    }
  }

  const newNumbers = numbersOf(suggestion).filter((n) => !numbersOf(source).includes(n));
  if (newNumbers.length) {
    found.push({
      tur: "uydurulan-sayi",
      kelimeler: newNumbers,
      soz: t("aicheck.flag.newNumber", { list: newNumbers.join(", ") }),
    });
  }

  const newNames = namesOf(suggestion).filter((n) => !source.includes(n));
  if (newNames.length) {
    found.push({
      tur: "uydurulan-ad",
      kelimeler: newNames,
      soz: t("aicheck.flag.newName", { list: newNames.join(", ") }),
    });
  }

  // A rewrite and a proofread both owe the source its names, its numbers and
  // roughly its length. Only a new paragraph is free of that.
  if (kind !== "continue") {
    const lostNames = namesOf(source).filter((n) => !suggestion.includes(n));
    if (lostNames.length) {
      found.push({
        tur: "kaybolan-ad",
        kelimeler: lostNames,
        soz: t("aicheck.flag.lostName", { list: lostNames.join(", ") }),
      });
    }

    const lostNumbers = numbersOf(source).filter((n) => !suggestion.includes(n));
    if (lostNumbers.length) {
      found.push({
        tur: "kaybolan-sayi",
        kelimeler: lostNumbers,
        soz: t("aicheck.flag.lostNumber", { list: lostNumbers.join(", ") }),
      });
    }

    const ratio = suggestion.length / source.length;
    if (ratio > 1.35) {
      found.push({ tur: "uzadi", kelimeler: [], soz: t("aicheck.flag.longer", { pct: Math.round((ratio - 1) * 100) }) });
    } else if (ratio < 0.7) {
      found.push({ tur: "kisaldi", kelimeler: [], soz: t("aicheck.flag.shorter", { pct: Math.round((1 - ratio) * 100) }) });
    }
  }

  return found;
}

/** Word count, for the control line. */
export const wordCount = (text) => (text.trim().match(/\S+/g) ?? []).length;

/**
 * Which words the proofreader actually touched.
 *
 * A plain longest-common-subsequence walk over the two word lists: everything
 * that lines up is untouched, and what does not line up is a substitution the
 * writer should see by name. Turkish spelling fixes are small and local
 * ("herkez" → "herkes"), so the pairs read like a list of corrections — and when
 * they do not, that is exactly the thing worth knowing.
 */
function changedWords(source, suggestion) {
  const a = source.trim().split(/\s+/).filter(Boolean);
  const b = suggestion.trim().split(/\s+/).filter(Boolean);

  // LCS table. These are paragraphs, not novels; the quadratic cost is nothing.
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const degisen = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      degisen.push({ once: a[i], sonra: "—" }); // dropped
      i++;
    } else {
      degisen.push({ once: "—", sonra: b[j] }); // added
      j++;
    }
  }
  while (i < n) degisen.push({ once: a[i++], sonra: "—" });
  while (j < m) degisen.push({ once: "—", sonra: b[j++] });

  // A dropped word immediately followed by an added one is a substitution: that
  // is what a spelling fix looks like, and it reads better as "herkez → herkes".
  const birlesik = [];
  for (let at = 0; at < degisen.length; at++) {
    const su = degisen[at];
    const sonraki = degisen[at + 1];
    if (su.sonra === "—" && sonraki?.once === "—") {
      birlesik.push({ once: su.once, sonra: sonraki.sonra });
      at++;
    } else {
      birlesik.push(su);
    }
  }
  return birlesik;
}
