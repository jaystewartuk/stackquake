// PyPI: licence fields, licence and status classifiers, yanked latest release (SPEC §5).
import { fromUtf8, HOUR, stableStringify, truncate } from "../../util";
import { politeFetch } from "../http";
import type { DetectedChange, KindHandler } from "../types";

export interface PypiState {
  license: string | null;
  licenseExpression: string | null;
  licenseClassifiers: string[];
  inactive: boolean;
  yanked: boolean;
}

/** PEP 503 name normalisation. */
export const pypiName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
export const pypiUrl = (name: string) => `https://pypi.org/pypi/${pypiName(name)}/json`;

export function parsePypi(body: string): PypiState & { version?: string; yankedReason?: string | null } {
  const d = JSON.parse(body) as { info?: Record<string, unknown> };
  const info = d.info ?? {};
  const classifiers = Array.isArray(info.classifiers) ? (info.classifiers as string[]) : [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const license = str(info.license);
  return {
    // Some projects paste the whole licence text here; keep enough to detect a change.
    license: license ? truncate(license, 2_000) : null,
    licenseExpression: str(info.license_expression),
    licenseClassifiers: classifiers.filter((c) => c.startsWith("License ::")).sort(),
    inactive: classifiers.some((c) => /^Development Status :: 7 - Inactive/.test(c)),
    yanked: info.yanked === true,
    version: str(info.version) ?? undefined,
    yankedReason: str(info.yanked_reason),
  };
}

const licenceLabel = (s: PypiState) => s.licenseExpression ?? (s.license && s.license.length <= 80 ? s.license : null) ?? s.licenseClassifiers.map((c) => c.split(" :: ").pop()).join(", ") ?? "unknown";

export function comparePypi(name: string, prev: PypiState, next: PypiState & { version?: string; yankedReason?: string | null }): DetectedChange[] {
  const url = `https://pypi.org/project/${pypiName(name)}/`;
  const out: DetectedChange[] = [];
  const licence = (s: PypiState) => stableStringify([s.licenseExpression, s.license, s.licenseClassifiers]);
  if (licence(prev) !== licence(next)) {
    const from = licenceLabel(prev) || "no licence";
    const to = licenceLabel(next) || "no licence";
    out.push({
      kind: "license",
      title: `${name} (PyPI): licence changed from ${from} to ${to}`,
      dedupeTitle: `licence ${from} -> ${to}`,
      quoteUrl: url,
      beforeText: stableStringify({ license: prev.license, license_expression: prev.licenseExpression, classifiers: prev.licenseClassifiers }),
      afterText: stableStringify({ license: next.license, license_expression: next.licenseExpression, classifiers: next.licenseClassifiers }),
    });
  }
  if (!prev.inactive && next.inactive) {
    out.push({ kind: "deprecated", title: `${name} (PyPI): project marked inactive`, dedupeTitle: `deprecated ${name}`, quote: "Development Status :: 7 - Inactive", quoteUrl: url });
  }
  if (!prev.yanked && next.yanked) {
    out.push({
      kind: "deprecated",
      title: `${name} (PyPI): latest release ${next.version ?? ""} was yanked`.replace("  ", " "),
      dedupeTitle: `yanked ${name} ${next.version ?? ""}`,
      quote: next.yankedReason ?? null,
      quoteUrl: url,
    });
  }
  return out;
}

export const pypi: KindHandler = {
  kind: "pypi",
  intervalMs: 6 * HOUR,
  gate: () => [],
  async poll(ctx, { source, prev }) {
    const r = await politeFetch(ctx, source.url, { accept: "application/json", etag: source.etag, lastModified: source.lastModified, maxBytes: 4_000_000 });
    if (r.type !== "ok") return r;
    const { version, yankedReason, ...state } = parsePypi(fromUtf8(r.body));
    return {
      type: "ok",
      status: r.status,
      etag: r.etag,
      lastModified: r.lastModified,
      canonical: stableStringify(state),
      state,
      changes: prev ? comparePypi(source.key, prev as PypiState, { ...state, version, yankedReason }) : [],
    };
  },
};
