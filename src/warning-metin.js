// The one warning's SENTENCE — pure, and deliberately alone in this file.
//
// It lives apart from warning.js because warning.js imports ai.js (for the live
// provider list and the DOM note). That import used to be fatal under Node —
// ai.js loaded its optional local module through Vite's `import.meta.glob`, a
// form Node does not have — so a test that only wanted to check the wording
// pulled in a Vite-only chain and crashed.
//
// That particular chain is gone (3 Ağu 2026: the CLI agents ship normally, so
// the glob went with them, and ai.js does import under Node today). The split
// stays, and not out of inertia: the wording is a function of a list of
// gateways and nothing else, which is exactly what makes it testable — and
// ai.js is one Tauri-only import away from being unloadable again, at which
// point the sentence would go down with it. A pure thing kept pure.

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
  // Two ways a model can cost something, and they are not the same thing to say.
  // A metered API bills the card; a CLI agent spends a subscription that is
  // already paid for. Both can be true at once — one job on an API key, another
  // on an installed agent — so neither replaces the other.
  const ucret =
    (gateways.some((each) => each.ucretli) ? t("warn.cost") : "") +
    (gateways.some((each) => each.abonelik) ? t("warn.subscription") : "");
  return `${nereye}${ucret}${t("warn.tail")}`;
}
