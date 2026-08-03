// The middle of the document row: the jobs that belong to THIS KIND of document.
//
// The row's two ends are fixed — where you are and how to get around on the
// left, search and ⋯ on the right — and between them sits whatever the document
// in front can actually do. A .md is written and printed and summarised; a PDF
// is scaled and paged through. Neither list is greyed out on the other's turn:
// it simply is not there (KR-42, applied to a kind of document rather than to a
// model).
//
// Reading size is NOT here. Zooming a PDF is an act — the paper gets bigger —
// while reading size is a setting: it belongs to the reader, not to the
// document, and it lives in Ayarlar → Okuma (Zafer, 2 Ağu: "md'de A'nın ne işi
// var? orada zoom yok").

import { documentJobs, jobName, jobShortcut, provider } from "./ai.js";
import { GLYPH, icon } from "./strip.js";
import { goster } from "./shortcuts.js";
import { t } from "./i18n.js";

/** The magnifier with a sign in it. The empty glass is search's and only
    search's; these two are the same glass carrying what they do to the page. */
const ZOOM = {
  out: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M19.5 19.5l-4.3-4.3"/><path d="M7.8 10.5h5.4"/>',
  in: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M19.5 19.5l-4.3-4.3"/><path d="M7.8 10.5h5.4M10.5 7.8v5.4"/>',
};

/**
 * As wide as the window will take it: two walls, and the page pushing out to
 * meet them. Not the four corner-arrows (those read as "full screen") and not a
 * medallion (a round frame says nothing about width) — the drawing has to say
 * "out to the edges", because that is the whole of what it does.
 */
const FIT =
  '<path d="M3.5 5.5v13M20.5 5.5v13"/><path d="M10 8.5L6.5 12l3.5 3.5M14 8.5l3.5 3.5-3.5 3.5"/>';

/** Pages run DOWN a PDF, so their arrows point up and down. Marks run along a
    list, so theirs point left and right (‹ ›). Two different journeys cannot
    wear one drawing. */
const PAGE = {
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};

function toolButton(glyph, title, onClick) {
  const button = document.createElement("button");
  button.className = "tool";
  button.title = title;
  button.innerHTML = icon(glyph, 19);
  button.onclick = onClick;
  return button;
}

function separator() {
  const line = document.createElement("div");
  line.className = "doc-sep";
  return line;
}

export function createDocTools({ activeTab, onCommand }) {
  const dom = document.createElement("div");
  dom.className = "doc-tools";

  /** The page counter, and the way to any page: a number you can type over. */
  let counter = null;

  const build = () => {
    dom.replaceChildren();
    counter = null;
    const tab = activeTab();
    if (!tab) return;

    if (tab.kind === "pdf") {
      buildPdf(tab);
      return;
    }
    buildDocument(tab);
  };

  /** Aktarma, on the row rather than buried in ⋯. Both kinds of document get
      it: a PDF goes in on the left, to be read from (KR-68). */
  const transferButton = () =>
    toolButton(GLYPH.transfer, `${t("menu.transfer")} · Ctrl+Shift+A`, () =>
      onCommand("transfer"),
    );

  const buildPdf = (tab) => {
    const pdf = tab.pdf;
    if (!pdf) return;

    dom.append(transferButton(), separator());
    const fit = toolButton(FIT, t("doc.fit"), () => {
      pdf.fitToScreen();
      showFit();
    });
    const showFit = () => {
      fit.classList.toggle("on", pdf.fitted);
      fit.title = pdf.fitted ? t("doc.fitBack") : t("doc.fit");
    };
    showFit();

    dom.append(
      toolButton(ZOOM.out, t("doc.zoomOut"), () => {
        pdf.zoomOut();
        showFit();
      }),
      toolButton(ZOOM.in, t("doc.zoomIn"), () => {
        pdf.zoomIn();
        showFit();
      }),
      fit,
      separator(),
      // ˄ ˅ then the page you are on, writable, then how many there are.
      // The number used to be a button that turned into a field when pressed,
      // which hid behind a click the one thing on this row that can be typed.
      // It is a field from the start; the total beside it is not — there is
      // nothing to decide about it.
      toolButton(PAGE.up, t("doc.pageUp"), () => pdf.goTo(Math.max(1, pdf.page - 1))),
      toolButton(PAGE.down, t("doc.pageDown"), () =>
        pdf.goTo(Math.min(pdf.pageCount, pdf.page + 1)),
      ),
    );

    counter = document.createElement("input");
    counter.className = "page-field";
    counter.title = t("doc.goToPage");
    counter.onkeydown = (event) => {
      if (event.key === "Enter") {
        const n = Number.parseInt(counter.value, 10);
        if (Number.isFinite(n)) pdf.goTo(Math.min(Math.max(1, n), pdf.pageCount));
        counter.blur();
      } else if (event.key === "Escape") {
        counter.value = String(pdf.page);
        counter.blur();
      }
      // The row is not the document: the field's own keys stay in the field.
      event.stopPropagation();
    };
    counter.onfocus = () => counter.select();
    // Left mid-edit, it goes back to saying where the reader actually is.
    counter.onblur = () => {
      counter.value = String(pdf.page);
    };

    const total = document.createElement("span");
    total.className = "page-total";
    dom.append(counter, total);
    setPage(pdf.page, pdf.pageCount);
  };

  const buildDocument = (tab) => {
    dom.append(
      transferButton(),
      separator(),
      toolButton(GLYPH.printer, `${t("menu.print")} · Ctrl+P`, () => onCommand("printPaper")),
    );

    // The document-wide AI jobs — the ones the ⋯ menu carries. Not greyed when
    // no model is routed to them: absent, like everywhere else (KR-42).
    const jobs = documentJobs().filter((job) => provider(job) && GLYPH[job]);
    if (!jobs.length) return;

    dom.append(separator());
    for (const job of jobs) {
      const key = jobShortcut(job);
      dom.append(
        toolButton(
          GLYPH[job],
          key ? `${jobName(job)} · ${goster(key)}` : jobName(job),
          () => onCommand(job),
        ),
      );
    }
    void tab;
  };

  /**
   * Called as the reader scrolls — the field follows without a rebuild. Never
   * while it is being typed into: the reader is in the middle of saying where
   * they want to go, and the scroll behind them is not an argument.
   */
  const setPage = (page, count) => {
    if (!counter) return;
    if (document.activeElement !== counter) counter.value = String(page);
    const total = counter.nextElementSibling;
    if (total) total.textContent = `/ ${count}`;
  };

  build();
  return { dom, refresh: build, setPage };
}
