// Fetching a feed item's post (M2 fetch_post step). Feeds often carry only an excerpt; the
// classifier and the quote check need the post itself. Polite like every other fetch: robots.txt,
// our User-Agent, Markdown first, then the HTML's <article> or <main>.
import type { Ctx } from "../context";
import { extractText } from "../sources/html";
import { politeRequest, readCapped, type FetchOutcome } from "../sources/http";
import { MAX_TEXT_CHARS, PAGE_ACCEPT, stripFrontMatter } from "../sources/kinds/page";
import { fromUtf8, gunzip, gzip, sha256Hex, utf8 } from "../util";

/** Raw HTML read for a post. Blog pages with inline assets can be large. */
export const POST_MAX_BYTES = 3_000_000;
/** Below this many characters a feed item's text is treated as an excerpt and the post fetched. */
export const EXCERPT_CHARS = 2_000;
/** Region of an HTML post to read, best first. */
const POST_SELECTORS = ["article", "main", "body"];

export const postKey = (sha: string) => `post/${sha}`;

/** Light cleanup only: the text is quoted from, so it must stay close to the original. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export type PostFetch = { type: "ok"; text: string } | Exclude<FetchOutcome, { type: "ok" | "not_modified" }> | { type: "empty"; reason: string };

export async function fetchPostText(ctx: Ctx, url: string): Promise<PostFetch> {
  const r = await politeRequest(ctx, url, { accept: PAGE_ACCEPT, robots: true });
  if (r.type === "not_modified") return { type: "retry", status: 304, reason: "unexpected 304", retryAfterMs: null };
  if (r.type !== "response") return r;
  const read = await readCapped(r.res, POST_MAX_BYTES, false);
  if (!read) return { type: "too_large", status: r.res.status, reason: `post over ${POST_MAX_BYTES} bytes` };
  if (/^text\/(markdown|x-markdown|plain)/.test(r.contentType)) {
    const text = tidyText(stripFrontMatter(fromUtf8(read.body))).slice(0, MAX_TEXT_CHARS);
    return text ? { type: "ok", text } : { type: "empty", reason: "empty Markdown" };
  }
  for (const selector of POST_SELECTORS) {
    const out = await extractText(new Response(read.body).body!, { selector, maxChars: MAX_TEXT_CHARS, maxBytes: POST_MAX_BYTES });
    if (out.matched && out.text.trim()) return { type: "ok", text: tidyText(out.text) };
    if (out.tooLarge) return { type: "too_large", status: r.res.status, reason: `more than ${MAX_TEXT_CHARS} characters of text in <${selector}>` };
  }
  return { type: "empty", reason: "no text in article, main or body" };
}

/** Stores text by content hash (gzip). Returns the blob key. */
export async function putText(ctx: Ctx, text: string): Promise<string> {
  const key = postKey(await sha256Hex(text));
  if (!(await ctx.blobs.has(key))) await ctx.blobs.put(key, await gzip(utf8(text)));
  return key;
}

export async function getText(ctx: Ctx, key: string): Promise<string | null> {
  const body = await ctx.blobs.get(key);
  return body ? fromUtf8(await gunzip(body)) : null;
}
