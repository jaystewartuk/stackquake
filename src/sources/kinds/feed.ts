// Vendor blog feeds (SPEC §5). New items become `pending_llm` events for the M2 classifier.
// The first poll records a baseline and creates no events.
import { fromUtf8, HOUR, stableStringify, truncate } from "../../util";
import { parseFeed, type FeedItem } from "../feed-parser";
import { HEAVY, hostOf, politeFetch } from "../http";
import type { CatalogLink, DetectedChange, KindHandler } from "../types";

export interface FeedState {
  seen: string[];
}

const MAX_SEEN = 500;
/** More new items than this at once means the feed's IDs changed, not 30 new posts: re-baseline. */
export const MAX_NEW_ITEMS = 25;
export const FEED_MAX_BYTES = 1_000_000;

export function passesFilter(item: FeedItem, links: CatalogLink[]): boolean {
  if (links.length === 0 || links.some((l) => !l.filter || l.filter.length === 0)) return true;
  const hay = `${item.title}\n${item.text}`.toLowerCase();
  return links.some((l) => l.filter!.some((word) => hay.includes(word.toLowerCase())));
}

export function compareFeed(prev: FeedState, items: FeedItem[], links: CatalogLink[], feedUrl: string): { changes: DetectedChange[]; newItems: number; rebaselined: boolean } {
  const seen = new Set(prev.seen);
  const fresh = items.filter((i) => !seen.has(i.id));
  if (fresh.length > MAX_NEW_ITEMS) return { changes: [], newItems: fresh.length, rebaselined: true };
  const changes = fresh
    .filter((i) => passesFilter(i, links))
    .map(
      (i): DetectedChange => ({
        kind: "other",
        title: i.title || i.link || "(untitled post)",
        dedupeTitle: `feed item ${i.id}`,
        quoteUrl: i.link || feedUrl,
        afterText: truncate(i.text, 8_000),
        effectiveDate: null,
      }),
    );
  return { changes, newItems: fresh.length, rebaselined: false };
}

export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 1_000).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export const feed: KindHandler = {
  kind: "feed",
  // SPEC says 1 h. 3 h still meets G1 (24 h) and keeps feed polls inside the runner's HEAVY
  // budget on the Free plan (docs/DECISIONS.md, M4: capacity).
  intervalMs: 3 * HOUR,
  gate: (source) => [hostOf(source.url), HEAVY],
  async poll(ctx, { source, prev, links }) {
    const r = await politeFetch(ctx, source.url, {
      accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
      etag: source.etag,
      lastModified: source.lastModified,
      maxBytes: FEED_MAX_BYTES,
      truncateOk: true,
      robots: true,
    });
    if (r.type !== "ok") return r;
    const xml = fromUtf8(r.body);
    if (looksLikeHtml(xml)) return { type: "blocked", status: r.status, reason: "expected a feed, got an HTML page" };
    const items = parseFeed(xml);
    if (items.length === 0) return { type: "retry", status: r.status, reason: "feed has no items", retryAfterMs: null };

    const canonical = stableStringify(items.map(({ id, title, link }) => ({ id, title, link })));
    const prevState = prev as FeedState | null;
    const result = prevState ? compareFeed(prevState, items, links, source.url) : { changes: [] };
    const seen = [...new Set([...items.map((i) => i.id), ...(prevState?.seen ?? [])])].slice(0, MAX_SEEN);
    return { type: "ok", status: r.status, etag: r.etag, lastModified: r.lastModified, canonical, state: { seen } satisfies FeedState, changes: result.changes };
  },
};
