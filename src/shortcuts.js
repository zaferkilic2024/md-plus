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
import { t } from "./i18n.js";

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
      baslik: t("sc.group.document"),
      kisayollar: [
        { tus: "Ctrl+O", ad: t("sc.openDoc") },
        { tus: "Ctrl+N", ad: t("sc.newDoc") },
        { tus: "Ctrl+S", ad: t("sc.save") },
        { tus: "Ctrl+Shift+S", ad: t("sc.saveAs") },
        { tus: "Ctrl+W", ad: t("sc.closeTab") },
        { tus: "Ctrl+P", ad: t("sc.print") },
        { tus: "Ctrl+Shift+P", ad: t("sc.savePdf") },
        { tus: "Ctrl+F", ad: t("sc.search") },
        { tus: "Ctrl+H", ad: t("sc.replace") },
        { tus: "Ctrl+1 … 9", ad: t("sc.switchTab") },
        { tus: "Alt+←", ad: t("sc.back") },
      ],
    },
    {
      // Only ever on screen while a PDF is: these do nothing in a document, and
      // a list that says otherwise is a list that lies.
      baslik: t("sc.group.pdf"),
      kisayollar: [
        // The wheel belongs in the key column, not inside the name: every other
        // row here names an action in the same voice ("Belge aç", "Kaydet"), and
        // a parenthetical explanation in one of them makes that row read like a
        // note rather than a shortcut.
        { tus: `Ctrl+= / Ctrl+- / Ctrl+${t("sc.wheel")}`, ad: t("sc.pdfZoom") },
        { tus: "Ctrl+0", ad: t("sc.pdfZoomReset") },
      ],
    },
    {
      baslik: t("sc.group.format"),
      kisayollar: [
        { tus: "Ctrl+B", ad: t("sc.bold") },
        { tus: "Ctrl+I", ad: t("sc.italic") },
        { tus: "Ctrl+E", ad: t("sc.code") },
        { tus: "Ctrl+Alt+1 / 2 / 3", ad: t("sc.heading") },
        { tus: "Ctrl+Alt+0", ad: t("sc.paragraph") },
        { tus: "Ctrl+Shift+L", ad: t("sc.list") },
        { tus: "Ctrl+Shift+Q", ad: t("sc.quote") },
      ],
    },
    {
      baslik: t("sc.group.mark"),
      kisayollar: [
        { tus: "Ctrl+Enter", ad: t("sc.markSel") },
        { tus: "F8 / Shift+F8", ad: t("sc.travelMark") },
        { tus: "Ctrl+Shift+A", ad: t("sc.transfer") },
      ],
    },
    {
      baslik: t("sc.group.palette"),
      kisayollar: [
        { tus: "Alt+P", ad: t("sc.togglePalette") },
        ...jobShortcuts().map(({ kisayol, ad }) => ({
          tus: goster(kisayol),
          ad: t("sc.suggest", { name: ad }),
        })),
      ],
    },
  ];
}
