import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { depSources, deps, imports, jobs, projects, sources } from "../src/db/schema";
import { runTick } from "../src/jobs/runner";
import { claimImportJob, kickImport, MAX_MANIFESTS, MAX_PACKAGES, parseRepoInput, pickManifests, SHOWN_PACKAGES, startImport } from "../src/stack/import";
import { CATALOG } from "../src/catalog/entries";
import { MONOREPO, serveRepo } from "./fixtures/repos";
import { resetDb } from "./helpers";
import { Browser, location, webCtx } from "./web";

beforeEach(resetDb);

/** Paste → progress page (refreshing) → picker. Returns the page loads it took. */
async function importVia(b: Browser, repoUrl: string): Promise<{ projectId: number; loads: number; final: Response }> {
  const res = await b.post("/app/projects", { name: "Shop", repo: repoUrl, next: "import" });
  expect(res.status).toBe(302);
  const progress = location(res)!;
  const projectId = Number(/\/app\/projects\/(\d+)\/import/.exec(progress)![1]);
  let loads = 0;
  for (;;) {
    const r = await b.get(progress);
    loads++;
    if (r.status === 302 || loads > 20) return { projectId, loads, final: r };
    const html = await r.text();
    if (html.includes("Import failed")) return { projectId, loads, final: new Response(html, { status: 200 }) };
    expect(html).toContain('http-equiv="refresh"');
  }
}

describe("E1: public repo import (GitHub API mocked)", () => {
  it("fills the dashboard with the expected catalog deps and runtimes in under 60 s", async () => {
    const started = Date.now();
    const { ctx, http } = await webCtx();
    serveRepo(http, "acme/shop", MONOREPO);
    const b = new Browser(ctx);
    await b.signIn("dev@example.com");

    const { projectId, loads, final } = await importVia(b, "https://github.com/acme/shop");
    expect(location(final)).toBe(`/app/projects/${projectId}/services?imported=1`);
    // The page refreshes every second: well inside G4's 60 s.
    expect(loads).toBeLessThanOrEqual(8);

    const rows = await ctx.db.select().from(deps).where(eq(deps.projectId, projectId)).all();
    const catalogIds = rows.filter((d) => d.catalogId).map((d) => d.catalogId);
    expect(catalogIds).toEqual(expect.arrayContaining(["cloudflare-workers", "supabase", "vercel", "nodejs", "redis", "terraform"]));
    // Runtimes, either as a catalog entry's cycle or as runtime deps of their own.
    const cycles = Object.fromEntries(rows.filter((d) => d.eolProduct).map((d) => [d.eolProduct, d.eolCycle]));
    expect(cycles).toMatchObject({ nodejs: "20", redis: "7.2", python: "3.12", postgresql: "16" });
    // Packages: direct, non-dev, not workspace-internal, not in skipped dirs (docs/, examples/).
    const packages = rows.filter((d) => d.ecosystem && d.ecosystem !== "eol").map((d) => d.depKey);
    expect(packages).toEqual(expect.arrayContaining(["npm:next", "npm:react", "npm:hono", "npm:zod", "npm:class-variance-authority", "pypi:fastapi", "pypi:uvicorn"]));
    for (const k of ["npm:@acme/ui", "npm:turbo", "npm:eslint", "npm:wrangler", "npm:docusaurus", "npm:express", "npm:@supabase/supabase-js"]) expect(packages).not.toContain(k);
    expect(rows.every((d) => d.origin === "import")).toBe(true);

    // Sources: the catalog's, the registry per package, and the EOL cycle in use.
    const linked = async (key: string) =>
      (
        await ctx.db
          .select({ kind: sources.kind, key: sources.key })
          .from(depSources)
          .innerJoin(sources, eq(sources.id, depSources.sourceId))
          .innerJoin(deps, eq(deps.id, depSources.depId))
          .where(and(eq(deps.projectId, projectId), eq(deps.depKey, key)))
          .all()
      ).map((s) => `${s.kind} ${s.key}`);
    expect(await linked("npm:next")).toEqual(["npm next"]);
    expect(await linked("catalog:nodejs")).toEqual(expect.arrayContaining(["eol nodejs", "eol nodejs@20", "github_repo nodejs/node"]));
    const nextSource = (await ctx.db.select().from(sources).where(and(eq(sources.kind, "npm"), eq(sources.key, "next"))).get())!;
    expect(nextSource.config).toEqual({ origin: "user" });
    expect(await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `poll:${nextSource.id}`)).get()).toBeDefined();

    // The picker is pre-filled and the dashboard shows the stack.
    const picker = await b.html(`/app/projects/${projectId}/services?imported=1`);
    expect(picker).toMatch(/value="supabase" checked/);
    expect(picker).toContain("found in repo");
    const dash = await b.html("/app");
    for (const name of ["Cloudflare Workers", "Supabase", "Vercel", "Node.js", "Redis", "Terraform", "next", "fastapi"]) expect(dash).toContain(name);
    expect(dash).toMatch(/Node.js<\/strong><\/a> <span class="meta">version 20/);
    expect(Date.now() - started).toBeLessThan(60_000);
  });

  it("finishes from the cron tick when nobody watches the page", async () => {
    const { ctx, http } = await webCtx();
    serveRepo(http, "acme/shop", MONOREPO);
    const [p] = await ctx.db.insert(projects).values({ userId: 1, name: "x", createdAt: 0 }).returning();
    const imp = await startImport(ctx, p.id, "acme/shop");
    for (let i = 0; i < 10; i++) {
      await ctx.db.update(jobs).set({ runAfter: 0 }).where(eq(jobs.kind, "import"));
      await runTick(ctx);
      if ((await ctx.db.select().from(imports).where(eq(imports.id, imp.id)).get())!.status !== "running") break;
    }
    expect((await ctx.db.select().from(imports).where(eq(imports.id, imp.id)).get())!.status).toBe("done");
    expect(await ctx.db.select().from(jobs).where(eq(jobs.kind, "import")).all()).toHaveLength(0);
    expect((await ctx.db.select().from(deps).where(eq(deps.projectId, p.id)).all()).length).toBeGreaterThan(10);
  });

  it("never runs one import step twice at once", async () => {
    const { ctx } = await webCtx();
    const imp = await startImport(ctx, 1, "acme/shop");
    expect(await claimImportJob(ctx, imp.id)).toBeDefined();
    expect(await claimImportJob(ctx, imp.id)).toBeUndefined();
  });

  it("gives up on a step that keeps killing its invocation, instead of spinning forever", async () => {
    const { ctx, clock } = await webCtx();
    const imp = await startImport(ctx, 1, "acme/shop");
    // Each claim that never records a result holds the lock until it expires.
    for (let i = 0; i < 3; i++) {
      expect(await claimImportJob(ctx, imp.id)).toBeDefined();
      clock.advance(61_000);
    }
    await kickImport(ctx, imp.id, CATALOG);
    expect((await ctx.db.select().from(imports).where(eq(imports.id, imp.id)).get())!).toMatchObject({ status: "failed", error: expect.stringContaining("kept stopping") });
    expect(await ctx.db.select().from(jobs).where(eq(jobs.kind, "import")).all()).toHaveLength(0);
  });

  it("re-import drops what the repo no longer has, but keeps what the user added", async () => {
    const { ctx, http } = await webCtx();
    serveRepo(http, "acme/shop", MONOREPO);
    const b = new Browser(ctx);
    await b.signIn("dev@example.com");
    const { projectId } = await importVia(b, "acme/shop");
    await b.post(`/app/projects/${projectId}/services`, { ids: ["supabase", "vercel", "bun"], shown: ["supabase", "vercel", "bun", "cloudflare-workers"] });
    const keys = async () => (await ctx.db.select({ k: deps.depKey }).from(deps).where(eq(deps.projectId, projectId)).all()).map((r) => r.k);
    expect(await keys()).toContain("catalog:bun");
    expect(await keys()).not.toContain("catalog:cloudflare-workers");

    const smaller = { ...MONOREPO };
    delete smaller["vercel.json"];
    delete smaller["apps/web/package.json"];
    serveRepo(http, "acme/shop", smaller);
    await b.post(`/app/projects/${projectId}/import`, { repo: "acme/shop" });
    for (let i = 0; i < 10; i++) if ((await b.get(`/app/projects/${projectId}/import`)).status === 302) break;
    const after = await keys();
    expect(after).not.toContain("npm:next");
    expect(after).toContain("catalog:bun"); // added by hand
    expect(after).not.toContain("catalog:vercel"); // found by import, gone from the repo
    expect(after).toContain("npm:hono");
  });

  it("explains a missing or private repo and offers the picker instead", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    await b.signIn("dev@example.com");
    const { final } = await importVia(b, "https://github.com/acme/nope");
    const html = await final.text();
    expect(html).toContain("Repository not found. Public repos can be pasted; private repos need the GitHub App");
    expect(html).toContain("Pick services instead");
  });

  it("refuses input that is not a GitHub repo", async () => {
    const { ctx } = await webCtx();
    const b = new Browser(ctx);
    await b.signIn("dev@example.com");
    expect((await b.post("/app/projects", { name: "x", repo: "https://gitlab.com/a/b", next: "import" })).status).toBe(400);
    expect(parseRepoInput("https://github.com/honojs/hono/tree/main/src")).toBe("honojs/hono");
    expect(parseRepoInput("git@github.com:a/b.git")).toBeNull();
    expect(parseRepoInput("github.com/a/b.git")).toBe("a/b");
    expect(parseRepoInput("a/..")).toBeNull();
  });
});

describe("import limits and ranking", () => {
  it("reads at most 30 manifests, shallowest first", () => {
    const paths = [...Array.from({ length: 40 }, (_, i) => `apps/a${String(i).padStart(2, "0")}/package.json`), "package.json", "README.md", "big/package.json"];
    const picked = pickManifests(paths, { "big/package.json": 10_000_000 });
    expect(picked).toHaveLength(MAX_MANIFESTS);
    expect(picked[0]).toBe("package.json");
    expect(picked).not.toContain("big/package.json");
  });

  it("shows the top 25 packages by downloads and collapses the rest under 'also watching'", async () => {
    const { ctx, http } = await webCtx();
    const names = Array.from({ length: 30 }, (_, i) => `pkg${i}`);
    serveRepo(http, "acme/many", { "package.json": JSON.stringify({ name: "many", dependencies: Object.fromEntries(names.map((n) => [n, "1.0.0"])) }) });
    // Downloads rise with the index, so pkg29 is the most important.
    http.set(`https://api.npmjs.org/downloads/point/last-week/${names.join(",")}`, Object.fromEntries(names.map((n, i) => [n, { downloads: i * 1000, package: n }])));
    const b = new Browser(ctx);
    await b.signIn("dev@example.com");
    const { projectId } = await importVia(b, "acme/many");
    const rows = await ctx.db.select().from(deps).where(eq(deps.projectId, projectId)).all();
    const rank = Object.fromEntries(rows.map((d) => [d.package, d.rank]));
    expect(rank.pkg29).toBe(1);
    expect(rank.pkg0).toBe(30);
    const dash = await b.html("/app");
    const [shown, also] = dash.split("Also watching 5 more packages");
    expect(also).toBeDefined();
    for (const n of ["pkg29", "pkg5"]) expect(shown).toContain(`<strong>${n}</strong>`);
    for (const n of ["pkg0", "pkg4"]) {
      expect(shown).not.toContain(`<strong>${n}</strong>`);
      expect(also).toContain(`<strong>${n}</strong>`);
    }
    expect(SHOWN_PACKAGES).toBe(25);
  });

  it("watches at most 150 packages per project (and stays under D1's 100-parameter limit)", async () => {
    const { ctx, http } = await webCtx();
    const names = Array.from({ length: 160 }, (_, i) => `many-${i}`);
    serveRepo(http, "acme/huge", { "package.json": JSON.stringify({ name: "huge", dependencies: Object.fromEntries(names.map((n) => [n, "1.0.0"])) }) });
    const b = new Browser(ctx);
    await b.signIn("dev@example.com");
    const { projectId, final } = await importVia(b, "acme/huge");
    expect(final.status).toBe(302);
    const rows = await ctx.db.select().from(deps).where(eq(deps.projectId, projectId)).all();
    expect(rows).toHaveLength(MAX_PACKAGES);
    expect((await ctx.db.select().from(depSources).all()).length).toBe(MAX_PACKAGES);
  });
});
