// Vendor pricing/terms pages (SPEC §5). The poll extracts and normalises the selected region;
// a hash change queues an extract_diff step, which decides whether there is an event.
//
// Many docs sites (Cloudflare, Vercel, Supabase) serve Markdown when asked. It is a fraction of
// the HTML's size and needs no parsing, so it is preferred; the selector then does not apply.
import { DAY, fromUtf8 } from "../../util";
import { extractText } from "../html";
import { hostOf, politeRequest, readCapped } from "../http";
import { normaliseText } from "../normalise";
import type { KindHandler } from "../types";

export interface PageConfig {
  exclude?: string[];
  ignore?: string[];
}

/** SPEC §7.2 budget guard: extraction and diffs work on at most 200 KB of text. */
export const MAX_TEXT_CHARS = 200_000;
/** Raw HTML cap. Parsing usually stops well before it, when the selected element closes. */
export const PAGE_MAX_BYTES = 5_000_000;

export const PAGE_ACCEPT = "text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.5";

const isText = (contentType: string) => /^text\/(markdown|x-markdown|plain)/.test(contentType);

/** Markdown front matter is metadata (it carries last_updated and similar), not content. */
export function stripFrontMatter(md: string): string {
  return md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

export async function pageText(body: ReadableStream<Uint8Array>, contentType: string, selector: string, config: PageConfig) {
  if (isText(contentType)) {
    const read = await readCapped(new Response(body), MAX_TEXT_CHARS * 4, false);
    const text = read ? stripFrontMatter(fromUtf8(read.body)) : "";
    const tooLarge = !read || text.length > MAX_TEXT_CHARS;
    return { text: tooLarge ? "" : text, matched: true, tooLarge };
  }
  return extractText(body, { selector, exclude: config.exclude, maxChars: MAX_TEXT_CHARS, maxBytes: PAGE_MAX_BYTES });
}

export const page: KindHandler = {
  kind: "page",
  intervalMs: DAY,
  hosts: (source) => [hostOf(source.url)],
  async poll(ctx, { source }) {
    const r = await politeRequest(ctx, source.url, { accept: PAGE_ACCEPT, etag: source.etag, lastModified: source.lastModified, robots: true });
    if (r.type !== "response") return r;
    const config = source.config as PageConfig;
    const status = r.res.status;
    if (!r.res.body) return { type: "retry", status, reason: "empty body", retryAfterMs: null };
    const extracted = await pageText(r.res.body, r.contentType, source.selector ?? "main", config);
    if (extracted.tooLarge) return { type: "too_large", status, reason: `page over the size cap (${MAX_TEXT_CHARS} characters of text); narrow the selector` };
    if (!extracted.matched) return { type: "retry", status, reason: `selector "${source.selector}" matched nothing`, retryAfterMs: null };
    const text = normaliseText(extracted.text, { ignore: config.ignore });
    if (!text) return { type: "retry", status, reason: "selected region has no text", retryAfterMs: null };
    return { type: "ok", status, etag: r.etag, lastModified: r.lastModified, canonical: text, state: { chars: text.length, format: isText(r.contentType) ? "markdown" : "html" }, changes: [] };
  },
};
