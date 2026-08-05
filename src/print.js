// Printing to PDF (UC-11).
//
// The editor cannot be printed directly: CodeMirror only puts the visible lines
// in the DOM, so half the document would be missing from the page. The document
// is therefore typeset once more, whole, into a plain printable sheet.
//
// What goes on the page is the document and nothing else (UC-11-K1): no tab
// strip, no palette, no marks, no badges, no comments, no cursor. Those live in
// the app, never in the file and never on paper.

import { marked } from "marked";
import katex from "katex";
import { convertFileSrc } from "@tauri-apps/api/core";
import { t } from "./i18n.js";

const FORMULA = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/** Formulas are typeset before Markdown runs, so it cannot mangle the LaTeX. */
function typesetFormulas(markdown) {
  return markdown.replace(FORMULA, (whole, block, inline) => {
    const source = (block ?? inline).trim();
    try {
      return katex.renderToString(source, {
        displayMode: Boolean(block),
        throwOnError: true,
        output: "html",
      });
    } catch {
      // UC-03/A1: a broken formula stays readable; it never breaks the page.
      return whole;
    }
  });
}

/** Callouts are quote blocks on disk; on paper they become their box (KR-07).
    The display label is localized; the file keeps its plain [!NOTE] either way. */
const CALLOUT_LABEL_KEYS = { NOTE: "callout.note", WARNING: "callout.warning", TIP: "callout.tip" };

function renderCallouts(html) {
  return html.replace(
    /<blockquote>\s*<p>\s*\[!(\w+)\]\s*(?:<br\s*\/?>)?\s*/gi,
    (whole, type) => {
      const key = CALLOUT_LABEL_KEYS[type.toUpperCase()];
      if (!key) return whole;
      const kind = t(key);
      return `<blockquote class="callout callout-${type.toLowerCase()}"><p class="callout-label">${kind}</p><p>`;
    },
  );
}

/**
 * Builds the printable sheet for a document.
 * @param {string} markdown the document text
 * @param {string|null} folder where it lives — images are relative to it
 */
export function renderPrintable(markdown, folder) {
  const html = marked.parse(typesetFormulas(markdown), {
    breaks: false,
    gfm: true,
  });

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = renderCallouts(html);

  // Point the images at the real files on disk (IS-04: they were never embedded).
  for (const image of sheet.querySelectorAll("img")) {
    const source = image.getAttribute("src") ?? "";
    if (folder && !/^([a-z]+:)?\//i.test(source)) {
      image.src = convertFileSrc(`${folder}/${source}`);
    }
    // UC-11/A1: a missing image leaves its alt text, not a "not found" box.
    image.onerror = () => image.replaceWith(document.createTextNode(image.alt));
  }

  return sheet;
}

/**
 * Waits for the sheet's images, so none of them prints as a hole.
 *
 * `decode()` rather than the load event: `complete` only promises the bytes
 * arrived, and the exporter needs the bitmap. Both are awaited because an image
 * that fails still has to stop being waited for — a picture nobody can read must
 * never cost the writer the PDF.
 */
function imagesReady(sheet) {
  const images = [...sheet.querySelectorAll("img")];
  if (images.length === 0) return Promise.resolve();

  return Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise((done) => {
          image.onload = done;
          image.onerror = done;
        });
      }
      await image.decode().catch(() => {});
    }),
  );
}

/**
 * UC-11: ask where it goes, then write the PDF. No print dialog, no printer to
 * choose, no "Microsoft Print to PDF" to find — the WebView renders the very
 * page it just showed and hands back a file.
 *
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
 */
/**
 * Lays the typeset sheet over the app, does something with it, and clears up.
 *
 * Both ways out of this file share it — and the sharing is the point. The heavy
 * part of printing is not the PDF, it is `renderPrintable`: the document has to
 * be typeset a second time, whole, because CodeMirror only keeps the visible
 * lines in the DOM. That sheet is the same sheet whether it ends up in a file or
 * on paper. Only the last step differs.
 */
async function onSheet(markdown, folder, use) {
  const sheet = renderPrintable(markdown, folder);

  const host = document.createElement("div");
  host.id = "print-host";
  host.append(sheet);
  document.body.append(host);
  document.body.classList.add("printing");

  try {
    await imagesReady(sheet);
    // Let the layout settle before the WebView paginates it.
    await new Promise((done) => requestAnimationFrame(() => done()));

    return await use();
  } finally {
    host.remove();
    document.body.classList.remove("printing");
  }
}

/**
 * PDF olarak kaydet — a file on disk (UC-11).
 *
 * Straight out of the WebView's own exporter (pdf.rs → PrintToPdf), never
 * through the system print dialog and its "Microsoft Print to PDF" (KR-27).
 * That is not fussiness: the printer driver is a different pipeline — the page
 * goes through GDI/XPS and comes back a different file — and it costs two
 * dialogs to reach. This one asks where it goes and writes it.
 */
export async function printDocument({ markdown, folder, title, save, toPdf }) {
  const path = await save({
    defaultPath: `${title ?? t("print.defaultName")}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return { ok: false };

  try {
    return await onSheet(markdown, folder, async () => {
      await toPdf(path);
      return { ok: true, path };
    });
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Yazdır — ink on paper (UC-11b, 17 Tem 2026).
 *
 * A different act from the one above, not a different button for it: that one
 * makes a file, this one asks a machine. KR-27 refused to *produce the PDF* by
 * way of the print dialog; it never refused paper — its own last line talks
 * about the colours "on paper".
 *
 * Here the dialog is not a detour, it is the point: which printer, how many,
 * which pages are the questions only the writer can answer.
 */
export async function printPaper({ markdown, folder }) {
  try {
    return await onSheet(markdown, folder, async () => {
      await new Promise((done) => {
        // The sheet must outlive the dialog. window.print() blocks in Chromium,
        // but afterprint is the documented end of the act — and the timeout is
        // there because a dialog nobody dismisses must not strand the sheet on
        // top of the app forever.
        const finish = () => {
          window.removeEventListener("afterprint", finish);
          clearTimeout(timer);
          done();
        };
        const timer = setTimeout(finish, 120000);
        window.addEventListener("afterprint", finish);
        window.print();
      });
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
