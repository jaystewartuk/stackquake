import { beforeEach, describe, expect, it } from "vitest";
import { catalogSources, events } from "../src/db/schema";
import { githubUrl } from "../src/sources/kinds/github";
import { npmUrl } from "../src/sources/kinds/npm";
import { dedupeKey, recordEvent } from "../src/watch/events";
import { pollSource } from "../src/watch/poll";
import { addSource, reload, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

describe("dedupe", () => {
  it("the same announcement seen via a feed and a page creates one event", async () => {
    const { ctx } = testCtx();
    const feed = await addSource(ctx, { kind: "feed", key: "https://deno.com/feed", url: "https://deno.com/feed" });
    const page = await addSource(ctx, { kind: "page", key: "https://deno.com/deploy/pricing main", url: "https://deno.com/deploy/pricing", selector: "main" });
    // After classification (M2) both carry the same catalog entry, kind and title;
    // punctuation and case differences do not matter.
    const viaFeed = await recordEvent(ctx, {
      sourceId: feed.id,
      sourceKind: "feed",
      catalogId: "deno",
      change: { kind: "eol", title: "Deno runtime: development ends in about a year", quoteUrl: "https://deno.com/blog/deno-joins-cloudflare" },
    });
    const viaPage = await recordEvent(ctx, {
      sourceId: page.id,
      sourceKind: "page",
      catalogId: "deno",
      change: { kind: "eol", title: "Deno runtime — development ends in about a year!", quoteUrl: "https://deno.com/deploy/pricing" },
    });
    expect(viaFeed.created).toBe(true);
    expect(viaPage).toEqual({ id: viaFeed.id, created: false });
    expect(await ctx.db.select().from(events).all()).toHaveLength(1);
  });

  it("an npm and a GitHub source of one catalog entry seeing the same licence change create one event", async () => {
    const { ctx, http } = testCtx();
    const npmSrc = await addSource(ctx, { kind: "npm", key: "widget", url: npmUrl("widget") });
    const ghSrc = await addSource(ctx, { kind: "github_repo", key: "acme/widget", url: githubUrl("acme/widget") });
    await ctx.db.insert(catalogSources).values([
      { catalogId: "widget", sourceId: npmSrc.id },
      { catalogId: "widget", sourceId: ghSrc.id },
    ]);
    const lic = "https://api.github.com/repos/acme/widget/license";
    http.set(npmUrl("widget"), { name: "widget", version: "1.0.0", license: "MIT" });
    http.set(githubUrl("acme/widget"), { full_name: "acme/widget", owner: { login: "acme" }, archived: false, license: { spdx_id: "MIT" } });
    http.set(lic, { path: "LICENSE", sha: "s1" });
    await pollSource(ctx, npmSrc);
    await pollSource(ctx, ghSrc);

    http.set(npmUrl("widget"), { name: "widget", version: "2.0.0", license: "BUSL-1.1" });
    http.set(githubUrl("acme/widget"), { full_name: "acme/widget", owner: { login: "acme" }, archived: false, license: { spdx_id: "BUSL-1.1" } });
    http.set(lic, { path: "LICENSE", sha: "s2" });
    expect((await pollSource(ctx, await reload(ctx, npmSrc.id))).eventsCreated).toBe(1);
    expect((await pollSource(ctx, await reload(ctx, ghSrc.id))).eventsCreated).toBe(0);
    const all = await ctx.db.select().from(events).all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "license", catalogId: "widget" });
  });

  it("different kinds or catalog entries do not collide", async () => {
    expect(await dedupeKey("deno", "eol", "X")).not.toBe(await dedupeKey("deno", "license", "X"));
    expect(await dedupeKey("deno", "eol", "X")).not.toBe(await dedupeKey("bun", "eol", "X"));
  });
});
