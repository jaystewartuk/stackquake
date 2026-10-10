import { describe, expect, it } from "vitest";
import { extractText } from "../src/sources/html";
import { normaliseText, normaliseUrl } from "../src/sources/normalise";
import { pageText } from "../src/sources/kinds/page";
import { sha256Hex, utf8 } from "../src/util";

const page = (opts: { updated: string; ago: string; utm: string; script: string; nonce: string; spaces: string; price?: string }) => `<!doctype html>
<html><head><title>Pricing</title><script>window.__BUILD="${opts.nonce}"</script><style>.a{color:red}</style></head>
<body>
  <nav>Home | Docs | <a href="/x?utm_source=${opts.utm}">Blog</a></nav>
  <main>
    <h1>Workers pricing</h1>
    <p>Last updated: ${opts.updated}</p>
    <script>track("${opts.nonce}")</script>
    <nav class="toc">On this page</nav>
    <table><tr><th>Plan</th><th>Requests</th></tr>
      <tr><td>Free</td><td>${opts.price ?? "100,000"}${opts.spaces}per day</td></tr></table>
    <p>See https://example.com/docs?id=7&amp;utm_campaign=${opts.utm}&amp;fbclid=${opts.nonce} for details.</p>
    <p class="meta">Edited ${opts.ago}</p>
    <div class="feedback">Was this page helpful?</div>
  </main>
  <footer>© 2026 Example, Inc.</footer>
</body></html>`;

async function pageHash(html: string, ignore?: string[]) {
  const { text, matched } = await pageText(new Response(utf8(html)).body!, "text/html; charset=utf-8", "main", { exclude: [".feedback"], ignore });
  expect(matched).toBe(true);
  const norm = normaliseText(text, { ignore });
  return { norm, hash: await sha256Hex(norm) };
}

describe("page normalisation", () => {
  const first = { updated: "Oct 1, 2026", ago: "3 minutes ago", utm: "newsletter", script: "a", nonce: "abc123", spaces: " " };
  const second = { updated: "2026-10-10 14:02:11Z", ago: "2 hours ago", utm: "twitter", script: "b", nonce: "zzz999", spaces: " \n\t  " };

  it("hashes the same page fetched twice the same, despite timestamps, tracking params, scripts and whitespace", async () => {
    const a = await pageHash(page(first));
    const b = await pageHash(page(second));
    expect(a.norm).toBe(b.norm);
    expect(a.hash).toBe(b.hash);
    expect(a.norm).toContain("Workers pricing");
    expect(a.norm).toContain("100,000 per day");
    expect(a.norm).toContain("https://example.com/docs?id=7 for details");
    expect(a.norm).not.toMatch(/Last updated|ago|track\(|__BUILD|On this page|Was this page helpful|Home \|/);
  });

  it("still detects a real change", async () => {
    const a = await pageHash(page(first));
    const b = await pageHash(page({ ...second, price: "50,000" }));
    expect(a.hash).not.toBe(b.hash);
  });

  it("applies catalog ignore regexes", async () => {
    const html = (n: number) => `<main><p>Pricing</p><p>Build ${n} deployed</p></main>`;
    const a = await pageHash(html(1), ["Build \\d+ deployed"]);
    const b = await pageHash(html(2), ["Build \\d+ deployed"]);
    expect(a.hash).toBe(b.hash);
  });

  it("keeps dates that are content, not timestamps", () => {
    expect(normaliseText("Node 22 reaches end of life on 2027-04-30.")).toBe("Node 22 reaches end of life on 2027-04-30.");
    expect(normaliseText("Price change effective March 1, 2027")).toBe("Price change effective March 1, 2027");
    expect(normaliseText("Updated on March 1, 2027\nFree: 10 GB")).toBe("Free: 10 GB");
  });
});

describe("extractText", () => {
  const body = (html: string) => new Response(html).body!;

  it("reports when the selector matches nothing", async () => {
    const r = await extractText(body("<div>no main here</div>"), { selector: "main", maxChars: 1_000, maxBytes: 10_000 });
    expect(r.matched).toBe(false);
  });

  it("supports comma-separated selectors and decodes entities", async () => {
    const r = await extractText(body(`<div id="a">Fish &amp; chips</div><p>skip</p><div class="b">5&nbsp;GB &#8211; free</div>`), { selector: "#a, .b", maxChars: 1_000, maxBytes: 10_000 });
    expect(normaliseText(r.text)).toBe("Fish & chips\n5 GB – free");
  });

  it("flags text over the cap as too large", async () => {
    const r = await extractText(body(`<main>${"x".repeat(5_000)}</main>`), { selector: "main", maxChars: 1_000, maxBytes: 100_000 });
    expect(r.tooLarge).toBe(true);
  });

  it("flags HTML over the byte cap as too large", async () => {
    const r = await extractText(body(`<html>${"<p>x</p>".repeat(5_000)}<main>late</main></html>`), { selector: "main", maxChars: 1_000, maxBytes: 10_000 });
    expect(r.tooLarge).toBe(true);
  });

  it("stops reading once a unique selector has closed", async () => {
    let pulled = 0;
    const chunks = ["<main><p>Free: 10 GB</p></main>", ...Array.from({ length: 50 }, () => `<script>${"x".repeat(1_000)}</script>`)];
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled < chunks.length) c.enqueue(utf8(chunks[pulled++]));
        else c.close();
      },
    });
    const r = await extractText(stream, { selector: "main", maxChars: 1_000, maxBytes: 10_000 });
    expect(normaliseText(r.text)).toBe("Free: 10 GB");
    expect(r.tooLarge).toBe(false);
    expect(pulled).toBeLessThan(5);
  });

  it("uses Markdown as is, without front matter", async () => {
    const md = "---\ntitle: Limits\nlast_updated: 2026-09-16\n---\n\n# Limits\n\nHobby: 100 GB";
    const r = await pageText(new Response(md).body!, "text/markdown; charset=utf-8", "main", {});
    expect(normaliseText(r.text)).toBe("# Limits\nHobby: 100 GB");
  });
});

describe("normaliseUrl", () => {
  it("drops tracking parameters and fragments, sorts the rest", () => {
    expect(normaliseUrl("https://blog.example.com/post?utm_source=rss&b=2&a=1&fbclid=x#comments")).toBe("https://blog.example.com/post?a=1&b=2");
    expect(normaliseUrl("https://example.com/p?utm_medium=feed")).toBe("https://example.com/p");
  });
});
