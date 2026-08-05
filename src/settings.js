// Reading preferences (IS-17).
//
// These change how the document *looks to you*, never what is in it. No setting
// here writes a byte into the .md — that is the line between this and the font
// picker KR-14 forbids: Word makes a word Arial, MD Plus makes your screen
// readable. The file stays plain Markdown either way.
//
// Deliberately open-ended: one file, one shape, easy to add to later.

import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { SETTINGS_FILE, appFolder } from "./app-folder.js";
import { detectLang, setLang } from "./i18n.js";
import { forgetSecret, readSecret, writeSecret } from "./secrets.js";

export const FONTS = {
  serif: {
    label: "Serif",
    stack: '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif',
  },
  // Georgia was buried in the serif stack as a fallback, which meant the one
  // serif actually drawn for most Windows readers had no name of its own. It
  // reads differently from Palatino — wider, darker, made for screens.
  georgia: {
    label: "Georgia",
    stack: 'Georgia, "Charter", "Bitstream Charter", serif',
  },
  // A third serif texture, and the one Windows always has: narrower, more
  // modern, better at small sizes than either of the two above.
  cambria: {
    label: "Cambria",
    stack: 'Cambria, Constantia, "Hoefler Text", serif',
  },
  sans: {
    label: "Sans",
    stack: '-apple-system, "Segoe UI", system-ui, sans-serif',
  },
  // Wide, loose, large-eyed: the one people reach for when a page is hard to
  // read rather than when it is ugly.
  verdana: {
    label: "Verdana",
    stack: 'Verdana, Tahoma, Geneva, sans-serif',
  },
  mono: {
    label: "Daktilo",
    stack: '"Cascadia Mono", Consolas, "SF Mono", monospace',
  },
};

const DEFAULTS = {
  // null means "follow the OS locale" (detectLang); a stored "tr"/"en" overrides
  // it (Zafer, 19 Tem). The effective language is settings.dil ?? detectLang().
  dil: null,

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
  // TWO layers since 6 Aug 2026 (KR-95, KR-50's third one dropped):
  //   baglantilar — {id, tur, anahtar?, baseUrl?, modeller: []}. A credential
  //                 and the models reached through it. No name field: the name
  //                 is computed, `Gemini#1`, because a name the user types is a
  //                 name the user has to think of, and it carries nothing —
  //                 since KR-94 even the key is filed under the id.
  //   isler       — each job holds a route: "" (off), "varsayilan", or
  //                 "<connId>/<model>".
  //   varsayilan  — the route jobs set to "varsayilan" follow. One decision
  //                 instead of nine.
  //
  // The middle layer used to be a `modeller` array of named instances pointing
  // at a connection by id. It is gone, and a whole class of bug went with it:
  // a model row could outlive its connection (B-28), which is why KR-77 had to
  // mark orphans. A model cannot outlive the connection it lives inside.
  //
  // While every job is off, nothing is sent and the palette shows no button
  // (KR-42): MD Plus is exactly v1. A default model does NOT turn jobs on.
  yapayZeka: {
    baglantilar: [],
    varsayilan: "",
    isler: {
      rewrite: "",
      continue: "",
      proofread: "",
      verify: "",
      cite: "",
      summarize: "",
      title: "",
      spot: "",
      translate: "",
    },
    // Which way translation goes (KR-83). A choice, not a guess: the model is
    // told, it does not decide. The defaults are the pair this app was asked
    // for; any pair from ai.js/TRANSLATION_LANGS can be set.
    ceviri: { from: "en", to: "tr" },
  },
};

export const LIMITS = {
  punto: { min: 14, max: 26, step: 0.5 },
  satirAraligi: { min: 1.3, max: 2.2, step: 0.06 },
  sutunGenisligi: { min: 560, max: 1040, step: 40 },
};

let settings = { ...DEFAULTS };

const pathOf = async () => `${await appFolder()}/${SETTINGS_FILE}`;

/**
 * Writes the settings — with every API key taken out first.
 *
 * The keys stay in `settings` in memory, because that is what `ai.js` reads on
 * its way to a request; what they never do is reach the disk. Each one goes to
 * the OS credential store under its connection's id, and the file keeps the
 * connection without it.
 *
 * A connection that has been deleted has its key deleted too — an orphaned
 * secret is a credential nobody can see and nobody meant to keep.
 */
async function persist() {
  const connections = settings.yapayZeka?.baglantilar ?? [];
  await Promise.all(connections.map((each) => writeSecret(each.id, each.anahtar ?? "")));

  const gone = knownConnections.filter((id) => !connections.some((each) => each.id === id));
  await Promise.all(gone.map(forgetSecret));
  knownConnections = connections.map((each) => each.id);

  const onDisk = {
    ...settings,
    yapayZeka: {
      ...settings.yapayZeka,
      baglantilar: connections.map(({ anahtar, ...rest }) => rest),
    },
  };
  await writeTextFile(await pathOf(), JSON.stringify(onDisk, null, 2));
}

/** Connection ids as of the last write, so a deleted one can be cleaned up. */
let knownConnections = [];

/** Puts the settings on the page. Everything downstream is CSS variables. */
export function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--reading", FONTS[settings.yaziTipi]?.stack ?? FONTS.serif.stack);
  root.setProperty("--reading-size", `${settings.punto}px`);
  root.setProperty("--reading-leading", String(settings.satirAraligi));
  root.setProperty("--column", `${settings.sutunGenisligi}px`);
}

export const getSettings = () => ({ ...settings });

/** The language actually in force: the stored choice, or the OS locale when the
    choice is "Otomatik" (null). The single source both settings and i18n read. */
export const effectiveLang = () => settings.dil || detectLang();

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
          isler: { ...DEFAULTS.yapayZeka.isler, ...(yz.isler ?? {}) },
          ceviri: { ...DEFAULTS.yapayZeka.ceviri, ...(yz.ceviri ?? {}) },
        },
      };
      settings = foldModelsIn(settings);
    }
  } catch {
    // A broken settings file is not worth a word to the writer: fall back to the
    // defaults and carry on.
    settings = { ...DEFAULTS };
  }

  await loadKeys();
  setLang(effectiveLang());
  applySettings();
  return getSettings();
}

/**
 * Folds a pre-KR-95 settings file into the two-layer shape: the `modeller`
 * array becomes a list of model names inside each connection, and every job's
 * model id becomes a `<connId>/<model>` route.
 *
 * A one-shot transform, not a compatibility layer — it runs, the new shape is
 * written on the next save, and this function can be deleted. Connection ids
 * are kept exactly as they were, which is what carries the API keys across:
 * since KR-94 a key is filed in the OS store under its connection's id.
 */
function foldModelsIn(current) {
  const yz = current.yapayZeka;
  if (!Array.isArray(yz.modeller)) return current;

  const routeOf = new Map();
  const modelsOf = new Map();
  for (const instance of yz.modeller) {
    if (!instance?.baglantiId || !instance.model) continue;
    routeOf.set(instance.id, `${instance.baglantiId}/${instance.model}`);
    const list = modelsOf.get(instance.baglantiId) ?? [];
    if (!list.includes(instance.model)) list.push(instance.model);
    modelsOf.set(instance.baglantiId, list);
  }

  const baglantilar = yz.baglantilar.map(({ ad, ...rest }) => ({
    ...rest,
    modeller: modelsOf.get(rest.id) ?? [],
  }));

  const isler = Object.fromEntries(
    Object.entries(yz.isler).map(([job, value]) => [job, routeOf.get(value) ?? ""]),
  );

  // Whatever the busiest connection answers with is a better default than
  // nothing; the first routed job's model is the closest thing this file has
  // to "the one you meant".
  const varsayilan = Object.values(isler).find(Boolean) ?? "";

  const { modeller, ...kept } = yz;
  return { ...current, yapayZeka: { ...kept, baglantilar, isler, varsayilan } };
}

/**
 * Fills each connection's key in from the credential store — and moves across
 * any key still sitting in the settings file from before 5 Aug 2026.
 *
 * The migration is deliberately one-way and immediate: the moment a plain-text
 * key is seen it is stored properly and the file is rewritten without it. A key
 * that has leaked once cannot be un-leaked, so the window where both copies
 * exist is made as short as a single function.
 */
async function loadKeys() {
  const connections = settings.yapayZeka?.baglantilar ?? [];
  knownConnections = connections.map((each) => each.id);
  if (!connections.length) return;

  let plainText = false;
  for (const connection of connections) {
    if (connection.anahtar) {
      // Was written in plain text by an older version.
      plainText = true;
      await writeSecret(connection.id, connection.anahtar);
    } else {
      connection.anahtar = await readSecret(connection.id);
    }
  }

  if (plainText) {
    try {
      await persist();
    } catch (error) {
      console.warn("anahtarlar taşınırken ayarlar yazılamadı:", error);
    }
  }
}

export async function updateSetting(key, value) {
  settings = { ...settings, [key]: value };
  if (key === "dil") setLang(effectiveLang());
  applySettings();
  try {
    await persist();
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
  await persist();
};

export const clamp = (key, value) => {
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
};
