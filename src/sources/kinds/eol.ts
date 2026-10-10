// endoflife.date API v1: EOL dates per release cycle (SPEC §5).
// Key is "product" (all cycles) or "product@cycle".
import { DAY, fromUtf8, stableStringify } from "../../util";
import { politeFetch } from "../http";
import type { DetectedChange, KindHandler, PollInput } from "../types";

export interface EolCycle {
  name: string;
  /** ISO date, or true/false when the product only says whether it is EOL. */
  eol: string | boolean;
  eoas: string | boolean | null;
}

export interface EolState {
  product: string;
  cycles: EolCycle[];
}

export function parseEolKey(key: string): { product: string; cycle: string | null } {
  const [product, cycle] = key.split("@");
  return { product, cycle: cycle ?? null };
}

export const eolUrl = (product: string) => `https://endoflife.date/api/v1/products/${encodeURIComponent(product)}/`;

interface ApiRelease {
  name: string;
  isEol?: boolean;
  eolFrom?: string | null;
  isEoas?: boolean | null;
  eoasFrom?: string | null;
}

export function parseEol(body: string, product: string, cycle: string | null): EolState {
  const d = JSON.parse(body) as { result?: { releases?: ApiRelease[] } };
  const releases = d.result?.releases ?? [];
  const cycles = releases
    .filter((r) => cycle === null || r.name === cycle)
    .map((r) => ({
      name: r.name,
      eol: r.eolFrom ?? r.isEol === true,
      eoas: r.eoasFrom ?? (typeof r.isEoas === "boolean" ? r.isEoas : null),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return { product, cycles };
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function compareEol(prev: EolState, next: EolState): DetectedChange[] {
  const before = new Map(prev.cycles.map((c) => [c.name, c]));
  const out: DetectedChange[] = [];
  for (const c of next.cycles) {
    const old = before.get(c.name);
    if (!old || !isDate(c.eol)) continue;
    const label = `${next.product} ${c.name}`;
    if (!isDate(old.eol) && old.eol !== true) {
      out.push({
        kind: "eol",
        title: `${label}: end-of-life date set to ${c.eol}`,
        dedupeTitle: `eol ${c.name} ${c.eol}`,
        quoteUrl: `https://endoflife.date/${next.product}`,
        afterText: `"eolFrom": "${c.eol}"`,
        effectiveDate: c.eol,
      });
    } else if (isDate(old.eol) && c.eol < old.eol) {
      out.push({
        kind: "eol",
        title: `${label}: end of life moved earlier, from ${old.eol} to ${c.eol}`,
        dedupeTitle: `eol ${c.name} ${c.eol}`,
        quoteUrl: `https://endoflife.date/${next.product}`,
        beforeText: `"eolFrom": "${old.eol}"`,
        afterText: `"eolFrom": "${c.eol}"`,
        effectiveDate: c.eol,
      });
    }
  }
  return out;
}

/** One reminder per cycle and date, when the EOL date is within 90 days (dedupe makes it one). */
export function eolReminders(state: EolState, now: number): DetectedChange[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const horizon = new Date(now + 90 * DAY).toISOString().slice(0, 10);
  return state.cycles
    .filter((c) => isDate(c.eol) && c.eol >= today && c.eol <= horizon)
    .map((c) => ({
      kind: "eol" as const,
      title: `${state.product} ${c.name} reaches end of life on ${c.eol}`,
      dedupeTitle: `eol reminder ${c.name} ${c.eol}`,
      quoteUrl: `https://endoflife.date/${state.product}`,
      afterText: `"eolFrom": "${c.eol}"`,
      effectiveDate: c.eol as string,
    }));
}

export const eol: KindHandler = {
  kind: "eol",
  intervalMs: DAY,
  gate: () => [],
  async poll(ctx, { source, prev }) {
    const { product, cycle } = parseEolKey(source.key);
    const r = await politeFetch(ctx, source.url, { accept: "application/json", etag: source.etag, lastModified: source.lastModified, maxBytes: 2_000_000 });
    if (r.type !== "ok") return r;
    const state = parseEol(fromUtf8(r.body), product, cycle);
    if (cycle && state.cycles.length === 0) return { type: "retry", status: r.status, reason: `cycle ${cycle} not found`, retryAfterMs: null };
    const changes = [...(prev ? compareEol(prev as EolState, state) : []), ...eolReminders(state, ctx.clock.now())];
    return { type: "ok", status: r.status, etag: r.etag, lastModified: r.lastModified, canonical: stableStringify(state), state, changes };
  },
  onUnchanged(ctx, { prev }: PollInput) {
    return prev ? eolReminders(prev as EolState, ctx.clock.now()) : [];
  },
};
