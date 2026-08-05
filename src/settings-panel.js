// Settings: they belong to the app, not to a document.
//
// That is why they hang off their own icon rather than the ⋯ menu, which is
// about the document you are standing in. They are remembered across sessions
// (~/.mdplus/settings.json — minus the API keys, which go to the OS credential
// store, see secrets.js) and none of them writes a byte into a .md.
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
  DEFAULT_ROUTE,
  TRANSLATION_LANGS,
  connectionModels,
  connectionName,
  jobName,
  languageName,
  providerLabel,
  providerMeta,
  providerRows,
  reportJobs,
  routeOf,
  splitRoute,
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
// Not the full registry any more: a CLI agent that is not installed on this
// machine never becomes an option (ai.js/providerRows). The connection's own
// type is always kept, so a saved row never loses the entry it points at.
const SAGLAYICILAR = providerRows;
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
  const meta = providerMeta(baglanti.tur);
  if (!baglanti.tur) throw new Error(t("settings.conn.pickType"));
  // Some providers list their models to anyone who asks (NVIDIA does), so an
  // empty key still came back with a full list — which reads as a stale cache
  // from an earlier key. It was neither: it was a question we should not have
  // asked yet.
  if (meta?.anahtarli && !(baglanti.anahtar ?? "").trim()) {
    throw new Error(t("settings.conn.keyNeeded"));
  }
  if (modelKesi.has(baglanti.id)) return modelKesi.get(baglanti.id);
  const soz = connectionModels(baglanti);
  modelKesi.set(baglanti.id, soz);
  soz.catch(() => modelKesi.delete(baglanti.id));
  return soz;
}

/**
 * The AI tab: two sub-tabs since KR-95 — providers, and jobs.
 *
 * It was three, one per layer of KR-50's routing: connections, model instances,
 * jobs. The middle one was the whole complaint (Zafer, 6 Aug: *"çok fazla
 * karmaşık geliyor bana… amacım sadelik"*). A "model instance" was an object
 * with a name you had to invent, pointing at a connection you had to pick, so
 * that a job could point at it — three named things to get one sentence
 * rewritten. Models now live inside the connection that reaches them, and a
 * whole class of bug went with the layer: B-28's orphan row, which existed only
 * because a model could outlive its connection.
 */
function aiSection() {
  const wrap = document.createElement("div");
  wrap.className = "ai-settings";

  const bar = document.createElement("div");
  bar.className = "settings-subtabs";
  const body = document.createElement("div");

  const sekmeler = [
    [t("settings.sub.providers"), saglayicilarTab],
    [t("settings.sub.jobs"), islerTab],
  ];

  const goster = (yap, dugme) => {
    for (const b of bar.children) b.classList.toggle("on", b === dugme);
    body.replaceChildren(yap(() => goster(yap, dugme)));
  };

  for (const [ad, yap] of sekmeler) {
    const d = document.createElement("button");
    d.textContent = ad;
    d.onclick = () => goster(yap, d);
    bar.append(d);
  }

  // Jobs opens first: setting a provider up is a one-time chore, choosing what
  // the machine may do is the thing you come back to. Unless there is nothing
  // to route yet — then Jobs has only one sentence to say, and it is "go to the
  // other tab". Land where the work is.
  const first = allRoutes().length ? 1 : 0;
  goster(sekmeler[first][1], bar.children[first]);
  wrap.append(bar, body);
  return wrap;
}

/** Which cards are open. Kept outside the render so re-drawing a card — which
    happens on every keystroke in a key field — does not fold it shut. */
const acikKartlar = new Set();

/**
 * Providers: one card per connection, its models inside it.
 *
 * There is no name field. The name is computed (`Gemini#1`) because a typed one
 * asks a question of somebody who came here to paste a key, and it answers
 * nothing: since KR-94 even the credential is filed under the id, so a name
 * carries no meaning the provider type does not already carry.
 */
function saglayicilarTab(render) {
  const wrap = document.createElement("div");

  for (const b of yz().baglantilar) {
    wrap.append(saglayiciKarti(b, render));
  }

  const ekle = document.createElement("button");
  ekle.className = "ai-ekle";
  ekle.textContent = t("settings.conn.add");
  ekle.onclick = async () => {
    const id = yeniId();
    // No type preselected (Zafer): landing on Gemini makes a choice on the
    // reader's behalf and, worse, looks like one they already made.
    await setYZ({
      baglantilar: [...yz().baglantilar, { id, tur: "", anahtar: "", modeller: [] }],
    });
    // Open the one just added: it is empty, and the next thing to happen is
    // typing in it.
    acikKartlar.add(id);
    render();
  };
  wrap.append(ekle);
  return wrap;
}

function saglayiciKarti(b, render) {
  const kart = document.createElement("div");
  kart.className = "ai-card";
  const meta = saglayiciMeta(b.tur);
  const acik = acikKartlar.has(b.id);

  const bas = document.createElement("div");
  bas.className = "ai-card-head";

  // The whole header is the toggle — a caret you have to hit exactly is a
  // 12-pixel target for a job the entire row is standing there to do.
  const kapak = document.createElement("button");
  kapak.className = "ai-card-toggle";
  kapak.setAttribute("aria-expanded", String(acik));
  kapak.innerHTML =
    `<span class="ai-card-caret">${acik ? "▾" : "▸"}</span>` +
    `<span class="ai-card-name"></span>` +
    `<span class="ai-card-sub"></span>`;
  kapak.querySelector(".ai-card-name").textContent = b.tur
    ? connectionName(b, yz().baglantilar)
    : t("settings.conn.pickType");
  // What the card is worth at a glance while it is shut: how many models are in
  // it. Not a green dot — we cannot know whether a remote provider will answer
  // without spending a request on it, and a light that means "probably" is
  // worse than no light (the same reason an unasked CLI question is never read
  // as "no").
  kapak.querySelector(".ai-card-sub").textContent = b.modeller?.length
    ? t("settings.conn.modelCount", { n: b.modeller.length })
    : t("settings.conn.noModel");
  kapak.onclick = () => {
    if (acik) acikKartlar.delete(b.id);
    else acikKartlar.add(b.id);
    render();
  };

  const sil = document.createElement("button");
  sil.className = "ai-sil";
  sil.textContent = "✕";
  sil.title = t("settings.conn.delete");
  sil.onclick = async () => {
    // KR-77's first half survives the new shape: a connection is still not
    // alone — jobs route through its models — so the deletion says what it will
    // take before it takes it. The second half (marking orphan rows) is gone
    // with the layer that made orphans possible.
    const used = jobsUsing(b.id);
    if (b.modeller?.length || used.length) {
      const answer = await askChoice(
        t("settings.conn.deleteCascade", {
          ad: connectionName(b, yz().baglantilar),
          n: b.modeller?.length ?? 0,
        }),
        [
          { label: t("dialog.cancel"), value: "cancel" },
          { label: t("settings.conn.deleteConfirm"), value: "delete", primary: true },
        ],
      );
      if (answer !== "delete") return;
    }
    const isler = Object.fromEntries(
      Object.entries(yz().isler).map(([job, value]) => [job, usesConnection(value, b.id) ? "" : value]),
    );
    await setYZ({
      baglantilar: yz().baglantilar.filter((x) => x.id !== b.id),
      isler,
      varsayilan: usesConnection(yz().varsayilan, b.id) ? "" : yz().varsayilan,
    });
    modelKesi.delete(b.id);
    render();
  };

  bas.append(kapak, sil);
  kart.append(bas);
  if (!acik) return kart;

  const govde = document.createElement("div");
  govde.className = "ai-card-body";

  const tur = document.createElement("select");
  tur.className = "ai-mini";
  if (!b.tur) {
    const bos = new Option(t("settings.conn.pickType"), "");
    bos.selected = true;
    bos.disabled = true;
    tur.append(bos);
  }
  for (const s of SAGLAYICILAR(b.tur)) {
    const o = new Option(providerLabel(s), s.id);
    o.selected = b.tur === s.id;
    tur.append(o);
  }
  tur.onchange = async () => {
    modelKesi.delete(b.id);
    // The models belonged to the old provider; keeping them would leave names
    // that the new one has never heard of.
    await guncelleBaglanti(b.id, { tur: tur.value, modeller: [] });
    render();
  };
  govde.append(satirla(t("settings.conn.type"), tur));

  if (meta?.anahtarli) {
    const key = document.createElement("input");
    key.type = "password";
    key.className = "ai-mini";
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
    govde.append(satirla(t("settings.conn.key"), key));
  }

  if (meta?.baseUrlKullanicidan) {
    const adres = document.createElement("input");
    adres.className = "ai-mini";
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
    govde.append(satirla(t("settings.conn.address"), adres));
  }

  // The live value of every model box, because the settings object is not it.
  // A model is written on a 400 ms debounce, so between typing and that timer
  // the truth is on screen and nowhere else — and the captured `b` is older
  // still. Building the new list from the captured object is what cleared the
  // boxes: "+ model" appended to a stale array and wrote the old one back over
  // what had been typed. The registered trap, again: read the live state from
  // the DOM, never from an object a closure caught earlier.
  const kutular = [];
  const canliModeller = () => kutular.map((k) => k.value.trim());

  for (const [i, model] of (b.modeller ?? []).entries()) {
    const { row, input } = modelSatiri(b, i, model, render, canliModeller);
    kutular.push(input);
    govde.append(row);
  }

  const alt = document.createElement("div");
  alt.className = "ai-card-foot";

  const ekle = document.createElement("button");
  ekle.className = "ai-ekle ai-ekle-model";
  ekle.textContent = t("settings.model.add");
  ekle.onclick = async () => {
    await guncelleBaglanti(b.id, { modeller: [...canliModeller(), ""] });
    render();
  };

  // How many models this provider offers, said once per card rather than once
  // per row: it is the connection's fact, not any single model's, and four
  // copies of "39 model" is three too many.
  const sayac = document.createElement("span");
  sayac.className = "ai-model-durum";
  baglantininModelleri(b)
    .then((liste) => {
      sayac.textContent = t("settings.model.count", { n: liste.length });
    })
    .catch((hata) => {
      sayac.textContent = hata.message;
    });

  alt.append(ekle, sayac);
  govde.append(alt);

  kart.append(govde);
  return kart;
}

async function guncelleBaglanti(id, alan) {
  await setYZ({
    baglantilar: yz().baglantilar.map((b) => (b.id === id ? { ...b, ...alan } : b)),
  });
}

/** A label and its control, on one line. */
function satirla(etiket, denetim) {
  const row = document.createElement("div");
  row.className = "ai-field";
  const label = document.createElement("span");
  label.className = "ai-field-label";
  label.textContent = etiket;
  row.append(label, denetim);
  return row;
}

/**
 * One model inside its connection: a search box against the provider's real
 * list, because OpenRouter alone offers hundreds and a dropdown of hundreds is
 * not a choice, it is a scroll.
 *
 * Returns the input as well as the row: the card needs to read what is in every
 * box right now, and "right now" is the box, not the settings file.
 */
function modelSatiri(b, index, model, render, canliModeller) {
  const row = document.createElement("div");
  row.className = "ai-model-row";

  const liste = document.createElement("datalist");
  liste.id = `dl-${b.id}-${index}-${++dlSeq}`;

  const kutu = document.createElement("input");
  kutu.className = "ai-mini ai-model-ara";
  kutu.setAttribute("list", liste.id);
  kutu.placeholder = t("settings.model.searchPlaceholder");
  kutu.value = model ?? "";
  let bekle = null;
  kutu.oninput = () => {
    clearTimeout(bekle);
    bekle = setTimeout(() => setModel(b.id, index, kutu.value.trim()), 400);
  };
  // Leaving the box commits it now rather than 400 ms from now — otherwise
  // clicking straight from here onto something that reads the settings races
  // the timer.
  kutu.onchange = () => {
    clearTimeout(bekle);
    setModel(b.id, index, kutu.value.trim());
  };

  const sil = document.createElement("button");
  sil.className = "ai-sil";
  sil.textContent = "✕";
  sil.title = t("settings.model.delete");
  sil.onclick = async () => {
    // Built from what is on screen, minus this row — same reason as "+ model".
    const kalan = canliModeller().filter((_, i) => i !== index);
    await guncelleBaglanti(b.id, { modeller: kalan });
    await forgetRoute(routeOf(b.id, model));
    render();
  };

  baglantininModelleri(b)
    .then((modeller) => {
      liste.replaceChildren();
      for (const opt of modeller) liste.append(new Option(opt, opt));
      // Chromium can bind an <input list> before a slow first fetch's options
      // arrive; re-setting the attribute forces it to pick them up.
      kutu.removeAttribute("list");
      kutu.setAttribute("list", liste.id);
    })
    .catch(() => {
      // The card's footer already says what went wrong; a row does not repeat it.
    });

  row.append(kutu, sil, liste);
  return { row, input: kutu };
}

/** Writes a model name into its slot, and carries every route that pointed at
    the old name over to the new one — otherwise renaming a model silently
    switched off every job using it. */
async function setModel(baglantiId, index, model) {
  const b = yz().baglantilar.find((x) => x.id === baglantiId);
  if (!b) return;
  const eski = b.modeller?.[index] ?? "";
  if (eski === model) return;

  const modeller = [...(b.modeller ?? [])];
  modeller[index] = model;

  const eskiRota = eski ? routeOf(baglantiId, eski) : null;
  const yeniRota = model ? routeOf(baglantiId, model) : "";
  const tasi = (value) => (eskiRota && value === eskiRota ? yeniRota : value);

  await setYZ({
    baglantilar: yz().baglantilar.map((x) => (x.id === baglantiId ? { ...x, modeller } : x)),
    isler: Object.fromEntries(Object.entries(yz().isler).map(([job, v]) => [job, tasi(v)])),
    varsayilan: tasi(yz().varsayilan),
    // First model anywhere becomes the default. Not a guess about which model
    // is best — a refusal to ask a question whose only sensible answer, when
    // there is exactly one model, is the one model.
    ...(model && !yz().varsayilan ? { varsayilan: yeniRota } : {}),
  });
}

/** Clears any route pointing at a model that has just been removed. */
async function forgetRoute(rota) {
  if (!rota) return;
  await setYZ({
    isler: Object.fromEntries(
      Object.entries(yz().isler).map(([job, v]) => [job, v === rota ? "" : v]),
    ),
    varsayilan: yz().varsayilan === rota ? "" : yz().varsayilan,
  });
}

const jobsUsing = (baglantiId) =>
  Object.entries(yz().isler)
    .filter(([, v]) => usesConnection(v, baglantiId))
    .map(([job]) => job);

const usesConnection = (value, baglantiId) => splitRoute(value)?.baglantiId === baglantiId;

/** Every model in every connection, as routes ready for a dropdown. */
function allRoutes() {
  const out = [];
  for (const b of yz().baglantilar) {
    for (const model of b.modeller ?? []) {
      if (model) out.push({ value: routeOf(b.id, model), label: `${connectionName(b, yz().baglantilar)} · ${model}` });
    }
  }
  return out;
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

/**
 * Jobs: a default model at the top, then one row per job.
 *
 * Every job starts off, and off still means absent (KR-42) — a default model
 * routes, it does not switch anything on. What the default removes is the
 * question "which model?" nine separate times: turning a job on is one click,
 * and the answer to the model question is already there.
 */
function islerTab(render) {
  const wrap = document.createElement("div");

  const routes = allRoutes();

  // The list is drawn even with nothing to route it to (Zafer, 6 Aug): *"having
  // no models does not mean having no jobs. The jobs should show — it is what
  // makes you want to define a model. Otherwise: define a model for WHAT?"*
  // Hiding them showed the price of the setup and none of what it buys. So the
  // rows stay and go quiet instead, which is KR-64's rule in another place:
  // disabled, not absent.
  if (!routes.length) {
    const not = document.createElement("p");
    not.className = "ai-note";
    not.textContent = t("settings.jobs.needModel");
    wrap.append(not);
  }

  const varsayilanKutu = document.createElement("div");
  varsayilanKutu.className = "ai-default-box";
  const varsayilanRow = document.createElement("div");
  varsayilanRow.className = "ai-job-row";
  const vad = document.createElement("span");
  vad.className = "ai-job-name";
  vad.textContent = t("settings.jobs.default");
  const vac = document.createElement("select");
  vac.className = "ai-mini ai-mini-model";
  vac.disabled = !routes.length;
  for (const r of routes) {
    const o = new Option(r.label, r.value);
    o.selected = yz().varsayilan === r.value;
    vac.append(o);
  }
  if (!routes.length) vac.append(new Option(t("settings.jobs.noModelYet"), ""));
  vac.onchange = async () => {
    await setYZ({ varsayilan: vac.value });
    render();
  };
  varsayilanRow.append(vad, vac);
  varsayilanKutu.append(varsayilanRow);
  wrap.append(varsayilanKutu);

  // The jobs live in one box, parted by hairlines — the reference's shape, and
  // the right one: they are nine of a kind, and the default above them is not
  // one of them. Two boxes say that; a rule between rows would not.
  const kutu = document.createElement("div");
  kutu.className = "ai-jobs-box";
  wrap.append(kutu);

  for (const job of [...textJobs(), ...reportJobs()]) {
    const satir = document.createElement("div");
    satir.className = "ai-job-row";

    const ad = document.createElement("span");
    ad.className = "ai-job-name";
    ad.textContent = jobName(job);

    const sec = document.createElement("select");
    sec.className = "ai-mini ai-mini-model";
    sec.disabled = !routes.length;

    const kapali = new Option(t("settings.jobs.off"), "");
    kapali.selected = !yz().isler[job];
    sec.append(kapali);

    if (routes.length) {
      const varsayilan = new Option(t("settings.jobs.useDefault"), DEFAULT_ROUTE);
      varsayilan.selected = yz().isler[job] === DEFAULT_ROUTE;
      sec.append(varsayilan);
    }

    for (const r of routes) {
      const o = new Option(r.label, r.value);
      o.selected = yz().isler[job] === r.value;
      sec.append(o);
    }

    sec.onchange = async () => {
      await setYZ({ isler: { ...yz().isler, [job]: sec.value } });
      render();
    };

    satir.append(ad, sec);
    kutu.append(satir);

    // Translation is the one job with a setting of its own: WHICH WAY (KR-83).
    // Not the model's to guess (Zafer) — it is told. The pair sits under the row
    // it belongs to, and only appears once the job is on: a direction for a job
    // that cannot run is a question nobody asked.
    if (job === "translate" && yz().isler[job]) kutu.append(translationRow());
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
    // A dialog the panel itself opened is not "outside" it. Confirming a
    // deletion closed the whole panel: the click landed on the overlay, which
    // is a child of <body>, and the rule below read that as "he clicked away".
    if (event.target.closest?.(".overlay")) return;
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
