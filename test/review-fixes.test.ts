// Regression tests for the M1 code review findings.
import { beforeEach, describe, expect, it } from "vitest";
import { syncCatalog, type CatalogEntry } from "../src/catalog/catalog";
import { events, jobs, sources } from "../src/db/schema";
import { enqueue, pruneJobs } from "../src/jobs/queue";
import { extractText, isUnique } from "../src/sources/html";
import { npmUrl } from "../src/sources/kinds/npm";
import { pypiUrl } from "../src/sources/kinds/pypi";
import { normaliseText } from "../src/sources/normalise";
import { DAY } from "../src/util";
import { pollSource } from "../src/watch/poll";
import { addSource, reload, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

const extract = async (html: string, exclude?: string[]) =>
  normaliseText((await extractText(new Response(html).body!, { selector: "main", exclude, maxChars: 10_000, maxBytes: 100_000 })).text);

describe("HTML extraction", () => {
  it("keeps text after a self-closing svg or an excluded void element", async () => {
    expect(await extract(`<main><p>Before</p><svg viewBox="0 0 1 1"/><p>After</p></main>`)).toBe("Before\nAfter");
    expect(await extract(`<main><p>Before</p><img src="x"><p>After</p></main>`, ["img"])).toBe("Before\nAfter");
  });
  it("does not stop at the first article", () => {
    expect(isUnique("article")).toBe(false);
    expect(isUnique("main")).toBe(true);
    expect(isUnique("#pricing")).toBe(true);
  });
});

describe("registry and GitHub events", () => {
  it("records a licence change that happens again months later", async () => {
    const { ctx, http, clock } = testCtx();
    const url = npmUrl("kv");
    const source = await addSource(ctx, { kind: "npm", key: "kv", url });
    for (const [license, monthsLater] of [["MIT", 0], ["BUSL-1.1", 0], ["MIT", 1], ["BUSL-1.1", 5]] as const) {
      clock.advance(monthsLater * 31 * DAY);
      http.set(url, { name: "kv", version: "1.0.0", license });
      await pollSource(ctx, await reload(ctx, source.id));
    }
    const titles = (await ctx.db.select().from(events).all()).map((e) => e.title);
    expect(titles.filter((t) => t.endsWith("from MIT to BUSL-1.1"))).toHaveLength(2);
  });

  it("detects that the previously latest PyPI release was yanked", async () => {
    const { ctx, http } = testCtx();
    const url = pypiUrl("acme");
    const doc = (version: string, yanked: boolean) => ({
      info: { version, license_expression: "MIT", classifiers: [] },
      releases: { "1.0.0": [{ yanked: false }], "2.0.0": [{ yanked, yanked_reason: yanked ? "Broken build" : null }] },
    });
    http.set(url, doc("2.0.0", false));
    const source = await addSource(ctx, { kind: "pypi", key: "acme", url });
    await pollSource(ctx, source);
    // PyPI moves `info` to the latest release that is not yanked.
    http.set(url, doc("1.0.0", true));
    await pollSource(ctx, await reload(ctx, source.id));
    const [e] = await ctx.db.select().from(events).all();
    expect(e).toMatchObject({ kind: "deprecated", title: "acme (PyPI): release 2.0.0 was yanked", quote: "Broken build" });
  });

  it("turns a parse error into a source retry, not a job failure", async () => {
    const { ctx, http } = testCtx();
    const url = npmUrl("broken");
    http.set(url, new Response("<html>oops</html>", { headers: { "content-type": "text/html" } }));
    const source = await addSource(ctx, { kind: "npm", key: "broken", url });
    const report = await pollSource(ctx, source);
    expect(report.status).toBe("retry");
    expect((await reload(ctx, source.id)).lastError).toMatch(/^error: SyntaxError/);
  });
});

describe("jobs and catalog", () => {
  it("revives a poll job parked for more than a day", async () => {
    const { ctx, clock } = testCtx();
    await enqueue(ctx, { kind: "poll", dedupeKey: "poll:1" });
    await ctx.db.update(jobs).set({ parkedAt: clock.now(), attempts: 6, lastError: "boom" });
    clock.advance(DAY + 1);
    await pruneJobs(ctx);
    const [job] = await ctx.db.select().from(jobs).all();
    expect(job).toMatchObject({ parkedAt: null, attempts: 0, runAfter: clock.now() });
  });

  it("re-baselines a page whose extraction rules change", async () => {
    const { ctx } = testCtx();
    const entry = (ignore?: string[]): CatalogEntry => ({ id: "x", name: "X", category: "hosting", sources: [{ kind: "page", url: "https://x.example/p", selector: "main", ignore }] });
    await syncCatalog(ctx, [entry()]);
    await ctx.db.update(sources).set({ etag: '"v1"', lastSha: "abc", lastState: { chars: 1 } });
    await syncCatalog(ctx, [entry(["Build \\d+"])]);
    const [s] = await ctx.db.select().from(sources).all();
    expect(s).toMatchObject({ etag: null, lastSha: null, lastState: null, config: { origin: "catalog", ignore: ["Build \\d+"] } });
  });
});
