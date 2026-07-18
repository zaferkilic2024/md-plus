// The one AI warning (KR-47, KR-53).
//
// There used to be warnings everywhere: a box on the report card, a note in the
// jobs tab, a mark in the palette menu, paragraphs in Connections. They were all
// swept away on 16 Tem for one reason — a warning repeated in six places is
// wallpaper, and wallpaper is not read. This is what replaces them: one warning,
// once, in one place.
//
// The place is Settings → Yapay zekâ → İşler (Zafer, 17 Tem), directly under the
// rows that route a job to a model. The status bar was tried first and it was
// wrong: the app's most visible strip would have carried a permanent notice that
// stops being read by the third day, in an application whose whole argument is
// that the screen is paper, not furniture. And the objection to Settings — "only
// someone already in Settings would see it" — is upside down. There is no other
// way in. Nobody switches this on without standing on this exact tab, so this is
// where everyone passes, and they pass at the moment they are deciding. It is
// also not permanently open, which is the point: a warning is read when it is
// about the thing you are doing.
//
// The sentence is COMPUTED, never a fixed string, because a warning that is not
// true is worse than no warning. A local model on 127.0.0.1 sends nothing
// anywhere; telling that writer "your text goes to the provider" would be the
// app lying about itself. It appears only once a job is actually routed — before
// that this is v1 and there is nothing to warn about (KR-42).

import { anyJobEnabled, provider, reportJobs, textJobs } from "./ai.js";
import { GLYPH, icon } from "./strip.js";
import { warningText } from "./warning-metin.js";

// The wording lives in warning-metin.js (pure, ai.js-free) so a test can reach
// it without pulling in ai.js's Vite-only glob. Re-exported here for callers.
export { warningText };

/** The gateways every routed job actually answers through, right now. */
export const routedProviders = () =>
  [...textJobs(), ...reportJobs()].map((job) => provider(job)).filter(Boolean);

/**
 * The note for the İşler tab. Returns nothing at all when no job is routed:
 * an empty box saying "nothing to warn about yet" is furniture.
 */
export function aiWarningNote() {
  if (!anyJobEnabled()) return null;

  const note = document.createElement("p");
  note.className = "ai-warning-note";
  note.innerHTML = `${icon(GLYPH.warn, 13)}<span></span>`;
  note.querySelector("span").textContent = warningText(routedProviders());
  return note;
}
