import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Tauri kabuğu build çıktısını buradan okur.
  build: { outDir: "dist", target: "chrome110", emptyOutDir: true },
});
