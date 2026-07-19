// Which language a piece of text is in — tr or en.
//
// Kept free of Tauri and settings on purpose (like ai-check.js and anchor.js),
// so it can be examined at a terminal. The AI jobs use it to decide the OUTPUT
// language: the model answers in the language of the text it is working on, not
// the interface's (Zafer, 19 Tem) — select an English passage, get English back.
//
// A heuristic, not a language library, and it only has to tell TWO languages
// apart. Turkish-only letters (ğ ş ı İ) settle it outright; a diacritic-free line
// is decided by the distinctive function words of each language. Genuinely
// ambiguous input — a formula, a URL, two words — returns null, and the caller
// falls back to the interface language (the writer's best guess about themselves).

const TR_LETTERS = /[ğşıİĞŞ]/;

const TR_WORDS =
  /\b(ve|bir|bu|için|ile|değil|çok|daha|olarak|gibi|kadar|ama|veya|her|olan|olduğu|ancak|fakat|çünkü|sonra|önce|ise|hem|göre|üzerine)\b/gi;

const EN_WORDS =
  /\b(the|and|of|to|is|in|that|it|for|on|with|as|are|this|be|or|an|by|at|from|was|were|which|but|not|have|has)\b/gi;

/**
 * "tr" or "en", or null when the text gives no signal either way.
 *
 * A Turkish-only letter is conclusive. Otherwise the two languages' function
 * words are counted and the heavier side wins; a tie goes to Turkish (the app's
 * home language). No signal at all → null.
 */
export function classify(text) {
  if (TR_LETTERS.test(text)) return "tr";
  const trHits = (text.match(TR_WORDS) ?? []).length;
  const enHits = (text.match(EN_WORDS) ?? []).length;
  if (trHits === 0 && enHits === 0) return null;
  return trHits >= enHits ? "tr" : "en";
}

/** The language to write in for `text`, falling back to `fallback` (the
    interface language) when the text is too short or ambiguous to tell. */
export function detectTextLang(text, fallback = "tr") {
  return classify(text) ?? fallback;
}
