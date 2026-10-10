// The dashboard's view of a stack (SPEC §7.6): deps grouped by risk, each with its latest
// published event. Loads everything for a user's projects in four queries.
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { FC } from "hono/jsx";
import type { CatalogEntry } from "../catalog/catalog";
import type { Ctx } from "../context";
import { deps, type Dep, type Project } from "../db/schema";
import { SHOWN_PACKAGES } from "../stack/import";
import { describeProfile, effectiveProfile, questionsFor } from "../stack/profile";
import { DAY } from "../util";
import { catalogEntry } from "./catalog-view";
import { KindPill } from "./events-view";
import { fmtDate } from "./layout";

export interface DepView {
  dep: Dep;
  entry?: CatalogEntry;
  name: string;
  detail: string;
  sources: number;
  archived: boolean;
  deprecated: boolean;
  unlicensed: boolean;
  latest?: { id: number; title: string; kind: string; publishedAt: number };
}

export type RiskGroup = "recent" | "archived" | "unlicensed" | "single_vendor" | "other";

export const RISK_LABELS: Record<RiskGroup, string> = {
  recent: "Changed recently",
  archived: "Archived or deprecated",
  unlicensed: "No licence",
  single_vendor: "Single vendor",
  other: "No known risk",
};

const RECENT_MS = 90 * DAY;
const RUNTIME_NAMES: Record<string, string> = { nodejs: "Node.js", python: "Python", postgresql: "PostgreSQL", go: "Go", ruby: "Ruby", php: "PHP", mysql: "MySQL", mariadb: "MariaDB", mongodb: "MongoDB", alpine: "Alpine Linux", debian: "Debian", ubuntu: "Ubuntu", nginx: "nginx", redis: "Redis", valkey: "Valkey", bun: "Bun", deno: "Deno" };

export function depName(d: Pick<Dep, "catalogId" | "ecosystem" | "package" | "eolProduct">, entry = catalogEntry(d.catalogId)): string {
  if (entry) return entry.name;
  if (d.ecosystem === "eol") return RUNTIME_NAMES[d.eolProduct ?? ""] ?? d.eolProduct ?? "runtime";
  return d.package ?? d.catalogId ?? "?";
}

export const WATCHED_ECOSYSTEMS = new Set(["npm", "pypi"]);

function depDetail(d: Dep, entry: CatalogEntry | undefined, defaults: Project["defaultProfile"]): string {
  const bits: string[] = [];
  if (d.eolProduct && d.eolCycle) bits.push(entry && d.eolProduct !== entry.sources.find((s) => s.kind === "eol")?.product ? `${RUNTIME_NAMES[d.eolProduct] ?? d.eolProduct} ${d.eolCycle}` : `version ${d.eolCycle}`);
  if (d.ecosystem && d.ecosystem !== "eol") bits.push(`${d.ecosystem}${d.versionSpec ? ` ${d.versionSpec}` : ""}`);
  if (entry) {
    const dims = questionsFor(entry);
    const usage = dims.length ? describeProfile(effectiveProfile(d.profile, defaults, dims)) : null;
    if (usage && usage !== "not set") bits.push(usage);
  }
  return bits.join(" · ");
}

/** Every dep of the given projects, with source flags and latest published event. */
export async function loadDeps(ctx: Ctx, projectList: Project[]): Promise<Map<number, DepView[]>> {
  const out = new Map<number, DepView[]>(projectList.map((p) => [p.id, []]));
  if (!projectList.length) return out;
  const ids = projectList.map((p) => p.id);
  const rows = await ctx.db.select().from(deps).where(inArray(deps.projectId, ids)).orderBy(asc(deps.id)).all();
  if (!rows.length) return out;
  const depIds = JSON.stringify(rows.map((d) => d.id));
  const flags = await ctx.db.all<{ dep_id: number; n: number; archived: number; deprecated: number; unlicensed: number }>(sql`
    SELECT ds.dep_id, count(*) AS n,
      max(CASE WHEN s.kind = 'github_repo' THEN coalesce(json_extract(s.last_state, '$.archived'), 0) ELSE 0 END) AS archived,
      max(CASE WHEN s.kind = 'npm' THEN json_extract(s.last_state, '$.deprecated') IS NOT NULL
               WHEN s.kind = 'pypi' THEN coalesce(json_extract(s.last_state, '$.inactive'), 0) ELSE 0 END) AS deprecated,
      max(CASE WHEN s.last_state IS NULL THEN 0
               WHEN s.kind = 'npm' THEN json_extract(s.last_state, '$.license') IS NULL
               WHEN s.kind = 'pypi' THEN json_extract(s.last_state, '$.license') IS NULL AND json_extract(s.last_state, '$.licenseExpression') IS NULL
                                        AND coalesce(json_array_length(s.last_state, '$.licenseClassifiers'), 0) = 0
               ELSE 0 END) AS unlicensed
    FROM dep_sources ds JOIN sources s ON s.id = ds.source_id
    WHERE ds.dep_id IN (SELECT value FROM json_each(${depIds}))
    GROUP BY ds.dep_id`);
  const latest = await ctx.db.all<{ dep_id: number; id: number; title: string; kind: string; published_at: number }>(sql`
    SELECT dep_id, id, title, kind, published_at FROM (
      SELECT ds.dep_id, e.id, e.title, e.kind, e.published_at,
             ROW_NUMBER() OVER (PARTITION BY ds.dep_id ORDER BY e.published_at DESC, e.id DESC) AS rn
      FROM dep_sources ds JOIN events e ON e.source_id = ds.source_id AND e.status = 'published'
      WHERE ds.dep_id IN (SELECT value FROM json_each(${depIds})))
    WHERE rn = 1`);
  const f = new Map(flags.map((r) => [r.dep_id, r]));
  const l = new Map(latest.map((r) => [r.dep_id, r]));
  const projectsById = new Map(projectList.map((p) => [p.id, p]));
  for (const d of rows) {
    const entry = catalogEntry(d.catalogId);
    const fl = f.get(d.id);
    const ev = l.get(d.id);
    out.get(d.projectId)!.push({
      dep: d,
      entry,
      name: depName(d, entry),
      detail: depDetail(d, entry, projectsById.get(d.projectId)!.defaultProfile),
      sources: fl?.n ?? 0,
      archived: !!fl?.archived || !!fl?.deprecated,
      deprecated: !!fl?.deprecated,
      // "No licence" is about packages; a service's GitHub repo without an SPDX id says little.
      unlicensed: !d.catalogId && !!fl?.unlicensed,
      latest: ev ? { id: ev.id, title: ev.title, kind: ev.kind, publishedAt: ev.published_at } : undefined,
    });
  }
  return out;
}

export function riskOf(v: DepView, now: number): RiskGroup {
  if (v.latest && now - v.latest.publishedAt < RECENT_MS) return "recent";
  if (v.archived) return "archived";
  if (v.unlicensed) return "unlicensed";
  if (v.entry?.single_vendor) return "single_vendor";
  return "other";
}

/** Risk groups in order, plus the packages collapsed under "also watching" (SPEC §7.1). */
export function groupDeps(list: DepView[], now: number): { groups: { risk: RiskGroup; deps: DepView[] }[]; also: DepView[] } {
  const groups = new Map<RiskGroup, DepView[]>();
  const also: DepView[] = [];
  const order = (v: DepView) => (v.dep.catalogId ? 0 : v.dep.ecosystem === "eol" ? 1 : 2);
  for (const v of [...list].sort((a, b) => order(a) - order(b) || (a.dep.rank ?? 0) - (b.dep.rank ?? 0) || a.name.localeCompare(b.name))) {
    const risk = riskOf(v, now);
    if (risk === "other" && v.dep.rank !== null && v.dep.rank > SHOWN_PACKAGES) {
      also.push(v);
      continue;
    }
    groups.set(risk, [...(groups.get(risk) ?? []), v]);
  }
  return { groups: (Object.keys(RISK_LABELS) as RiskGroup[]).filter((r) => groups.has(r)).map((risk) => ({ risk, deps: groups.get(risk)! })), also };
}

const DepRow: FC<{ v: DepView; now: number }> = ({ v, now }) => (
  <li>
    <div class="spread">
      <span>
        <a href={`/app/deps/${v.dep.id}`}>
          <strong>{v.name}</strong>
        </a>{" "}
        {v.detail && <span class="meta">{v.detail}</span>}{" "}
        {v.dep.mutedUntil && v.dep.mutedUntil > now && <span class="pill">muted until {fmtDate(v.dep.mutedUntil)}</span>}
        {v.sources === 0 && <span class="pill">{v.dep.ecosystem && !WATCHED_ECOSYSTEMS.has(v.dep.ecosystem) && v.dep.ecosystem !== "eol" ? `${v.dep.ecosystem} not watched yet` : "no sources yet"}</span>}
        {v.deprecated ? <span class="pill bad">deprecated</span> : v.archived && <span class="pill bad">archived</span>}
        {v.unlicensed && <span class="pill warn">no licence</span>}
      </span>
      {v.latest ? (
        <span class="meta">
          <KindPill kind={v.latest.kind} /> <a href={`/events/${v.latest.id}`}>{v.latest.title}</a> · {fmtDate(v.latest.publishedAt)}
        </span>
      ) : (
        <span class="meta">No changes seen</span>
      )}
    </div>
  </li>
);

export const StackView: FC<{ list: DepView[]; now: number }> = ({ list, now }) => {
  const { groups, also } = groupDeps(list, now);
  return (
    <>
      {groups.map((g) => (
        <>
          <h3>
            {RISK_LABELS[g.risk]} <span class="meta">({g.deps.length})</span>
          </h3>
          <ul class="plain">
            {g.deps.map((v) => (
              <DepRow v={v} now={now} />
            ))}
          </ul>
        </>
      ))}
      {also.length > 0 && (
        <details>
          <summary>Also watching {also.length} more packages</summary>
          <ul class="plain">
            {also.map((v) => (
              <DepRow v={v} now={now} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
};

export async function projectDeps(ctx: Ctx, project: Project): Promise<DepView[]> {
  return (await loadDeps(ctx, [project])).get(project.id)!;
}

export async function userDepCount(ctx: Ctx, projectId: number): Promise<number> {
  return (await ctx.db.select({ n: sql<number>`count(*)` }).from(deps).where(eq(deps.projectId, projectId)).get())?.n ?? 0;
}
