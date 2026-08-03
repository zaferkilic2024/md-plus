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

  const command = Command.create(cfg.command, cfg.args(cfg.model, WRITER_PREAMBLE + prompt));

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
 * Is this agent actually on the machine?
 *
 * KR-42 says a job with no model behind it is not drawn at all; the same rule
 * reaches further once CLI agents ship to everyone. Almost nobody has these
 * installed, and an option that cannot possibly work is worse than a missing
 * one — it looks like a promise. So the row is asked, once, whether its command
 * answers, and a row that does not answer never reaches the connection list.
 *
 * The probe is the cheapest thing the agent can do (`--version`, or a `models`
 * listing it already knows how to run). Its result is cached per row for the
 * session: this is asked while a panel is being drawn, and spawning a process
 * on every repaint would be paid for in visible stutter.
 *
 * Failure of any kind — command missing, PATH not carrying it, a non-zero exit —
 * reads as "not installed". There is no case where a probe that throws should
 * still put the row on screen.
 */
const probed = new Map();

export function probeAgent(row) {
  if (!row.probe) return Promise.resolve(true);
  if (probed.has(row.id)) return probed.get(row.id);

  const answer = (async () => {
    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const res = await Command.create(row.probe.name, row.probe.args).execute();
      if (res.code !== 0) {
        console.warn(`ai-cli: ${row.command} ${res.code} ile çıktı — satır gizlendi.`);
      }
      return res.code === 0;
    } catch (error) {
      // A hidden row explains itself somewhere, or "why is it not in the list?"
      // has no answer at all. console.WARN, not error: a missing agent is the
      // expected case on most machines, and the red band in index.html is for
      // crashes (it never clears). The message names the two things that are
      // actually wrong when the agent IS installed: the shell capability is
      // compiled into the Rust binary, so a newly added command needs the app
      // restarted; and the command has to be on PATH as the app sees it.
      console.warn(
        `ai-cli: ${row.command} yanıt vermedi — satır gizlendi. ` +
          `Kuruluysa: yetki Rust ikilisine gömülüdür (yeni komut = uygulamayı ` +
          `yeniden başlat), ve komut PATH'te olmalı. Sebep:`,
        error,
      );
      return false;
    }
  })();

  probed.set(row.id, answer);
  return answer;
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
    command: "claude",
    // Not local (the wire goes out) and not metered by the token: what this
    // costs comes off a subscription. The card and the warning both say so.
    abonelik: true,
    maxLength: 20000,
    // Cheapest possible "are you there" — its own entry in the shell capability,
    // because argument lists are matched whole.
    probe: { name: "claude-version", args: ["--version"] },
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
    command: "agy",
    abonelik: true,
    maxLength: 20000,
    // agy has no --version; its model listing is the cheapest thing it does,
    // and the capability entry for it already exists.
    probe: { name: "agy-models", args: ["models"] },
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
    command: "codex",
    abonelik: true,
    maxLength: 20000,
    probe: { name: "codex-version", args: ["--version"] },
    // Model listesi komutu YOK. Listede yalnız çalıştığı görülen model var —
    // "test edemediklerimizi koyma" (Zafer). Hesabın desteklemediği bir ad
    // 400 ile döner, yani uydurulan satır kullanıcıya hata olarak çıkardı.
    fixedModels: ["gpt-5.6-sol"],
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
