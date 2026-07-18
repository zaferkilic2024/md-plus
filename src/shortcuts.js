// The one place shortcuts are described for the reader (shown in Settings).
//
// Today this list is documentation: the actual bindings live in main.js (the
// window-level shortcuts) and surface.js (the editor keymap). Keeping the two in
// step is done by hand — when you add or change a binding there, add it here.
//
// Making THIS list the binding source too — so a shortcut can be rebound from
// Settings — is a larger change (a central registry both handlers read from,
// plus conflict handling). It is parked in YAPILACAKLAR.
//
// The AI job shortcuts are not repeated here: they are defined once, next to the
// jobs in ai.js, and pulled in below — so a job's key is written in a single
// place and both the keymap and this list agree by construction.

import { jobShortcuts } from "./ai.js";

/**
 * CM's key form ("Alt-a") to the reader's form ("Alt+A").
 *
 * The single letter is upper-cased. It used to be a plain `-`→`+` swap, so the
 * AI jobs read "Alt+a" while every hand-written key beside them read "Ctrl+O" —
 * the comment above this line has claimed "Alt+A" since the day it was written.
 * A shortcut is a key on a keyboard, and the keys are engraved in capitals.
 */
export const goster = (kisayol) =>
  kisayol
    .split("-")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join("+");

export function shortcutGroups() {
  return [
    {
      baslik: "Belge",
      kisayollar: [
        { tus: "Ctrl+O", ad: "Belge aç" },
        { tus: "Ctrl+N", ad: "Yeni belge" },
        { tus: "Ctrl+S", ad: "Kaydet" },
        { tus: "Ctrl+Shift+S", ad: "Farklı kaydet" },
        { tus: "Ctrl+W", ad: "Sekmeyi kapat" },
        { tus: "Ctrl+P", ad: "Yazdır" },
        { tus: "Ctrl+Shift+P", ad: "PDF olarak kaydet" },
        { tus: "Ctrl+F", ad: "Belgede ara" },
        { tus: "Ctrl+H", ad: "Bul ve değiştir" },
        { tus: "Ctrl+1 … 9", ad: "Sekmeye geç" },
        { tus: "Alt+←", ad: "Geri (takip edilen linkten dön)" },
      ],
    },
    {
      baslik: "Biçim",
      kisayollar: [
        { tus: "Ctrl+B", ad: "Kalın" },
        { tus: "Ctrl+I", ad: "İtalik" },
        { tus: "Ctrl+E", ad: "Kod" },
        { tus: "Ctrl+Alt+1 / 2 / 3", ad: "Başlık" },
        { tus: "Ctrl+Alt+0", ad: "Paragraf" },
        { tus: "Ctrl+Shift+L", ad: "Liste" },
        { tus: "Ctrl+Shift+Q", ad: "Alıntı" },
      ],
    },
    {
      baslik: "İşaret",
      kisayollar: [
        { tus: "Ctrl+Enter", ad: "Seçimi işaretle" },
        { tus: "F8 / Shift+F8", ad: "Sonraki / önceki işarete git" },
        { tus: "Ctrl+Shift+A", ad: "İşaretleri taşı ekranını aç / kapat" },
      ],
    },
    {
      baslik: "Palet ve yapay zekâ",
      kisayollar: [
        { tus: "Alt+P", ad: "Yüzen paleti gizle / getir" },
        ...jobShortcuts().map(({ kisayol, ad }) => ({
          tus: goster(kisayol),
          ad: `Öneri: ${ad}`,
        })),
      ],
    },
  ];
}
