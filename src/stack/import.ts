// Public repo import (SPEC §7.1) as a job: a small state machine stored in `imports`, one step per
// run. The progress page runs a step on each refresh (so G4's 60 s holds without waiting for a
// cron tick) and the 5-minute tick finishes imports whose page was closed. Every step stays well
// inside the Free plan's limits: at most ~30 subrequests, a handful of D1 queries, and only small
// files parsed.
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { CatalogEntry } from "../catalog/catalog";
import type { Ctx } from "../context";
import { deps, imports, jobs, projects, type Import, type Job } from "../db/schema";
import { enqueue, LOCK_MS } from "../jobs/queue";
import { GithubAppError, installationToken } from "../github/app";
import { errorMessage, truncate } from "../util";
import { mapStack, type ProposedDep } from "./mapping";
import { emptyFound, parseManifest, parserFor, type Found } from "./manifests";
import { deleteDeps, linkSources, upsertDeps, type DepWrite } from "./deps";

export const MAX_MANIFESTS = 30;
/** Packages shown on the dashboard; the rest are watched under "also watching" (SPEC §7.1). */
export const SHOWN_PACKAGES = 25;
/** Packages watched per project. Each is a registry poll every 6 h (docs/DECISIONS.md, M3). */
export const MAX_PACKAGES = 150;
const MAX_DIRS_PER_STEP = 24;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_PATHS = 3_000;
const MAX_STEP_ERRORS = 3;
/** Claims of one step that never recorded a result (the invocation died) before giving up. */
const MAX_KILLED_STEPS = 3;

/** Top-level directories that never hold the project's own manifests. */
const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "dist", "build", "out", "target", "coverage", "docs", "doc", "test", "tests", "__tests__", "e2e", "fixtures", "testdata", "examples", "example", "samples", "assets", "static", "public", ".vscode", ".idea", ".devcontainer", ".changeset", ".husky", ".yarn"]);
/** Directories whose children are workspace packages (apps/web/package.json): listed one level deeper. */
const CONTAINERS = new Set(["apps", "packages", "services", "libs", "workers", "functions", "modules", "crates", "projects", "sites", "backend", "frontend", "infra", "deploy", "terraform"]);

export const importJobKey = (importId: number) => `import:${importId}`;

export interface ImportState {
  owner: string;
  name: string;
  branch?: string;
  /** Every file path seen (for detection by file name). */
  paths: string[];
  /** Directories still to list: [path, tree sha, depth]. */
  dirs: [string, string, number][];
  found: Record<string, Found>;
  /** npm weekly downloads, for ranking packages. */
  downloads?: Record<string, number>;
  errors: number;
  /** Shown on the progress page. */
  log: string[];
  counts?: { catalog: number; runtimes: number; packages: number };
  /** File sizes from the trees, until manifests are picked. */
  sizes?: Sizes;
  /** GitHub App installation (private repos, M5): its token replaces GITHUB_TOKEN. */
  installationId?: number;
}

export type ImportStep = "repo" | "tree" | "fetch" | "rank" | "write" | "done";

/** "https://github.com/o/r", "github.com/o/r.git", "o/r" → "o/r". Null when it is not a GitHub repo. */
export function parseRepoInput(input: string): string | null {
  const s = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const m = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:\/(?:tree|blob)\/.*)?$/.exec(s);
  if (!m || m[2] === "." || m[2] === "..") return null;
  return `${m[1]}/${m[2]}`;
}

export async function startImport(ctx: Ctx, projectId: number, repo: string, installationId?: number | null): Promise<Import> {
  const now = ctx.clock.now();
  const [owner, name] = repo.split("/");
  const state: ImportState = { owner, name, paths: [], dirs: [], found: {}, errors: 0, log: [`Reading ${repo}`], ...(installationId ? { installationId } : {}) };
  const [row] = await ctx.db
    .insert(imports)
    .values({ projectId, repo, status: "running", step: "repo", state: state as unknown as Record<string, unknown>, createdAt: now, updatedAt: now })
    .returning();
  await ctx.db.update(projects).set({ repoFullName: repo, githubInstallationId: installationId ?? null }).where(eq(projects.id, projectId));
  await enqueue(ctx, { kind: "import", payload: { importId: row.id }, dedupeKey: importJobKey(row.id) });
  return row;
}

class ImportError extends Error {}

/** Tokens resolved for the current step (one cache read or mint per step, not per request). */
const stepTokens = new WeakMap<ImportState, Promise<string | undefined>>();

/** The installation's token for a private-repo import, else GITHUB_TOKEN (public repos). */
function ghToken(ctx: Ctx, st: ImportState): Promise<string | undefined> {
  if (!st.installationId) return Promise.resolve(ctx.config.githubToken);
  let token = stepTokens.get(st);
  if (!token) {
    token = installationToken(ctx, st.installationId).catch((e) => {
      throw e instanceof GithubAppError ? new ImportError(e.message) : e;
    });
    stepTokens.set(st, token);
  }
  return token;
}

async function ghFetch(ctx: Ctx, st: ImportState, url: string, accept = "application/vnd.github+json"): Promise<Response> {
  const h: Record<string, string> = { "user-agent": ctx.config.userAgent, accept, "x-github-api-version": "2022-11-28" };
  const token = await ghToken(ctx, st);
  if (token) h.authorization = `Bearer ${token}`;
  return ctx.http(new Request(url, { headers: h, signal: AbortSignal.timeout(20_000) }));
}

async function ghJson<T>(ctx: Ctx, st: ImportState, path: string): Promise<T> {
  const res = await ghFetch(ctx, st, `${ctx.config.githubApi}${path}`);
  if (res.status === 404) {
    throw new ImportError(
      st.installationId
        ? "Repository not found. Check that the Stackquake GitHub App can access it (GitHub → Settings → Applications)."
        : "Repository not found. Public repos can be pasted; private repos need the GitHub App (Import a private repo).",
    );
  }
  if (res.status === 403 || res.status === 429) {
    await res.body?.cancel();
    throw new ImportError("GitHub's rate limit was hit. Try again in a few minutes.");
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json<T>();
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function addTree(state: ImportState, prefix: string, depth: number, tree: TreeEntry[], sizes: Map<string, number>) {
  for (const e of tree) {
    const path = prefix ? `${prefix}/${e.path}` : e.path;
    if (e.type === "blob") {
      if (state.paths.length < MAX_PATHS) state.paths.push(path);
      if (e.size !== undefined) sizes.set(path, e.size);
    } else if (e.type === "tree") {
      const base = e.path.toLowerCase();
      if (SKIP_DIRS.has(base) || (base.startsWith(".") && path !== ".github")) continue;
      // Root and one level down (SPEC §7.1); one more inside workspace containers and .github.
      const parent = prefix.split("/")[0].toLowerCase();
      const wanted = depth === 0 || (depth === 1 && (CONTAINERS.has(parent) || path === ".github/workflows"));
      if (wanted) state.dirs.push([path, e.sha, depth + 1]);
    }
  }
}

/** Known directory names first, so a cap drops the least likely ones. */
function dirPriority(path: string): number {
  const base = path.split("/").pop()!.toLowerCase();
  if (path === ".github" || path === ".github/workflows") return 0;
  if (CONTAINERS.has(base) || ["src", "api", "web", "server", "client", "app", "supabase", "worker"].includes(base)) return 1;
  return 2;
}

type Sizes = Record<string, number>;

async function stepRepo(ctx: Ctx, st: ImportState): Promise<ImportStep> {
  const repo = await ghJson<{ default_branch: string; private?: boolean }>(ctx, st, `/repos/${st.owner}/${st.name}`);
  if (repo.private && !st.installationId) throw new ImportError("This repository is private. Use \"Import a private repo\", which connects it through the Stackquake GitHub App.");
  st.branch = repo.default_branch;
  const root = await ghJson<{ tree: TreeEntry[]; truncated?: boolean }>(ctx, st, `/repos/${st.owner}/${st.name}/git/trees/${encodeURIComponent(st.branch)}`);
  const sizes = new Map<string, number>();
  addTree(st, "", 0, root.tree, sizes);
  st.sizes = Object.fromEntries(sizes);
  st.log.push(`Default branch ${st.branch}: ${root.tree.length} entries at the root`);
  return st.dirs.length ? "tree" : "fetch";
}

async function stepTree(ctx: Ctx, st: ImportState): Promise<ImportStep> {
  st.dirs.sort((a, b) => a[2] - b[2] || dirPriority(a[0]) - dirPriority(b[0]) || a[0].localeCompare(b[0]));
  const batch = st.dirs.splice(0, MAX_DIRS_PER_STEP);
  const sizes = new Map(Object.entries(st.sizes ?? {}));
  const trees = await Promise.all(batch.map(([path, sha]) => ghJson<{ tree: TreeEntry[] }>(ctx, st, `/repos/${st.owner}/${st.name}/git/trees/${sha}`).then((t) => [path, t] as const)));
  for (const [path, t] of trees) addTree(st, path, batch.find((b) => b[0] === path)![2], t.tree, sizes);
  st.sizes = Object.fromEntries(sizes);
  // Depth-2 directories (inside containers) are listed in one more step; anything left is dropped.
  st.dirs = st.dirs.filter((d) => d[2] <= 2);
  const deeper = batch.every((b) => b[2] === 1) && st.dirs.length > 0;
  if (!deeper) st.dirs = [];
  st.log.push(`Listed ${batch.length} folders`);
  return deeper ? "tree" : "fetch";
}

/** Manifests to read: shallowest first, at most 30 (SPEC §7.1). */
export function pickManifests(paths: string[], sizes: Sizes): string[] {
  return paths
    .filter((p) => parserFor(p) !== null && (sizes[p] ?? 0) <= MAX_FILE_BYTES)
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, MAX_MANIFESTS);
}

async function stepFetch(ctx: Ctx, st: ImportState): Promise<ImportStep> {
  const sizes = st.sizes ?? {};
  const picked = pickManifests(st.paths, sizes);
  const texts = await Promise.all(
    picked.map(async (path) => {
      // Private repos: the contents API (raw media type) with the installation token.
      const res = st.installationId
        ? await ghFetch(ctx, st, `${ctx.config.githubApi}/repos/${st.owner}/${st.name}/contents/${encPath(path)}?ref=${encodeURIComponent(st.branch!)}`, "application/vnd.github.raw+json")
        : await ghFetch(ctx, st, `${ctx.config.githubRaw}/${st.owner}/${st.name}/${encodeURIComponent(st.branch!)}/${encPath(path)}`, "*/*");
      if (!res.ok) {
        await res.body?.cancel();
        return [path, null] as const;
      }
      return [path, await res.text()] as const;
    }),
  );
  for (const [path, text] of texts) if (text !== null) st.found[path] = compact(parseManifest(path, text));
  delete st.sizes;
  st.log.push(`Read ${Object.keys(st.found).length} manifest files`);
  return "rank";
}

/** Drops empty arrays so the stored state stays small. */
function compact(f: Found): Found {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => !(Array.isArray(v) && v.length === 0))) as unknown as Found;
}

const withDefaults = (found: Record<string, Found>): Record<string, Found> =>
  Object.fromEntries(Object.entries(found).map(([p, f]) => [p, { ...emptyFound(), ...(f as Partial<Found>) }]));

async function stepRank(ctx: Ctx, st: ImportState, entries: CatalogEntry[]): Promise<ImportStep> {
  const { packages } = mapStack(st.paths, withDefaults(st.found), entries);
  const npm = packages.filter((p) => p.ecosystem === "npm").map((p) => p.package!);
  // Ranking only matters when there are more packages than the dashboard shows.
  if (packages.length <= SHOWN_PACKAGES || !npm.length) return "write";
  const downloads: Record<string, number> = {};
  const unscoped = npm.filter((n) => !n.startsWith("@")).slice(0, MAX_PACKAGES);
  const scoped = npm.filter((n) => n.startsWith("@")).slice(0, 20);
  const get = async (url: string) => {
    try {
      const res = await ctx.http(new Request(url, { headers: { "user-agent": ctx.config.userAgent }, signal: AbortSignal.timeout(10_000) }));
      return res.ok ? await res.json<Record<string, unknown>>() : null;
    } catch {
      return null;
    }
  };
  const calls: Promise<void>[] = [];
  // The bulk endpoint takes up to 128 unscoped names; scoped packages are one request each.
  for (let i = 0; i < unscoped.length; i += 128) {
    const chunk = unscoped.slice(i, i + 128);
    calls.push(
      get(`https://api.npmjs.org/downloads/point/last-week/${chunk.join(",")}`).then((d) => {
        if (!d) return;
        if (chunk.length === 1) downloads[chunk[0]] = Number(d.downloads ?? 0);
        else for (const n of chunk) downloads[n] = Number((d[n] as { downloads?: number } | null)?.downloads ?? 0);
      }),
    );
  }
  for (const n of scoped) calls.push(get(`https://api.npmjs.org/downloads/point/last-week/${n}`).then((d) => void (d && (downloads[n] = Number(d.downloads ?? 0)))));
  await Promise.all(calls);
  st.downloads = downloads;
  st.log.push(`Ranked ${Object.keys(downloads).length} npm packages by downloads`);
  return "write";
}

/** Most important first: registry downloads (npm), then the order found. */
export function rankPackages(packages: ProposedDep[], downloads: Record<string, number> = {}): ProposedDep[] {
  return packages
    .map((p, i) => ({ p, i, d: p.ecosystem === "npm" ? (downloads[p.package!] ?? -1) : -1 }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .map((x) => x.p);
}

async function stepWrite(ctx: Ctx, imp: Import, st: ImportState, entries: CatalogEntry[]): Promise<ImportStep> {
  const proposal = mapStack(st.paths, withDefaults(st.found), entries);
  const known = new Set(entries.map((e) => e.id));
  const ranked = rankPackages(proposal.packages, st.downloads).slice(0, MAX_PACKAGES);
  const list: DepWrite[] = [
    ...proposal.catalog.filter((d) => known.has(d.catalogId!)).map((d) => ({ ...d, rank: null })),
    ...proposal.runtimes.map((d) => ({ ...d, rank: null })),
    ...ranked.map((d, i) => ({ ...d, rank: i + 1 })),
  ];
  const written = await upsertDeps(ctx, imp.projectId, list, "import");
  // A re-import drops what the repo no longer has, but only deps that import added.
  const keep = new Set(list.map((d) => d.depKey));
  const stale = await ctx.db
    .select({ id: deps.id, depKey: deps.depKey })
    .from(deps)
    .where(and(eq(deps.projectId, imp.projectId), eq(deps.origin, "import")))
    .all();
  await deleteDeps(ctx, imp.projectId, stale.filter((d) => !keep.has(d.depKey)).map((d) => d.id));
  await linkSources(ctx, written);
  await ctx.db.update(projects).set({ lastImportAt: ctx.clock.now() }).where(eq(projects.id, imp.projectId));
  st.counts = { catalog: proposal.catalog.length, runtimes: proposal.runtimes.length + proposal.catalog.filter((d) => d.eolProduct).length, packages: ranked.length };
  st.log.push(`Found ${proposal.catalog.length} services and tools, ${st.counts.runtimes} runtimes, ${ranked.length} packages`);
  return "done";
}

/** Runs one step of an import. Never throws: errors are recorded on the import. */
export async function advanceImport(ctx: Ctx, importId: number, entries: CatalogEntry[]): Promise<Import | undefined> {
  const imp = await ctx.db.select().from(imports).where(eq(imports.id, importId)).get();
  if (!imp || imp.status !== "running") return imp;
  const st = imp.state as unknown as ImportState;
  let next: ImportStep = imp.step as ImportStep;
  let status: Import["status"] = "running";
  let error: string | null = null;
  try {
    if (next === "repo") next = await stepRepo(ctx, st);
    else if (next === "tree") next = await stepTree(ctx, st);
    else if (next === "fetch") next = await stepFetch(ctx, st);
    else if (next === "rank") next = await stepRank(ctx, st, entries);
    else if (next === "write") next = await stepWrite(ctx, imp, st, entries);
    if (next === "done") status = "done";
  } catch (e) {
    st.errors++;
    error = e instanceof ImportError ? e.message : truncate(errorMessage(e), 500);
    if (e instanceof ImportError || st.errors >= MAX_STEP_ERRORS) status = "failed";
  }
  const [row] = await ctx.db
    .update(imports)
    .set({ step: next, status, state: st as unknown as Record<string, unknown>, error, updatedAt: ctx.clock.now() })
    .where(eq(imports.id, imp.id))
    .returning();
  return row;
}

/** The job runner's handler (cron path). */
export async function importStep(ctx: Ctx, job: Job, entries: CatalogEntry[]): Promise<"done" | "again"> {
  const importId = (job.payload as { importId?: number } | null)?.importId;
  if (!importId) return "done";
  const row = await advanceImport(ctx, importId, entries);
  return row?.status === "running" ? "again" : "done";
}

/**
 * Locks the import's job so a page refresh and a cron tick never run the same step twice.
 * Returns the job when this caller holds the lock.
 */
export async function claimImportJob(ctx: Ctx, importId: number): Promise<Job | undefined> {
  const now = ctx.clock.now();
  // Claims count attempts (as in claimJobs), so a step that kills its invocation is not retried forever.
  const [job] = await ctx.db
    .update(jobs)
    .set({ lockedUntil: now + LOCK_MS, attempts: sql`${jobs.attempts} + 1` })
    .where(and(eq(jobs.dedupeKey, importJobKey(importId)), isNull(jobs.parkedAt), lte(jobs.runAfter, now), or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, now))))
    .returning();
  return job;
}

/** Runs one step now, on behalf of the progress page. */
export async function kickImport(ctx: Ctx, importId: number, entries: CatalogEntry[]): Promise<void> {
  const job = await claimImportJob(ctx, importId);
  if (!job) {
    // No job left (parked by the cron runner, or lost) while the import still says running.
    const live = await ctx.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.dedupeKey, importJobKey(importId)), isNull(jobs.parkedAt))).get();
    if (!live) await failImport(ctx, importId, "The import stopped part-way. Try again, or pick services instead.");
    return;
  }
  if (job.attempts > MAX_KILLED_STEPS) {
    await ctx.db.delete(jobs).where(eq(jobs.id, job.id));
    await failImport(ctx, importId, "The import kept stopping part-way (the repository may be too large). Pick services instead.");
    return;
  }
  const result = await importStep(ctx, job, entries);
  if (result === "done") await ctx.db.delete(jobs).where(eq(jobs.id, job.id));
  else await ctx.db.update(jobs).set({ lockedUntil: null, runAfter: ctx.clock.now(), attempts: 0 }).where(eq(jobs.id, job.id));
}

async function failImport(ctx: Ctx, importId: number, error: string): Promise<void> {
  await ctx.db.update(imports).set({ status: "failed", error, updatedAt: ctx.clock.now() }).where(and(eq(imports.id, importId), eq(imports.status, "running")));
}

export async function latestImport(ctx: Ctx, projectId: number): Promise<Import | undefined> {
  return ctx.db.select().from(imports).where(eq(imports.projectId, projectId)).orderBy(sql`${imports.id} DESC`).limit(1).get();
}
