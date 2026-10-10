// Vendor pricing/terms pages (SPEC §5). The poll extracts and normalises the selected region;
// a hash change queues an extract_diff step, which decides whether there is an event.
import { DAY, fromUtf8 } from "../../util";
import { extractText } from "../html";
import { hostOf, politeFetch } from "../http";
import { normaliseText } from "../normalise";
import type { KindHandler } from "../types";

export interface PageConfig {
  exclude?: string[];
  ignore?: string[];
}

/** SPEC §7.2 budget guard: extraction and diffs work on at most 200 KB of text. */
export const MAX_TEXT_CHARS = 200_000;
/** Raw HTML cap. HTMLRewriter streams natively, so this mainly bounds memory. */
export const PAGE_MAX_BYTES = 5_000_000;

export async function pageText(body: Uint8Array, contentType: string, selector: string, config: PageConfig) {
  if (/^text\/(markdown|plain)/.test(contentType)) {
    const text = fromUtf8(body);
    return { text: text.length > MAX_TEXT_CHARS ? "" : text, matched: true, tooLarge: text.length > MAX_TEXT_CHARS };
  }
  return extractText(new Response(body).body!, { selector, exclude: config.exclude, maxChars: MAX_TEXT_CHARS });
}

export const page: KindHandler = {
  kind: "page",
  intervalMs: DAY,
  hosts: (source) => [hostOf(source.url)],
  async poll(ctx, { source }) {
    const r = await politeFetch(ctx, source.url, {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      etag: source.etag,
      lastModified: source.lastModified,
      maxBytes: PAGE_MAX_BYTES,
      robots: true,
    });
    if (r.type !== "ok") return r;
    const config = source.config as PageConfig;
    const extracted = await pageText(r.body, r.contentType, source.selector ?? "main", config);
    if (extracted.tooLarge) return { type: "too_large", status: r.status, reason: `selected text over ${MAX_TEXT_CHARS} characters; narrow the selector` };
    if (!extracted.matched) return { type: "retry", status: r.status, reason: `selector "${source.selector}" matched nothing`, retryAfterMs: null };
    const text = normaliseText(extracted.text, { ignore: config.ignore });
    if (!text) return { type: "retry", status: r.status, reason: "selected region has no text", retryAfterMs: null };
    return { type: "ok", status: r.status, etag: r.etag, lastModified: r.lastModified, canonical: text, state: { chars: text.length }, changes: [] };
  },
};
