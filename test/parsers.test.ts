import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/sources/feed-parser";
import { robotsAllows } from "../src/sources/robots";

describe("parseFeed", () => {
  it("parses RSS 2.0 with CDATA and escaped HTML, and strips tracking params from links", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><lastBuildDate>Sat, 10 Oct 2026 12:00:00 GMT</lastBuildDate>
      <item><title><![CDATA[Deno & Cloudflare]]></title><link>https://deno.com/blog/x?utm_source=rss</link>
        <guid isPermaLink="false">post-42</guid><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate>
        <description>&lt;p&gt;We will support the Deno runtime for another year.&lt;/p&gt;&lt;p&gt;Second para&lt;/p&gt;</description></item>
      <item><title>Older</title><link>https://deno.com/blog/y</link></item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "post-42", title: "Deno & Cloudflare", link: "https://deno.com/blog/x", published: "Fri, 09 Oct 2026 10:00:00 GMT" });
    expect(items[0].text).toBe("We will support the Deno runtime for another year.\nSecond para");
    expect(items[1].id).toBe("https://deno.com/blog/y");
  });

  it("parses Atom with alternate links and content", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><updated>2026-10-10T00:00:00Z</updated>
      <entry><id>tag:vercel.com,2026:1</id><title type="html">Hobby plan &amp;amp; limits</title>
        <link rel="self" href="https://vercel.com/self/1"/><link rel="alternate" href="https://vercel.com/changelog/1?ref=atom"/>
        <published>2026-10-01T00:00:00Z</published><content type="html">&lt;p&gt;New limits.&lt;/p&gt;</content></entry></feed>`;
    const [item] = parseFeed(xml);
    expect(item).toMatchObject({ id: "tag:vercel.com,2026:1", title: "Hobby plan & limits", link: "https://vercel.com/changelog/1", text: "New limits." });
  });

  it("ignores a truncated trailing item", () => {
    const xml = `<rss><channel><item><guid>a</guid><title>A</title></item><item><guid>b</guid><title>B`;
    expect(parseFeed(xml).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("robotsAllows", () => {
  const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public-page

User-agent: StackquakeBot
Disallow: /pricing$
Disallow: /drafts/*.html
`;
  it("uses the most specific group for our agent", () => {
    expect(robotsAllows(robots, "stackquakebot", "https://x.com/private/a")).toBe(true); // our group has no /private rule
    expect(robotsAllows(robots, "stackquakebot", "https://x.com/pricing")).toBe(false);
    expect(robotsAllows(robots, "stackquakebot", "https://x.com/pricing/workers")).toBe(true);
    expect(robotsAllows(robots, "stackquakebot", "https://x.com/drafts/a/b.html")).toBe(false);
  });
  it("falls back to * and lets the longest rule win", () => {
    expect(robotsAllows(robots, "otherbot", "https://x.com/private/a")).toBe(false);
    expect(robotsAllows(robots, "otherbot", "https://x.com/private/public-page")).toBe(true);
    expect(robotsAllows("", "otherbot", "https://x.com/anything")).toBe(true);
  });
});
