// Text and URL normalisation (SPEC §5 "Normalisation"). Everything here must be deterministic:
// the same content fetched twice must normalise to the same string.

const TRACKING_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|__hstc|__hssc|__hsfp|hsctatracking|igshid|yclid|_ga|_gl|ref|ref_src|ref_url|cmpid|s_cid|trk|si|spm)$/i;

/** Drops tracking parameters and the fragment; sorts what is left. Leaves invalid URLs alone. */
export function normaliseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  u.hash = "";
  const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = kept.length ? "?" + new URLSearchParams(kept).toString() : "";
  return u.toString();
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"')\]]+/g;

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE =
  `(?:\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?` +
  `|${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}` +
  `|\\d{1,2}(?:st|nd|rd|th)? ${MONTH}\\.?,? \\d{4}` +
  `|\\d{1,2}/\\d{1,2}/\\d{2,4})`;

/**
 * Volatile fragments that change between fetches without the content changing. Only dates
 * that are introduced as "updated"/"modified"/"edited"/"published" are removed, so dates that
 * matter (an EOL date in a table, a price change effective date) are kept.
 */
const VOLATILE: RegExp[] = [
  // "Last updated: Oct 1, 2026", "Updated 2026-10-01 12:00", "last modified on 1 October 2026"
  new RegExp(`\\b(?:last\\s+)?(?:updated|modified|edited|reviewed|published|generated|refreshed)(?:\\s+(?:on|at))?:?\\s*${DATE}(?:\\s+(?:at\\s+)?\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[ap]\\.?m\\.?)?(?:\\s*[A-Z]{2,4})?)?`, "gi"),
  // "updated 3 minutes ago", "5 hours ago", "a day ago", "just now"
  /\b(?:(?:last\s+)?(?:updated|modified|edited|published)\s+)?(?:\d+|an?|a few)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)\s+ago\b/gi,
  /\b(?:updated\s+)?just now\b/gi,
  // Copyright lines roll over every January.
  /(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?\d{4}/gi,
];

export interface NormaliseOptions {
  /** Extra regexes from the catalog entry (`ignore:`), applied before the built-in ones. */
  ignore?: string[];
}

/** Normalises extracted text: tracking params, volatile timestamps, whitespace runs. */
export function normaliseText(text: string, opts: NormaliseOptions = {}): string {
  let s = text.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[​-‍﻿]/g, "");
  for (const pattern of opts.ignore ?? []) s = s.replace(new RegExp(pattern, "gi"), "");
  for (const re of VOLATILE) s = s.replace(re, "");
  s = s.replace(URL_IN_TEXT, (u) => normaliseUrl(u));
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£",
  yen: "¥", cent: "¢", times: "×", middot: "·", bull: "•", rarr: "→", larr: "←", deg: "°", plusmn: "±",
  laquo: "«", raquo: "»", sect: "§", para: "¶", zwj: "", zwnj: "", shy: "",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}
