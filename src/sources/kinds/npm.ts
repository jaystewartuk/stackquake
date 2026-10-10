// npm: licence, deprecation and repository of the latest version (SPEC §5).
import { fromUtf8, HOUR, stableStringify } from "../../util";
import { politeFetch } from "../http";
import type { DetectedChange, KindHandler } from "../types";

export interface NpmState {
  license: string | null;
  deprecated: string | null;
  repository: string | null;
  version?: string;
}

export function npmUrl(name: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/, "@")}/latest`;
}

export function licenseString(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object" && "type" in raw && typeof raw.type === "string") return raw.type.trim() || null;
  if (Array.isArray(raw)) {
    const parts = raw.map(licenseString).filter((x): x is string => !!x);
    return parts.length ? (parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0]) : null;
  }
  return null;
}

export function repoString(raw: unknown): string | null {
  const url = typeof raw === "string" ? raw : raw && typeof raw === "object" && "url" in raw && typeof raw.url === "string" ? raw.url : null;
  if (!url) return null;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

export function parseNpm(body: string): NpmState {
  const d = JSON.parse(body) as Record<string, unknown>;
  return {
    license: licenseString(d.license ?? d.licenses),
    deprecated: typeof d.deprecated === "string" && d.deprecated.trim() ? d.deprecated.trim() : null,
    repository: repoString(d.repository),
    version: typeof d.version === "string" ? d.version : undefined,
  };
}

export function compareNpm(name: string, prev: NpmState, next: NpmState): DetectedChange[] {
  const url = `https://www.npmjs.com/package/${name}`;
  const out: DetectedChange[] = [];
  if ((prev.license ?? "") !== (next.license ?? "")) {
    const from = prev.license ?? "no licence";
    const to = next.license ?? "no licence";
    out.push({
      kind: "license",
      title: `${name} (npm): licence changed from ${from} to ${to}`,
      dedupeTitle: `licence ${from} -> ${to}`,
      quoteUrl: url,
      beforeText: `"license": ${JSON.stringify(prev.license)}`,
      afterText: `"license": ${JSON.stringify(next.license)}${next.version ? ` (version ${next.version})` : ""}`,
    });
  }
  if (!prev.deprecated && next.deprecated) {
    out.push({
      kind: "deprecated",
      title: `${name} (npm): latest version is deprecated`,
      dedupeTitle: `deprecated ${name}`,
      quote: next.deprecated,
      quoteUrl: url,
      afterText: next.deprecated,
    });
  }
  return out;
}

export const npm: KindHandler = {
  kind: "npm",
  intervalMs: 6 * HOUR,
  gate: () => [],
  async poll(ctx, { source, prev }) {
    const r = await politeFetch(ctx, source.url, { accept: "application/json", etag: source.etag, lastModified: source.lastModified, maxBytes: 2_000_000 });
    if (r.type !== "ok") return r;
    const { version, ...state } = parseNpm(fromUtf8(r.body));
    return {
      type: "ok",
      status: r.status,
      etag: r.etag,
      lastModified: r.lastModified,
      canonical: stableStringify(state),
      state,
      changes: prev ? compareNpm(source.key, prev as NpmState, { ...state, version }) : [],
    };
  },
};
