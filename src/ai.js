// The one door to a model (KR-46).
//
// Two providers, one signature. Nothing that calls `suggest()` knows or cares
// which one is behind it — so the day a better machine arrives, switching from
// Gemini to a local model is a setting, not a rewrite.
//
// Default: none. With no provider chosen, MD Plus is exactly v1 — no dead
// button, no invitation, no nudge (KR-42). This file is not even reached.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { contextRisk, hardGate, flags, wordCount } from "./ai-check.js";
import { providers as CLI_PROVIDERS, adapters as CLI_ADAPTERS, probeAgent } from "./ai-cli.js";
import { effectiveLang, getSettings } from "./settings.js";
import { detectTextLang } from "./lang-detect.js";
import { t } from "./i18n.js";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const OLLAMA = "http://127.0.0.1:11434/api/generate";
const CLAUDE = "https://api.anthropic.com/v1";

/**
 * Anthropic refuses requests that look like they come from a web page — a
 * sensible defence, since an API key in a browser is an API key in public. Tauri
 * sends an Origin header, so we look exactly like that, and get a 403 that reads
 * like an invalid key.
 *
 * This header is the way to say: the key is not in a web page, it is in a desktop
 * app on the writer's own machine, in their own settings file.
 */
/**
 * The same trap, a second provider. Ollama only answers origins it recognises,
 * and on Windows the Tauri webview calls itself `http://tauri.localhost` — which
 * is not on its list, so every request came back 403 while the same call from
 * curl got 200. Its list does contain `tauri://localhost`, which is what this
 * app actually is. Measured on Ollama 0.32.0.
 */
const OLLAMA_ORIGIN = { origin: "tauri://localhost" };

const CLAUDE_HEADERS = (anahtar) => ({
  "content-type": "application/json",
  "x-api-key": anahtar,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

/**
 * The jobs, in two classes — and the class is the whole point.
 *
 *   "metin"  — the model writes prose you may take into your document. If it is
 *              wrong, the output is *bad*, not *false*: you see it and refuse.
 *              Cost of a mistake: one keystroke.
 *
 *   "rapor"  — the model makes CLAIMS ABOUT THE WORLD. It cannot be taken into
 *              the document at all, because a model does not know the literature;
 *              it estimates how plausible a claim looks in its training data. A
 *              fabricated source, in perfect citation format, is the most
 *              expensive kind of error a writer can ship. So these are shown as
 *              what they are: unverified assertions, with no way to accept them.
 *
 * The line between the two classes is not decoration. It is what stops the second
 * kind from borrowing the credibility of the first.
 *
 * Note what none of the prompts say any more: "akademik". Every text was being
 * treated as a journal article, so a warm, personal paragraph came back wearing
 * a tie. The style of the text is the text's business.
 */
/**
 * The English prompts — the exact rules as their Turkish siblings in JOBS, so a
 * suggestion is judged by the same bar in either language (the hard gate and the
 * flags are language-agnostic; only the instructions differ).
 */
const EN_PROMPTS = {
  rewrite: (text) =>
    `Make the following text more fluent and readable.\n\n` +
    `RULES:\n` +
    `1. Do NOT change the content, claims, numbers, dates or proper names.\n` +
    `2. Do NOT add new information, new numbers or new sources.\n` +
    `3. PRESERVE THE TEXT'S OWN VOICE. If it is casual, keep it casual; if formal, keep it formal. Do not impose your own style.\n` +
    `4. Do NOT add metaphors. Leave the text's own figures of speech in place; do not pile a new one on in the name of "fluency". Turning a plain sentence into an image is not fluency.\n` +
    `5. Keep the Markdown formatting (**bold**, *italic*, [link](x.md)) and LaTeX formulas ($...$) EXACTLY.\n` +
    `6. Do not use HTML.\n` +
    `7. Do not lengthen the text; keep it the same length.\n` +
    `8. Give ONLY the rewritten text. No explanation, heading or preface.\n\n` +
    `TEXT:\n${text}`,

  continue: (text) =>
    `Write a NEW paragraph that continues the following text.\n\n` +
    `YOU ARE THE AUTHOR OF THE TEXT. Continue from within it, in the author's own voice.\n` +
    `Do NOT invent a third person ("the user", "the writer", "you"); do not describe\n` +
    `anyone, do not answer anyone. Your output will be added directly to the document.\n\n` +
    `LENGTH: A full paragraph — 4 to 7 sentences. Not a one-line note but a real\n` +
    `paragraph that advances the thought. (Here brevity is not a virtue; it is\n` +
    `leaving the job unfinished.)\n\n` +
    `RULES:\n` +
    `1. Do NOT restate the existing text in other words. Say something new: a reason, an example, a counterpoint, a distinction, a conclusion.\n` +
    `2. No empty sentences. Every sentence must carry something new — content, not decoration.\n` +
    `3. Do not fake a conclusion with connectives like "therefore", "in conclusion"; do not use them unless you are actually concluding something.\n` +
    `4. METAPHOR SPARINGLY: at most one comparison per paragraph, and only if it genuinely advances the thought. Piling on comparisons is noise, not depth; do not explain one image with a second.\n` +
    `5. PRESERVE THE TEXT'S OWN VOICE AND TONE.\n` +
    `6. Do NOT invent sources, dates, names or numbers.\n` +
    `7. Do not use HTML.\n` +
    `8. Give ONLY the new paragraph. No explanation, no preface.\n\n` +
    `TEXT:\n${text}`,

  proofread: (text) =>
    `Fix ONLY spelling and punctuation errors in the following text.\n\n` +
    `MOST IMPORTANT RULE — DO NOT CHANGE WORDS:\n` +
    `Do NOT replace any word with another. Do not write a synonym. Do not suggest a nicer one.\n` +
    `Do NOT add, remove or reorder words. No splitting or merging sentences.\n` +
    `The words in the output must be the SAME words as the input — only the misspelt ones are\n` +
    `corrected to their right spelling. Example: "recieve" → "receive" (a typo, corrected).\n` +
    `But "wrong" → "incorrect" is FORBIDDEN (that is a word change).\n\n` +
    `THE ONLY THINGS ALLOWED:\n` +
    `- The correct spelling of a misspelt word ("seperate" → "separate", "alot" → "a lot")\n` +
    `- Missing/extra punctuation (commas, periods, apostrophes: "dont" → "don't")\n` +
    `- Capitalization errors ("england" → "England")\n` +
    `- Wrong joined/split spelling ("everyday" → "every day" where meant as two words)\n\n` +
    `STRICTLY FORBIDDEN:\n` +
    `- Changing the style, tone or sentence structure. "Improving" or "smoothing" the text.\n` +
    `- Mistaking long but CORRECT words for errors and changing them.\n` +
    `- Touching proper names, terms or formulas (Nash equilibrium, von Neumann, $x^2$).\n` +
    `- Writing HTML. Breaking Markdown formatting.\n\n` +
    `IF THERE ARE NO ERRORS: return the text letter for letter, unchanged. You do not have to change anything.\n` +
    `OUTPUT: text only. Do not explain what you fixed, do not make a list.\n\n` +
    `TEXT:\n${text}`,

  verify: (text) =>
    `Examine the FACTUAL CLAIMS in the following text.\n\n` +
    `RULES:\n` +
    `1. List each claim one by one. For each: "doubtful", "looked correct" or "not sure".\n` +
    `2. WHERE YOU ARE NOT SURE, SAY "not sure". Do not guess, do not fill in.\n` +
    `3. If a date, number or name looks wrong, say so; but if you are not sure of the correct one, say that too.\n` +
    `4. Do not rewrite the text or suggest corrections. Only review.\n` +
    `5. Write short, as a bulleted list.\n\n` +
    `TEXT:\n${text}`,

  cite: (text) =>
    `Suggest sources from the literature relevant to the topic of the following text.\n\n` +
    `RULES:\n` +
    `1. Only suggest works you are SURE actually exist. If you are not sure, do NOT suggest it.\n` +
    `2. Do NOT invent DOIs, page numbers or volume numbers. If you don't know, don't write it.\n` +
    `3. For each source, say in one sentence why it is relevant.\n` +
    `4. If you are not sure of any source, say "I can't suggest a source I'm sure of".\n` +
    `5. At most 5 sources. Write short.\n\n` +
    `TEXT:\n${text}`,

  summarize: (text) =>
    `Summarize the following text.\n\n` +
    `RULES:\n` +
    `1. Summarize ONLY what the text says. Do not add information, numbers, names or dates not in the text.\n` +
    `2. Draw out the text's own argument, its steps, and its conclusion if it reaches one.\n` +
    `3. Write as bullets: at most 7 bullets, each a single sentence.\n` +
    `4. Use THE TEXT'S OWN TERMS; do not impose your own vocabulary.\n` +
    `5. Do not add commentary, do not evaluate, do not advise. A summary is not a judgement.\n` +
    `6. If the text reaches no conclusion, do not pretend it does; say where it leaves off.\n` +
    `7. Do not use HTML.\n` +
    `8. Give ONLY the summary. No explanation, heading or closing sentence.\n\n` +
    `TEXT:\n${text}`,

  title: (text) =>
    `Propose THREE titles for the following text.\n\n` +
    `RULES:\n` +
    `1. EXACTLY three lines. One title per line.\n` +
    `2. No numbering, no bullets, no quotation marks, no explanation.\n` +
    `3. Each title names what the text is ABOUT — not what it promises the reader.\n` +
    `4. Use the text's own terms. Do not invent a subject it does not cover.\n` +
    `5. Make the three genuinely different: not one title in three phrasings.\n` +
    `6. Short: at most 8 words each. No colon-subtitle constructions.\n` +
    `7. No Markdown marks (no #, no **), no HTML.\n\n` +
    `TEXT:\n${text}`,

  spot: (text) =>
    `Write a STANDFIRST for the following text.\n\n` +
    `WHAT A STANDFIRST IS: the two sentences under the title that pull the reader\n` +
    `in. Its job is NOT to summarize but to get the piece read. It leads with the\n` +
    `text's sharpest claim or its point of greatest tension, so that having read\n` +
    `those two sentences the reader wants the rest.\n\n` +
    `RULES:\n` +
    `1. TWO SENTENCES. No more, no less.\n` +
    `2. THE FIRST puts a claim or a tension on the table — where the text cuts\n` +
    `   against the grain, unsettles, or costs something. Not a topic announcement.\n` +
    `3. THE SECOND says what that costs, or where the text is looking. Do not give\n` +
    `   away its conclusion; leave something to be read.\n` +
    `4. Intrigue, do not OVERSELL. Only what is in the text: no new fact, number,\n` +
    `   name or date, and no claim the text does not make.\n` +
    `5. FORBIDDEN: questions, exclamation marks, "in this article", "explores",\n` +
    `   "in today's world", "a must-read", "surprising" and the like.\n` +
    `6. Keep the text's own register: an academic piece gets a sober standfirst —\n` +
    `   curiosity comes from choosing the right sentence, not from raising the voice.\n` +
    `7. No Markdown marks, no HTML.\n` +
    `8. Give ONLY the two sentences. No heading, no explanation.\n\n` +
    `TEXT:\n${text}`,
};

/**
 * The languages translation offers (KR-83).
 *
 * Not every language there is — a list of two hundred is a list nobody reads.
 * Turkish, English and Arabic are the ones this app was asked for; the rest are
 * simply the widely written ones. Adding one is a line here and nothing else.
 *
 * The NAMES are not in the catalogues on purpose: `Intl.DisplayNames` already
 * knows what "ar" is called in Turkish and in English, in the reader's own
 * language, and always will — twenty-six catalogue keys would be twenty-six
 * things to keep in step for no gain.
 */
export const TRANSLATION_LANGS = [
  "tr",
  "en",
  "ar",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "ru",
  "zh",
  "ja",
  "ko",
  "fa",
];

/** A language's name in a given interface language, or its code if unknown. */
export function languageName(code, inLang = effectiveLang()) {
  try {
    return new Intl.DisplayNames([inLang], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The pair the writer set, with the defaults a Turkish reader would pick. */
export const translationPair = () => {
  const { from = "en", to = "tr" } = getSettings().yapayZeka?.ceviri ?? {};
  return { from, to };
};

/**
 * What a job needs told beyond the text — its settings, in other words. Only
 * translation has any (which way), and a shortcut has nowhere to ask, so it
 * takes the pair from Settings. The right-click menu passes its own instead.
 */
export const jobOptions = (job) => (job === "translate" ? translationPair() : undefined);

const JOBS = {
  rewrite: {
    ad: "Akıcı alternatif",
    tur: "metin",
    kisayol: "Alt-a",
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.rewrite(text) :
      `Aşağıdaki Türkçe metni daha akıcı ve okunaklı hâle getir.\n\n` +
      `KURALLAR:\n` +
      `1. İçeriği, iddiaları, sayıları, tarihleri, özel adları DEĞİŞTİRME.\n` +
      `2. Yeni bilgi, yeni sayı, yeni kaynak EKLEME.\n` +
      `3. METNİN KENDİ ÜSLUBUNU KORU. Samimi yazılmışsa samimi, resmi yazılmışsa resmi kalsın. Kendi üslubunu dayatma.\n` +
      `4. METAFOR EKLEME. Metnin kendi benzetmeleri yerinde kalsın; "akıcılık" adına üstüne yenisini bindirme. Düz bir cümleyi imgeye çevirmek akıcılık değildir.\n` +
      `5. Markdown biçimini (**kalın**, *italik*, [link](x.md)) ve LaTeX formülleri ($...$) AYNEN koru.\n` +
      `6. HTML kullanma.\n` +
      `7. Metni uzatma; aynı uzunlukta kalsın.\n` +
      `8. Yalnız yeniden yazılmış metni ver. Açıklama, başlık, giriş cümlesi yazma.\n\n` +
      `METİN:\n${text}`,
  },

  continue: {
    ad: "Tamamlayıcı paragraf",
    tur: "metin",
    kisayol: "Alt-t",
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.continue(text) :
      `Aşağıdaki Türkçe metni tamamlayan YENİ bir paragraf yaz.\n\n` +
      `SEN METNİN YAZARISIN. Metnin içinden, yazarın kendi ağzından devam et.\n` +
      `"Kullanıcı", "yazar", "siz" diye üçüncü şahıs KURMA; kimseyi anlatma,\n` +
      `kimseye cevap verme. Çıktın doğrudan belgeye eklenecek.\n\n` +
      `UZUNLUK: Tam bir paragraf — 4 ila 7 cümle. Tek cümlelik bir not değil,\n` +
      `düşünceyi ilerleten gerçek bir paragraf. (Burada özlü olmak erdem değil,\n` +
      `eksik bırakmaktır.)\n\n` +
      `KURALLAR:\n` +
      `1. Var olan metni başka kelimelerle TEKRAR ETME. Yeni bir şey söyle: bir gerekçe, bir örnek, bir karşı görüş, bir ayrım, bir sonuç.\n` +
      `2. Boş cümle kurma. Her cümle yeni bir şey taşısın — süsleme değil, içerik.\n` +
      `3. "Dolayısıyla", "sonuç olarak" gibi bağlaçlarla sonuç taklidi yapma; gerçekten bir şey sonuçlandırmıyorsan kullanma.\n` +
      `4. METAFOR ÖLÇÜLÜ: paragraf başına en çok bir benzetme, o da düşünceyi gerçekten ilerletiyorsa. Benzetme yığmak derinlik değil, gürültüdür; bir imgeyi ikinci bir imgeyle açıklama.\n` +
      `5. METNİN KENDİ ÜSLUBUNU VE TONUNU KORU.\n` +
      `6. Uydurma kaynak, tarih, isim, sayı VERME.\n` +
      `7. HTML kullanma.\n` +
      `8. Yalnız yeni paragrafı ver. Açıklama yazma, giriş cümlesi kurma.\n\n` +
      `METİN:\n${text}`,
  },

  proofread: {
    ad: "Yazım ve noktalama",
    tur: "metin",
    kisayol: "Alt-y",
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.proofread(text) :
      `Aşağıdaki Türkçe metinde YALNIZCA yazım (imla) ve noktalama hatalarını düzelt.\n\n` +
      `EN ÖNEMLİ KURAL — KELİME DEĞİŞTİRME:\n` +
      `Hiçbir kelimeyi başka bir kelimeyle DEĞİŞTİRME. Eşanlamlısını yazma. Daha güzelini önerme.\n` +
      `Kelime EKLEME, kelime ÇIKARMA, kelime SIRASI değiştirme. Cümle bölme, cümle birleştirme YOK.\n` +
      `Çıktıdaki kelimeler, girdideki kelimelerin AYNISI olmalı — yalnızca yanlış YAZILMIŞ olanlar\n` +
      `doğru yazımıyla düzelir. Örnek: "yalnış" → "yanlış" (bu bir yazım hatası, düzeltilir).\n` +
      `Ama "yanlış" → "hatalı" YASAK (bu bir kelime değişikliğidir).\n\n` +
      `İZİN VERİLEN TEK ŞEYLER:\n` +
      `- Yanlış yazılmış bir kelimenin doğru yazımı ("bir kaç" → "birkaç", "herkez" → "herkes")\n` +
      `- Eksik/fazla noktalama (virgül, nokta, kesme işareti: "Ali nin" → "Ali'nin")\n` +
      `- Büyük/küçük harf hatası ("türkiye" → "Türkiye")\n` +
      `- Yanlış birleşik/ayrı yazım ("herşey" → "her şey")\n\n` +
      `KESİNLİKLE YASAK:\n` +
      `- Üslubu, tonu, cümle yapısını değiştirmek. Metni "iyileştirmek", "akıcılaştırmak".\n` +
      `- Türkçe eklemeli bir dildir: "oynanabilirliğinden", "gerçekleştirilemeyeceği" gibi uzun\n` +
      `  ama DOĞRU kelimeleri hata sanıp değiştirmek.\n` +
      `- Özel adlara, terimlere, formüllere dokunmak (Nash dengesi, von Neumann, $x^2$).\n` +
      `- HTML yazmak. Markdown biçimini bozmak.\n\n` +
      `HATA YOKSA: metni harfi harfine AYNEN geri ver. Değiştirmek zorunda değilsin.\n` +
      `ÇIKTI: yalnız metin. Neyi düzelttiğini açıklama, liste yapma.\n\n` +
      `METİN:\n${text}`,
  },

  // ---- claims about the world: shown, never accepted ----

  verify: {
    ad: "Bilgi denetimi",
    tur: "rapor",
    kisayol: "Alt-b",
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.verify(text) :
      `Aşağıdaki Türkçe metindeki OLGUSAL İDDİALARI incele.\n\n` +
      `KURALLAR:\n` +
      `1. Her iddiayı tek tek listele. Her biri için: "şüpheli", "doğru göründü" ya da "emin değilim".\n` +
      `2. EMİN OLMADIĞIN YERDE "emin değilim" DE. Tahmin yürütme, doldurma yapma.\n` +
      `3. Bir tarih, sayı ya da isim yanlış görünüyorsa söyle; ama doğrusunu bildiğinden emin değilsen bunu da söyle.\n` +
      `4. Metni yeniden yazma, düzeltme önerme. Yalnızca denetle.\n` +
      `5. Kısa madde madde yaz.\n\n` +
      `METİN:\n${text}`,
  },

  cite: {
    ad: "Kaynak önerisi",
    tur: "rapor",
    kisayol: "Alt-k",
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.cite(text) :
      `Aşağıdaki Türkçe metnin konusuyla ilgili literatürden kaynak öner.\n\n` +
      `KURALLAR:\n` +
      `1. Yalnızca GERÇEKTEN var olduğundan emin olduğun eserleri öner. Emin değilsen ÖNERME.\n` +
      `2. DOI, sayfa numarası, cilt numarası UYDURMA. Bilmiyorsan yazma.\n` +
      `3. Her kaynak için neden ilgili olduğunu tek cümleyle söyle.\n` +
      `4. Hiçbir kaynaktan emin değilsen "emin olduğum bir kaynak öneremiyorum" de.\n` +
      `5. En fazla 5 kaynak. Kısa yaz.\n\n` +
      `METİN:\n${text}`,
  },

  /**
   * Özet (16 Tem 2026, Zafer) — belgenin tamamı üzerinde, ⋯ menüsünden.
   *
   * `kapsam: "belge"` iki şey söyler: seçimden değil BELGEDEN çalışır, ve bu
   * yüzden yüzen palette görünmez — palet seçim hakkındadır.
   *
   * Neden "rapor": sınıfın asıl ölçütü "dünya hakkında mı konuşuyor" değil,
   * "belgeye girebilir mi" (KR-49). Özet giremez. Bir özeti metnin üstüne
   * yapıştırmak, özetlediği şeyi silmek olurdu — o yüzden kartta "kabul et"
   * yoktur, olamaz.
   */
  summarize: {
    ad: "Özet",
    tur: "rapor",
    kapsam: "belge",
    // The same pattern as the other five: the job's initial (Akıcı→A,
    // Tamamlayıcı→T, Yazım→Y, Bilgi→B, Kaynak→K, Özet→O).
    //
    // ASCII only — never a Turkish letter. A shortcut is a physical key, not a
    // spelling: "Alt-ö" exists on a Turkish layout and nowhere else, so on any
    // other keyboard the job would simply have no shortcut at all. Ö reads as O.
    //
    // Unlike the other five it asks for no selection — the keymap reads `kapsam`
    // and runs this one on the whole document, exactly as the ⋯ menu does.
    kisayol: "Alt-o",
    // "Belge" değil "metin" (18 Tem): aynı iş artık paletten SEÇİM üzerinde de
    // çalışıyor. Prompt girdisinin ne olduğunu bilmez; kapıyı arayan bilir.
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.summarize(text) :
      `Aşağıdaki Türkçe metni özetle.\n\n` +
      `KURALLAR:\n` +
      `1. Yalnız metinde YAZANI özetle. Metinde olmayan bilgi, sayı, ad, tarih EKLEME.\n` +
      `2. Metnin kendi savını, adımlarını ve varsa vardığı sonucu çıkar.\n` +
      `3. Madde madde yaz: en fazla 7 madde, her madde tek cümle.\n` +
      `4. METNİN KENDİ TERİMLERİNİ kullan; kendi sözlüğünü dayatma.\n` +
      `5. Yorum katma, değerlendirme yapma, öneri verme. Özet bir yargı değildir.\n` +
      `6. Metin bir sonuca varmıyorsa varmış gibi yazma; nerede kaldığını söyle.\n` +
      `7. HTML kullanma.\n` +
      `8. Yalnız özeti ver. Açıklama, başlık, kapanış cümlesi yazma.\n\n` +
      `METİN:\n${text}`,
  },

  /**
   * Başlık ve spot (27 Tem 2026, Zafer — KR-67, UC-23).
   *
   * Neden "rapor" ve neden ✓ yok: kabul edilen başlık nereye yazılsın diye
   * soruldu, cevap **hiçbir yere** oldu (28 Tem, Zafer) — kart üç adayı gösterir,
   * yazar beğendiğini kopyalar. Kabul yoksa iş rapordur (ölçüt "belgeye girebilir
   * mi", KR-49), ve rapor sert kapıdan hiç geçmez. Planlanan "üretim kapısı"
   * böylece gereksizleşti: 4.000 kelimelik formüllü bir belgeden çıkan sekiz
   * kelimelik başlığın formül karşılaştırmasına girmesi diye bir tehlike kalmadı.
   *
   * `lines: true` yalnız BAŞLIKTA: üç aday üç ayrı şeydir, kart her satıra kendi
   * kopyala ikonunu koyar. Spot iki cümlelik tek bir metindir, tek kopya yeter.
   */
  title: {
    ad: "Başlık",
    tur: "rapor",
    kapsam: "belge",
    lines: true,
    inPalette: false,
    // Kural işin adından bir harf almaktır; baş harf doluysa iş biter demek
    // değil — adın İÇİNDE ilerlenir. Başlık: B dolu (Bilgi denetimi), a dolu
    // (Akıcı), ş→S dolu (Spot), **l boş**. Yani Alt+L, hâlâ işin kendi adından.
    // (Harf ASCII olmak zorunda: "Alt-ş" yalnız Türkçe klavyede vardır.)
    kisayol: "Alt-l",
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.title(text) :
      `Aşağıdaki metin için ÜÇ başlık öner.\n\n` +
      `KURALLAR:\n` +
      `1. TAM ÜÇ SATIR. Her satırda bir başlık.\n` +
      `2. Numara, madde işareti, tırnak, açıklama YOK.\n` +
      `3. Her başlık metnin NE HAKKINDA olduğunu söylesin — okura ne vaat ettiğini değil.\n` +
      `4. Metnin kendi terimlerini kullan. Metinde olmayan bir konu uydurma.\n` +
      `5. Üçü gerçekten farklı olsun: aynı başlığın üç söylenişi değil.\n` +
      `6. Kısa: her biri en çok 8 kelime. İki nokta üst üste ile alt başlık kurma.\n` +
      `7. Markdown işareti (#, **) ve HTML kullanma.\n\n` +
      `METİN:\n${text}`,
  },

  /**
   * Translation (29 Tem 2026, Zafer — KR-83).
   *
   * A REPORT, not a text job: it never enters the document, it is read and
   * copied. So it is not gated (`hardGate` guards the file, and nothing is being
   * written to a file) — if a translation mangles a formula, you see it in the
   * card before you take it.
   *
   * Neither on the palette nor on the strip, by decision: it lives on the right
   * click and on Alt+C. So `inPalette: false`, and `kapsam: "secim"` because a
   * translation is of a passage — the whole document is a different animal
   * (length, cost, formula integrity) and stays out of scope.
   *
   * The DIRECTION is not the model's to guess (Zafer): from and to are chosen in
   * Settings, and the context menu offers both ways of that pair.
   */
  translate: {
    ad: "Çevir",
    tur: "rapor",
    kapsam: "secim",
    inPalette: false,
    // Ç is not a key on an English keyboard and this app is TR/EN; C is the
    // nearest letter of the job's own name that every layout has.
    kisayol: "Alt-c",
    prompt: (text, lang, { from = "en", to = "tr" } = {}) => {
      // The languages are named in ENGLISH to the model, whatever the interface
      // is: every model knows "Turkish", not every model knows "Türkçe".
      const source = languageName(from, "en");
      const target = languageName(to, "en");
      return lang === "en"
        ? `Translate the following ${source} text into ${target}.\n\n` +
          `RULES:\n` +
          `1. Translate. Do not summarise, explain, comment or add anything.\n` +
          `2. Keep Markdown formatting (**bold**, *italic*, lists, [link](x.md)) and LaTeX formulas ($...$) EXACTLY as they are. Translate link TEXT, never link targets.\n` +
          `3. Keep proper names, numbers, dates and units unchanged.\n` +
          `4. Keep the register of the original: an academic passage stays academic.\n` +
          `5. If a term has no settled ${target} equivalent, use the original and put your rendering in parentheses after it — once, at first use.\n` +
          `6. No HTML.\n` +
          `7. Give ONLY the translation. No heading, no preface, no notes.\n\n` +
          `TEXT:\n${text}`
        : `Aşağıdaki ${languageName(from, "tr")} metni ${languageName(to, "tr")} diline çevir.\n\n` +
          `KURALLAR:\n` +
          `1. Çevir. Özetleme, açıklama, yorum ekleme.\n` +
          `2. Markdown biçimini (**kalın**, *italik*, listeler, [link](x.md)) ve LaTeX formülleri ($...$) AYNEN koru. Link METNİNİ çevir, link hedefine dokunma.\n` +
          `3. Özel adları, sayıları, tarihleri, birimleri değiştirme.\n` +
          `4. Metnin kendi üslubunu koru: akademik bir pasaj akademik kalsın.\n` +
          `5. Yerleşik karşılığı olmayan terimde özgün terimi bırak, karşılığını ilk geçtiği yerde parantez içinde ver.\n` +
          `6. HTML kullanma.\n` +
          `7. Yalnız çeviriyi ver. Başlık, giriş cümlesi, not yazma.\n\n` +
          `METİN:\n${text}`;
    },
  },

  spot: {
    ad: "Spot",
    tur: "rapor",
    kapsam: "belge",
    kisayol: "Alt-s",
    inPalette: false,
    prompt: (text, lang) => lang === "en" ? EN_PROMPTS.spot(text) :
      `Aşağıdaki metin için bir SPOT yaz.\n\n` +
      `SPOT NEDİR: başlığın altında duran, okuru içeri çeken iki cümle. İşi\n` +
      `özetlemek DEĞİL, okutmaktır. Metnin en keskin iddiasını ya da en gergin\n` +
      `yerini öne çıkarır; okur o iki cümleyi okuyunca devamını merak eder.\n\n` +
      `KURALLAR:\n` +
      `1. İKİ CÜMLE. Ne fazla, ne eksik.\n` +
      `2. BİRİNCİ CÜMLE bir iddia ya da gerilim koysun — metnin alışılmışa ters\n` +
      `   düşen, rahatsız eden ya da bedeli olan yanı. Konu tanıtımı değil.\n` +
      `3. İKİNCİ CÜMLE bunun neye mal olduğunu ya da metnin nereye baktığını\n` +
      `   söylesin. Vardığı SONUCU ele verme; okunacak bir şey bıraksın.\n` +
      `4. Merak uyandır, ama ABARTMA. Yalnız metinde olanı söyle: yeni bilgi,\n` +
      `   sayı, ad, tarih ekleme; metnin söylemediği bir iddiayı ona yükleme.\n` +
      `5. YASAK: soru cümlesi, ünlem, "bu yazıda", "ele alınıyor", "günümüzde",\n` +
      `   "mutlaka okuyun", "şaşırtıcı" gibi klişe ve reklam dili.\n` +
      `6. Metnin kendi tonunu koru: akademik bir metnin spotu da ağırbaşlıdır —\n` +
      `   merak, ses yükselterek değil doğru cümleyi seçerek uyandırılır.\n` +
      `7. Markdown işareti ve HTML kullanma.\n` +
      `8. Yalnız iki cümleyi ver. Başlık, açıklama yazma.\n\n` +
      `METİN:\n${text}`,
  },
};

// The display name is localized; JOBS[job].ad is no longer read for it (the
// prompt bodies stay in JOBS, the labels moved to the i18n catalog).
export const jobName = (job) => t(`ai.job.${job}`);
export const jobKind = (job) => JOBS[job].tur;
export const jobShortcut = (job) => JOBS[job].kisayol ?? null;
/** Does this job answer with a LIST of alternatives rather than one text? Only
    "Başlık" does: three candidates, each its own thing to copy. */
export const jobLines = (job) => JOBS[job].lines === true;

/**
 * May this job appear on the floating palette? (28 Tem 2026, Zafer.)
 *
 * Not the same question as `kapsam`, which is about the default INPUT — "Özet"
 * is a document job and belongs on the palette, because summarizing the passage
 * you just selected is a real thing to want. Başlık and Spot are not: a title
 * for one paragraph is not a title, it is a mistake. So they live in the ⋯ menu,
 * where the subject is the document.
 *
 * There is a second reason, and it is the plainer one: the palette floats. Two
 * more rows pushed its submenu off the bottom of the window when the selection
 * reached the end of the document. A menu you cannot reach is not a feature.
 */
export const jobInPalette = (job) => JOBS[job].inPalette !== false;
export const textJobs = () => Object.keys(JOBS).filter((j) => JOBS[j].tur === "metin");
export const reportJobs = () => Object.keys(JOBS).filter((j) => JOBS[j].tur === "rapor");

/**
 * What a job takes by DEFAULT: the selection, or the whole document.
 *
 * The ⋯ menu and the shortcut keymap ask this — "Özet" from there runs on the
 * document. The palette no longer filters by it (18 Tem): a document job
 * pressed on a selection works on the selection, because the palette IS the
 * selection. Settings never asks: every job needs a model, wherever it runs.
 */
export const jobScope = (job) => JOBS[job].kapsam ?? "secim";
export const documentJobs = () => Object.keys(JOBS).filter((j) => jobScope(j) === "belge");

/** Every job that carries a keyboard shortcut, text jobs first — the single
    source both the editor keymap and the Settings list read from. */
export const jobShortcuts = () =>
  [...textJobs(), ...reportJobs()]
    .filter((j) => JOBS[j].kisayol)
    .map((j) => ({ job: j, kisayol: JOBS[j].kisayol, ad: jobName(j) }));

/**
 * The provider registry — the one list that knows how each kind of connection
 * becomes a call. Adding a provider is adding a row here, not editing five
 * switch statements across two files (KR-46 taken to its conclusion).
 *
 * `protokol` is the wire shape, and there are only a handful: "openai" (the de
 * facto standard — POST /chat/completions + GET /models, a bearer key),
 * "gemini", "anthropic", "ollama", plus "cli" — the one that is not a wire at
 * all but a command on this machine (ai-cli.js). Every
 * hosted model shipping this year speaks "openai", which is why the "ozel" row
 * needs no code at all:
 * point it at a base URL, paste a key, pick a model. Tomorrow's provider is a
 * connection, not a commit.
 *
 * Fields:
 *   id            — the connection's `tur`, stored in settings.
 *   ad            — what the dropdown shows.
 *   anahtarli     — needs an API key?
 *   protokol      — which adapter calls it.
 *   baseUrl       — fixed endpoint (omitted when the user types their own).
 *   baseUrlKullanicidan — the base URL is a field on the connection (custom).
 *   basliklar     — extra request headers.
 *   usageInclude  — ask an OpenRouter-style endpoint to return the real $ cost.
 *   ucretli       — bills real money. Decides what a rate-limit error says: a
 *                   paid model's 429 is a hiccup, a free one's is the free tier
 *                   working as designed.
 *   fixedModels  — a fixed model list; a row may instead bring a live `fetchModels`
 *                   (its own way of listing models).
 *
 * `etiket` was removed on 17 Tem. It built "model · ağa gider · ÜCRETLİ" for one
 * consumer — the palette's hint — where it truncated to nonsense in a 205px
 * menu. The hint now says the model and nothing else; the network-and-money
 * words belong to KR-53's single global warning, not to a fragment in a menu.
 */
// The CLI agents ship with the app now (3 Ağu 2026). They used to arrive through
// an optional gitignored module loaded by import.meta.glob, behind a build flag —
// two gates whose whole purpose was keeping them OUT of the package. The decision
// reversed, so the indirection went with it: a plain import says what is true.
//
// What kept the old arrangement honest still holds, only differently: an agent
// that is not installed never reaches the connection list (see availableProviders
// below), so the option nobody can use is not shown to everybody.

export const PROVIDERS = [
  { id: "gemini", ad: "Gemini", anahtarli: true, protokol: "gemini" },
  { id: "claude", ad: "Claude", anahtarli: true, protokol: "anthropic", ucretli: true },
  {
    id: "openrouter",
    ad: "OpenRouter",
    anahtarli: true,
    protokol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    basliklar: { "x-title": "MD Plus" },
    usageInclude: true,
    ucretli: true,
  },
  {
    id: "nvidia",
    ad: "NVIDIA",
    anahtarli: true,
    protokol: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  },
  {
    id: "groq",
    ad: "Groq",
    anahtarli: true,
    protokol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  {
    id: "deepseek",
    ad: "DeepSeek",
    anahtarli: true,
    protokol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    ucretli: true,
  },
  {
    id: "openai",
    ad: "OpenAI",
    anahtarli: true,
    protokol: "openai",
    baseUrl: "https://api.openai.com/v1",
    ucretli: true,
  },
  { id: "ollama", ad: "Yerel (Ollama)", anahtarli: false, protokol: "ollama" },
  {
    id: "ozel",
    ad: "Özel (OpenAI uyumlu)",
    anahtarli: true,
    protokol: "openai",
    baseUrlKullanicidan: true,
  },
  // The CLI agents, at the end: they are the exception in every way the rows
  // above are the rule (no key, no wire protocol of their own, subscription
  // rather than tokens), and only appear at all when installed.
  ...CLI_PROVIDERS,
];

/**
 * Which CLI agents answered. `null` until asked — and "not asked yet" must not
 * read as "not installed", or the list would flicker its rows away on a slow
 * machine and no one would ever see them.
 */
let cliReady = null;

/**
 * Asks each CLI row whether its command exists. Called once at startup, off the
 * critical path: the answer is wanted by the time Settings is opened, and
 * nobody opens Settings in the first second.
 */
export async function refreshCliAvailability() {
  const answers = await Promise.all(
    CLI_PROVIDERS.map(async (row) => ((await probeAgent(row)) ? row.id : null)),
  );
  cliReady = new Set(answers.filter(Boolean));
}

/**
 * The provider rows worth offering on this machine.
 *
 * Everything hosted is always offerable — a key is something you can go and get.
 * A CLI agent is not: either the command is on the machine or it is not, and an
 * option that cannot work is worse than a missing one, because it reads as a
 * promise. (KR-42's rule, one level up: there it was a job with no model, here
 * it is a connection with no program.)
 *
 * `keep` is the type a connection ALREADY uses. A saved connection never loses
 * its own row from the dropdown, whatever the probe said — a select whose value
 * is missing from its options quietly shows the first one instead, and the row
 * then looks healthy while pointing somewhere else entirely. That is exactly how
 * the orphan model line hid itself (B-28); once was enough.
 */
export function providerRows(keep = null) {
  if (!cliReady) return PROVIDERS;
  return PROVIDERS.filter(
    (row) => row.protokol !== "cli" || row.id === keep || cliReady.has(row.id),
  );
}

/** The registry row for a connection's type, or null for an unknown/old one. */
export const providerMeta = (tur) => PROVIDERS.find((p) => p.id === tur) ?? null;

/**
 * The connection type's display name. Brand names (Gemini, Claude, OpenRouter…)
 * are the same in every language and come straight off the row; only the two
 * descriptive ones ("Yerel (Ollama)", "Özel (OpenAI uyumlu)") are localized,
 * so a missing catalog key falls back to the row's own `ad`.
 */
export const providerLabel = (meta) => {
  if (!meta) return "";
  const key = `provider.${meta.id}`;
  const s = t(key);
  return s === key ? meta.ad : s;
};

/** A localhost endpoint never touches the network — the warning must not lie. */
const isLocal = (url) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url ?? "");

/**
 * The route for one job (KR-50): job → model instance → connection → config.
 *
 * Each job points at a named model instance by id; the instance names a
 * connection (the credential) and a model. Resolving the chain here means the
 * settings can be reshuffled freely and this stays the one place that knows how
 * a job becomes a call. Returns null when the job is unrouted or its instance
 * has been deleted.
 */
export function provider(job) {
  const yz = getSettings().yapayZeka ?? {};
  const modelId = yz.isler?.[job];
  if (!modelId) return null;

  const örnek = (yz.modeller ?? []).find((m) => m.id === modelId);
  if (!örnek) return null;

  const baglanti = (yz.baglantilar ?? []).find((b) => b.id === örnek.baglantiId);
  if (!baglanti || !örnek.model) return null;

  return configFor(baglanti, örnek.model);
}

/**
 * Turns a connection + model id into a ready-to-call config with an honest
 * label — entirely from the registry row, so a new provider needs no case here.
 */
function configFor(baglanti, model) {
  const p = providerMeta(baglanti.tur);
  if (!p) return null;

  const baseUrl = p.baseUrlKullanicidan ? (baglanti.baseUrl ?? "").trim() : p.baseUrl;
  const agaCikar = p.protokol !== "ollama" && !isLocal(baseUrl);

  return {
    // Carry the whole row first, then overwrite with the computed fields. This
    // is how a local provider's extra fields (komut/arglar/ayikla/maxUzunluk/ad)
    // reach the adapter — the core does not know those fields exist, it just
    // forwards whatever the row holds. (Without this: `kapi.arglar is not a function`.)
    ...p,
    tur: p.id,
    protokol: p.protokol,
    model,
    anahtar: baglanti.anahtar ?? "",
    baseUrl,
    basliklar: p.basliklar ?? {},
    usageInclude: !!p.usageInclude,
    ucretli: !!p.ucretli,
    // A CLI agent bills nothing per call; it spends a subscription. Said
    // separately from `ucretli` because "may cost money" would be the wrong
    // sentence for someone who has already paid.
    abonelik: !!p.abonelik,
    agaCikar,
  };
}

/** Is any job routed to a model? Decides whether the palette shows "Öneri". */
export const anyJobEnabled = () => [...textJobs(), ...reportJobs()].some((j) => provider(j));

/**
 * Asks for a suggestion, and checks it before anyone sees it.
 *
 * Returns one of:
 *   { metin, bayraklar, kelime, sure }  — show it, with its flags
 *   { engel }                            — do not show it; say this instead
 *   { hata }                             — it never arrived; say this instead
 */
export async function suggest(job, text, { signal, options } = {}) {
  const kapi = provider(job);
  if (!kapi) return { hata: t("ai.err.off") };
  if (!kapi.model) return { hata: t("ai.err.noModel") };

  const basladi = Date.now();
  let cikti;
  let kullanim = null;

  // Dispatch by wire protocol, not by provider: OpenRouter, NVIDIA, Groq,
  // DeepSeek, OpenAI and every "Özel" endpoint all share the one "openai" adapter.
  const soranlar = {
    openai: askOpenAI,
    gemini: askGemini,
    anthropic: askClaude,
    ollama: askOllama,
    // One more shape: a command on this machine rather than a URL (ai-cli.js).
    ...CLI_ADAPTERS,
  };

  // The output language follows the TEXT, not the interface (Zafer, 19 Tem);
  // only when the text gives no signal does it fall back to the interface language.
  const lang = detectTextLang(text, effectiveLang());

  try {
    // `options` is the job's own business — today only the translation pair
    // (from/to), which is a choice and not something to be guessed from the text.
    const yanit = await soranlar[kapi.protokol](kapi, JOBS[job].prompt(text, lang, options), signal);
    cikti = yanit.metin;
    kullanim = yanit.kullanim ?? null;
  } catch (hata) {
    if (hata.name === "AbortError") return { iptal: true };
    // console.WARN, not error: a provider failure is expected (rate limits,
    // quotas, a model being down) and is already shown to the writer as a
    // closeable message. The red debug band in index.html intercepts
    // console.error and never clears — feeding a handled, routine failure to it
    // painted a permanent "crash" over an error we had gracefully caught. The
    // band is for the unforeseen; this is foreseen.
    console.warn("ai:", hata);
    return { hata: readableError(hata, kapi) };
  }

  cikti = tidy(cikti);
  const sure = Date.now() - basladi;

  // Measured on what was sent, reported with what came back: a model handed
  // more than it can hold answers just as confidently about the part it kept.
  // The card says so; nothing is blocked (see contextRisk in ai-check.js).
  const uzun = contextRisk(kapi.protokol, text);

  // A report is never taken into the document, so there is nothing for the gate
  // to protect. It is shown as what it is: an unverified claim (KR-49).
  if (JOBS[job].tur === "rapor") {
    return { rapor: cikti, sure, kullanim, model: kapi.model, uzun };
  }

  // The gate stands here, not in the interface: a damaged suggestion is never
  // handed over, whatever screen asked for it (KR-45).
  const engel = hardGate(text, cikti, { kind: gateKind(job) });
  if (engel) return { engel, sure, kullanim, model: kapi.model };

  return {
    metin: cikti,
    // The gate judges by duty to the text (proofreading owes it the same as a
    // rewrite); the flags judge by what the job promised (a proofreader promised
    // not to change a single word).
    bayraklar: flags(text, cikti, { kind: job }),
    kelime: wordCount(cikti),
    sure,
    kullanim,
    uzun,
    model: kapi.model, // shown at the far right of the card's control line
  };
}

/**
 * Proofreading and rewriting have the same duty to the text: keep its formulas,
 * its formatting, its facts. Only "continue" writes something new, and is judged
 * by looser rules.
 */
const gateKind = (job) => (job === "continue" ? "continue" : "rewrite");

/**
 * Models like to wrap their answer in a code fence or announce it first ("İşte
 * daha akıcı hâli:"). None of that is the paragraph.
 */
function tidy(text) {
  let out = text.trim();
  out = out.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "");
  // Turkish ("İşte daha akıcı hâli:") and English ("Here is the rewritten text:")
  // prefaces alike — the output language can now be either.
  out = out.replace(
    /^(İşte|Buyurun|Elbette|Here(?:'s| is)?|Sure|Certainly|Of course)[^\n:]{0,60}:\s*/i,
    "",
  );
  return out.trim();
}

async function askOllama(kapi, prompt, signal) {
  const yanit = await tauriFetch(OLLAMA, {
    method: "POST",
    headers: { "content-type": "application/json", ...OLLAMA_ORIGIN },
    body: JSON.stringify({
      model: kapi.model,
      prompt,
      stream: false,
      // num_ctx is asked for, not assumed. Ollama's default window is 4096
      // tokens whatever the model can actually hold, and anything past it is
      // dropped in silence — the summary comes back sounding certain about a
      // document it only half read. Sized from the prompt (Turkish runs about
      // three characters to the token) with room for the answer, and capped:
      // a window costs memory, and one large enough to swap is worse than one
      // that is honestly too small.
      options: {
        temperature: 0.2,
        num_ctx: Math.min(16384, Math.max(4096, Math.ceil(prompt.length / 3) + 2048)),
      },
    }),
    signal,
  });

  if (!yanit.ok) throw Object.assign(new Error(await yanit.text()), { durum: yanit.status });

  const veri = await yanit.json();
  return {
    metin: veri.response ?? "",
    // Costs nothing, but the writer may still want to know the size of the call.
    kullanim: { giren: veri.prompt_eval_count ?? 0, cikan: veri.eval_count ?? 0 },
  };
}

/**
 * Claude. The only provider that bills per call, which is why the card shows the
 * tokens it just spent: "you cannot manage what you cannot see" applies to money
 * as much as to time.
 */
async function askClaude(kapi, prompt, signal) {
  if (!kapi.anahtar) throw Object.assign(new Error("anahtar yok"), { anahtarYok: true });

  const cagir = (sicaklik) =>
    tauriFetch(`${CLAUDE}/messages`, {
      method: "POST",
      headers: CLAUDE_HEADERS(kapi.anahtar),
      body: JSON.stringify({
        model: kapi.model,
        max_tokens: 2048,
        ...(sicaklik ? { temperature: 0.2 } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });

  let yanit = await cagir(true);

  // The newest models have dropped `temperature` and reject the whole request
  // for mentioning it. Rather than deny the writer their model, ask again
  // without it — the same trick Gemini needed for `thinkingConfig`, and for the
  // same reason unconditional: a provider need not name the field it refused.
  if (yanit.status === 400) yanit = await cagir(false);

  if (!yanit.ok) throw Object.assign(new Error(await yanit.text()), { durum: yanit.status });

  const veri = await yanit.json();
  const metin = (veri.content ?? [])
    .filter((parca) => parca.type === "text")
    .map((parca) => parca.text)
    .join("");

  return {
    metin,
    kullanim: {
      giren: veri.usage?.input_tokens ?? 0,
      cikan: veri.usage?.output_tokens ?? 0,
    },
  };
}

async function askGemini(kapi, prompt, signal) {
  if (!kapi.anahtar) throw Object.assign(new Error("anahtar yok"), { anahtarYok: true });

  const cagir = async (dusunmeKapali) => {
    const generationConfig = { temperature: 0.2 };

    // Thinking off. Measured on this key: the same paragraph took 51 s with it
    // and 1.1 s without — the model was spending 1148 tokens of reasoning to
    // produce 41 tokens of prose. Rewriting a sentence is language work, not
    // deliberation; there is nothing here to think about.
    if (dusunmeKapali) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    return tauriFetch(
      `${GEMINI}/${kapi.model}:generateContent?key=${encodeURIComponent(kapi.anahtar)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
        }),
        signal,
      },
    );
  };

  let yanit = await cagir(true);

  // Some models do not know the field and reject the whole request for it.
  // Rather than deny the writer their model, ask again without it — slowly, but
  // at all.
  //
  // The retry used to be conditioned on the body mentioning "thinking". Google
  // does not name the field it refused ("Request contains an invalid argument."),
  // so the condition never held and this fallback never once ran. A status code
  // is a contract; an error body is not. Retry on any 400: an untested fallback
  // is not a fallback.
  if (yanit.status === 400) yanit = await cagir(false);

  if (!yanit.ok) throw Object.assign(new Error(await yanit.text()), { durum: yanit.status });

  const veri = await yanit.json();
  return {
    metin: veri.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    kullanim: {
      giren: veri.usageMetadata?.promptTokenCount ?? 0,
      cikan: veri.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

/**
 * Which models does this key actually have? Asked of Google, not guessed by us —
 * the model list changes, and a hard-coded name is a promise we cannot keep.
 * Only the ones that can generate text are offered.
 */
export async function geminiModels(anahtar) {
  const yanit = await tauriFetch(`${GEMINI}?key=${encodeURIComponent(anahtar)}&pageSize=100`);
  if (!yanit.ok) {
    const govde = await yanit.text();
    throw new Error(
      yanit.status === 400 || yanit.status === 403
        ? t("ai.err.keyInvalidShort")
        : t("ai.err.modelListFailedCode", { status: yanit.status, body: govde.slice(0, 120) }),
    );
  }

  const veri = await yanit.json();
  return (veri.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((ad) => !/embedding|aqa|imagen|veo|tts/i.test(ad))
    .sort();
}

/** The local models Ollama has pulled. Same principle: ask, do not assume. */
export async function ollamaModels() {
  const yanit = await tauriFetch("http://127.0.0.1:11434/api/tags", {
    headers: { ...OLLAMA_ORIGIN },
  });
  if (!yanit.ok) throw new Error(t("ai.err.ollamaNoResponse"));
  return ((await yanit.json()).models ?? []).map((m) => m.name).sort();
}


/**
 * The OpenAI-compatible adapter — the one that makes tomorrow's provider a
 * setting instead of a commit. A bearer key and POST /chat/completions is what
 * OpenRouter, NVIDIA, Groq, DeepSeek, OpenAI, and any "Özel" endpoint all speak;
 * the differences (which URL, an extra header, whether it returns a dollar cost)
 * ride in on `kapi` from the registry, so this function grows no per-provider
 * branch. The model id ("anthropic/claude-…", "google/gemini-…") is what routes
 * within a multi-model gateway.
 */
async function askOpenAI(kapi, prompt, signal) {
  const base = (kapi.baseUrl ?? "").replace(/\/+$/, "");
  if (!base) throw new Error(t("ai.err.addressMissing"));

  // A key is required unless the endpoint is on this machine (LM Studio, vLLM),
  // where it is typically ignored.
  if (!kapi.anahtar && !isLocal(base)) {
    throw Object.assign(new Error("anahtar yok"), { anahtarYok: true });
  }

  const yanit = await tauriFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(kapi.anahtar ? { authorization: `Bearer ${kapi.anahtar}` } : {}),
      ...kapi.basliklar,
    },
    body: JSON.stringify({
      model: kapi.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
      // OpenRouter-only: makes the response carry the real dollar cost, which the
      // card shows because that one is billed. Others ignore an unknown field.
      ...(kapi.usageInclude ? { usage: { include: true } } : {}),
    }),
    signal,
  });

  if (!yanit.ok) throw Object.assign(new Error(await yanit.text()), { durum: yanit.status });

  const veri = await yanit.json();

  // An OpenAI-compatible gateway (OpenRouter the worst offender) can hand back an
  // upstream failure inside a 200 OK body — a rate-limited free model returns
  // code 429 here, not as an HTTP status. Missing this meant the raw JSON landed
  // in front of the writer, unreadable and uncloseable.
  if (veri.error) {
    throw Object.assign(new Error(veri.error.message ?? t("ai.err.providerError")), {
      durum: veri.error.code ?? 500,
      ucretsizKota: /rate-limit/i.test(veri.error.metadata?.raw ?? ""),
    });
  }

  const u = veri.usage ?? {};
  return {
    metin: veri.choices?.[0]?.message?.content ?? "",
    kullanim: {
      giren: u.prompt_tokens ?? 0,
      cikan: u.completion_tokens ?? 0,
      bedel: u.cost ?? null, // real USD when the endpoint returns it
    },
  };
}

/**
 * An OpenAI-compatible endpoint's model list. Same principle as everywhere else:
 * ask GET /models, never hard-code a name we cannot keep. Returned in the API's
 * own order (usually newest first); the picker type-searches rather than scrolls.
 */
export async function openaiModels(baseUrl, anahtar) {
  const base = (baseUrl ?? "").replace(/\/+$/, "");
  if (!base) throw new Error(t("ai.err.enterAddress"));
  const yanit = await tauriFetch(`${base}/models`, {
    headers: anahtar ? { authorization: `Bearer ${anahtar}` } : {},
  });
  if (!yanit.ok) {
    throw new Error(yanit.status === 401 ? t("ai.err.keyInvalidShort") : t("ai.err.modelListFailed"));
  }
  return ((await yanit.json()).data ?? []).map((m) => m.id);
}

/**
 * The models a connection can offer, asked of the provider — this is provider
 * knowledge, so it lives here, and the settings screen just calls it. Dispatched
 * by protocol, so every OpenAI-compatible provider (known preset or custom) is
 * one branch, not one each.
 */
export async function connectionModels(baglanti) {
  const p = providerMeta(baglanti.tur);
  if (!p) return [];

  // A provider row may bring its own live model fetch (some providers expose a
  // way to list their models). The core does not know how it works —
  // it just calls it, and falls back to the fixed list if it throws or comes back
  // empty. So a new model appearing over there needs no edit here: reopen the
  // Modeller tab and it is listed, exactly as with an /models API.
  if (p.fetchModels) {
    try {
      const live = await p.fetchModels();
      if (Array.isArray(live) && live.length) return live;
    } catch {
      // Command missing or failed — fall through to the fixed list.
    }
  }
  if (p.fixedModels) return p.fixedModels;

  const anahtar = baglanti.anahtar ?? "";
  switch (p.protokol) {
    case "gemini":
      return geminiModels(anahtar);
    case "anthropic":
      return claudeModels(anahtar);
    case "openai":
      return openaiModels(p.baseUrlKullanicidan ? baglanti.baseUrl : p.baseUrl, anahtar);
    case "ollama":
      return ollamaModels();
    default:
      return [];
  }
}

/** Claude's models, asked of Anthropic — newest first, as they are returned. */
export async function claudeModels(anahtar) {
  const yanit = await tauriFetch(`${CLAUDE}/models?limit=100`, {
    headers: CLAUDE_HEADERS(anahtar),
  });

  if (!yanit.ok) {
    // Do not guess at the reason. "Anahtar geçersiz" was what this said when the
    // key was perfectly good and Anthropic was refusing us for looking like a
    // browser — a wrong diagnosis sends the writer hunting for the wrong bug.
    const govde = await yanit.text();
    throw new Error(
      yanit.status === 401
        ? t("ai.err.keyInvalidShort")
        : t("ai.err.modelListFailedCode", { status: yanit.status, body: govde.slice(0, 120) }),
    );
  }

  return ((await yanit.json()).data ?? []).map((m) => m.id);
}

/**
 * Every failure says what to do about it. None of them opens a dialog — and none
 * of them hides what actually happened: an unrecognised error is shown as it
 * came, because a vague "bir şeyler ters gitti" is how a bug survives for weeks.
 */
function readableError(hata, kapi) {
  if (hata.anahtarYok) return t("ai.err.keyMissing");

  if (hata.durum === 429) {
    // A free model's rate limit is not a passing hiccup — it is the free tier
    // working as designed. Say what it is and what actually fixes it.
    if (hata.ucretsizKota) {
      return t("ai.err.freeQuota");
    }
    return kapi.ucretli ? t("ai.err.rateLimitPaid") : t("ai.err.quotaFree");
  }
  if (hata.durum === 401 || hata.durum === 403) return t("ai.err.keyInvalid");
  if (hata.durum === 402) return t("ai.err.balance");
  if (hata.durum === 400) return t("ai.err.badRequest", { msg: kisalt(hata.message) });
  if (hata.durum === 404) return t("ai.err.modelNotFound", { model: kapi.model });
  if (hata.durum === 529 || hata.durum === 503) return t("ai.err.busy");

  // Ollama's own crashes come back as a wall of C++ (CUDA init failures, stack
  // overruns). "Ollama yanıt vermiyor" would be a lie: it answered, and what it
  // said was that it had fallen over. So say which of the two it is.
  if (kapi.tur === "ollama") {
    if (/cuda|gpu|shared object/i.test(hata.message ?? "")) {
      return t("ai.err.ollamaGpu");
    }
    if (!hata.durum) return t("ai.err.ollamaDown");
    return t("ai.err.ollamaFailed", { msg: kisalt(hata.message) });
  }

  return t("ai.err.generic", { msg: kisalt(hata.message ?? String(hata)) });
}

const kisalt = (text) => {
  const tek = String(text).replace(/\s+/g, " ").trim();
  return tek.length > 160 ? `${tek.slice(0, 160)}…` : tek;
};
