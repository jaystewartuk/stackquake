// A small RSS 2.0 / RSS 1.0 / Atom parser. Feeds are read only up to a byte cap, so the input
// may end mid-item; only complete <item>/<entry> elements are returned.
import { decodeEntities, normaliseText, normaliseUrl } from "./normalise";

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  published: string | null;
  /** Plain text of the body. Computed on first access: only new items need it. */
  readonly text: string;
}

const ITEM = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

function unwrap(raw: string): string {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

const tagPatterns = new Map<string, RegExp>();

function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    let re = tagPatterns.get(name);
    if (!re) {
      re = new RegExp(`<(?:[a-z0-9]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[a-z0-9]+:)?${name}\\s*>)`, "i");
      tagPatterns.set(name, re);
    }
    const m = re.exec(block);
    if (m && m[1] !== undefined) return unwrap(m[1]).trim();
  }
  return null;
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs)?.[1];
  const alt = links.find((a) => attr(a, "href") && (!attr(a, "rel") || attr(a, "rel") === "alternate"));
  const href = alt ? attr(alt, "href") : undefined;
  return href ? decodeEntities(href) : null;
}

/** HTML (possibly entity-escaped, as in RSS descriptions) to plain text. */
export function htmlToText(html: string): string {
  let s = html.includes("&lt;") ? decodeEntities(html) : html;
  s = s
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|blockquote|pre|ul|ol|section|article|figure|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return normaliseText(decodeEntities(s));
}

export function parseFeed(xml: string, maxItems = 100, maxTextChars = 8_000): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(ITEM)) {
    const block = m[2];
    const title = normaliseText(decodeEntities(htmlToText(tag(block, ["title"]) ?? "")));
    const rawLink = m[1].toLowerCase() === "entry" ? atomLink(block) : (tag(block, ["link"]) ?? atomLink(block));
    const link = rawLink ? normaliseUrl(decodeEntities(rawLink)) : "";
    const guid = tag(block, ["guid", "id"]);
    const id = guid ? (/^https?:\/\//i.test(guid) ? normaliseUrl(decodeEntities(guid)) : decodeEntities(guid)) : link || title;
    const published = tag(block, ["pubDate", "published", "updated", "date"]);
    if (!id) continue;
    let text: string | undefined;
    items.push({
      id,
      title,
      link,
      published,
      get text() {
        text ??= htmlToText(tag(block, ["encoded", "content", "description", "summary"]) ?? "").slice(0, maxTextChars);
        return text;
      },
    });
    if (items.length >= maxItems) break;
  }
  return items;
}
