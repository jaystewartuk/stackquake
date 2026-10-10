// M2 event pipeline with the fake LLM: fetch_post → classify → summarise → quote check → gate.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events, jobs, llmCalls, sources, type Event } from "../src/db/schema";
import { ensurePipelineJobs } from "../src/jobs/queue";
import { runTick } from "../src/jobs/runner";
import { json, refusal } from "../src/llm/fake";
import { costUsd, type LlmRequest } from "../src/llm/llm";
import { checkSchema, SUMMARISE_SCHEMA, validateClassification, type Classification, type Note } from "../src/llm/schemas";
import { reviewGate } from "../src/pipeline/gate";
import { quoteFound } from "../src/pipeline/quote";
import { MAX_LLM_ATTEMPTS } from "../src/pipeline/steps";
import type { DetectedChange } from "../src/sources/types";
import { gzip, MINUTE, utf8 } from "../src/util";
import { recordEvent } from "../src/watch/events";
import { snapshotKey } from "../src/watch/poll";
import { addSource, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

type T = ReturnType<typeof testCtx>;

const DENO_QUOTE = "We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.";
const POST_HTML = `<html><body><nav>Blog</nav><article><h1>Deno is joining Cloudflare</h1>
<p>Today we’re announcing that the entire Deno team is joining <a href="https://cloudflare.com">Cloudflare</a>.</p>
<p>We will support the <a href="/runtime">Deno runtime</a> for
another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.</p>
</article></body></html>`;
const POST_URL = "https://deno.com/blog/cloudflare";

const classification = (over: Partial<Classification> = {}): Classification => ({ kind: "eol", confidence: 0.95, effective_date: "2027-10", one_line: "Deno runtime development ends in a year.", quote: DENO_QUOTE, ...over });
const note = (over: Partial<Note> = {}): Note => ({
  material: true,
  kind: "eol",
  title: "Deno runtime development ends",
  what_changed: "Deno gets one more year of bug fixes, then development ends.",
  quote: DENO_QUOTE,
  effective_date: "2027-10",
  applies_when: { hosting: [], use: [], tier: [] },
  who_is_not_affected: null,
  options: [{ catalog_id: "nodejs", name: "Node.js", why: "Mature runtime", effort: "medium" }],
  uncertain: [],
  confidence: 0.95,
  ...over,
});

async function feedEvent(t: T, change: Partial<DetectedChange> = {}, catalogId: string | null = "deno") {
  const source =
    (await t.ctx.db.select().from(sources).where(eq(sources.key, "https://deno.com/feed")).get()) ??
    (await addSource(t.ctx, { kind: "feed", key: "https://deno.com/feed", url: "https://deno.com/feed" }));
  const { id } = await recordEvent(t.ctx, {
    sourceId: source.id,
    sourceKind: "feed",
    catalogId,
    change: { kind: "other", title: "Deno is joining Cloudflare", dedupeTitle: `feed item ${POST_URL}`, quoteUrl: POST_URL, afterText: "The Deno team is joining Cloudflare.", ...change },
  });
  return { source, id };
}

/** Runs ticks until no job is due, moving the clock past deferrals and retry backoff. */
async function drain(t: T, maxTicks = 40) {
  for (let i = 0; i < maxTicks; i++) {
    const r = await runTick(t.ctx);
    if (r.claimed === 0) {
      const next = await t.ctx.db.select().from(jobs).all();
      if (!next.some((j) => j.parkedAt === null)) return;
    }
    t.clock.advance(13 * 60 * MINUTE);
  }
  throw new Error("pipeline did not settle");
}

const getEvent = async (t: T, id: number): Promise<Event> => (await t.ctx.db.select().from(events).where(eq(events.id, id)).get())!;

describe("quote check", () => {
  const source = "We will support the Deno runtime for\nanother year with monthly releases.\nAfter that year we will end our development of the Deno runtime.";

  it("finds a verbatim quote", () => {
    expect(quoteFound("After that year we will end our development of the Deno runtime.", [source])).toBe(true);
  });

  it("ignores whitespace differences, including line breaks from HTML extraction", () => {
    expect(quoteFound("We will support the Deno runtime for another year with monthly releases.", [source])).toBe(true);
    expect(quoteFound("We  will support\tthe Deno runtime   for another year", [source])).toBe(true);
    // HTML extraction stores "See <a>docs</a>." as "See \ndocs\n.".
    expect(quoteFound("See docs for details.", ["Pricing changes.\nSee \ndocs\n for details\n."])).toBe(true);
  });

  it("treats typographic quotes, dashes and Markdown markup as equal to plain ones", () => {
    expect(quoteFound("Today we're announcing that the team is joining Cloudflare", ["Today we’re announcing that the team is joining [Cloudflare](https://cloudflare.com)"])).toBe(true);
    expect(quoteFound("No change to self-hosting", ["- **No change to self‑hosting, the licensing change affects resellers**"])).toBe(true);
  });

  it("rejects a made-up or edited quote", () => {
    expect(quoteFound("After that year we will stop maintaining the Deno runtime.", [source])).toBe(false);
    expect(quoteFound("We will support the Deno runtime for two more years", [source])).toBe(false);
    // Joining two passages with an ellipsis is not verbatim.
    expect(quoteFound("We will support the Deno runtime … end our development of the Deno runtime.", [source])).toBe(false);
  });

  it("rejects empty and trivially short quotes", () => {
    expect(quoteFound("", [source])).toBe(false);
    expect(quoteFound(null, [source])).toBe(false);
    expect(quoteFound("Deno", [source])).toBe(false);
  });

  it("looks in every source text", () => {
    expect(quoteFound('"license": "BUSL-1.1"', ['"license": "MIT"', '"license": "BUSL-1.1" (version 2.0.0)'])).toBe(true);
  });
});

describe("review gate", () => {
  it.each([
    [{ kind: "license", confidence: 0.95, quoteFound: true }, "published"],
    [{ kind: "eol", confidence: 0.9, quoteFound: true }, "published"],
    [{ kind: "deprecated", confidence: 0.99, quoteFound: true }, "published"],
    [{ kind: "archived", confidence: 0.92, quoteFound: true }, "published"],
    [{ kind: "eol", confidence: 0.89, quoteFound: true }, "pending_review"],
    [{ kind: "license", confidence: 0.99, quoteFound: false }, "pending_review"],
    [{ kind: "pricing", confidence: 0.99, quoteFound: true }, "pending_review"],
    [{ kind: "free_tier", confidence: 0.99, quoteFound: true }, "pending_review"],
    [{ kind: "acquisition", confidence: 0.99, quoteFound: true }, "pending_review"],
    [{ kind: "other", confidence: 0.99, quoteFound: true }, "pending_review"],
  ] as const)("%o → %s", (input, status) => {
    expect(reviewGate(input).status).toBe(status);
  });

  it("says why an event needs review", () => {
    expect(reviewGate({ kind: "pricing", confidence: 0.5, quoteFound: false }).reason).toBe("quote not found in the source; kind pricing always needs review; confidence 0.50 < 0.9");
  });
});

describe("schemas", () => {
  it("accepts a well-formed note and rejects extra or missing fields", () => {
    expect(checkSchema(SUMMARISE_SCHEMA, note())).toEqual([]);
    expect(checkSchema(SUMMARISE_SCHEMA, { ...note(), extra: 1 })).toEqual(["$.extra: unexpected"]);
    const { title: _t, ...missing } = note();
    expect(checkSchema(SUMMARISE_SCHEMA, missing)).toEqual(["$.title: missing"]);
  });

  it("checks what the API schema cannot: confidence range and date shape", () => {
    expect(validateClassification(classification({ confidence: 1.5 })).ok).toBe(false);
    expect(validateClassification(classification({ effective_date: "next year" })).ok).toBe(false);
    expect(validateClassification(classification({ effective_date: "2027-10-09" })).ok).toBe(true);
  });

  it("prices calls per model, including the fallback split", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costUsd("claude-haiku-5-5", usage)).toBeCloseTo(0.15);
    expect(costUsd("claude-opus-5-5", usage)).toBeCloseTo(6);
    expect(costUsd("claude-opus-4-8", { ...usage, byModel: [{ model: "claude-opus-5-5", ...usage }, { model: "claude-opus-4-8", ...usage }] })).toBeCloseTo(13.5);
  });
});

describe("feed item pipeline", () => {
  it("fetches the post, classifies, summarises on the high-stakes model and auto-publishes", async () => {
    const t = testCtx();
    t.http.set("https://deno.com/robots.txt", "User-agent: *\nDisallow: /x/");
    t.http.set(POST_URL, POST_HTML);
    t.llm.on("classify", json(classification())).on("summarise", json(note()));
    const { id } = await feedEvent(t);
    await drain(t);

    const e = await getEvent(t, id);
    expect(e).toMatchObject({ status: "published", kind: "eol", title: "Deno runtime development ends", quote: DENO_QUOTE, quoteFound: true, effectiveDate: "2027-10", reviewReason: null });
    expect(e.publishedAt).not.toBeNull();
    expect(e.sourceKeys).toHaveLength(1);
    // The post was fetched once, politely, and its text (not the feed excerpt) went to the model.
    expect(t.http.count(POST_URL)).toBe(1);
    expect(t.http.requests.find((r) => r.url === POST_URL)!.headers.get("user-agent")).toContain("StackquakeBot");
    const [c] = t.llm.calls("classify");
    expect(c).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    expect(c.input).toContain("end our development of the Deno runtime");
    expect(c.input.indexOf("<post>")).toBeGreaterThan(0);
    expect(c.system).toContain("untrusted");
    // eol was known before summarising, so the note went straight to the high-stakes model.
    expect(t.llm.calls("summarise").map((r) => [r.model, r.effort])).toEqual([["claude-opus-5-5", "medium"]]);
    const calls = await t.ctx.db.select().from(llmCalls).all();
    expect(calls.map((r) => [r.purpose, r.model, r.eventId, r.outcome])).toEqual([
      ["classify", "claude-haiku-5-5", id, "ok"],
      ["summarise", "claude-opus-5-5", id, "ok"],
    ]);
    expect(calls[1].costUsd).toBeCloseTo((1_000 * 4 + 100 * 20) / 1e6);
    expect(await t.ctx.db.select().from(jobs).all()).toEqual([]);
  });

  it("uses the feed text when it is long enough, and does not fetch the post", async () => {
    const t = testCtx();
    t.llm.on("classify", json(classification({ kind: "other", confidence: 0.9 })));
    const { id } = await feedEvent(t, { afterText: "x".repeat(2_500) });
    await drain(t);
    expect(t.http.requests).toHaveLength(0);
    expect(await getEvent(t, id)).toMatchObject({ status: "rejected", reviewReason: "classifier: other (0.90)" });
  });

  it("rejects kind other and low confidence without summarising", async () => {
    for (const c of [classification({ kind: "other", confidence: 0.99 }), classification({ kind: "pricing", confidence: 0.6 })]) {
      await resetDb();
      const t = testCtx();
      t.llm.on("classify", json(c));
      const { id } = await feedEvent(t, { afterText: "y".repeat(2_500) });
      await drain(t);
      expect((await getEvent(t, id)).status).toBe("rejected");
      expect(t.llm.calls("summarise")).toHaveLength(0);
    }
  });

  it("carries on with the feed text when the post is blocked", async () => {
    const t = testCtx();
    t.http.set("https://deno.com/robots.txt", "User-agent: *\nDisallow: /blog/");
    t.llm.on("classify", json(classification({ kind: "other" })));
    const { id } = await feedEvent(t);
    await drain(t);
    expect(t.http.count(POST_URL)).toBe(0);
    expect(t.llm.calls("classify")[0].input).toContain("The Deno team is joining Cloudflare.");
    expect((await getEvent(t, id)).reviewReason).toBe("classifier: other (0.95)");
  });

  it("keeps a note whose quote is not in the source in pending_review", async () => {
    const t = testCtx();
    t.http.set(POST_URL, POST_HTML);
    t.llm.on("classify", json(classification())).on("summarise", json(note({ quote: "Deno will be shut down next year." })));
    const { id } = await feedEvent(t);
    await drain(t);
    expect(await getEvent(t, id)).toMatchObject({ status: "pending_review", quoteFound: false, reviewReason: "quote not found in the source", publishedAt: null });
  });

  it("rejects a post the note writer finds is no deal change", async () => {
    const t = testCtx();
    t.http.set(POST_URL, POST_HTML);
    t.llm.on("classify", json(classification({ kind: "pricing", confidence: 0.75 }))).on("summarise", json(note({ kind: "other", material: false })));
    const { id } = await feedEvent(t);
    await drain(t);
    expect(await getEvent(t, id)).toMatchObject({ status: "rejected", note: null });
    expect((await getEvent(t, id)).reviewReason).toMatch(/^summariser: not a deal change/);
  });
});

describe("refusals", () => {
  it("a classify refusal goes to review and is not retried", async () => {
    const t = testCtx();
    t.http.set(POST_URL, POST_HTML);
    t.llm.on("classify", refusal("cyber"));
    const { id } = await feedEvent(t);
    await drain(t);
    expect(await getEvent(t, id)).toMatchObject({ status: "pending_review", reviewReason: "classify: model refused (cyber)" });
    expect(t.llm.calls()).toHaveLength(1);
    expect((await t.ctx.db.select().from(llmCalls).all())[0].outcome).toBe("refusal");
  });

  it("a summarise refusal goes to review with a note of why", async () => {
    const t = testCtx();
    t.http.set(POST_URL, POST_HTML);
    t.llm.on("classify", json(classification({ kind: "pricing" }))).on("summarise", refusal(null));
    const { id } = await feedEvent(t);
    await drain(t);
    expect(await getEvent(t, id)).toMatchObject({ status: "pending_review", reviewReason: "summarise: model refused (no category)", note: null });
    expect(t.llm.calls("summarise")).toHaveLength(1);
  });
});

describe("page diffs", () => {
  async function pageEvent(t: T, before: string, after: string) {
    const source = await addSource(t.ctx, { kind: "page", key: "https://developers.cloudflare.com/workers/platform/pricing/ main", url: "https://developers.cloudflare.com/workers/platform/pricing/", selector: "main" });
    for (const [sha, text] of [["old", before], ["new", after]]) await t.ctx.blobs.put(snapshotKey(sha), await gzip(utf8(text)));
    const { id } = await recordEvent(t.ctx, {
      sourceId: source.id,
      sourceKind: "page",
      catalogId: "cloudflare-workers",
      change: { kind: "other", title: `Page changed: ${source.url}`, dedupeTitle: "page diff 1 old new", quoteUrl: source.url, beforeText: before, afterText: after, sourceKeys: [snapshotKey("new"), snapshotKey("old")] },
    });
    return id;
  }

  it("a change that is not material is rejected with no note, after one Haiku call", async () => {
    const t = testCtx();
    t.llm.on("summarise", json(note({ material: false, kind: "other", what_changed: "A link was reworded." })));
    const id = await pageEvent(t, "Read the [limits docs](/limits).", "Read the [limits page](/limits).");
    await drain(t);
    expect(await getEvent(t, id)).toMatchObject({ status: "rejected", note: null, reviewReason: "page change not material: A link was reworded." });
    expect(t.llm.calls().map((r) => r.model)).toEqual(["claude-haiku-5-5"]);
  });

  it("a material free-tier change gets a Haiku note, quoted from the whole page, and waits for review", async () => {
    const t = testCtx();
    const after = "| **Free** | 50,000 per day | No charge for duration |";
    t.llm.on("summarise", json(note({ kind: "free_tier", title: "Workers Free plan: daily requests cut to 50,000", quote: after, effective_date: null })));
    const id = await pageEvent(t, "| **Free** | 100,000 per day | No charge for duration |", after);
    await drain(t);
    const e = await getEvent(t, id);
    expect(e).toMatchObject({ status: "pending_review", kind: "free_tier", quoteFound: true, reviewReason: "kind free_tier always needs review" });
    const [req] = t.llm.calls("summarise");
    expect(req.input).toContain("<before>");
    expect(req.input).toContain("100,000 per day");
    expect(t.llm.calls().map((r) => r.model)).toEqual(["claude-haiku-5-5"]);
  });

  it("a Haiku note that turns out to be high-stakes is written again by the high-stakes model", async () => {
    const t = testCtx();
    const after = "The software is licensed under the Business Source License 1.1.";
    t.llm.on("summarise", json(note({ kind: "license", quote: after })), json(note({ kind: "license", quote: after, title: "Licence moves to BUSL 1.1" })));
    const id = await pageEvent(t, "The software is licensed under the MIT License.", after);
    await drain(t);
    expect(t.llm.calls().map((r) => r.model)).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(await getEvent(t, id)).toMatchObject({ status: "published", kind: "license", title: "Licence moves to BUSL 1.1" });
  });
});

describe("deterministic events", () => {
  it("an npm licence change is summarised on the high-stakes model and auto-published", async () => {
    const t = testCtx();
    const source = await addSource(t.ctx, { kind: "npm", key: "left-pad-pro", url: "https://registry.npmjs.org/left-pad-pro/latest" });
    t.llm.on("summarise", (req: LlmRequest) => {
      expect(req.input).toContain('"license": "BUSL-1.1"');
      return json(note({ kind: "license", quote: '"license": "BUSL-1.1"', title: "left-pad-pro moves to BUSL-1.1" }));
    });
    const { id } = await recordEvent(t.ctx, {
      sourceId: source.id,
      sourceKind: "npm",
      catalogId: null,
      change: { kind: "license", title: "left-pad-pro (npm): licence changed from MIT to BUSL-1.1", quoteUrl: "https://www.npmjs.com/package/left-pad-pro", beforeText: '"license": "MIT"', afterText: '"license": "BUSL-1.1" (version 2.0.0)' },
    });
    await drain(t);
    expect(await getEvent(t, id)).toMatchObject({ status: "published", kind: "license", quoteFound: true });
    expect(t.llm.calls().map((r) => [r.purpose, r.model])).toEqual([["summarise", "claude-opus-5-5"]]);
  });

  it("keeps the detected kind even if the note says otherwise", async () => {
    const t = testCtx();
    const source = await addSource(t.ctx, { kind: "github_repo", key: "acme/widget", url: "https://api.github.com/repos/acme/widget" });
    t.llm.on("summarise", json(note({ kind: "eol", quote: '"archived": true' })));
    const { id } = await recordEvent(t.ctx, {
      sourceId: source.id,
      sourceKind: "github_repo",
      catalogId: null,
      change: { kind: "archived", title: "acme/widget: repository archived", quoteUrl: "https://github.com/acme/widget", beforeText: '"archived": false', afterText: '"archived": true' },
    });
    await drain(t);
    expect(await getEvent(t, id)).toMatchObject({ status: "published", kind: "archived" });
    expect(t.llm.calls()[0].model).toBe("claude-haiku-5-5");
  });
});

describe("semantic dedupe", () => {
  it("the same announcement from two feed items becomes one event; the newer is marked a duplicate", async () => {
    const t = testCtx();
    t.llm.defaults = { classify: json(classification()), summarise: json(note()) };
    const text = `${DENO_QUOTE} ${"z".repeat(2_000)}`;
    const a = await feedEvent(t, { afterText: text, dedupeTitle: "feed item A", quoteUrl: "https://deno.com/blog/a" });
    t.clock.advance(MINUTE);
    const other = await addSource(t.ctx, { kind: "feed", key: "https://deno.com/feed2", url: "https://deno.com/feed2" });
    const b = await recordEvent(t.ctx, {
      sourceId: other.id,
      sourceKind: "feed",
      catalogId: "deno",
      change: { kind: "other", title: "Deno is joining Cloudflare!", dedupeTitle: "feed item B", quoteUrl: "https://deno.com/blog/b", afterText: text },
    });
    await drain(t);
    const [ea, eb] = [await getEvent(t, a.id), await getEvent(t, b.id)];
    expect(ea.status).toBe("published");
    expect(eb).toMatchObject({ status: "rejected", duplicateOf: a.id, reviewReason: `duplicate of event ${a.id}` });
    // Caught after classify (same title), so the duplicate cost no note.
    expect(t.llm.calls("summarise")).toHaveLength(1);
  });

  it("when the older event reaches the key second, it takes the key and the newer becomes the duplicate", async () => {
    const t = testCtx();
    // The newer post's note is less sure, so it waits for review instead of being published.
    t.llm.defaults = { classify: json(classification()), summarise: (req) => json(note({ confidence: req.input.includes("Post two") ? 0.8 : 0.95 })) };
    const text = `${DENO_QUOTE} ${"z".repeat(2_000)}`;
    const older = await feedEvent(t, { afterText: text, dedupeTitle: "feed item old", title: "Post one" });
    t.clock.advance(MINUTE);
    const newer = await recordEvent(t.ctx, {
      sourceId: older.source.id,
      sourceKind: "feed",
      catalogId: "deno",
      change: { kind: "other", title: "Post two", dedupeTitle: "feed item new", quoteUrl: "https://deno.com/blog/b", afterText: text },
    });
    // Process the newer one first: its classify job runs before the older one's.
    await t.ctx.db.update(jobs).set({ runAfter: t.clock.now() + 60 * MINUTE }).where(eq(jobs.eventId, older.id));
    for (let i = 0; i < 3; i++) await runTick(t.ctx);
    expect((await getEvent(t, newer.id)).status).toBe("pending_review");
    await t.ctx.db.update(jobs).set({ runAfter: t.clock.now() }).where(eq(jobs.eventId, older.id));
    await drain(t);
    // Different post titles, same note title: the older event keeps the announcement.
    expect(await getEvent(t, older.id)).toMatchObject({ status: "published" });
    expect(await getEvent(t, newer.id)).toMatchObject({ status: "rejected", duplicateOf: older.id });
  });
});

describe("retries and idempotence", () => {
  it("each step runs its side effects once even when its job runs twice", async () => {
    const t = testCtx();
    t.http.set(POST_URL, POST_HTML);
    t.llm.on("classify", json(classification())).on("summarise", json(note()));
    const { id } = await feedEvent(t);
    await drain(t);
    // Replay every step for the finished event: nothing is fetched or called again.
    for (const kind of ["fetch_post", "classify", "summarise"] as const) await t.ctx.db.insert(jobs).values({ kind, eventId: id, runAfter: t.clock.now() });
    await drain(t);
    expect(t.http.count(POST_URL)).toBe(1);
    expect(t.llm.calls()).toHaveLength(2);
    expect((await getEvent(t, id)).status).toBe("published");
  });

  it("a classify step that already ran only queues summarise", async () => {
    const t = testCtx();
    t.llm.on("classify", json(classification())).on("summarise", json(note()));
    const { id } = await feedEvent(t, { afterText: `${DENO_QUOTE} ${"z".repeat(2_000)}` });
    await runTick(t.ctx); // fetch_post (skipped: long feed text) → classify queued
    await runTick(t.ctx); // classify
    await t.ctx.db.insert(jobs).values({ kind: "classify", eventId: id, runAfter: t.clock.now() });
    await drain(t);
    expect(t.llm.calls("classify")).toHaveLength(1);
    expect((await getEvent(t, id)).status).toBe("published");
  });

  it("an LLM error is retried with backoff, then the event goes to review", async () => {
    const t = testCtx();
    t.llm.defaults = { classify: () => { throw new Error("overloaded"); } };
    const { id } = await feedEvent(t, { afterText: "w".repeat(2_500) });
    await drain(t);
    expect(t.llm.calls("classify")).toHaveLength(MAX_LLM_ATTEMPTS);
    expect(await getEvent(t, id)).toMatchObject({ status: "pending_review" });
    expect((await getEvent(t, id)).reviewReason).toContain("overloaded");
  });

  it("invalid output is retried, then sent to review", async () => {
    const t = testCtx();
    t.llm.defaults = { classify: json({ kind: "eol" }) };
    const { id } = await feedEvent(t, { afterText: "w".repeat(2_500) });
    await drain(t);
    expect(t.llm.calls("classify")).toHaveLength(MAX_LLM_ATTEMPTS);
    expect((await getEvent(t, id)).reviewReason).toContain("classify output invalid");
  });

  it("the daily run re-queues an event whose pipeline job was lost", async () => {
    const t = testCtx();
    const { id } = await feedEvent(t);
    await t.ctx.db.delete(jobs);
    await ensurePipelineJobs(t.ctx);
    await ensurePipelineJobs(t.ctx);
    expect((await t.ctx.db.select().from(jobs).all()).map((j) => [j.kind, j.eventId])).toEqual([["fetch_post", id]]);
  });

  it("one LLM step per tick", async () => {
    const t = testCtx();
    t.llm.defaults = { classify: json(classification({ kind: "other" })) };
    for (let i = 0; i < 3; i++) await feedEvent(t, { afterText: "v".repeat(2_500), dedupeTitle: `item ${i}` });
    await runTick(t.ctx); // three fetch_post steps, no fetch needed
    await runTick(t.ctx);
    expect(t.llm.calls()).toHaveLength(1);
  });
});
