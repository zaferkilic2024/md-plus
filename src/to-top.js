// Back to the top — one button, both kinds of surface.
//
// It floats OVER the body rather than living in a row: a control that appears
// and disappears must not push anything sideways (KR-64's reason), and here it
// pushes nothing at all. It is born on the way down and gone at the top, which
// is the one place where it would be a lie.
//
// Deliberately not a row of navigation: this is a long document's one gesture,
// not a scrollbar with opinions.

import { t } from "./i18n.js";

/** How far down before it is worth offering. Roughly a screen and a half — far
    enough that scrolling back by hand is a job, near enough to be there when it
    becomes one. */
const SHOW_AFTER = 900;

const ARROW = '<path d="M12 20V5"/><path d="M5.5 11.5L12 5l6.5 6.5"/>';

/**
 * @param host     the tab's box — the button is positioned against it
 * @param scroller the element that actually scrolls
 * @param toTop    what "the top" means for this surface (a PDF goes to page 1,
 *                 so that its counter and its saved place follow along)
 * @param dark     over a PDF's grey table rather than paper
 */
export function attachToTop({ host, scroller, toTop, dark = false }) {
  const button = document.createElement("button");
  button.className = dark ? "to-top dark" : "to-top";
  button.title = t("doc.toTop");
  button.hidden = true;
  button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ARROW}</svg>`;
  button.onclick = () => toTop();
  host.append(button);

  const sync = () => {
    button.hidden = scroller.scrollTop < SHOW_AFTER;
  };
  scroller.addEventListener("scroll", sync, { passive: true });
  sync();

  return {
    sync,
    destroy: () => {
      scroller.removeEventListener("scroll", sync);
      button.remove();
    },
  };
}
