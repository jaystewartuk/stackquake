// GitHub App webhooks (SPEC §7.1, §8). Signed with X-Hub-Signature-256. The app subscribes to
// `push` only; `installation` events arrive regardless. A push to the default branch that touches
// a manifest re-imports every project connected to that repo through the same installation.
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { CATALOG } from "../catalog/entries";
import type { CatalogEntry } from "../catalog/catalog";
import type { Ctx } from "../context";
import { teamPlanSql } from "../billing/plans";
import { githubInstallations, projects } from "../db/schema";
import type { AppEnv } from "../env";
import { latestImport, startImport } from "../stack/import";
import { parserFor } from "../stack/manifests";
import { fileMatcher } from "../stack/mapping";
import { verifyWebhookSignature } from "./app";

/** Bigger bodies are acknowledged unread: parsing them would not fit the CPU budget. */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;
/** GitHub caps a push payload's `commits` at this many; a full list may have missed files. */
const COMMITS_CAP = 2048;

export interface PushPayload {
  ref?: string;
  deleted?: boolean;
  repository?: { full_name?: string; default_branch?: string };
  installation?: { id?: number };
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
}

/** True when a path is a manifest import reads, or a file a catalog entry is detected by. */
export function isManifestPath(path: string, entries: CatalogEntry[] = CATALOG): boolean {
  if (parserFor(path)) return true;
  return entries.some((e) => (e.detect?.files ?? []).some((f) => fileMatcher(f).test(path)));
}

export function pushTouchesManifest(p: PushPayload, entries: CatalogEntry[] = CATALOG): boolean {
  const commits = p.commits ?? [];
  if (commits.length >= COMMITS_CAP) return true;
  return commits.some((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])].some((path) => isManifestPath(path, entries)));
}

export type PushResult = "ignored" | "no_manifest" | "no_project" | { reimported: number[] };

export async function handlePush(ctx: Ctx, p: PushPayload, entries: CatalogEntry[] = CATALOG): Promise<PushResult> {
  const repo = p.repository?.full_name;
  const installationId = p.installation?.id;
  if (!repo || !installationId || p.deleted || p.ref !== `refs/heads/${p.repository?.default_branch}`) return "ignored";
  if (!pushTouchesManifest(p, entries)) return "no_manifest";
  const rows = await ctx.db
    .select({ id: projects.id, repo: projects.repoFullName })
    .from(projects)
    // Private repos are a Team feature: a lapsed plan stops re-imports (SPEC §10).
    .where(and(sql`lower(${projects.repoFullName}) = ${repo.toLowerCase()}`, eq(projects.githubInstallationId, installationId), teamPlanSql(sql`${projects.userId}`)))
    .all();
  if (!rows.length) return "no_project";
  const started: number[] = [];
  for (const r of rows) {
    // An import already running will read the new commit anyway.
    if ((await latestImport(ctx, r.id))?.status === "running") continue;
    await startImport(ctx, r.id, r.repo!, installationId);
    started.push(r.id);
  }
  return { reimported: started };
}

interface InstallationPayload {
  action?: string;
  installation?: { id?: number; account?: { login?: string } };
}

export async function handleInstallation(ctx: Ctx, p: InstallationPayload): Promise<string> {
  const id = p.installation?.id;
  if (!id) return "ignored";
  const now = ctx.clock.now();
  if (p.action === "deleted") {
    // Projects keep their repo name; their next import says the app must be installed again.
    await ctx.db.delete(githubInstallations).where(eq(githubInstallations.id, id));
  } else if (p.action === "suspend" || p.action === "unsuspend") {
    await ctx.db
      .update(githubInstallations)
      .set({ suspendedAt: p.action === "suspend" ? now : null, tokenEnc: null, tokenExpiresAt: null, updatedAt: now })
      .where(eq(githubInstallations.id, id));
  } else return "ignored";
  return p.action;
}

export function githubWebhook(makeCtx: (env: AppEnv) => Ctx) {
  const hook = new Hono<{ Bindings: AppEnv }>();
  hook.post("/github/webhook", async (c) => {
    const ctx = makeCtx(c.env);
    const app = ctx.config.githubApp;
    if (!app) return c.text("Not configured", 404);
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > MAX_WEBHOOK_BYTES) {
      console.log(JSON.stringify({ webhook: c.req.header("x-github-event"), skipped: "too_large", bytes: length }));
      return c.text("Too large; ignored", 202);
    }
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.length > MAX_WEBHOOK_BYTES) return c.text("Too large; ignored", 202);
    if (!(await verifyWebhookSignature(app.webhookSecret, body, c.req.header("x-hub-signature-256")))) return c.text("Bad signature", 401);
    const event = c.req.header("x-github-event");
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return c.text("Bad JSON", 400);
    }
    let result: unknown = "ignored";
    if (event === "push") result = await handlePush(ctx, payload as PushPayload);
    else if (event === "installation") result = await handleInstallation(ctx, payload as InstallationPayload);
    else if (event === "ping") result = "pong";
    console.log(JSON.stringify({ webhook: event, delivery: c.req.header("x-github-delivery"), result }));
    return c.json({ ok: true, result });
  });
  return hook;
}
