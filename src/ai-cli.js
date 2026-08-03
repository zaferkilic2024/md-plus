// CLI sağlayıcı katmanı — makinede kurulu abonelik ajanları (3 Ağu 2026).
//
// 17 Tem'de bu dosya kişiseldi ve dağıtılmıyordu; gerekçe "başka birinin
// makinesinde ne komut vardır ne anlamı" idi. 3 Ağu'da karar döndü (Zafer):
// kullanıcının zaten ödediği aboneliği uygulamada kullanabilmesi gerçek bir
// katma değer, ve "kurulu değilse hiç görünmez" kuralı zaten elimizde (KR-42).
//
// Bu sağlayıcıların API anahtarı YOKTUR: yetki, makinede açık olan oturumdan
// gelir. Bedel de jetondan değil ABONELİKTEN düşer — kart bunu böyle söyler.
// "Yerel" DEĞİLDİR: komut yerelde çalışır ama ajan ağa çıkar, metin sağlayıcının
// sunucusuna gider. Uyarı cümlesi (warning.js) bunu olduğu gibi söylemek
// zorunda; "yerel" demek burada yalan olurdu.
//
// TABLODA YALNIZ SINAYABİLDİĞİMİZ İKİSİ VAR (Zafer, 3 Ağu: "test edemediklerimizi
// koyma"). Bir CLI'nın argüman şekli, çıktı biçimi ve hata davranışı ancak
// çalıştırılarak bilinir; belgelerden okunanı tabloya yazmak, kullanıcının
// makinesinde sessizce bozuk bir satır bırakmaktır. Antigravity'nin web'de
// yazan bayrakları (--output-format/--headless/--approve) yanlıştı ve bunu
// yalnız deneyerek öğrendik (17 Tem). Yeni satır = önce kurup denemek.
//
// Genelleştirme: tek bir "cli" protokolü. Yeni bir CLI ajanı eklemek, aşağıdaki
// diziye bir satır yazmaktır — komutu, argümanları ve çıktı ayrıştırıcısı satırın
// kendisinde. `askCli` bunları körlemesine uygular; hiçbir sağlayıcıya özel dal
// bilmez. (PROVIDERS'ın registry felsefesi, KR-46, CLI tarafına da taşındı.)
//
// Adlandırma: değişkenler İngilizce (CLAUDE.md kuralı). Tek istisna `ad` alanı —
// o PROVIDERS registry'sinin geneli, tarihsel borçta.

/**
 * Her CLI ajanı bir asistandır ve aksi söylenene dek öyle kalır. İki belirti,
 * ikisi de gerçek çıktıda ölçüldü: terse cevap verir ("bir paragraf yaz" → tek
 * cümle) ve yazarı 3. şahıstan anlatır ("Kullanıcı şu haftalarda…") — o metin
 * doğrudan belgeye gidiyordu. O yüzden çağrı, işi baştan değiştirir. (Bu metin
 * modele gider, o yüzden Türkçe.)
 */
const WRITER_PREAMBLE =
  `Bu bir kodlama görevi ya da bir sohbet DEĞİLDİR. Sen bir asistan değil, ` +
  `metnin YAZARISIN.\n\n` +
  `- Bana cevap verme, benimle konuşma, beni anlatma.\n` +
  `- "Kullanıcı", "yazar", "siz" diye üçüncü şahıs kurma. Metnin içinden yaz.\n` +
  `- Çıktın doğrudan belgeye girecek: yalnızca metnin kendisini ver.\n` +
  `- Kısa ve öz olmaya çalışma; istenen uzunlukta, dolu bir metin yaz.\n\n`;

/**
 * The one CLI adapter. Command name, arguments and output parsing all ride in on
 * `cfg` from the provider row below — this function grows no per-agent branch.
 *
 * The length limit lives here, not in the shell capability's regex. Writing it as
 * `[\s\S]{1,20000}` there took the whole app down: Rust's regex engine builds an
 * automaton for the repetitions and blows its compile limit (see CLAUDE.md). The
 * limit is the command line's, not the model's — the prompt travels as an argv
 * entry.
 */
async function askCli(cfg, prompt, signal) {
  const { Command } = await import("@tauri-apps/plugin-shell");

  if (cfg.maxLength && prompt.length > cfg.maxLength) {
    throw new Error(
      `Metin çok uzun: ${cfg.ad} komut satırından en çok ~${cfg.maxLength} ` +
        `karakter geçebiliyor. Bu işi Ayarlar'dan API üzerinden çalışan bir modele verin.`,
    );
  }

  // Hangi adla çalıştığı denemede belli oldu (probeAgent). Bu ad, yetki
  // listesindeki kayıt adıdır — çalıştırılan gerçek program onun `cmd` alanında
  // yazar. İkisini karıştırmak "program not allowed on the configured shell
  // scope" hatası verir ve satır listede dururken hiçbir iş yapmaz.
  const aday = activeVariant(cfg);
  if (!aday) throw new Error(`${cfg.ad} için çalıştırılabilir bir komut bulunamadı.`);

  const command = Command.create(aday.name, cfg.args(cfg.model, WRITER_PREAMBLE + prompt));

  const res = await new Promise((resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("iptal", "AbortError")));
    command.execute().then(resolve, reject);
  });

  if (res.code !== 0) {
    throw new Error(res.stderr?.trim() || `${cfg.ad} ${res.code} ile çıktı.`);
  }

  // The RAW stdout goes to the parser — the adapter does not assume JSON. Claude
  // Code prints JSON and parses it; Antigravity prints plain text and takes it as
  // is. Assuming a format here is exactly the mistake the web docs made.
  return cfg.parse(res.stdout);
}

/**
 * Bu ajan bu makinede var mı, ve varsa HANGİ ADLA çalışıyor?
 *
 * İki soru tek yerde soruluyor, çünkü cevapları aynı denemeden çıkıyor.
 *
 * (1) VAR MI. KR-42 modeli olmayan işi hiç çizmiyordu; ajanlar herkese açılınca
 *     aynı kural bir üst seviyeye taşındı. Çoğu makinede bunlar kurulu değil ve
 *     çalışamayacak bir seçenek, hiç olmayandan kötüdür — söz gibi görünür.
 *
 * (2) HANGİ ADLA. Aynı araç makineden makineye farklı bir dosya olarak kurulur.
 *     Codex npm'den geliyorsa Windows'ta gerçek bir .exe değil bir sarmalayıcı
 *     bırakır (codex.cmd); resmi kurucudan geliyorsa düpedüz codex.exe olur.
 *     Tek ada bağlamak, kurulumun bir türünü sessizce dışarıda bırakmaktır —
 *     ve dışarıda kalan kullanıcı hiçbir şey göremeyeceği için sorunu bize
 *     bildiremez bile. O yüzden satır adayları sırayla dener; ilk cevap veren
 *     kazanır ve o oturum boyunca kullanılacak ad odur (`resolved`).
 *
 * Deneme, ajanın yapabileceği en ucuz şey (`--version`, ya da zaten bildiği bir
 * `models` listesi). Sonuç satır başına bir kez hesaplanır: bu soru panel
 * çizilirken soruluyor ve her çizimde süreç başlatmak gözle görülür takılma
 * demek olurdu.
 *
 * Her türlü başarısızlık — komut yok, PATH'te değil, sıfırdan farklı çıkış —
 * "kurulu değil" diye okunur. Cevap vermeyen bir ajanı listeye koymanın hiçbir
 * doğru hâli yok.
 */
const probed = new Map();

export function probeAgent(row) {
  const adaylar = row.variants ?? [];
  if (!adaylar.length) return Promise.resolve(true);
  if (probed.has(row.id)) return probed.get(row.id);

  const answer = (async () => {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const sebepler = [];

    for (const aday of adaylar) {
      try {
        const res = await Command.create(aday.probe, aday.probeArgs).execute();
        if (res.code === 0) {
          // Bundan sonrası bu adla konuşulacak: askCli de, listModels de.
          row.resolved = aday;
          return true;
        }
        sebepler.push(`${aday.probe} → çıkış ${res.code}`);
      } catch (error) {
        sebepler.push(`${aday.probe} → ${error}`);
      }
    }

    // Gizlenen satır sebebini bir yere yazmalı, yoksa "neden listede yok?"
    // sorusunun hiçbir cevabı olmaz. console.WARN, error değil: ajanın kurulu
    // olmaması çoğu makinede beklenen durumdur ve index.html'deki kırmızı bant
    // çökmeler içindir, hiç temizlenmez.
    console.warn(
      `ai-cli: ${row.ad} yanıt vermedi, satır gizlendi. Kuruluysa iki şeye bak: ` +
        `yetki Rust ikilisine gömülüdür (yeni komut eklendiyse uygulamayı yeniden ` +
        `başlat), ve komut uygulamanın gördüğü PATH'te olmalı. Denenenler: ` +
        sebepler.join(" · "),
    );
    return false;
  })();

  probed.set(row.id, answer);
  return answer;
}

/** Bu satırın şu an geçerli adı — deneme kazananı, yoksa ilk aday. */
const activeVariant = (row) => row.resolved ?? row.variants?.[0] ?? null;

/**
 * Codex'in kullanabildiği modeller.
 *
 * Codex model listeleyen bir komut sunmuyor, ama kendi indirdiği listeyi
 * `~/.codex/models_cache.json`'a yazıyor — biz de oradan okuyoruz. Elle liste
 * tutmanın alternatifi şuydu: kullanıcının hesabında olmayan bir model adını
 * ona seçtirmek ve 400 ile karşılaştırmak.
 *
 * `visibility` "list" olmayanlar elenir, sıra `priority` — Codex'in kendi
 * sıralaması, yani varsayılan model başa gelir.
 *
 * Bir de AYNI MODELİN İKİ ADI var: Codex'in kod incelemesi için kullandığı
 * satır, gerçek bir modelin görünen adını taşıyor (`codex-auto-review` →
 * "GPT-5.6-Terra"). İkisini birden göstermek, listede aynı ada sahip iki satır
 * demek — hangisinin ne olduğu okunamaz. Görünen ad başına tek satır bırakılır
 * ve kendi adını söyleyen slug kazanır: `gpt-5.6-terra` "GPT-5.6-Terra"nın
 * küçük harflisidir, `codex-auto-review` değildir.
 *
 * Dosya yoksa, okunamıyorsa ya da şekli değiştiyse boş döner; çağıran taraf
 * (connectionModels) sabit listeye düşer. Bu dosya Codex'in iç yapısıdır ve
 * bir gün değişebilir — o yüzden yedeksiz güvenilmez.
 */
async function codexModels() {
  const [{ readTextFile }, { homeDir, join }] = await Promise.all([
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ]);

  const path = await join(await homeDir(), ".codex", "models_cache.json");
  const data = JSON.parse(await readTextFile(path));
  if (!Array.isArray(data?.models)) return [];

  const bySira = data.models
    .filter((m) => m?.visibility === "list" && typeof m.slug === "string")
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

  // Map ekleme sırasını korur: sonradan gelen daha iyi slug, satırın YERİNİ
  // değil yalnız değerini değiştirir.
  const tek = new Map();
  for (const m of bySira) {
    const ad = (m.display_name ?? m.slug).toLowerCase();
    if (!tek.has(ad) || m.slug.toLowerCase() === ad) tek.set(ad, m.slug);
  }
  return [...tek.values()];
}

/**
 * Runs a CLI's own `models` command and returns the lines as model ids. This is
 * how a CLI provider joins the live-list world the API providers already live in
 * (connectionModels calls `fetchModels` when a row has one): a new model over
 * there needs no edit here.
 */
async function listModels(bin, args, name) {
  const { Command } = await import("@tauri-apps/plugin-shell");
  const res = await Command.create(name, args).execute();
  if (res.code !== 0) {
    throw new Error(res.stderr?.trim() || `${bin} ${res.code} ile çıktı.`);
  }
  return res.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The CLI providers. Each carries everything the generic adapter needs: the
 * command, an argv builder, a maximum length, an output parser tuned to that
 * agent's shape, and either a fixed model list or a live `fetchModels`.
 */
export const providers = [
  {
    id: "claude-cli",
    ad: "Claude Code",
    anahtarli: false,
    protokol: "cli",
    // Tek aday: claude gerçek bir .exe olarak kurulur.
    variants: [{ name: "claude", probe: "claude-version", probeArgs: ["--version"] }],
    // Not local (the wire goes out) and not metered by the token: what this
    // costs comes off a subscription. The card and the warning both say so.
    abonelik: true,
    maxLength: 20000,
    fixedModels: [
      "opus",
      "sonnet",
      "haiku",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
    ],
    // `--allowedTools ""` keeps it from dragging the whole coding agent along:
    // 6.6¢ → 1.2¢ a paragraph, measured (CLAUDE.md).
    args: (model, prompt) => [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--allowedTools",
      "",
      "--model",
      model,
    ],
    parse: (stdout) => {
      let data;
      try {
        data = JSON.parse(stdout);
      } catch {
        throw new Error("Claude CLI beklenmedik bir çıktı verdi.");
      }
      if (data.is_error) throw new Error(data.result ?? "Claude CLI hata döndürdü.");
      const usage = data.usage ?? {};
      return {
        metin: data.result ?? "",
        kullanim: {
          giren:
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          cikan: usage.output_tokens ?? 0,
          // Quota out of the subscription, not money out of pocket. Shown anyway.
          bedel: data.total_cost_usd ?? null,
        },
      };
    },
  },

  // Antigravity — gerçek çıktılarla DOĞRULANDI (17 Tem 2026, Zafer). Web'in
  // verdiği --output-format/--headless/--approve bayrakları YANLIŞTI, agy'de yok.
  // Gerçek: `-p` (print, non-interactive) + `--model`. Çıktı JSON değil DÜZ METİN,
  // banner/log gürültüsü olmadan sadece cevap — `stdout.trim()` yeter. Model
  // listesi artık CANLI: `agy models` çalıştırılır, fixedModels yalnız yedek.
  {
    id: "antigravity",
    ad: "Antigravity",
    anahtarli: false,
    protokol: "cli",
    // agy'nin --version'ı yok; en ucuz işi model listesi ve o kayıt zaten var.
    variants: [{ name: "agy", probe: "agy-models", probeArgs: ["models"] }],
    abonelik: true,
    maxLength: 20000,
    // Live from `agy models`; falls back to the fixed list if the command fails.
    // The `agy-models` name maps to its own entry in cli-local.json (args differ,
    // so it needs a separate allow rule).
    fetchModels: () => listModels("agy", ["models"], "agy-models"),
    fixedModels: [
      "Gemini 3.5 Flash (Medium)",
      "Gemini 3.5 Flash (High)",
      "Gemini 3.5 Flash (Low)",
      "Gemini 3.1 Pro (Low)",
      "Gemini 3.1 Pro (High)",
      "Claude Sonnet 4.6 (Thinking)",
      "Claude Opus 4.6 (Thinking)",
      "GPT-OSS 120B (Medium)",
    ],
    // Minimal ve güvenli: sadece prompt + model. `--dangerously-skip-permissions`
    // BİLEREK yok — o araçları AÇAR; biz saf metin istiyoruz. Doğrulandı: model
    // yazma promptuna araç kullanmadan düz cevap veriyor, takılma yok.
    //
    // MODEL ADINA TIRNAK EKLEME. Adlar boşluklu ("Gemini 3.5 Flash (Medium)").
    // Terminalde `--model Gemini 3.5…` boşluktan bölünür ve tırnak gerekir; ama
    // burası argv dizisidir, shell yoktur — model TEK eleman olarak OS'a gider ve
    // Windows'ta Tauri onu kendisi tırnaklar. Elle `"..."` eklemek çift-tırnak
    // yapıp adı bozar. (Zafer'in terminal denemesi bu ayrımı ortaya çıkardı.)
    //
    // `--sandbox` ve `--disable-slash-commands` (3 Ağu 2026): agy'de Claude
    // Code'un `--allowedTools ""`ünün karşılığı YOK (`agy --help` ile bakıldı);
    // bu ikisi eldeki en yakın kapı. Neden gerekli: modele giden metin
    // kullanıcının yazdığı bir şey olmak zorunda değil — bir PDF'ten alınmış
    // pasaj da olabilir ve o pasajın içinde ajana yazılmış talimatlar
    // bulunabilir. Araçları kapalı bir ajan o talimatı okur ve hiçbir şey
    // yapamaz; açık olan, kullanıcının dosyalarında dolaşabilir.
    // `--disable-slash-commands` aynı sebeple: gelen metindeki `/komut` bir
    // beceriye açılmasın.
    args: (model, prompt) => [
      "-p",
      prompt,
      "--model",
      model,
      "--sandbox",
      "--disable-slash-commands",
    ],
    // Düz metin, çıktının kendisi cevaptır. agy token sayısı vermez → kullanım
    // yok (kart token satırını göstermez, claude-cli'deki bedel gibi değil).
    parse: (stdout) => ({ metin: stdout.trim(), kullanim: null }),
  },

  // Codex CLI — gerçek çıktıyla DOĞRULANDI (3 Ağu 2026, codex-cli 0.146.0).
  // Ölçülenler: `codex exec` non-interactive kapı; `--json` JSONL olay akışı
  // verir ve cevabı `item.completed`/`agent_message` taşır; `--version` exit 0
  // ile sürüm basar (probe için yeter); geçersiz model `turn.failed` doğurur.
  {
    id: "codex-cli",
    ad: "Codex",
    anahtarli: false,
    protokol: "cli",
    // YALNIZ GERÇEK .exe (Zafer, 3 Ağu). npm'den kurulan Codex Windows'ta bir
    // .cmd sarmalayıcısı bırakır ve o yol denendi, çalışmıyor: Rust bir batch
    // dosyasına satır sonu içeren argüman geçirmeyi reddediyor
    // ("batch file arguments are invalid" — CVE-2024-24576'nın yaması). Bizim
    // gönderdiğimiz her şey çok satırlı, yani sarmalayıcı üzerinden HİÇBİR iş
    // yapılamaz.
    //
    // Denenip bırakılan iki kaçamak, ikisi de daha kötüydü: prompt'u geçici bir
    // dosyaya yazıp ajana okutmak (çalıştı, ama her istekte diske yazma + ajanın
    // fazladan bir okuma turu) ve stdin'den beslemek (Tauri'de stdin'i kapatma
    // yolu yok, süreç EOF bekleyip asılıyor).
    //
    // Sonuç: .exe yoksa satır hiç görünmez — KR-42'nin dediği bu. Yarım çalışan
    // bir satır, hiç olmayandan kötüdür.
    variants: [{ name: "codex", probe: "codex-version", probeArgs: ["--version"] }],
    abonelik: true,
    maxLength: 20000,
    // Model listesi CANLI ama komuttan değil: Codex'in model listeleme komutu
    // yok, buna karşılık kendi indirdiği listeyi `~/.codex/models_cache.json`'a
    // yazıyor. Elle bir liste tutmak, kullanıcının hesabında olmayan bir adı
    // ona 400 olarak göstermek demekti; dosyayı okumak ise onun gerçekten
    // erişebildiği modelleri veriyor. Dosya yoksa/bozuksa sabit listeye düşer
    // (agy'deki desenin aynısı).
    fetchModels: codexModels,
    fixedModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4"],
    //
    // Bayrakların her biri bir şeyi kapatıyor ve hiçbiri süs değil:
    //   --json              çıktı ayrıştırılabilir olsun (banner + cevabın iki
    //                       kez basıldığı düz metni okumak kırılgandı).
    //   -s read-only        modelin ürettiği kabuk komutları yazamasın. Codex'te
    //                       araçları tamamen kapatan bir bayrak yok; en dar
    //                       politika bu. Okuma kalıyor — bu yüzden çalışma kökü
    //                       de daraltılmalı (aşağıda -C).
    //   --ignore-user-config  kullanıcının `config.toml`'u isteğe binmesin.
    //   --ignore-rules      proje/kullanıcı `.rules` dosyaları da öyle. (Aynı
    //                       tuzağın Claude Code'daki hali CLAUDE.md'de kayıtlı:
    //                       ajan çalışma dizininden yukarı doğru talimat arar.)
    //   --ephemeral         oturum dosyası diske yazılmasın; bu bir sohbet değil.
    //   --skip-git-repo-check  belge bir git deposunda olmak zorunda değil.
    //   --color never       ANSI kaçışları JSON'a bulaşmasın.
    args: (model, prompt) => [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "-s",
      "read-only",
      "--color",
      "never",
      "-m",
      model,
      prompt,
    ],
    /**
     * JSONL: her satır bir olay. Bizi ilgilendiren iki tanesi — ajanın mesajı
     * ve turun kullanımı. Satır satır okunur, çünkü akışın başında JSON olmayan
     * satırlar da var ("Reading additional input from stdin…") ve tek bir
     * `JSON.parse(stdout)` onlara çarpıp her cevabı düşürürdü.
     *
     * Son `agent_message` kazanır: ajan ara mesaj üretebilir, sonuncusu cevaptır.
     *
     * Hata olayı sessizce geçilmez. `item.completed`/`error` yalnızca bir uyarı
     * olabilir (bilinmeyen model için "fallback metadata" der ve devam eder);
     * turu gerçekten düşüren `turn.failed`'dır — ayrımı korumak, uyarıyı hata
     * diye göstermemek için.
     */
    parse: (stdout) => {
      let metin = "";
      let kullanim = null;
      let hata = null;

      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;

        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          metin = event.item.text ?? "";
        } else if (event.type === "turn.completed" && event.usage) {
          kullanim = {
            giren: (event.usage.input_tokens ?? 0) + (event.usage.cached_input_tokens ?? 0),
            cikan: event.usage.output_tokens ?? 0,
            // Abonelikten düşer, cepten değil — kart bedel satırı göstermez.
            bedel: null,
          };
        } else if (event.type === "turn.failed") {
          hata = event.error?.message ?? "";
        }
      }

      if (!metin) {
        throw new Error(readCodexError(hata) || "Codex boş cevap verdi.");
      }
      return { metin, kullanim };
    },
  },
];

/**
 * Codex, sağlayıcının hata gövdesini bir JSON dizesi olarak kendi hata alanının
 * İÇİNE koyar. Kullanıcıya `{"type":"error","status":400,…}` göstermek, hatayı
 * hiç göstermemekten iyi değildir: içindeki cümle okunur, çıkmazsa ham hâli
 * verilir — tahmin edilmiş bir mesajla değiştirilmez (B-26'nın dersi: 401
 * dışında gövdeyi körlemesine yorumlama).
 */
function readCodexError(raw) {
  if (!raw) return "";
  try {
    const inner = JSON.parse(raw);
    return inner?.error?.message ?? raw;
  } catch {
    return raw;
  }
}

/** The protocol → adapter entry the core merges into its dispatch table. */
export const adapters = { cli: askCli };
