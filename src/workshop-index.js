// The workshop's index — pure, Tauri-free, testable.
//
// The workshop (atölye) is where a document's marks and comments live from now
// on: one folder of our own, instead of a `.mdplus/` sown beside every file the
// reader ever opened. The `.md` stays free — that never changed — but the disk
// stays clean too.
//
// The price of moving out is that a record no longer sits next to the thing it
// describes: it points at a path, and a path is the one thing the reader is
// free to change. So a record is found twice over — by path, and failing that
// by CONTENT SIGNATURE. Move `tez.md` to another folder and its marks follow;
// the record quietly learns its new address on the way.
//
// The signature says "the same bytes", never "what is in them". It is
// deliberately weak, and deliberately partial — head, tail and length, never
// the whole file — because a 30 MB PDF is asked this question every time it is
// opened. It guards nothing: a collision costs a wrong lookup, not a lost file,
// and the anchors would refuse to resolve anyway (KR-16).
//
// Sampling the ends rather than the middle also buys something we want: a file
// that was moved AND edited in the middle still matches. That is the case the
// reader would least understand losing.

import { fileNameOf, samePath } from "./paths.js";

/** Bytes taken from each end. Everything shorter is hashed whole. */
export const SAMPLE = 65536;

/**
 * A short, stable fingerprint of a document's content. Takes a string (a `.md`)
 * or a Uint8Array (a PDF); the two are never compared with each other, so they
 * need no common encoding.
 */
export function signatureOf(content) {
  if (content === null || content === undefined) return "";
  const length = content.length;
  if (!length) return "";

  // Two lanes, so that neither a run of identical bytes nor a swap of two of
  // them passes unnoticed. Math.imul keeps the multiply in 32-bit territory —
  // a plain `*` would go through doubles and lose the low bits.
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;

  const eat = (byte) => {
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = (Math.imul(b + byte, 0x85ebca6b) >>> 0) || 1;
    b = ((b << 13) | (b >>> 19)) >>> 0;
  };

  const at =
    typeof content === "string" ? (i) => content.charCodeAt(i) & 0xffff : (i) => content[i];

  if (length <= SAMPLE * 2) {
    for (let i = 0; i < length; i++) eat(at(i));
  } else {
    for (let i = 0; i < SAMPLE; i++) eat(at(i));
    for (let i = length - SAMPLE; i < length; i++) eat(at(i));
  }

  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(a)}${hex(b)}-${length.toString(36)}`;
}

/**
 * The record belonging to a document: by path first, by signature second.
 *
 * Two records with the same signature settle nothing — that is a copied file,
 * and neither copy is more the original than the other. Guessing there would
 * hand one document the other's comments, so the answer is "no record", and a
 * fresh one is made. Losing a link is recoverable; a wrong link is not obvious.
 */
export function matchRecord(records, path, signature) {
  const byPath = records.find((record) => samePath(record.yol, path));
  if (byPath) return byPath;
  if (!signature) return null;

  const hits = records.filter((record) => record.imza === signature);
  return hits.length === 1 ? hits[0] : null;
}

/** Whether a lookup that hit by signature has to write the new address back. */
export const movedFrom = (record, path) => Boolean(record) && !samePath(record.yol, path);

/**
 * A file name for a new record: readable enough that the folder can be looked
 * at by a human, unique enough that two `notlar.md` never share one.
 */
export function nextId(records, path, random = Math.random) {
  const base =
    fileNameOf(path)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[ğ]/g, "g")
      .replace(/[ü]/g, "u")
      .replace(/[ş]/g, "s")
      .replace(/[ı]/g, "i")
      .replace(/[ö]/g, "o")
      .replace(/[ç]/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "belge";

  const taken = new Set(records.map((record) => record.id));
  for (let attempt = 0; ; attempt++) {
    const tail = Math.floor(random() * 0xffffff)
      .toString(16)
      .padStart(6, "0");
    const id = `${base}-${tail}`;
    if (!taken.has(id)) return id;
    // A jammed random source must not spin here forever.
    if (attempt > 50) return `${base}-${taken.size.toString(36)}${tail}`;
  }
}

/** The index with one record's address brought up to date. */
export const withRecord = (records, record) => [
  ...records.filter((each) => each.id !== record.id),
  record,
];

export const withoutRecord = (records, id) => records.filter((each) => each.id !== id);
