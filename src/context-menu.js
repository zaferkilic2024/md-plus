// The right click (29 Tem 2026, Zafer — KR-84).
//
// Until now the right button opened the WEBVIEW's menu — reload, spell check,
// things that belong to a browser and not to this app ("alakasız", Zafer, in a
// PDF as much as in a document). An app that draws its own reading surface owns
// the menu on it.
//
// WHY THIS DOES NOT DUPLICATE THE PALETTE. One verb, one place:
//
//   the palette   — what you do TO a selection, as an icon: format, mark,
//                   comment. It appears BECAUSE you selected something.
//   this menu     — the verbs that have no icon and are asked for rarely, in
//                   words. Copy, and translate.
//
// So translation is on neither the palette nor the strip (Zafer's condition) and
// is still findable — which is what a keyboard-only job was missing.
//
// "No written buttons" (16 Tem) is not broken here: a menu row is not a button
// on the surface. ⋯, İçindekiler and Son açılanlar have always been words.

import { popover } from "./chrome.js";
import { jobShortcut, languageName, provider, translationPair } from "./ai.js";
import { goster } from "./shortcuts.js";
import { t } from "./i18n.js";

/**
 * A menu at a POINT rather than under a control.
 *
 * popover() wants an anchor it can measure and ask "was the click inside you?".
 * A right click has no such element — it has a place. This is that place wearing
 * the two methods popover needs, which is cheaper and truer than teaching the
 * menu a second way to be positioned.
 */
const pointAnchor = (event) => {
  const rect = { top: event.clientY, bottom: event.clientY, left: event.clientX, right: event.clientX, width: 0, height: 0 };
  return { getBoundingClientRect: () => rect, contains: () => false };
};

/**
 * Opens the menu for a surface.
 *
 * @param {object} spec
 * @param {MouseEvent} spec.event
 * @param {string} spec.text        what is selected right now ("" if nothing)
 * @param {(job: string, options: object) => void} spec.onJob  runs an AI job
 */
export function openContextMenu({ event, text, onJob }) {
  // The webview's own menu goes, whether or not ours has anything to offer:
  // it is not this app's menu and it never was.
  event.preventDefault();

  const has = Boolean(text.trim());
  const items = [
    {
      icon: "copy",
      label: t("menu.copy"),
      key: goster("Ctrl-c"),
      disabled: !has,
      run: () => navigator.clipboard?.writeText(text),
    },
  ];

  // With no model bound the directions go pale rather than away (Zafer, 6 Aug),
  // the same as the jobs on the row and in ⋯. The pair still comes from
  // Settings, so the menu says which way it would translate once there is a
  // model to ask.
  {
    const canTranslate = Boolean(provider("translate"));
    const { from, to } = translationPair();
    items.push("-", { heading: t("ai.job.translate"), key: goster(jobShortcut("translate")) });
    // Both ways of the configured pair, so changing direction is a click and not
    // a trip to Settings. Identical languages would be one row saying nothing.
    const ways = from === to ? [[from, to]] : [[from, to], [to, from]];
    for (const [a, b] of ways) {
      items.push({
        // Drawn and marked like the other AI jobs (Zafer, 6 Aug): the row calls
        // a model, and the badge is how the app says so everywhere it happens.
        icon: "translate",
        ai: true,
        label: `${languageName(a)} → ${languageName(b)}`,
        disabled: !has || !canTranslate,
        run: () => onJob("translate", { from: a, to: b }),
      });
    }
  }

  return popover(pointAnchor(event), items);
}
