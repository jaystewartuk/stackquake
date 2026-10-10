// Writing a project's deps and linking them to sources (SPEC §6 deps, dep_sources).
// Bulk writes pass rows as one JSON parameter and expand them with json_each: one statement per
// table however many rows, which keeps a step inside D1's per-invocation query limit and its
// 100-parameter-per-statement limit.
import { and, eq, inArray, sql } from "drizzle-orm";
import { sourceRow, type SourceRow } from "../catalog/catalog";
import type { Ctx } from "../context";
import { catalogSources, deps, type Dep } from "../db/schema";
import type { ProposedDep } from "./mapping";

/** Sources a user's dep created (not the catalog): disabled by the daily run once no dep links them. */
const USER_ORIGIN = { origin: "user" };

/** Finds or creates sources by (kind, key); queues a first poll for new or re-enabled ones. */
export async function ensureSources(ctx: Ctx, rows: SourceRow[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (!rows.length) return ids;
  const now = ctx.clock.now();
  const json = JSON.stringify(rows.map((r) => ({ ...r, config: JSON.stringify(r.config) })));
  const created = await ctx.db.all<{ id: number }>(sql`
    INSERT INTO sources (kind, key, url, selector, config, next_poll_at)
    SELECT json_extract(value, '$.kind'), json_extract(value, '$.key'), json_extract(value, '$.url'),
           json_extract(value, '$.selector'), json_extract(value, '$.config'), ${now}
    FROM json_each(${json}) WHERE true
    ON CONFLICT (kind, key) DO NOTHING
    RETURNING id`);
  const keys = JSON.stringify(rows.map((r) => [r.kind, r.key]));
  const found = await ctx.db.all<{ id: number; kind: string; key: string }>(sql`
    SELECT s.id, s.kind, s.key FROM json_each(${keys}) j
    JOIN sources s ON s.kind = json_extract(j.value, '$[0]') AND s.key = json_extract(j.value, '$[1]')`);
  for (const r of found) ids.set(`${r.kind} ${r.key}`, r.id);
  const revived = await ctx.db.all<{ id: number }>(sql`
    UPDATE sources SET state = 'active' WHERE state = 'disabled' AND id IN (SELECT value FROM json_each(${JSON.stringify(found.map((r) => r.id))}))
    RETURNING id`);
  const toPoll = [...created, ...revived].map((r) => r.id);
  if (toPoll.length) {
    await ctx.db.run(sql`
      INSERT INTO jobs (kind, source_id, run_after, attempts, dedupe_key)
      SELECT 'poll', value, ${now}, 0, 'poll:' || value FROM json_each(${JSON.stringify(toPoll)}) WHERE true
      ON CONFLICT (dedupe_key) DO NOTHING`);
  }
  return ids;
}

/** The non-catalog sources a dep needs: its registry, or the endoflife.date cycle it runs. */
export function ownSourceRows(d: Pick<ProposedDep, "ecosystem" | "package" | "eolProduct" | "eolCycle">): SourceRow[] {
  const user = (r: SourceRow): SourceRow => ({ ...r, config: USER_ORIGIN });
  if (d.ecosystem === "npm" && d.package) return [user(sourceRow({ kind: "npm", package: d.package }))];
  if (d.ecosystem === "pypi" && d.package) return [user(sourceRow({ kind: "pypi", package: d.package }))];
  // SPEC §5: an eol source is per product and cycle ("the cycle in use").
  if (d.eolProduct) return [user(sourceRow({ kind: "eol", product: d.eolProduct, ...(d.eolCycle ? { cycle: d.eolCycle } : {}) }))];
  return [];
}

/**
 * Replaces the source links of the given deps: their catalog entry's sources plus their own
 * (registry or EOL cycle). Creates missing sources.
 */
export async function linkSources(ctx: Ctx, list: Pick<Dep, "id" | "catalogId" | "ecosystem" | "package" | "eolProduct" | "eolCycle">[]): Promise<void> {
  if (!list.length) return;
  const own = list.map((d) => ({ dep: d, rows: ownSourceRows(d) }));
  const ids = await ensureSources(ctx, own.flatMap((o) => o.rows));
  const catalogIds = [...new Set(list.map((d) => d.catalogId).filter((x): x is string => !!x))];
  const cs = catalogIds.length ? await ctx.db.select().from(catalogSources).where(inArray(catalogSources.catalogId, catalogIds)).all() : [];
  const pairs: [number, number][] = [];
  for (const { dep, rows } of own) {
    for (const r of rows) {
      const id = ids.get(`${r.kind} ${r.key}`);
      if (id !== undefined) pairs.push([dep.id, id]);
    }
    for (const c of cs) if (c.catalogId === dep.catalogId) pairs.push([dep.id, c.sourceId]);
  }
  const depIds = JSON.stringify(list.map((d) => d.id));
  await ctx.db.run(sql`DELETE FROM dep_sources WHERE dep_id IN (SELECT value FROM json_each(${depIds}))`);
  if (pairs.length) {
    await ctx.db.run(sql`
      INSERT INTO dep_sources (dep_id, source_id)
      SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(${JSON.stringify(pairs)}) WHERE true
      ON CONFLICT DO NOTHING`);
  }
}

export interface DepWrite extends ProposedDep {
  rank: number | null;
}

/**
 * Upserts deps for a project. On conflict the existing row keeps its origin, profile and mute;
 * what import found (version, cycle, rank, paths) is refreshed. Returns the rows written.
 */
export async function upsertDeps(ctx: Ctx, projectId: number, list: DepWrite[], origin: "import" | "manual"): Promise<Dep[]> {
  if (!list.length) return [];
  const now = ctx.clock.now();
  const json = JSON.stringify(list.map((d) => ({ ...d, foundIn: d.foundIn.length ? JSON.stringify(d.foundIn) : null })));
  const written = await ctx.db.all<{ id: number }>(sql`
    INSERT INTO deps (project_id, catalog_id, ecosystem, package, version_spec, eol_product, eol_cycle, origin, dep_key, rank, found_in, created_at)
    SELECT ${projectId}, json_extract(value, '$.catalogId'), json_extract(value, '$.ecosystem'), json_extract(value, '$.package'),
           json_extract(value, '$.versionSpec'), json_extract(value, '$.eolProduct'), json_extract(value, '$.eolCycle'), ${origin},
           json_extract(value, '$.depKey'), json_extract(value, '$.rank'), json_extract(value, '$.foundIn'), ${now}
    FROM json_each(${json}) WHERE true
    ON CONFLICT (project_id, dep_key) DO UPDATE SET
      version_spec = coalesce(excluded.version_spec, version_spec),
      eol_product = coalesce(excluded.eol_product, eol_product),
      eol_cycle = coalesce(excluded.eol_cycle, eol_cycle),
      rank = excluded.rank,
      found_in = coalesce(excluded.found_in, found_in)
    RETURNING id`);
  return ctx.db
    .select()
    .from(deps)
    .where(inArray(deps.id, written.map((w) => w.id)))
    .all();
}

/** Deletes deps (and their links) by id, scoped to one project. */
export async function deleteDeps(ctx: Ctx, projectId: number, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const json = JSON.stringify(ids);
  await ctx.db.run(sql`DELETE FROM dep_sources WHERE dep_id IN (SELECT id FROM deps WHERE project_id = ${projectId} AND id IN (SELECT value FROM json_each(${json})))`);
  await ctx.db.run(sql`DELETE FROM deps WHERE project_id = ${projectId} AND id IN (SELECT value FROM json_each(${json}))`);
}

/** Adds catalog entries to a project as manual deps (the picker). Existing ones are kept as they are. */
export async function addCatalogDeps(ctx: Ctx, projectId: number, catalogIds: string[]): Promise<Dep[]> {
  if (!catalogIds.length) return [];
  const existing = await ctx.db
    .select({ catalogId: deps.catalogId })
    .from(deps)
    .where(and(eq(deps.projectId, projectId), inArray(deps.catalogId, catalogIds)))
    .all();
  const have = new Set(existing.map((e) => e.catalogId));
  const fresh = catalogIds.filter((id) => !have.has(id));
  const rows = await upsertDeps(
    ctx,
    projectId,
    fresh.map((id) => ({ depKey: `catalog:${id}`, catalogId: id, ecosystem: null, package: null, versionSpec: null, eolProduct: null, eolCycle: null, foundIn: [], rank: null })),
    "manual",
  );
  await linkSources(ctx, rows);
  return rows;
}

/** Keeps dep links in step with the catalog after entries change (called by syncCatalog). */
export async function relinkCatalogDeps(ctx: Ctx, catalogIds: string[]): Promise<void> {
  if (!catalogIds.length) return;
  const json = JSON.stringify(catalogIds);
  await ctx.db.run(sql`
    INSERT INTO dep_sources (dep_id, source_id)
    SELECT d.id, cs.source_id FROM deps d JOIN catalog_sources cs ON cs.catalog_id = d.catalog_id
    WHERE d.catalog_id IN (SELECT value FROM json_each(${json}))
    ON CONFLICT DO NOTHING`);
  await ctx.db.run(sql`
    DELETE FROM dep_sources WHERE rowid IN (
      SELECT ds.rowid FROM dep_sources ds
      JOIN deps d ON d.id = ds.dep_id
      JOIN sources s ON s.id = ds.source_id
      WHERE d.catalog_id IN (SELECT value FROM json_each(${json}))
        AND json_extract(s.config, '$.origin') = 'catalog'
        AND NOT EXISTS (SELECT 1 FROM catalog_sources cs WHERE cs.catalog_id = d.catalog_id AND cs.source_id = ds.source_id))`);
}

/** Daily: sources that only users' deps created stop being polled once no dep links them. */
export async function disableOrphanUserSources(ctx: Ctx): Promise<void> {
  await ctx.db.run(sql`
    UPDATE sources SET state = 'disabled'
    WHERE state = 'active' AND json_extract(config, '$.origin') = 'user'
      AND id NOT IN (SELECT source_id FROM dep_sources)`);
}
