<div align="center">

# MD Plus

### Yazın, okuyun, düzenleyin. Hepsi tek pencerede.

Markdown'ın gücü, işaretlerin ötesinde. Sadece içeriğe odaklanın.

**[English](README.en.md)** · Türkçe

</div>

MD Plus, birden çok `.md` dosyasını sekmelerde açan, çevrimdışı bir masaüstü
Markdown uygulamasıdır. Her sekme hem okunur hem yazılır; biçim metnin üstünde
durur, ayrı bir önizleme yoktur.

Yazdığınız her şey standart Markdown'dır; uygulamaya özel hiçbir şey `.md`
dosyanızın içine girmez. İşaretleriniz ve yorumlarınız da belgenin yanına değil,
uygulamanın kendi klasörüne yazılır — dosyanızı başka bir editörde açtığınızda
karşınıza kendi metninizden başkası çıkmaz.

---

## Beş temel

### Çok sekmeli çalışma

Bütün belgeleriniz tek pencerede, sekme sekme elinizin altında. Sekmeler
sürükle-bırak sıralanır ve kendiliğinden kaydedilir; kayıt önce geçici bir
dosyaya yazılıp yerine taşınır, yani yarıda kalan bir yazma belgenize
dokunamaz. Biçim, metni seçince açılan **yüzen paletten** ve kısayollardan
verilir: kalın, italik, başlık, liste, alıntı, kod, callout, görsel, link.

### İşaretle ve yorumla

Önemli yerleri işaretleyin, kenarına not düşün. Notlarınız kenarda durur,
belgenize karışmaz. İşaretin tuttuğu şey bir konum değil **metnin kendisidir**:
dosya dışarıdan değişse de işaret kendini yeniden bağlar, bağlanamazsa silinmez
— çözülmemiş olur. Belgeyi başka bir klasöre taşısanız da notlarınız onu bulur.

### Belgeler arası aktarma

Seçtiğiniz metni öteki belgeye geçirin. **Aktarma** sekmelerin üstünde tam bir
katman açar: solda kaynak, sağda hedef. İşaretler arasında dolaşır, seçtiğinizi
**Taşı** ile gönderirsiniz. Metin karşıya alıntı olarak iner ve yanında tek bir
`🔗` künyesi taşır — tıklayınca kaynağın tam o yerine dönersiniz
(`belge.md#başlık`, `kitap.pdf#page=12`).

### PDF'ler de burada

PDF açılır, okunur, işaretlenir, yorumlanır; seçtiğiniz metin `.md` belgenize
geçer. Geçerken de toparlanır: satır sonları birleşir, tireyle bölünmüş
kelimeler kaynaşır, paragraflar ve listeler sayfadaki yerleşiminden tanınır. İki
sütunlu bir sayfa doğru sırayla okunur. PDF'e yazılmaz, PDF'e dönüştürülmez.

### Yapay zekâ, isterseniz

Metni toparlasın, kelimelere ilham versin. Kalem yine sizde. İsteğe bağlı katman
belge satırından, paletten ve sağ tıktan çalışır; **çıktı, işlediğiniz metnin
dilinde gelir**. İşler: akıcı alternatif · tamamlayıcı paragraf · yazım ve
noktalama · bilgi denetimi · kaynak önerisi · özet · başlık · spot cümle ·
çeviri. Son beşi yalnız okunur, belgeye giremez.

**Zaten ödediğiniz aboneliği kullanın.** Claude Code, Antigravity ya da Codex
kuruluysa MD Plus onları doğrudan çalıştırır: ikinci bir anahtar almanıza,
jeton başına ödeme yapmanıza gerek yoktur. Kurulu değillerse listede hiç
görünmezler.

Klasik sağlayıcılar da var: Gemini, Claude, OpenAI, OpenRouter, NVIDIA, Groq,
DeepSeek, yerel **Ollama** ve OpenAI-uyumlu herhangi bir servis (kendi adresinizi
girerek). Anahtarlarınız işletim sisteminin kasasında saklanır, ayar dosyasına
yazılmaz. Varsayılan **kapalı**: hiçbir model bağlı değilken uygulama tam olarak
yapay zekâsız hâlidir.

---

## Dahası

- **Görsel** — panodan yapıştırın ya da sürükleyin; belgenin kendi klasörüne
  kopyalanır (`tez.md` → `tez.images/`) ve satır içinde görünür. Belgeyi
  paylaşırken yanına neyi alacağınız adından bellidir.
- **Formül** — `$...$` ile yazılan LaTeX, KaTeX ile dizilir.
- **PDF ve yazdırma** — belge A4'e basılır; işaret ve yorumlar çıktıya girmez.
- **Bul ve değiştir** — `Ctrl+F` / `Ctrl+H`, Türkçe'nin büyük/küçük harflerini
  doğru katlayarak. Arama işaretlerin içinde de yapılabilir, PDF'te de çalışır.
- **Gömülü belge** — bir `.md` linkinin içeriğini yerinde, salt okunur açar.
- **Dış değişiklik** — dosyanız başka bir yerde değiştiyse haber verir;
  kaydedilmemiş yazınız varsa kararı size bırakır.
- **Son açılanlar**, **içindekiler**, işaret listesi, link takibi ve geri dönüş.

## İki dil

Arayüz **Türkçe ve İngilizce**. Açılışta işletim sisteminizin diline uyar,
Ayarlar'dan değiştirilir. Yapay zekâ çıktısı ise arayüzden bağımsız olarak
**metnin diline** göre gelir.

## Yığın

[Tauri 2](https://tauri.app/) (Rust kabuk) + [Vite](https://vitejs.dev/) +
[CodeMirror 6](https://codemirror.net/) + [pdf.js](https://mozilla.github.io/pdf.js/) +
[KaTeX](https://katex.org/) + [marked](https://marked.js.org/).
Bağımsız `.exe` ~19 MB.

## Geliştirme

```bash
npm install
npm run app        # geliştirme (canlı yenileme)
npm run app:build  # bağımsız exe + MSI (src-tauri/target/release/)
npm test           # birim sınavları
```

## Nasıl üretildi

Bu proje **vibe coding** ile yazıldı: ürün fikri, tasarım kararları, isterler ve
yön tamamen **repo sahibine (Zafer Kılıç)** aittir; **kodun tamamı yapay zekâ
tarafından** onun yönlendirmesiyle yazılmıştır. Yani insan neyi ve nasıl
istediğini belirledi, kodu makine yazdı.

## Lisans

[MIT](LICENSE) © Zafer Kılıç
