// PyPI: licence fields, licence and status classifiers, yanked releases (SPEC §5).
import { fromUtf8, HOUR, stableStringify, truncate } from "../../util";
import { politeFetch } from "../http";
import type { DetectedChange, KindHandler } from "../types";

export interface PypiState {
  license: string | null;
  licenseExpression: string | null;
  licenseClassifiers: string[];
  inactive: boolean;
}

/** Comparator state: the hashed fields plus the latest version, which is not hashed. */
export interface PypiStored extends PypiState {
  version?: string;
}

export interface PypiParsed extends PypiStored {
  /** Versions whose files are all yanked, with the reason. */
  yanked: Map<string, string | null>;
}

/** PEP 503 name normalisation. */
export const pypiName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
export const pypiUrl = (name: string) => `https://pypi.org/pypi/${pypiName(name)}/json`;

type ReleaseFile = { yanked?: boolean; yanked_reason?: string | null };

export function parsePypi(body: string): PypiParsed {
  const d = JSON.parse(body) as { info?: Record<string, unknown>; releases?: Record<string, ReleaseFile[]> };
  const info = d.info ?? {};
  const classifiers = Array.isArray(info.classifiers) ? (info.classifiers as string[]) : [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const license = str(info.license);
  const yanked = new Map<string, string | null>();
  for (const [version, files] of Object.entries(d.releases ?? {})) {
    if (files.length && files.every((f) => f.yanked)) yanked.set(version, files[0].yanked_reason ?? null);
  }
  return {
    // Some projects paste the whole licence text here; keep enough to detect a change.
    license: license ? truncate(license, 2_000) : null,
    licenseExpression: str(info.license_expression),
    licenseClassifiers: classifiers.filter((c) => c.startsWith("License ::")).sort(),
    inactive: classifiers.some((c) => /^Development Status :: 7 - Inactive/.test(c)),
    // `info` describes the latest release that is not yanked.
    version: str(info.version) ?? undefined,
    yanked,
  };
}

const licenceLabel = (s: PypiState) =>
  s.licenseExpression ?? (s.license && s.license.length <= 80 ? s.license : null) ?? s.licenseClassifiers.map((c) => c.split(" :: ").pop()).join(", ");

export function comparePypi(name: string, prev: PypiStored, next: PypiParsed): DetectedChange[] {
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
      repeatable: true,
      quoteUrl: url,
      beforeText: stableStringify({ license: prev.license, license_expression: prev.licenseExpression, classifiers: prev.licenseClassifiers }),
      afterText: stableStringify({ license: next.license, license_expression: next.licenseExpression, classifiers: next.licenseClassifiers }),
    });
  }
  if (!prev.inactive && next.inactive) {
    out.push({ kind: "deprecated", title: `${name} (PyPI): project marked inactive`, dedupeTitle: `deprecated ${name}`, repeatable: true, quote: "Development Status :: 7 - Inactive", quoteUrl: url });
  }
  // The release that was the latest last time is now fully yanked.
  if (prev.version && next.yanked.has(prev.version)) {
    const reason = next.yanked.get(prev.version) ?? null;
    out.push({
      kind: "deprecated",
      title: `${name} (PyPI): release ${prev.version} was yanked`,
      dedupeTitle: `yanked ${name} ${prev.version}`,
      quote: reason,
      quoteUrl: `${url}${prev.version}/`,
      afterText: reason,
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
    const parsed = parsePypi(fromUtf8(r.body));
    const { version, yanked: _yanked, ...hashed } = parsed;
    return {
      type: "ok",
      status: r.status,
      etag: r.etag,
      lastModified: r.lastModified,
      canonical: stableStringify(hashed),
      state: { ...hashed, version } satisfies PypiStored,
      changes: prev ? comparePypi(source.key, prev as PypiStored, parsed) : [],
    };
  },
};
