// The one i18n gate. Every user-visible string in the app flows through t().
//
// Design (kept as small as the rest of the app):
//   - A flat catalog per language, keyed by a namespaced string ("menu.contents").
//     Keys are English-ish slugs, never prose, so a key never has to change when
//     the wording does.
//   - t(key, params) resolves against the CURRENT language at CALL time. So the
//     data tables that hold labels (palette buttons, shortcut rows, AI job names)
//     keep KEYS, and turn into prose only at the moment they build DOM — which is
//     why switching the language re-renders live for anything drawn on demand
//     (menus, palette, dialogs, the settings panel).
//   - `{name}` placeholders are filled from params: t("status.notFound", {path}).
//
// Language choice (Zafer, 19 Tem): the OS locale is the default (detectLang),
// and Ayarlar overrides it. The effective language lives in settings.js, which
// calls setLang on load and on change; this file only holds the catalogs and the
// lookup, so it stays free of Tauri and testable under Node.
//
// Default is "tr" on purpose: the Node tests (uyari, oneri) import string-
// producing modules without ever calling setLang, and they assert on the Turkish
// wording. A missing English key also falls back to Turkish — never to the raw
// key — so the app is always readable, even while en.js is half-filled.

import { tr } from "./locales/tr.js";
import { en } from "./locales/en.js";

const CATALOGS = { tr, en };

/** The languages the app offers, in menu order. Value is the endonym. */
export const LANGS = { tr: "Türkçe", en: "English" };

let current = "tr";

/** The OS/browser locale, narrowed to a language we ship. Called by settings.js
    when no explicit choice is stored. */
export function detectLang() {
  const nav = (typeof navigator !== "undefined" && navigator.language) || "tr";
  return nav.toLowerCase().startsWith("tr") ? "tr" : "en";
}

/** Set the live language. Unknown codes fall back to Turkish. */
export function setLang(lang) {
  current = CATALOGS[lang] ? lang : "tr";
}

export const getLang = () => current;

/**
 * The string for `key` in the current language.
 *
 * Falls back to Turkish when the current catalog lacks the key (so a half-filled
 * en.js still reads), and to the key itself only as a last resort (so a genuine
 * typo is visible rather than blank). `params` fills `{name}` placeholders.
 */
export function t(key, params) {
  const cat = CATALOGS[current] || tr;
  let s = cat[key];
  if (s == null) s = tr[key];
  if (s == null) return key;
  if (params) {
    for (const name in params) s = s.split(`{${name}}`).join(String(params[name]));
  }
  return s;
}
