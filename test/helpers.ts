import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { DEFAULT_MODELS, USER_AGENT, type Ctx } from "../src/context";
import { sources, type Source, type SourceKind } from "../src/db/schema";
import { d1Db } from "../src/platform/cloudflare";
import { FakeLlm } from "../src/llm/fake";
import { FakeClock, MemoryBlobStore } from "../src/platform/memory";

export type Route = Response | string | object | ((req: Request) => Response | Promise<Response>);

/** Fixture HTTP: routes by exact URL. Records every request. Unknown URLs get a 404. */
export class FixtureHttp {
  readonly requests: Request[] = [];
  routes = new Map<string, Route>();

  set(url: string, route: Route) {
    this.routes.set(url, route);
    return this;
  }

  fetch = async (req: Request): Promise<Response> => {
    this.requests.push(req);
    const route = this.routes.get(req.url);
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "function") return route(req);
    if (route instanceof Response) return route.clone();
    if (typeof route === "string") return new Response(route, { headers: { "content-type": "text/html" } });
    return Response.json(route);
  };

  count(url: string) {
    return this.requests.filter((r) => r.url === url).length;
  }
}

export async function resetDb() {
  const db = d1Db(env.DB);
  for (const t of ["llm_calls", "events", "jobs", "snapshots", "catalog_sources", "catalog", "robots", "sources"]) await db.run(sql.raw(`DELETE FROM ${t}`));
}

export function testCtx(overrides: Partial<Omit<Ctx, "llm">> & { http?: FixtureHttp; llm?: FakeLlm } = {}) {
  const http = overrides.http ?? new FixtureHttp();
  const llm = overrides.llm ?? new FakeLlm();
  const clock = new FakeClock();
  const blobs = new MemoryBlobStore();
  const ctx: Ctx = {
    db: d1Db(env.DB),
    blobs,
    clock,
    http: http.fetch,
    config: { jobsPerTick: 10, userAgent: USER_AGENT, models: DEFAULT_MODELS },
    ...overrides,
    llm,
  };
  return { ctx, http, llm, clock: (overrides.clock as FakeClock) ?? clock, blobs: (overrides.blobs as MemoryBlobStore) ?? blobs };
}

export async function addSource(ctx: Ctx, s: { kind: SourceKind; key: string; url: string; selector?: string; config?: Record<string, unknown> }): Promise<Source> {
  const [row] = await ctx.db
    .insert(sources)
    .values({ kind: s.kind, key: s.key, url: s.url, selector: s.selector ?? null, config: s.config ?? {}, nextPollAt: ctx.clock.now() })
    .returning();
  return row;
}

export async function reload(ctx: Ctx, id: number): Promise<Source> {
  return (await ctx.db.select().from(sources).where(sql`${sources.id} = ${id}`).get())!;
}
