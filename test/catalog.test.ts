import { beforeEach, describe, expect, it } from "vitest";
import { syncCatalog, validateEntry, type CatalogEntry } from "../src/catalog/catalog";
import { CATALOG } from "../src/catalog/entries";
import { catalogSources, jobs, snapshots, sources } from "../src/db/schema";
import { pruneSnapshots, runDaily } from "../src/jobs/cron";
import { snapshotKey } from "../src/watch/poll";
import { utf8 } from "../src/util";
import { addSource, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

describe("catalog", () => {
  it("ships valid entries", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(25);
    const hosted = CATALOG.filter((e) => !["runtime", "infrastructure", "self_hosted", "security"].includes(e.category));
    expect(hosted.length / CATALOG.length).toBeGreaterThan(0.5);
    for (const e of CATALOG) expect(validateEntry(e)).toEqual([]);
  });

  it("rejects bad entries", () => {
    expect(validateEntry({ id: "Bad Id", name: "x", category: "y", sources: [{ kind: "page", url: "http://x" }] })).toEqual([
      "catalog Bad Id: id must be kebab-case",
      "catalog Bad Id: category must be one of hosting, database, storage, auth, email, payments, ai, monitoring, ci, runtime, infrastructure, security, self_hosted",
      "catalog Bad Id: sources[0]: url must be https",
      "catalog Bad Id: sources[0]: selector is required",
    ]);
  });

  it("syncs idempotently, sharing sources between entries and queueing one poll per source", async () => {
    const { ctx } = testCtx();
    const first = await syncCatalog(ctx, CATALOG);
    const again = await syncCatalog(ctx, CATALOG);
    expect(again.created).toBe(0);
    expect(again.sources).toBe(first.sources);
    const rows = await ctx.db.select().from(sources).all();
    expect(rows).toHaveLength(first.sources);
    expect(await ctx.db.select().from(jobs).all()).toHaveLength(first.sources);
  });

  it("disables catalog sources no entry uses any more, and re-enables them when they return", async () => {
    const { ctx } = testCtx();
    const entry: CatalogEntry = { id: "x", name: "X", category: "hosting", sources: [{ kind: "npm", package: "a" }, { kind: "npm", package: "b" }] };
    await syncCatalog(ctx, [entry]);
    await syncCatalog(ctx, [{ ...entry, sources: [{ kind: "npm", package: "a" }] }]);
    const states = Object.fromEntries((await ctx.db.select().from(sources).all()).map((s) => [s.key, s.state]));
    expect(states).toEqual({ a: "active", b: "disabled" });
    expect(await ctx.db.select().from(catalogSources).all()).toHaveLength(1);
    await syncCatalog(ctx, [entry]);
    expect((await ctx.db.select().from(sources).all()).every((s) => s.state === "active")).toBe(true);
  });
});

describe("daily", () => {
  it("re-creates a missing poll job for an active source", async () => {
    const { ctx } = testCtx();
    await syncCatalog(ctx, CATALOG);
    const before = (await ctx.db.select().from(jobs).all()).length;
    await ctx.db.delete(jobs);
    await runDaily(ctx, CATALOG);
    expect(await ctx.db.select().from(jobs).all()).toHaveLength(before);
  });

  it("keeps the latest 20 bodies per source and never deletes one still in use", async () => {
    const { ctx, blobs } = testCtx();
    const s = await addSource(ctx, { kind: "page", key: "k", url: "https://x.example/p", selector: "main" });
    const shared = await addSource(ctx, { kind: "page", key: "k2", url: "https://x.example/q", selector: "main" });
    for (let i = 0; i < 25; i++) {
      const key = snapshotKey(`sha${i}`);
      await blobs.put(key, utf8(String(i)));
      await ctx.db.insert(snapshots).values({ sourceId: s.id, fetchedAt: ctx.clock.now() - 10 * 86_400_000 + i, httpStatus: 200, sha256: `sha${i}`, r2Key: key });
    }
    // Another source still points at sha0's body.
    await ctx.db.insert(snapshots).values({ sourceId: shared.id, fetchedAt: ctx.clock.now() - 10 * 86_400_000, httpStatus: 200, sha256: "sha0", r2Key: snapshotKey("sha0") });
    const r = await pruneSnapshots(ctx);
    expect(r.blobsDeleted).toBe(4);
    expect([...blobs.blobs.keys()].sort()).not.toContain(snapshotKey("sha1"));
    expect(await blobs.has(snapshotKey("sha0"))).toBe(true);
    expect(await blobs.has(snapshotKey("sha24"))).toBe(true);
    expect(blobs.blobs.size).toBe(21);
  });
});
