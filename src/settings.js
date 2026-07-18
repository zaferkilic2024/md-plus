// Reading preferences (IS-17).
//
// These change how the document *looks to you*, never what is in it. No setting
// here writes a byte into the .md — that is the line between this and the font
// picker KR-14 forbids: Word makes a word Arial, MD Plus makes your screen
// readable. The file stays plain Markdown either way.
//
// Deliberately open-ended: one file, one shape, easy to add to later.

import { appDataDir } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const FILE = "ayarlar.json";

export const FONTS = {
  serif: {
    label: "Serif",
    stack: '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif',
  },
  sans: {
    label: "Sans",
    stack: '-apple-system, "Segoe UI", system-ui, sans-serif',
  },
  mono: {
    label: "Daktilo",
    stack: '"Cascadia Mono", Consolas, "SF Mono", monospace',
  },
};

const DEFAULTS = {
  yaziTipi: "serif",
  punto: 18.5,
  satirAraligi: 1.78,
  sutunGenisligi: 760,

  // KR-42: off, and off means absent. Every job starts "kapali"; while they all
  // are, the palette grows no button, ai.js is never reached, and nothing goes
  // to the network. MD Plus is exactly v1.
  //
  // KR-46: swapping one model for another is a setting, not a rewrite. Keys never
  // leave this file, and this file is never a .md.
  //
  // KR-50: each job is routed on its own. The models are not one size — a huge
  // one advances a paragraph, a fast free one fixes spelling — so each of the
  // five jobs picks its own provider and model. Keys are entered once and shared
  // across the jobs that use that provider.
  // Three layers, on purpose (KR-50):
  //   baglantilar — a credential with a free name: {id, ad, tur, anahtar}.
  //                 Enter a key once; reuse it across many models.
  //   modeller    — a named model instance: {id, ad, baglantiId, model}. One
  //                 OpenRouter key can feed several ("nemotron", "gpt").
  //   isler       — each of the five jobs points at a model instance by id.
  //
  // While isler is empty, nothing is sent and the palette shows no button
  // (KR-42): MD Plus is exactly v1.
  yapayZeka: {
    baglantilar: [],
    modeller: [],
    isler: { rewrite: "", continue: "", proofread: "", verify: "", cite: "" },
  },
};

export const LIMITS = {
  punto: { min: 14, max: 26, step: 0.5 },
  satirAraligi: { min: 1.3, max: 2.2, step: 0.06 },
  sutunGenisligi: { min: 560, max: 1040, step: 40 },
};

let settings = { ...DEFAULTS };

const pathOf = async () => {
  const folder = await appDataDir();
  if (!(await exists(folder))) await mkdir(folder, { recursive: true });
  return `${folder}/${FILE}`;
};

/** Puts the settings on the page. Everything downstream is CSS variables. */
export function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reading", FONTS[settings.yaziTipi]?.stack ?? FONTS.serif.stack);
  root.setProperty("--reading-size", `${settings.punto}px`);
  root.setProperty("--reading-leading", String(settings.satirAraligi));
  root.setProperty("--column", `${settings.sutunGenisligi}px`);
}

export const getSettings = () => ({ ...settings });

export async function loadSettings() {
  try {
    const path = await pathOf();
    if (await exists(path)) {
      const kayitli = JSON.parse(await readTextFile(path));
      const yz = kayitli.yapayZeka ?? {};
      settings = {
        ...DEFAULTS,
        ...kayitli,
        // Nested, so a settings file written before a field existed still gets
        // its defaults instead of `undefined` — down to each job's route.
        yapayZeka: {
          ...DEFAULTS.yapayZeka,
          ...yz,
          baglantilar: yz.baglantilar ?? [],
          modeller: yz.modeller ?? [],
          isler: { ...DEFAULTS.yapayZeka.isler, ...(yz.isler ?? {}) },
        },
      };
    }
  } catch {
    // A broken settings file is not worth a word to the writer: fall back to the
    // defaults and carry on.
    settings = { ...DEFAULTS };
  }
  applySettings();
  return getSettings();
}

export async function updateSetting(key, value) {
  settings = { ...settings, [key]: value };
  applySettings();
  try {
    await writeTextFile(await pathOf(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.warn("ayarlar kaydedilemedi:", error);
  }
  // So live views of a setting (the strip's model indicator, the palette's
  // price) can follow a change without polling.
  window.dispatchEvent(new CustomEvent("ayar-degisti"));
  return getSettings();
}

// Reset is the reading tab's button, so it resets reading — and only reading.
// It used to `{ ...DEFAULTS }` the whole object, which quietly wiped every AI
// connection, model and job route along with the font size.
export const resetSettings = async () => {
  settings = {
    ...settings,
    yaziTipi: DEFAULTS.yaziTipi,
    punto: DEFAULTS.punto,
    satirAraligi: DEFAULTS.satirAraligi,
    sutunGenisligi: DEFAULTS.sutunGenisligi,
  };
  applySettings();
  await writeTextFile(await pathOf(), JSON.stringify(settings, null, 2));
};

export const clamp = (key, value) => {
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
};
