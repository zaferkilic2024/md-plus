import { cpSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The version, from the one file that already has to carry it. Baked in at
// build time rather than asked of Tauri at runtime: the number is the same for
// the whole life of the binary, and asking would mean a permission and an
// await for something that cannot change.
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

// pdf.js'in 14 standart PDF yazı tipi kopyası (Helvetica, Times, Courier,
// Symbol…). Bu tipler dosyaya GÖMÜLMEYEBİLİR — PDF standardı "her okuyucuda
// vardır" varsayar; tarayıcının içinde böyle bir garanti yoktur. Klasör yoksa
// o tipleri kullanan sayfa yanlış tiple çizilir; harf genişlikleri kayınca
// görünmez metin katmanı da kayar, yani SEÇİM yanlış yerden alır.
//
// node_modules'tan kopyalanır, repoya kopyalanmaz (`public/standard_fonts`
// .gitignore'da): pdfjs-dist yükseltilince dosyalar kendiliğinden tazelenir,
// elle senkron tutulacak ikinci bir kopya olmaz. Kopya yapılandırmanın
// gövdesinde — hem `dev` hem `build` bu dosyayı bir kez çalıştırır.
cpSync("node_modules/pdfjs-dist/standard_fonts", "public/standard_fonts", {
  recursive: true,
});

export default defineConfig({
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 1420, strictPort: true },
  // Tauri kabuğu build çıktısını buradan okur.
  build: { outDir: "dist", target: "chrome110", emptyOutDir: true },
});
