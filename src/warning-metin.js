// The one warning's SENTENCE — pure, and deliberately alone in this file.
//
// It lives apart from warning.js because warning.js imports ai.js (for the live
// provider list and the DOM note), and ai.js uses Vite's `import.meta.glob` to
// load an optional local providers module — which does not exist under Node. So a test that
// imported warning.js just to check the wording pulled the whole Vite-only chain
// in and crashed. The wording has no need of any of that: it is a function of a
// list of gateways, nothing more. Kept here, `test/uyari.test.mjs` reaches it
// without touching ai.js.

import { t } from "./i18n.js";

/**
 * The true sentence for the models routed right now (KR-47, KR-53).
 *
 * This is the one string in the app that must not be able to lie, so it is
 * examined at a terminal, not by eye. A local model on 127.0.0.1 sends nothing
 * anywhere; telling that writer "your text goes to the provider" would be the
 * app lying about itself. "Model uydurabilir" is the only clause with no
 * condition — true of every model, local or remote, free or paid, and the one
 * that costs a writer the most (KR-49).
 *
 * `gateways` is required; the default (the currently routed providers) lives in
 * warning.js, which is the only place that knows about live providers.
 */
export function warningText(gateways) {
  const nereye = gateways.some((each) => each.agaCikar)
    ? t("warn.remote")
    : t("warn.local");
  const ucret = gateways.some((each) => each.ucretli) ? t("warn.cost") : "";
  return `${nereye}${ucret}${t("warn.tail")}`;
}
