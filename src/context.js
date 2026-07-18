// The app's one mode flag: are we in the tabs, or inside Aktarma?
//
// Until 18 Tem every component derived this for itself — the palette from the
// `editable` facet, the strip from a `face` field, the search box from nothing
// at all — and each derivation broke in its own way (B-18: the palette opened
// on Aktarma's *target*, which is editable; B-22: a search box opened in
// Aktarma survived the trip back to the tabs). One source now: Transfer sets
// it on the way in and out, everyone else only reads.

let mode = "sekme";

/** @returns {"sekme" | "aktarma"} */
export const appMode = () => mode;

/** Transfer's to call, nobody else's. */
export const setAppMode = (next) => {
  mode = next;
};
