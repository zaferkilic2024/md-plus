// Settings: they belong to the app, not to a document.
//
// That is why they hang off their own icon rather than the ⋯ menu, which is
// about the document you are standing in. They are remembered across sessions
// (ayarlar.json) and none of them writes a byte into a .md.
//
// Everything is live — change it and the document under you changes with it, so
// you judge the setting on your own prose rather than on a preview.
//
// One section today. Deliberately built to take more.

import { aiWarningNote } from "./warning.js";
import {
  FONTS,
  LIMITS,
  clamp,
  getSettings,
  resetSettings,
  updateSetting,
} from "./settings.js";
import {
  PROVIDERS,
  TRANSLATION_LANGS,
  connectionModels,
  jobName,
  languageName,
  providerLabel,
  providerMeta,
  reportJobs,
  textJobs,
} from "./ai.js";
import { askChoice } from "./confirm.js";
import { shortcutGroups } from "./shortcuts.js";
import { LANGS, t } from "./i18n.js";

/** Which CSS variable each numeric reading setting drives — so a drag can
    preview live without persisting on every pixel. Mirrors applySettings(). */
const CSS_VAR = {
  punto: (v) => ["--reading-size", `${v}px`],
  satirAraligi: (v) => ["--reading-leading", String(v)],
  sutunGenisligi: (v) => ["--column", `${v}px`],
};
const applyLive = (key, value) => {
  const [name, val] = CSS_VAR[key](value);
  document.documentElement.style.setProperty(name, val);
};

/**
 * A slider row: label, a draggable track, a live value. Dragging previews the
 * change on the document immediately (CSS variables) and persists it only on
 * release — so one drag is one saved setting, not fifty disk writes.
 *
 * Each slider pushes its own render() into `renders`, which is how Reset makes
 * the handles jump to their defaults: the values used to stay frozen on screen
 * until you nudged −/+, because nothing re-read them after the reset.
 */
function slider(label, key, format, renders) {
  const row = document.createElement("div");
  row.className = "type-row";

  const name = document.createElement("span");
  name.className = "type-label";
  name.textContent = label;

  const controls = document.createElement("div");
  controls.className = "type-controls";

  const input = document.createElement("input");
  input.type = "range";
  input.className = "type-slider";
  const { min, max, step } = LIMITS[key];
  input.min = min;
  input.max = max;
  input.step = step;

  const value = document.createElement("span");
  value.className = "type-value";

  const render = () => {
    const v = getSettings()[key];
    input.value = v;
    value.textContent = format(v);
  };

  input.oninput = () => {
    const v = clamp(key, Number(input.value));
    applyLive(key, v); // preview now
    value.textContent = format(v);
  };
  input.onchange = () => {
    const v = clamp(key, Number(input.value));
    updateSetting(key, v).then(render); // persist on release
  };

  render();
  renders.push(render);
  controls.append(input, value);
  row.append(name, controls);
  return row;
}

// ---- AI: connections → models → jobs (KR-50) -------------------------------

// The provider list is the registry in ai.js — one source of truth. Adding a
// provider there makes it appear here with no change to this file.
const SAGLAYICILAR = PROVIDERS;
const saglayiciMeta = providerMeta;
const yeniId = () => `id_${Math.random().toString(36).slice(2, 9)}`;

const yz = () => getSettings().yapayZeka ?? {};
const setYZ = (patch) => updateSetting("yapayZeka", { ...yz(), ...patch });

/** A connection's models, fetched once and shared. Keyed by connection id, so a
    key change (new id or cleared cache) re-fetches. */
const modelKesi = new Map();
// A per-render counter so every datalist gets a collision-proof id, even if two
// model instances ever share (or lack) an id.
let dlSeq = 0;
async function baglantininModelleri(baglanti) {
  if (modelKesi.has(baglanti.id)) return modelKesi.get(baglanti.id);
  const soz = connectionModels(baglanti);
  modelKesi.set(baglanti.id, soz);
  soz.catch(() => modelKesi.delete(baglanti.id));
  return soz;
}

/** The AI tab: three sub-tabs, one per layer of the routing (KR-50). */
function aiSection() {
  const wrap = document.createElement("div");
  wrap.className = "ai-settings";

  const bar = document.createElement("div");
  bar.className = "settings-subtabs";
  const body = document.createElement("div");

  const sekmeler = [
    [t("settings.sub.connections"), baglantilarTab],
    [t("settings.sub.models"), modellerTab],
    [t("settings.sub.jobs"), islerTab],
  ];

  let etkin = null;
  const goster = (ad, yap, dugme) => {
    etkin = ad;
    for (const b of bar.children) b.classList.toggle("on", b === dugme);
    body.replaceChildren(yap(() => goster(ad, yap, dugme)));
  };

  for (const [ad, yap] of sekmeler) {
    const d = document.createElement("button");
    d.textContent = ad;
    d.onclick = () => goster(ad, yap, d);
    bar.append(d);
  }

  // İşler opens first: once the connections and models are set up (a one-time
  // chore), assigning jobs is the tab you actually come back to.
  goster(sekmeler[2][0], sekmeler[2][1], bar.children[2]);
  wrap.append(bar, body);
  return wrap;
}

/** Layer 1: named credentials. Enter a key once; reuse across models. */
function baglantilarTab(render) {
  const wrap = document.createElement("div");

  // No explanatory prose here by choice: the network/cost truth (KR-47) still
  // rides on each model's label ("… · ağa gider · ÜCRETLİ") and on the palette
  // hint at the point of use, where it is read; a wall of text at the top was not.

  for (const b of yz().baglantilar) {
    const satir = document.createElement("div");
    satir.className = "ai-conn-row";

    const ad = document.createElement("input");
    ad.className = "ai-mini ai-conn-ad";
    ad.placeholder = t("settings.conn.namePlaceholder");
    ad.value = b.ad ?? "";
    ad.oninput = () => guncelleBaglanti(b.id, { ad: ad.value });

    const tur = document.createElement("select");
    tur.className = "ai-mini";
    for (const s of SAGLAYICILAR) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = providerLabel(s);
      o.selected = b.tur === s.id;
      tur.append(o);
    }
    tur.onchange = async () => {
      modelKesi.delete(b.id);
      await guncelleBaglanti(b.id, { tur: tur.value });
      render(); // key field appears or disappears with the type
    };

    satir.append(ad, tur);

    if (saglayiciMeta(b.tur)?.anahtarli) {
      const key = document.createElement("input");
      key.type = "password";
      key.className = "ai-mini ai-conn-key";
      key.placeholder = t("settings.conn.keyPlaceholder");
      key.value = b.anahtar ?? "";
      let bekle = null;
      key.oninput = () => {
        clearTimeout(bekle);
        bekle = setTimeout(() => {
          modelKesi.delete(b.id);
          guncelleBaglanti(b.id, { anahtar: key.value.trim() });
        }, 500);
      };
      satir.append(key);
    }

    const sil = document.createElement("button");
    sil.className = "ai-sil";
    sil.textContent = "✕";
    sil.title = t("settings.conn.delete");
    sil.onclick = async () => {
      // A connection is not alone: model rows point at its id, and jobs point at
      // those models. Deleting it and leaving them behind is what B-28 was —
      // deleting Ollama and re-adding it gave the new one a NEW id, the old model
      // row went on pointing at the dead one, and the job it fed simply stopped
      // being drawn in the palette (provider() returns null, and KR-42 draws no
      // dead buttons). A job disappearing with no reason written anywhere is the
      // one answer that is not allowed, so the deletion takes its dependants with
      // it and says so first.
      const dependants = yz().modeller.filter((m) => m.baglantiId === b.id);
      if (dependants.length) {
        const name = b.ad || providerLabel(saglayiciMeta(b.tur)) || t("settings.conn.fallbackName");
        const answer = await askChoice(
          t("settings.conn.deleteCascade", { ad: name, n: dependants.length }),
          [
            { label: t("dialog.cancel"), value: "cancel" },
            { label: t("settings.conn.deleteConfirm"), value: "delete", primary: true },
          ],
        );
        if (answer !== "delete") return;
      }
      const orphanIds = new Set(dependants.map((m) => m.id));
      const isler = Object.fromEntries(
        Object.entries(yz().isler).map(([job, modelId]) => [
          job,
          orphanIds.has(modelId) ? "" : modelId,
        ]),
      );
      await setYZ({
        baglantilar: yz().baglantilar.filter((x) => x.id !== b.id),
        modeller: yz().modeller.filter((m) => !orphanIds.has(m.id)),
        isler,
      });
      render();
    };
    satir.append(sil);
    wrap.append(satir);

    // Custom (OpenAI-compatible) connections type their own endpoint. Its own
    // full-width line beneath the row, so the row above never overflows the panel.
    if (saglayiciMeta(b.tur)?.baseUrlKullanicidan) {
      const adres = document.createElement("input");
      adres.className = "ai-mini ai-conn-adres";
      adres.placeholder = t("settings.conn.addressPlaceholder");
      adres.value = b.baseUrl ?? "";
      let bekleU = null;
      adres.oninput = () => {
        clearTimeout(bekleU);
        bekleU = setTimeout(() => {
          modelKesi.delete(b.id); // base URL changed → its model list is stale
          guncelleBaglanti(b.id, { baseUrl: adres.value.trim() });
        }, 500);
      };
      wrap.append(adres);
    }
  }

  const ekle = document.createElement("button");
  ekle.className = "ai-ekle";
  ekle.textContent = t("settings.conn.add");
  ekle.onclick = async () => {
    await setYZ({
      baglantilar: [...yz().baglantilar, { id: yeniId(), ad: "", tur: "gemini", anahtar: "" }],
    });
    render();
  };
  wrap.append(ekle);
  return wrap;
}

async function guncelleBaglanti(id, alan) {
  await setYZ({
    baglantilar: yz().baglantilar.map((b) => (b.id === id ? { ...b, ...alan } : b)),
  });
}

/** Layer 2: named model instances. One connection can feed several. */
function modellerTab(render) {
  const wrap = document.createElement("div");

  if (!yz().baglantilar.length) {
    const not = document.createElement("p");
    not.className = "ai-note";
    not.textContent = t("settings.model.needConnection");
    wrap.append(not);
    return wrap;
  }

  for (const m of yz().modeller) {
    wrap.append(modelRow(m, render));
  }

  const ekle = document.createElement("button");
  ekle.className = "ai-ekle";
  ekle.textContent = t("settings.model.add");
  ekle.onclick = async () => {
    const ilk = yz().baglantilar[0];
    await setYZ({
      modeller: [...yz().modeller, { id: yeniId(), ad: "", baglantiId: ilk.id, model: "" }],
    });
    render();
  };
  wrap.append(ekle);
  return wrap;
}

function modelRow(m, render) {
  const satir = document.createElement("div");
  satir.className = "ai-model-row";

  const ust = document.createElement("div");
  ust.className = "ai-model-ust";

  const ad = document.createElement("input");
  ad.className = "ai-mini ai-conn-ad";
  ad.placeholder = t("settings.model.namePlaceholder");
  ad.value = m.ad ?? "";
  ad.oninput = () => guncelleModel(m.id, { ad: ad.value });

  const baglanti = document.createElement("select");
  baglanti.className = "ai-mini";
  // An orphan row — its connection was deleted before the cascade above existed
  // (B-28). Without this the select silently shows its FIRST option as chosen and
  // the row reads as healthy while `m.baglantiId` points at nothing. The empty
  // option is selectable-out-of, never back into: picking a real connection
  // repairs the row.
  const orphan = !yz().baglantilar.some((b) => b.id === m.baglantiId);
  if (orphan) {
    const o = new Option(t("settings.model.orphan"), "");
    o.selected = true;
    o.disabled = true;
    baglanti.append(o);
    satir.classList.add("ai-orphan");
  }
  for (const b of yz().baglantilar) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.ad || providerLabel(saglayiciMeta(b.tur)) || t("settings.conn.fallbackName");
    o.selected = b.id === m.baglantiId;
    baglanti.append(o);
  }

  const sil = document.createElement("button");
  sil.className = "ai-sil";
  sil.textContent = "✕";
  sil.title = t("settings.model.delete");
  sil.onclick = async () => {
    await setYZ({ modeller: yz().modeller.filter((x) => x.id !== m.id) });
    render();
  };

  ust.append(ad, baglanti, sil);

  // The model itself — a search box against the connection's real list, since
  // OpenRouter alone offers hundreds. Type "opus", see what it has.
  const liste = document.createElement("datalist");
  liste.id = `dl-${m.id}-${++dlSeq}`;
  const model = document.createElement("input");
  model.className = "ai-mini ai-model-ara";
  model.setAttribute("list", liste.id);
  model.placeholder = t("settings.model.searchPlaceholder");
  model.value = m.model ?? "";
  model.oninput = () => guncelleModel(m.id, { model: model.value.trim() });

  const durum = document.createElement("span");
  durum.className = "ai-model-durum";

  const doldur = async () => {
    // Read the connection from the SELECT, never from the captured `m`. After
    // switching this row's connection, `m.baglantiId` is still the old value
    // (the settings store was updated, this closure's object was not), so
    // reading `m` fetched the previous provider's models — Gemini, the first
    // connection — until a tab switch rebuilt the row with a fresh `m`. That was
    // the whole "wrong list first, fixed on return" bug.
    const b = yz().baglantilar.find((x) => x.id === baglanti.value);
    if (!b) {
      liste.replaceChildren();
      durum.textContent = orphan ? t("settings.model.orphan") : "";
      return;
    }
    liste.replaceChildren(); // drop stale options up front, before the await
    durum.textContent = "…";
    try {
      const modeller = await baglantininModelleri(b);
      liste.replaceChildren();
      for (const opt of modeller) liste.append(new Option(opt, opt));
      // Chromium can also bind an <input list> before a slow first fetch's
      // options arrive; re-setting the attribute forces it to pick them up.
      model.removeAttribute("list");
      model.setAttribute("list", liste.id);
      durum.textContent = t("settings.model.count", { n: modeller.length });
    } catch (hata) {
      durum.textContent = hata.message;
    }
  };

  baglanti.onchange = async () => {
    await guncelleModel(m.id, { baglantiId: baglanti.value, model: "" });
    model.value = "";
    doldur();
  };

  doldur();
  satir.append(ust, model, durum, liste);
  return satir;
}

async function guncelleModel(id, alan) {
  await setYZ({ modeller: yz().modeller.map((m) => (m.id === id ? { ...m, ...alan } : m)) });
}

/**
 * Which way translation goes (KR-83): two selects, one row, under the job.
 *
 * The language NAMES come from `Intl.DisplayNames`, not from the catalogues:
 * the platform already knows what "ar" is called in Turkish and in English, and
 * twenty-six keys in two files would be twenty-six things to keep in step.
 */
function translationRow() {
  const row = document.createElement("div");
  row.className = "ai-job-row ai-job-sub";

  const pick = (which, field) => {
    const label = document.createElement("span");
    label.className = "ai-sub-label";
    label.textContent = t(which);

    const sec = document.createElement("select");
    sec.className = "ai-mini";
    for (const code of TRANSLATION_LANGS) {
      const option = new Option(languageName(code), code);
      option.selected = (yz().ceviri ?? {})[field] === code;
      sec.append(option);
    }
    sec.onchange = async () => {
      await setYZ({ ceviri: { ...yz().ceviri, [field]: sec.value } });
    };
    row.append(label, sec);
  };

  pick("settings.translateFrom", "from");
  pick("settings.translateTo", "to");
  return row;
}

/** Layer 3: bind each of the five jobs to a model instance. */
function islerTab() {
  const wrap = document.createElement("div");

  if (!yz().modeller.length) {
    const not = document.createElement("p");
    not.className = "ai-note";
    not.textContent = t("settings.jobs.needModel");
    wrap.append(not);
    return wrap;
  }

  const isOrphan = (m) => !yz().baglantilar.some((b) => b.id === m.baglantiId);
  // A model whose connection is gone cannot answer, so the row says so where the
  // routing is chosen rather than letting the job vanish from the palette (B-28).
  const adOf = (m) =>
    `${m.ad || m.model || t("settings.jobs.unnamed")}${isOrphan(m) ? ` (${t("settings.model.orphan")})` : ""}`;
  const detayOf = (m) => {
    const b = yz().baglantilar.find((x) => x.id === m.baglantiId);
    const kaynak = b ? b.ad || providerLabel(saglayiciMeta(b.tur)) : t("settings.model.orphan");
    return `${kaynak || "?"} · ${m.model || t("settings.jobs.noModelChosen")}`;
  };

  for (const job of [...textJobs(), ...reportJobs()]) {
    const satir = document.createElement("div");
    satir.className = "ai-job-row";

    const ad = document.createElement("span");
    ad.className = "ai-job-name";
    ad.textContent = jobName(job);

    const sec = document.createElement("select");
    sec.className = "ai-mini ai-mini-model";

    const kapali = new Option(t("settings.jobs.off"), "");
    kapali.selected = !yz().isler[job];
    sec.append(kapali);

    for (const m of yz().modeller) {
      const o = new Option(adOf(m), m.id);
      o.title = detayOf(m); // KR: hover names where this model was defined
      o.selected = yz().isler[job] === m.id;
      sec.append(o);
    }

    // The whole select gets the chosen model's detail as its tooltip too, so you
    // can check "which model was that?" without opening the list.
    const seciliDetay = () => {
      const m = yz().modeller.find((x) => x.id === yz().isler[job]);
      sec.title = m ? detayOf(m) : "";
    };
    seciliDetay();

    sec.onchange = async () => {
      await setYZ({ isler: { ...yz().isler, [job]: sec.value } });
      seciliDetay();
    };

    satir.append(ad, sec);
    wrap.append(satir);

    // Translation is the one job with a setting of its own: WHICH WAY (KR-83).
    // Not the model's to guess (Zafer) — it is told. The pair sits under the row
    // it belongs to, and only appears once the job has a model: a direction for
    // a job that cannot run is a question nobody asked.
    if (job === "translate" && yz().isler[job]) wrap.append(translationRow());
  }

  // The one global notice the 16 Tem sweep promised (KR-53), in the one place
  // everyone who turns this on has to stand: right under the rows that route a
  // job. It says nothing until a job is actually routed — until then the app is
  // v1 and there is nothing to warn about (KR-42).
  const uyari = aiWarningNote();
  if (uyari) wrap.append(uyari);

  return wrap;
}


/**
 * The interface language row. "Otomatik" (empty value) follows the OS locale;
 * "Türkçe"/"English" pin it. Changing it persists the choice and asks the shell
 * to re-label itself live (main.js listens for "dil-degisti") — no restart, so
 * an unsaved draft is never lost to a reload.
 */
function languageRow() {
  const row = document.createElement("div");
  row.className = "type-row";

  const label = document.createElement("span");
  label.className = "type-label";
  label.textContent = t("settings.language");

  const select = document.createElement("select");
  select.className = "ai-mini";
  const stored = getSettings().dil ?? "";

  const auto = new Option(t("settings.language.auto"), "");
  auto.selected = stored === "";
  select.append(auto);

  for (const [code, name] of Object.entries(LANGS)) {
    const option = new Option(name, code);
    option.selected = stored === code;
    select.append(option);
  }

  select.onchange = async () => {
    await updateSetting("dil", select.value || null);
    // The shell is built once; tell it to re-read every label in the new
    // language. Reopening Settings picks it up on its own (it rebuilds on open).
    window.dispatchEvent(new CustomEvent("dil-degisti"));
  };

  row.append(label, select);
  return row;
}

/** The reading tab: everything that changes how the document looks to you. */
function readingTab() {
  const wrap = document.createElement("div");
  const renders = []; // every slider registers its refresh here, for Reset

  // Language sits at the top: it is an app-display choice like the typeface, and
  // Reading is where those live (there is no separate General tab). "Otomatik"
  // follows the OS; a pick overrides it, and the whole UI re-labels live.
  wrap.append(languageRow());

  const faces = document.createElement("div");
  faces.className = "type-row";

  const facesLabel = document.createElement("span");
  facesLabel.className = "type-label";
  facesLabel.textContent = t("settings.reading.font");

  const choices = document.createElement("div");
  choices.className = "type-faces";

  const paint = () => {
    for (const button of choices.children) {
      button.classList.toggle("on", button.dataset.font === getSettings().yaziTipi);
    }
  };

  for (const [key, font] of Object.entries(FONTS)) {
    const button = document.createElement("button");
    button.dataset.font = key;
    button.textContent = t(`settings.font.${key}`);
    button.style.fontFamily = font.stack;
    button.onclick = () => updateSetting("yaziTipi", key).then(paint);
    choices.append(button);
  }
  paint();

  faces.append(facesLabel, choices);
  wrap.append(faces);

  wrap.append(slider(t("settings.reading.size"), "punto", (v) => `${v}`, renders));
  wrap.append(slider(t("settings.reading.leading"), "satirAraligi", (v) => v.toFixed(2), renders));
  wrap.append(slider(t("settings.reading.column"), "sutunGenisligi", (v) => `${Math.round(v)}`, renders));

  const reset = document.createElement("button");
  reset.className = "type-reset";
  reset.title = t("settings.reading.reset");
  reset.setAttribute("aria-label", t("settings.reading.reset"));
  // A reset/undo circular arrow — the word "varsayılana dön" was a caption for it.
  reset.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  reset.onclick = () =>
    resetSettings().then(() => {
      paint();
      for (const render of renders) render();
    });
  wrap.append(reset);

  return wrap;
}

/**
 * The shortcuts tab: the keys, grouped and named, in one readable place. Today
 * it is a reference (the bindings live in main.js and surface.js). The day they
 * become editable, this same list becomes their source — see YAPILACAKLAR.
 */
function kisayollarTab() {
  const wrap = document.createElement("div");
  wrap.className = "kisayollar";

  for (const grup of shortcutGroups()) {
    const baslik = document.createElement("h4");
    baslik.className = "kisayol-baslik";
    baslik.textContent = grup.baslik;
    wrap.append(baslik);

    for (const k of grup.kisayollar) {
      const satir = document.createElement("div");
      satir.className = "kisayol-satir";

      const ad = document.createElement("span");
      ad.className = "kisayol-ad";
      ad.textContent = k.ad;

      const tus = document.createElement("span");
      tus.className = "kisayol-tus";
      // Each token its own <kbd>, so "Ctrl+Shift+S" reads as three keys.
      for (const parca of k.tus.split("+")) {
        const kbd = document.createElement("kbd");
        kbd.textContent = parca.trim();
        tus.append(kbd);
      }

      satir.append(ad, tus);
      wrap.append(satir);
    }
  }

  return wrap;
}

/**
 * The panel used to be one narrow popover with everything stacked in it —
 * typography and a six-provider AI block crammed into the same column, cramped
 * exactly as a settings screen should never be. Now it is a panel with tabs:
 * each concern gets its own room, and a new tab is how it grows.
 */
// The close() of the panel while it is open, or null. Lets a second click on the
// settings icon toggle it shut instead of reopening a fresh one over the old.
let acikAyarKapat = null;

export function openSettings(anchor) {
  // Second click on the icon closes it (the mousedown handler below ignores the
  // icon, so the click reaches here to toggle).
  if (acikAyarKapat) {
    acikAyarKapat();
    return;
  }

  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const box = anchor.getBoundingClientRect();
  panel.style.top = `${box.bottom + 6}px`;
  panel.style.right = `${Math.max(10, window.innerWidth - box.right)}px`;

  const bar = document.createElement("div");
  bar.className = "settings-tabs";

  const body = document.createElement("div");
  body.className = "settings-body";

  const sekmeler = [
    [t("settings.tab.ai"), aiSection],
    [t("settings.tab.reading"), readingTab],
    [t("settings.tab.shortcuts"), kisayollarTab],
  ];

  let etkin = null;
  const goster = (ad, yap, dugme) => {
    if (etkin === ad) return;
    etkin = ad;
    for (const b of bar.children) b.classList.toggle("on", b === dugme);
    body.replaceChildren(yap());
  };

  for (const [ad, yap] of sekmeler) {
    const dugme = document.createElement("button");
    dugme.textContent = ad;
    dugme.onclick = () => goster(ad, yap, dugme);
    bar.append(dugme);
  }

  panel.append(bar, body);
  goster(sekmeler[0][0], sekmeler[0][1], bar.firstChild);

  const close = () => {
    panel.remove();
    window.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("keydown", onEsc, true);
    acikAyarKapat = null;
  };
  const onOutside = (event) => {
    // Ignore the icon itself: its own click does the toggle. Without this, the
    // mousedown closed the panel and the click reopened it — so it never shut.
    if (panel.contains(event.target) || anchor.contains(event.target)) return;
    close();
  };
  // Capture phase, so it beats the suggestion card's Escape handler and closes
  // the panel instead of cancelling a running job behind it.
  const onEsc = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  document.body.append(panel);
  acikAyarKapat = close;
  setTimeout(() => {
    window.addEventListener("mousedown", onOutside, true);
    window.addEventListener("keydown", onEsc, true);
  });
}
