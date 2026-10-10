// Fixture-based deterministic events (SPEC §5 table, §11 golden cases 6 and 7 at the detector level).
import { beforeEach, describe, expect, it } from "vitest";
import { events, jobs, snapshots } from "../src/db/schema";
import { runTick } from "../src/jobs/runner";
import { enqueue, pollJobKey } from "../src/jobs/queue";
import { eolUrl } from "../src/sources/kinds/eol";
import { githubUrl } from "../src/sources/kinds/github";
import { npmUrl } from "../src/sources/kinds/npm";
import { pypiUrl } from "../src/sources/kinds/pypi";
import { DAY } from "../src/util";
import { extractDiff } from "../src/watch/extract-diff";
import { pollSource } from "../src/watch/poll";
import { addSource, reload, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

const allEvents = (ctx: ReturnType<typeof testCtx>["ctx"]) => ctx.db.select().from(events).all();

describe("npm", () => {
  const url = npmUrl("left-pad-pro");
  const latest = (over: Record<string, unknown> = {}) => ({ name: "left-pad-pro", version: "1.0.0", license: "MIT", repository: { type: "git", url: "git+https://github.com/acme/left-pad-pro.git" }, ...over });

  it("records a baseline, then a deterministic license event for MIT -> BUSL-1.1", async () => {
    const { ctx, http } = testCtx();
    http.set(url, latest());
    const source = await addSource(ctx, { kind: "npm", key: "left-pad-pro", url });
    expect((await pollSource(ctx, source)).status).toBe("baseline");
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("unchanged");
    // A new version with the same licence is not a change.
    http.set(url, latest({ version: "1.0.1", gitHead: "abc" }));
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("unchanged");

    http.set(url, latest({ version: "2.0.0", license: "BUSL-1.1" }));
    const report = await pollSource(ctx, await reload(ctx, source.id));
    expect(report).toMatchObject({ status: "changed", eventsCreated: 1 });
    const [e] = await allEvents(ctx);
    expect(e).toMatchObject({ kind: "license", status: "pending_llm", title: "left-pad-pro (npm): licence changed from MIT to BUSL-1.1", quoteUrl: "https://www.npmjs.com/package/left-pad-pro" });
    expect(e.afterText).toContain("BUSL-1.1");

    // Polling again creates nothing new.
    expect((await pollSource(ctx, await reload(ctx, source.id))).eventsCreated).toBe(0);
    expect(await allEvents(ctx)).toHaveLength(1);
  });

  it("creates a deprecated event quoting the deprecation message", async () => {
    const { ctx, http } = testCtx();
    http.set(url, latest());
    const source = await addSource(ctx, { kind: "npm", key: "left-pad-pro", url });
    await pollSource(ctx, source);
    http.set(url, latest({ deprecated: "No longer maintained. Use pad-everything instead." }));
    await pollSource(ctx, await reload(ctx, source.id));
    const [e] = await allEvents(ctx);
    expect(e).toMatchObject({ kind: "deprecated", quote: "No longer maintained. Use pad-everything instead." });
  });

  it("sends the bot User-Agent", async () => {
    const { ctx, http } = testCtx();
    http.set(url, latest());
    await pollSource(ctx, await addSource(ctx, { kind: "npm", key: "left-pad-pro", url }));
    expect(http.requests[0].headers.get("user-agent")).toBe("StackquakeBot/1.0 (+https://stackquake.com/bot)");
  });
});

describe("pypi", () => {
  const url = pypiUrl("redis");
  const doc = (info: Record<string, unknown>) => ({ info: { name: "redis", version: "8.1.0", license: null, license_expression: "MIT", classifiers: ["License :: OSI Approved :: MIT License", "Development Status :: 5 - Production/Stable"], yanked: false, ...info }, releases: {} });

  it("detects a licence change and the project going inactive", async () => {
    const { ctx, http } = testCtx();
    http.set(url, doc({}));
    const source = await addSource(ctx, { kind: "pypi", key: "redis", url });
    await pollSource(ctx, source);
    http.set(url, doc({ license_expression: "AGPL-3.0-only", classifiers: ["Development Status :: 7 - Inactive"] }));
    const report = await pollSource(ctx, await reload(ctx, source.id));
    expect(report.eventsCreated).toBe(2);
    const kinds = (await allEvents(ctx)).map((e) => [e.kind, e.title]);
    expect(kinds).toContainEqual(["license", "redis (PyPI): licence changed from MIT to AGPL-3.0-only"]);
    expect(kinds).toContainEqual(["deprecated", "redis (PyPI): project marked inactive"]);
  });
});

describe("github_repo", () => {
  const url = githubUrl("acme/widget");
  const licUrl = "https://api.github.com/repos/acme/widget/license";
  const repo = (over: Record<string, unknown> = {}) => ({ full_name: "acme/widget", owner: { login: "acme" }, archived: false, license: { spdx_id: "MIT" }, stargazers_count: 10, pushed_at: "2026-10-10T00:00:00Z", ...over });
  const lic = (sha: string, text: string, spdx = "MIT") =>
    new Response(JSON.stringify({ path: "LICENSE", sha, encoding: "base64", content: btoa(text), license: { spdx_id: spdx } }), { headers: { etag: `"${sha}"`, "content-type": "application/json" } });

  it("detects archived, a licence change (with before/after text) and a transfer", async () => {
    const { ctx, http } = testCtx();
    http.set(url, repo());
    http.set(licUrl, lic("sha1", "MIT License\nPermission is hereby granted"));
    const source = await addSource(ctx, { kind: "github_repo", key: "acme/widget", url });
    await pollSource(ctx, source);

    // Noise only (stars, pushed_at) and the licence answered with 304: unchanged.
    http.set(url, repo({ stargazers_count: 11, pushed_at: "2026-10-11T00:00:00Z" }));
    http.set(licUrl, (req) => (req.headers.get("if-none-match") === '"sha1"' ? new Response(null, { status: 304 }) : lic("sha1", "MIT License")));
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("unchanged");

    http.set(url, repo({ archived: true }));
    await pollSource(ctx, await reload(ctx, source.id));
    expect((await allEvents(ctx)).map((e) => e.kind)).toEqual(["archived"]);

    http.set(url, repo({ archived: true, license: { spdx_id: "BUSL-1.1" } }));
    http.set(licUrl, lic("sha2", "Business Source License 1.1", "BUSL-1.1"));
    await pollSource(ctx, await reload(ctx, source.id));
    const licence = (await allEvents(ctx)).find((e) => e.kind === "license")!;
    expect(licence.title).toBe("acme/widget: licence changed from MIT to BUSL-1.1");
    expect(licence.beforeText).toContain("Permission is hereby granted");
    expect(licence.afterText).toContain("Business Source License 1.1");

    http.set(url, repo({ archived: true, license: { spdx_id: "BUSL-1.1" }, full_name: "megacorp/widget", owner: { login: "megacorp" } }));
    http.set("https://api.github.com/repos/megacorp/widget/license", lic("sha2", "Business Source License 1.1", "BUSL-1.1"));
    await pollSource(ctx, await reload(ctx, source.id));
    expect((await allEvents(ctx)).map((e) => e.title)).toContain("acme/widget was transferred to megacorp/widget");
  });

  it("treats GitHub's rate-limit 403 as 'later', not as a block", async () => {
    const { ctx, http } = testCtx();
    http.set(url, new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(ctx.clock.now() / 1000) + 600) } }));
    const source = await addSource(ctx, { kind: "github_repo", key: "acme/widget", url });
    const report = await pollSource(ctx, source);
    expect(report.status).toBe("retry");
    const after = await reload(ctx, source.id);
    expect(after.blockStrikes).toBe(0);
    expect(after.nextPollAt).toBe(ctx.clock.now() + 600_000);
  });
});

describe("eol", () => {
  const url = eolUrl("nodejs");
  const doc = (releases: Record<string, unknown>[]) => ({ schema_version: "1.2.1", generated_at: new Date().toISOString(), result: { name: "nodejs", releases } });

  it("detects an EOL date being set and moved earlier, and reminds once within 90 days", async () => {
    const { ctx, http, clock } = testCtx();
    http.set(url, doc([{ name: "26", isEol: false, eolFrom: null }, { name: "24", isEol: false, eolFrom: "2028-04-30" }]));
    const source = await addSource(ctx, { kind: "eol", key: "nodejs", url });
    await pollSource(ctx, source);
    expect(await allEvents(ctx)).toHaveLength(0);

    http.set(url, doc([{ name: "26", isEol: false, eolFrom: "2029-04-30" }, { name: "24", isEol: false, eolFrom: "2027-01-31" }]));
    await pollSource(ctx, await reload(ctx, source.id));
    const titles = (await allEvents(ctx)).map((e) => e.title);
    expect(titles).toEqual(["nodejs 24: end of life moved earlier, from 2028-04-30 to 2027-01-31", "nodejs 26: end-of-life date set to 2029-04-30"]);

    // Within 90 days of 2027-01-31: one reminder, even if the server says 304 from now on.
    clock.set(Date.UTC(2026, 11, 1));
    http.set(url, new Response(null, { status: 304 }));
    await pollSource(ctx, await reload(ctx, source.id));
    await pollSource(ctx, await reload(ctx, source.id));
    const reminders = (await allEvents(ctx)).filter((e) => e.title.includes("reaches end of life"));
    expect(reminders.map((e) => [e.title, e.effectiveDate])).toEqual([["nodejs 24 reaches end of life on 2027-01-31", "2027-01-31"]]);
    expect(clock.now() + 90 * DAY).toBeGreaterThan(Date.UTC(2027, 0, 31));
  });

  it("a later EOL date is not an event", async () => {
    const { ctx, http } = testCtx();
    http.set(url, doc([{ name: "24", eolFrom: "2028-04-30" }]));
    const source = await addSource(ctx, { kind: "eol", key: "nodejs", url });
    await pollSource(ctx, source);
    http.set(url, doc([{ name: "24", eolFrom: "2028-10-30" }]));
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("changed");
    expect(await allEvents(ctx)).toHaveLength(0);
  });
});

describe("feed", () => {
  const url = "https://blog.example.com/rss/";
  const robots = "https://blog.example.com/robots.txt";
  const rss = (items: [string, string, string][], build = "Sat, 10 Oct 2026 12:00:00 GMT") =>
    new Response(
      `<?xml version="1.0"?><rss><channel><lastBuildDate>${build}</lastBuildDate>${items
        .map(([id, title, body]) => `<item><guid>${id}</guid><title>${title}</title><link>https://blog.example.com/${id}?utm_source=rss</link><description>${body}</description></item>`)
        .join("")}</channel></rss>`,
      { headers: { "content-type": "application/rss+xml" } },
    );

  it("baselines on the first poll, then stores new items as pending_llm events with their text", async () => {
    const { ctx, http } = testCtx();
    http.set(robots, "User-agent: *\nDisallow: /admin");
    http.set(url, () => rss([["p1", "Old post", "old"]]));
    const source = await addSource(ctx, { kind: "feed", key: url, url });
    expect((await pollSource(ctx, source)).status).toBe("baseline");
    http.set(url, () => rss([["p1", "Old post", "old"]], "Sun, 11 Oct 2026 08:00:00 GMT"));
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("unchanged");

    http.set(url, () => rss([["p2", "Deno and Cloudflare", "We will end our development of the Deno runtime."], ["p1", "Old post", "old"]]));
    const report = await pollSource(ctx, await reload(ctx, source.id));
    expect(report).toMatchObject({ status: "changed", eventsCreated: 1 });
    const [e] = await allEvents(ctx);
    expect(e).toMatchObject({ kind: "other", status: "pending_llm", title: "Deno and Cloudflare", quoteUrl: "https://blog.example.com/p2" });
    expect(e.afterText).toContain("end our development of the Deno runtime");
    // robots.txt is fetched once and cached.
    expect(http.count(robots)).toBe(1);
  });

  it("uses conditional requests", async () => {
    const { ctx, http } = testCtx();
    http.set(robots, "");
    http.set(url, (req) =>
      req.headers.get("if-none-match") === '"v1"' ? new Response(null, { status: 304 }) : new Response(rss([["p1", "A", "a"]]).body, { headers: { etag: '"v1"' } }),
    );
    const source = await addSource(ctx, { kind: "feed", key: url, url });
    await pollSource(ctx, source);
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("not_modified");
  });

  it("is blocked at once when robots.txt disallows it", async () => {
    const { ctx, http } = testCtx();
    http.set(robots, "User-agent: StackquakeBot\nDisallow: /rss/");
    const source = await addSource(ctx, { kind: "feed", key: url, url });
    const report = await pollSource(ctx, source);
    expect(report.status).toBe("blocked");
    expect((await reload(ctx, source.id)).state).toBe("blocked");
    expect(http.count(url)).toBe(0);
  });

  it("marks a source blocked after three challenges in a row, and stops polling it", async () => {
    const { ctx, http, clock } = testCtx();
    http.set(robots, "");
    http.set(url, () => new Response("<title>Vercel Security Checkpoint</title>", { status: 429, headers: { "x-vercel-mitigated": "challenge" } }));
    const source = await addSource(ctx, { kind: "feed", key: url, url });
    await enqueue(ctx, { kind: "poll", sourceId: source.id, dedupeKey: pollJobKey(source.id) });
    for (let i = 1; i <= 3; i++) {
      const s = await reload(ctx, source.id);
      expect(s.state).toBe("active");
      clock.set(s.nextPollAt);
      await ctx.db.update(jobs).set({ runAfter: clock.now() });
      await runTick(ctx);
    }
    const blocked = await reload(ctx, source.id);
    expect(blocked).toMatchObject({ state: "blocked", blockStrikes: 3, lastError: "Vercel Security Checkpoint" });
    expect(await ctx.db.select().from(jobs).all()).toHaveLength(0);
  });

  it("applies the catalog keyword filter before creating events", async () => {
    const { ctx, http } = testCtx();
    http.set(robots, "");
    http.set(url, () => rss([["p1", "A", "a"]]));
    const source = await addSource(ctx, { kind: "feed", key: url, url });
    await ctx.db.insert((await import("../src/db/schema")).catalogSources).values({ catalogId: "x", sourceId: source.id, filter: ["pricing"] });
    await pollSource(ctx, source);
    http.set(url, () => rss([["p3", "New pricing for Workers", "..."], ["p2", "Our new office", "..."], ["p1", "A", "a"]]));
    await pollSource(ctx, await reload(ctx, source.id));
    expect((await allEvents(ctx)).map((e) => e.title)).toEqual(["New pricing for Workers"]);
  });
});

describe("page", () => {
  const url = "https://vendor.example.com/pricing";
  const html = (free: string, updated: string) =>
    `<html><body><nav>menu</nav><main><h1>Pricing</h1><p>Updated ${updated}</p><h2>Free</h2><p>${free}</p><p>Paid: $5/month</p></main></body></html>`;

  async function setup() {
    const t = testCtx();
    t.http.set("https://vendor.example.com/robots.txt", "");
    const source = await addSource(t.ctx, { kind: "page", key: `${url} main`, url, selector: "main" });
    return { ...t, source };
  }

  it("ignores a timestamp-only change: no snapshot body, no diff job, no event", async () => {
    const { ctx, http, source, blobs } = await setup();
    http.set(url, html("100,000 requests per day", "5 minutes ago"));
    await pollSource(ctx, source);
    http.set(url, html("100,000 requests per day", "2 hours ago"));
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("unchanged");
    expect(blobs.blobs.size).toBe(1);
    expect(await ctx.db.select().from(jobs).all()).toHaveLength(0);
  });

  it("queues extract_diff on a real change, which creates a pending_llm event with before/after", async () => {
    const { ctx, http, source } = await setup();
    http.set(url, html("100,000 requests per day", "5 minutes ago"));
    await pollSource(ctx, source);
    http.set(url, html("10,000 requests per day, then requests fail", "1 minute ago"));
    expect((await pollSource(ctx, await reload(ctx, source.id))).status).toBe("changed");
    const [job] = await ctx.db.select().from(jobs).all();
    expect(job.kind).toBe("extract_diff");
    expect((await runTick(ctx)).done).toBe(1);
    const [e] = await allEvents(ctx);
    expect(e).toMatchObject({ kind: "other", status: "pending_llm", quoteUrl: url });
    expect(e.beforeText).toBe("Pricing\nFree\n100,000 requests per day");
    expect(e.afterText).toBe("Pricing\nFree\n10,000 requests per day, then requests fail");
  });

  it("drops a diff under 20 characters without an event", async () => {
    const { ctx, http, source } = await setup();
    http.set(url, html("Beta", "x"));
    await pollSource(ctx, source);
    http.set(url, html("GA", "x"));
    const s = await reload(ctx, source.id);
    const before = s.lastSha!;
    await pollSource(ctx, s);
    const after = (await reload(ctx, source.id)).lastSha!;
    expect(await extractDiff(ctx, s, before, after)).toEqual({ type: "below_threshold", changedChars: 4 });
    expect(await allEvents(ctx)).toHaveLength(0);
  });

  it("records every poll as a snapshot row, storing the body only when the hash changes", async () => {
    const { ctx, http, source } = await setup();
    http.set(url, html("A plan with plenty of requests", "x"));
    await pollSource(ctx, source);
    await pollSource(ctx, await reload(ctx, source.id));
    const rows = await ctx.db.select().from(snapshots).all();
    expect(rows).toHaveLength(2);
    expect(rows[0].r2Key).toBe(`snap/${rows[0].sha256}`);
    expect(rows[1].r2Key).toBeNull();
    expect(rows[1].sha256).toBe(rows[0].sha256);
  });

  it("backs off exponentially on 5xx, honouring Retry-After, up to 24 h", async () => {
    const { ctx, http, source, clock } = await setup();
    http.set(url, () => new Response("down", { status: 503 }));
    const r1 = await pollSource(ctx, source);
    expect(r1.nextPollAt - clock.now()).toBe(5 * 60_000);
    const r2 = await pollSource(ctx, await reload(ctx, source.id));
    expect(r2.nextPollAt - clock.now()).toBe(10 * 60_000);
    http.set(url, () => new Response("slow down", { status: 429, headers: { "retry-after": "7200" } }));
    const r3 = await pollSource(ctx, await reload(ctx, source.id));
    expect(r3.nextPollAt - clock.now()).toBe(2 * 3_600_000);
    await ctx.db.update((await import("../src/db/schema")).sources).set({ failCount: 20 });
    const r4 = await pollSource(ctx, await reload(ctx, source.id));
    expect(r4.nextPollAt - clock.now()).toBe(DAY);
  });
});
