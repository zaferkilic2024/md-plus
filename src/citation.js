// The source a moved piece carries with it (29 Tem 2026, Zafer — KR-81).
//
// Pure, DOM-free, Tauri-free: test/alinti.test.mjs is the whole of it.
//
// A piece that lands in another document IS a quote, and a quote whose origin is
// not written down stops being one within a week. So what lands is a blockquote,
// and its last line is where it came from — INSIDE the quote, so the two are one
// block: deleting the piece takes its provenance with it, and no edit meant for
// the one can leave the other stranded.
//
// This does not touch KR-17. What lands is still the source's own Markdown,
// unconverted, undecided-about — the quote is a wrapper that says "this came
// from somewhere else", not a reformatting of what came.
//
// The line is a LINK whose whole face is one small emoji, and what it says lives
// in the link's title. A citation printed into every paragraph is louder than
// the paragraph; the emoji is a mark in the margin of the prose, and the words
// come when you ask for them. The title is standard Markdown — no HTML (the
// portability law), shown on hover by any reader that renders titles, and by our
// own surface (inline-format.js).
//
// It is not a citation SYSTEM: one line, no footnotes, no reference list, no
// styles. That is still out of scope.

import { t } from "./i18n.js";

/**
 * The face of the citation. One glyph, so it reads as a mark and not as text.
 *
 * A sheet of paper was tried first and did not fit (Zafer, 29 Tem): it says
 * "document", which the quote above it already said. The link says the thing the
 * glyph is actually for — there is somewhere else, and this is the way to it.
 */
export const CITE_GLYPH = "🔗";

/**
 * Every face a citation has ever worn. What is WRITTEN is CITE_GLYPH; what is
 * RECOGNISED is all of them, because the ones already written into somebody's
 * documents do not change when we change our minds.
 */
export const CITE_GLYPHS = [CITE_GLYPH, "📄"];

/** Whether a link's text is a citation's glyph — the door for embed.js et al. */
export const isCiteFace = (text) => CITE_GLYPHS.includes(text);

/** Splits on both endings: every .md written on Windows is CRLF (see the trap). */
const lines = (text) => text.split(/\r?\n/);

/**
 * The headings a passage sits under, outermost first — a document's answer to
 * the question a PDF answers with "page 12".
 *
 * NOT a line number. A line number rots on the first edit above it and tells the
 * reader nothing anyway; the heading survives the edit and says where you were.
 * At most `levels` of them: the nearest heading and its parent are the address,
 * six levels of it are a table of contents.
 */
export function headingTrail(text, pos, { levels = 2 } = {}) {
  const trail = [];
  let fenced = false;

  for (const line of lines(text.slice(0, pos))) {
    // A `#` inside a code fence is a comment in somebody's shell script.
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;

    const depth = heading[1].length;
    // Anything deeper is behind us now: a new `##` ends the `###` before it.
    trail.length = Math.min(trail.length, depth - 1);
    trail[depth - 1] = heading[2].trim();
  }

  // filter(Boolean): a document may open at `###` with no `#` above it, which
  // leaves holes in the array — a hole is not an address.
  return trail.filter(Boolean).slice(-levels);
}

/**
 * What the tooltip says: "Kaynak: kitap.pdf, s. 12" · "Kaynak: notlar.md › Yöntem".
 * As detailed as the source can honestly be, and no more.
 */
export function citeText({ name, page = null, trail = [] }) {
  let what = name;
  if (page) what += `, ${t("transfer.citePage", { n: page })}`;
  for (const heading of trail) what += ` › ${heading}`;
  return t("transfer.citeSource", { what });
}

/**
 * Where in the source, as a link fragment — so the citation opens the PLACE and
 * not merely the file (29 Tem).
 *
 * Both halves are somebody else's standard, not ours: `#page=12` is the PDF open
 * parameter every viewer knows, and `#heading` is how Markdown has always linked
 * into a document. A citation clicked in GitHub lands about where it lands here.
 */
export function fragmentFor({ page = null, trail = [] } = {}) {
  if (page) return `#page=${page}`;
  const last = trail[trail.length - 1];
  return last ? `#${slugify(last)}` : "";
}

/** A heading reduced to what a fragment can carry. Turkish keeps its letters —
    they are legal in a URL and unreadable without them. */
export const slugify = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/**
 * A link target split into the file and the place in it. Everything that OPENS a
 * link needs this: `belge.md#yöntem` is not the name of a file, and asking the
 * disk for it answers "not found".
 */
export function splitTarget(target) {
  const at = target.indexOf("#");
  if (at === -1) return { path: target, fragment: "" };
  return { path: target.slice(0, at), fragment: target.slice(at + 1) };
}

/** The page a `#page=12` fragment names, or null. */
export function pageOfFragment(fragment) {
  const match = /^page=(\d+)$/.exec(fragment);
  return match ? Number(match[1]) : null;
}

/**
 * A link destination as it must appear in the file.
 *
 * A space ends a destination — `[x](a b.md)` is not a link at all, which is why
 * surface.js refuses to read one. Angle brackets are the standard answer, and
 * the app's own opener already strips them.
 */
const destination = (href) => (/[ ()<>]/.test(href) ? `<${href}>` : href);

/** `[📄](belge.md "Kaynak: …")` — the citation itself. */
export function citeLink(href, cite) {
  const title = cite ? ` "${cite.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : "";
  return `[${CITE_GLYPH}](${destination(href)}${title})`;
}

/**
 * The block that lands in the target: the piece as a quote, its source beneath.
 *
 * Without `href` there is no citation line — an unsaved source has no address,
 * and a link to nowhere is worse than no link. The quote still stands.
 */
export function quotedPiece(piece, { href = null, cite = "" } = {}) {
  const rows = lines(piece.trim())
    // A blank line inside a blockquote must carry the `>` too, or the quote ends
    // there and the rest of the passage lands as ordinary prose.
    .map((line) => (line.trim() ? `> ${line}` : ">"));

  if (!href) return rows.join("\n");

  // Right where the passage ends, one space away — the distance after a comma
  // (Zafer, 29 Tem). A line of its own made the citation a second paragraph, and
  // a glyph is not a paragraph.
  const link = citeLink(href, cite);
  const last = rows.length - 1;
  rows[last] = canCarry(rows[last]) ? `${rows[last]} ${link}` : `${rows[last]}\n> ${link}`;
  return rows.join("\n");
}

/**
 * Whether a line can take the glyph at its end.
 *
 * Three cannot, and all three would swallow it rather than show it: a closing
 * code fence (the glyph would fall INSIDE the code), a table row (anything after
 * the last `|` is not part of the table), and an empty quote line.
 */
const canCarry = (row) => !/^>\s*(```|~~~)/.test(row) && !/\|\s*$/.test(row) && row.trim() !== ">";

/**
 * Bu işaret nerelere taşındı?
 *
 * Kayıt 3 Ağu'ya dek TEK bir hedef tutuyordu ve her taşımada üzerine yazıyordu
 * (`record.aktarma = {...}`). Oysa "istediğin kadar tekrar taşınabilir" kuralı
 * ta baştan vardı: aynı pasajı üç belgeye gönderen yazar, kayıtta yalnız
 * sonuncusunu buluyordu. Kayıt kuralın gerisinde kalmıştı ve bunu kimse
 * göremiyordu, çünkü kaydı gösteren bir yer yoktu (Zafer: "10 tane hedef
 * olursa ne yapacaksın?").
 *
 * Artık liste. Eski kayıtlar tek nesne olarak duruyor ve öyle de okunuyor —
 * yan kayıt kullanıcının diskinde yaşar, bir sürüm yükseltmesi onu bozamaz.
 *
 * @returns {Array<{hedefBelge: string, zaman?: string}>} en eskiden en yeniye
 */
export function movedTo(record) {
  const a = record?.aktarma;
  if (!a) return [];
  return (Array.isArray(a) ? a : [a]).filter((each) => each?.hedefBelge);
}

/**
 * Bu belgeye YAPILMIŞ alıntıların sayısı — metnin kendisinden okunur.
 *
 * "Kaç parça gönderdim" sorusunun cevabı atölyededir (her işaretin `aktarma`
 * listesi); "bana kaç parça geldi" sorusununki **belgenin içindedir**, çünkü
 * inen her parça künyesini yanında getirir (KR-81). Kaynağa sormak yanlış yol
 * olurdu: kaynak başka bir makinede olabilir, silinmiş olabilir, ya da parça
 * hiç bizim kayıtlarımızdan gelmemiş olabilir.
 *
 * Yazılan yüz birdir, tanınan yüzler tümüdür (`CITE_GLYPHS`) — biz fikrimizi
 * değiştirince okurun belgesindeki eski künyeler sayılmaz olmamalı. Kod çitinin
 * içi sayılmaz: orada duran şey örnektir, alıntı değil.
 */
export function countCitations(text) {
  if (!text) return 0;
  const faces = CITE_GLYPHS.map((glyph) => glyph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const cite = new RegExp(`\\[(?:${faces})\\]\\(`, "gu");
  let count = 0;
  // WHICH fence opened, not merely "a fence did": a ``` line inside a ~~~ block
  // is content, and treating it as the closer let the rest of the document be
  // counted as prose.
  let fence = null;
  for (const line of lines(text)) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line);
    if (mark) {
      const char = mark[1][0];
      if (!fence) fence = char;
      else if (char === fence) fence = null;
      continue;
    }
    if (fence) continue;
    count += line.match(cite)?.length ?? 0;
  }
  return count;
}

/**
 * Bir taşımayı kayda ekler ve YENİ listeyi döndürür (kaydı değiştirmez).
 *
 * Aynı hedefe ikinci kez taşımak yeni satır açmaz, o satırın zamanını tazeler
 * ve onu sona alır: liste "nerelere gitti" sorusunun cevabı, "kaç kez
 * bastım"ın değil. Sıra son taşımayı sonda tutar, çünkü gösterilen tek ad
 * sonuncusu olacak.
 */
export function withMove(record, hedefBelge, zaman = new Date().toISOString()) {
  const kalan = movedTo(record).filter((each) => each.hedefBelge !== hedefBelge);
  return [...kalan, { hedefBelge, zaman }];
}
