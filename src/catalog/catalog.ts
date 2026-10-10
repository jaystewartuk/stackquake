// Catalog entries (SPEC §5.1): validation and sync into the sources table.
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Ctx } from "../context";
import { catalog, catalogSources, sources, type SourceKind } from "../db/schema";
import { enqueue, pollJobKey } from "../jobs/queue";
import { eolUrl, parseEolKey } from "../sources/kinds/eol";
import { githubUrl } from "../sources/kinds/github";
import { npmUrl } from "../sources/kinds/npm";
import { pypiName, pypiUrl } from "../sources/kinds/pypi";
import { normaliseUrl } from "../sources/normalise";
import { stableStringify } from "../util";

export type SourceSpec =
  | { kind: "npm"; package: string }
  | { kind: "pypi"; package: string }
  | { kind: "github_repo"; repo: string }
  | { kind: "eol"; product: string; cycle?: string }
  | { kind: "feed"; url: string; filter?: string[] }
  | { kind: "page"; url: string; selector: string; exclude?: string[]; ignore?: string[] };

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  aliases?: string[];
  detect?: { files?: string[]; npm?: string[]; pypi?: string[] };
  sources: SourceSpec[];
  alternatives?: string[];
  usage_questions?: string[];
  notes?: string;
}

const strList = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string"));
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const httpsUrl = (v: unknown) => str(v) && /^https:\/\//.test(v as string);

/** Returns a list of problems; empty means valid. */
export function validateEntry(e: unknown): string[] {
  const errs: string[] = [];
  if (!e || typeof e !== "object") return ["entry is not an object"];
  const o = e as Record<string, unknown>;
  const where = `catalog ${String(o.id ?? "?")}`;
  if (!str(o.id) || !/^[a-z0-9][a-z0-9-]*$/.test(o.id as string)) errs.push(`${where}: id must be kebab-case`);
  if (!str(o.name)) errs.push(`${where}: name is required`);
  if (!str(o.category)) errs.push(`${where}: category is required`);
  for (const k of ["aliases", "alternatives", "usage_questions"]) if (!strList(o[k])) errs.push(`${where}: ${k} must be a list of strings`);
  if (!Array.isArray(o.sources) || o.sources.length === 0) errs.push(`${where}: sources must be a non-empty list`);
  for (const [i, s] of ((o.sources as unknown[]) ?? []).entries()) {
    const src = s as Record<string, unknown>;
    const at = `${where}: sources[${i}]`;
    switch (src?.kind) {
      case "npm":
      case "pypi":
        if (!str(src.package)) errs.push(`${at}: package is required`);
        break;
      case "github_repo":
        if (!str(src.repo) || !/^[\w.-]+\/[\w.-]+$/.test(src.repo as string)) errs.push(`${at}: repo must be owner/name`);
        break;
      case "eol":
        if (!str(src.product)) errs.push(`${at}: product is required`);
        if (src.cycle !== undefined && !str(src.cycle)) errs.push(`${at}: cycle must be a string`);
        break;
      case "feed":
        if (!httpsUrl(src.url)) errs.push(`${at}: url must be https`);
        if (!strList(src.filter)) errs.push(`${at}: filter must be a list of strings`);
        break;
      case "page":
        if (!httpsUrl(src.url)) errs.push(`${at}: url must be https`);
        if (!str(src.selector)) errs.push(`${at}: selector is required`);
        if (!strList(src.exclude) || !strList(src.ignore)) errs.push(`${at}: exclude/ignore must be lists of strings`);
        for (const re of (src.ignore as string[] | undefined) ?? []) {
          try {
            new RegExp(re);
          } catch {
            errs.push(`${at}: bad ignore regex ${re}`);
          }
        }
        break;
      default:
        errs.push(`${at}: unknown kind ${String(src?.kind)}`);
    }
  }
  return errs;
}

export interface SourceRow {
  kind: SourceKind;
  key: string;
  url: string;
  selector: string | null;
  config: Record<string, unknown>;
}

/** The global, deduplicated identity of a source (SPEC §5: sources are global). */
export function sourceRow(spec: SourceSpec): SourceRow {
  const origin = { origin: "catalog" };
  switch (spec.kind) {
    case "npm":
      return { kind: "npm", key: spec.package, url: npmUrl(spec.package), selector: null, config: origin };
    case "pypi":
      return { kind: "pypi", key: pypiName(spec.package), url: pypiUrl(spec.package), selector: null, config: origin };
    case "github_repo":
      return { kind: "github_repo", key: spec.repo.toLowerCase(), url: githubUrl(spec.repo.toLowerCase()), selector: null, config: origin };
    case "eol": {
      const key = spec.cycle ? `${spec.product}@${spec.cycle}` : spec.product;
      return { kind: "eol", key, url: eolUrl(parseEolKey(key).product), selector: null, config: origin };
    }
    case "feed": {
      const url = normaliseUrl(spec.url);
      return { kind: "feed", key: url, url, selector: null, config: origin };
    }
    case "page": {
      const url = normaliseUrl(spec.url);
      return { kind: "page", key: `${url} ${spec.selector}`, url, selector: spec.selector, config: { ...origin, exclude: spec.exclude, ignore: spec.ignore } };
    }
  }
}

/**
 * Upserts catalog entries and their sources, links them, and queues a first poll for new
 * sources. Catalog sources no entry uses any more are disabled. Idempotent. Entries whose stored
 * copy is identical are skipped, so the daily run costs one query when nothing changed.
 */
export async function syncCatalog(ctx: Ctx, entries: CatalogEntry[]): Promise<{ sources: number; created: number; changedEntries: number }> {
  const now = ctx.clock.now();
  const problems = entries.flatMap(validateEntry);
  if (problems.length) throw new Error(`invalid catalog:\n${problems.join("\n")}`);

  const stored = new Map((await ctx.db.select({ id: catalog.id, data: catalog.data }).from(catalog).all()).map((r) => [r.id, stableStringify(r.data)]));
  const changed = entries.filter((e) => stored.get(e.id) !== stableStringify(e));
  const ids = new Set(entries.map((e) => e.id));
  const removed = [...stored.keys()].filter((id) => !ids.has(id));
  const countLinked = async () => (await ctx.db.selectDistinct({ id: catalogSources.sourceId }).from(catalogSources).all()).length;
  if (changed.length === 0 && removed.length === 0) return { sources: await countLinked(), created: 0, changedEntries: 0 };

  let created = 0;
  for (const entry of changed) {
    const keep: number[] = [];
    for (const spec of entry.sources) {
      const row = sourceRow(spec);
      const inserted = await ctx.db
        .insert(sources)
        .values({ ...row, nextPollAt: now })
        .onConflictDoNothing({ target: [sources.kind, sources.key] })
        .returning({ id: sources.id });
      let id: number;
      if (inserted.length) {
        id = inserted[0].id;
        created++;
        await enqueue(ctx, { kind: "poll", sourceId: id, runAfter: now, dedupeKey: pollJobKey(id) });
      } else {
        const existing = await ctx.db.select({ id: sources.id, state: sources.state }).from(sources).where(and(eq(sources.kind, row.kind), eq(sources.key, row.key))).get();
        id = existing!.id;
        await ctx.db
          .update(sources)
          .set({ url: row.url, selector: row.selector, config: row.config, ...(existing!.state === "disabled" ? { state: "active" as const } : {}) })
          .where(eq(sources.id, id));
        if (existing!.state === "disabled") await enqueue(ctx, { kind: "poll", sourceId: id, runAfter: now, dedupeKey: pollJobKey(id) });
      }
      const filter = spec.kind === "feed" ? (spec.filter ?? null) : null;
      await ctx.db
        .insert(catalogSources)
        .values({ catalogId: entry.id, sourceId: id, filter })
        .onConflictDoUpdate({ target: [catalogSources.catalogId, catalogSources.sourceId], set: { filter } });
      keep.push(id);
    }
    await ctx.db.delete(catalogSources).where(and(eq(catalogSources.catalogId, entry.id), notInArray(catalogSources.sourceId, keep)));
    // Written last: a stored entry means its sources are in place, so a crash above is retried.
    await ctx.db
      .insert(catalog)
      .values({ id: entry.id, name: entry.name, category: entry.category, data: entry, updatedAt: now })
      .onConflictDoUpdate({ target: catalog.id, set: { name: entry.name, category: entry.category, data: entry, updatedAt: now } });
  }
  if (removed.length) {
    await ctx.db.delete(catalogSources).where(inArray(catalogSources.catalogId, removed));
    await ctx.db.delete(catalog).where(inArray(catalog.id, removed));
  }
  // Catalog-made sources that no entry links to any more stop being polled.
  await ctx.db.run(sql`
    UPDATE sources SET state = 'disabled'
    WHERE state = 'active' AND json_extract(config, '$.origin') = 'catalog'
      AND id NOT IN (SELECT source_id FROM catalog_sources)`);
  return { sources: await countLinked(), created, changedEntries: changed.length };
}
