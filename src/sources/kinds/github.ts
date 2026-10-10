// GitHub repo metadata: archived, SPDX ID, LICENSE file sha, owner (SPEC §5).
// One poll makes two API calls (repo, then licence). The licence call is conditional (ETag),
// so it is usually a free 304.
import type { Ctx } from "../../context";
import { fromUtf8, gunzip, gzip, HOUR, stableStringify, truncate, utf8 } from "../../util";
import { politeFetch } from "../http";
import type { DetectedChange, KindHandler } from "../types";

export interface GithubState {
  fullName: string;
  owner: string;
  archived: boolean;
  spdx: string | null;
  licenseSha: string | null;
  licensePath: string | null;
}

interface GithubStored extends GithubState {
  licenseEtag?: string | null;
}

export const githubUrl = (repo: string) => `https://api.github.com/repos/${repo}`;

export function parseGithubRepo(body: string): Pick<GithubState, "fullName" | "owner" | "archived" | "spdx"> {
  const d = JSON.parse(body) as { full_name?: string; owner?: { login?: string }; archived?: boolean; license?: { spdx_id?: string } | null };
  return {
    fullName: (d.full_name ?? "").toLowerCase(),
    owner: (d.owner?.login ?? "").toLowerCase(),
    archived: d.archived === true,
    spdx: d.license?.spdx_id ?? null,
  };
}

export function parseGithubLicense(body: string): { sha: string | null; path: string | null; text: string | null } {
  const d = JSON.parse(body) as { sha?: string; path?: string; content?: string; encoding?: string };
  let text: string | null = null;
  if (d.content && d.encoding === "base64") {
    try {
      text = fromUtf8(Uint8Array.from(atob(d.content.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
    } catch {
      text = null;
    }
  }
  return { sha: d.sha ?? null, path: d.path ?? null, text };
}

export function compareGithub(prev: GithubState, next: GithubState, licenceText?: { before: string | null; after: string | null }): DetectedChange[] {
  const url = `https://github.com/${next.fullName}`;
  const out: DetectedChange[] = [];
  if (!prev.archived && next.archived) {
    out.push({ kind: "archived", title: `${next.fullName}: repository archived`, dedupeTitle: "archived", quoteUrl: url });
  }
  if ((prev.spdx ?? "") !== (next.spdx ?? "")) {
    const from = prev.spdx ?? "no licence";
    const to = next.spdx ?? "no licence";
    out.push({
      kind: "license",
      title: `${next.fullName}: licence changed from ${from} to ${to}`,
      dedupeTitle: `licence ${from} -> ${to}`,
      quoteUrl: next.licensePath ? `${url}/blob/HEAD/${next.licensePath}` : url,
      beforeText: licenceText?.before ? truncate(licenceText.before, 8_000) : null,
      afterText: licenceText?.after ? truncate(licenceText.after, 8_000) : null,
    });
  } else if (prev.licenseSha && next.licenseSha && prev.licenseSha !== next.licenseSha) {
    out.push({
      kind: "license",
      title: `${next.fullName}: licence file changed (${next.licensePath ?? "LICENSE"})`,
      dedupeTitle: `licence file ${next.licenseSha}`,
      quoteUrl: `${url}/blob/HEAD/${next.licensePath ?? "LICENSE"}`,
      beforeText: licenceText?.before ? truncate(licenceText.before, 8_000) : null,
      afterText: licenceText?.after ? truncate(licenceText.after, 8_000) : null,
    });
  }
  if (prev.owner && next.owner && prev.owner !== next.owner) {
    out.push({
      kind: "other",
      title: `${prev.fullName} was transferred to ${next.fullName}`,
      dedupeTitle: `transferred ${prev.owner} -> ${next.owner}`,
      quoteUrl: url,
    });
  }
  return out;
}

export const github: KindHandler = {
  kind: "github_repo",
  intervalMs: 6 * HOUR,
  gate: () => [],
  async poll(ctx, { source, prev }) {
    const headers: Record<string, string> = { "x-github-api-version": "2022-11-28" };
    if (ctx.config.githubToken) headers.authorization = `Bearer ${ctx.config.githubToken}`;
    const accept = "application/vnd.github+json";

    // The repo resource changes on every push, so its ETag rarely saves anything; fetch it fresh.
    const repo = await politeFetch(ctx, source.url, { accept, headers, maxBytes: 1_000_000 });
    if (repo.type !== "ok") return repo;
    const meta = parseGithubRepo(fromUtf8(repo.body));

    const old = prev as GithubStored | null;
    const sameRepo = old?.fullName === meta.fullName;
    const lic = await politeFetch(ctx, `https://api.github.com/repos/${meta.fullName}/license`, {
      accept,
      headers,
      etag: sameRepo ? old?.licenseEtag : null,
      maxBytes: 2_000_000,
    });
    let licence: { sha: string | null; path: string | null; text: string | null };
    let licenseEtag: string | null = null;
    if (lic.type === "ok") {
      licence = parseGithubLicense(fromUtf8(lic.body));
      licenseEtag = lic.etag;
    } else if (lic.type === "not_modified" && old) {
      licence = { sha: old.licenseSha, path: old.licensePath, text: null };
      licenseEtag = old.licenseEtag ?? null;
    } else if (lic.type === "retry" && lic.status === 404) {
      licence = { sha: null, path: null, text: null };
    } else {
      return lic.type === "not_modified" ? { type: "retry", status: 304, reason: "licence 304 without a stored state", retryAfterMs: null } : lic;
    }

    const state: GithubState = { ...meta, licenseSha: licence.sha, licensePath: licence.path };
    // Licence texts are kept by git blob sha so a later change can show before and after.
    if (licence.sha && licence.text) await putText(ctx, licence.sha, licence.text);
    let changes: DetectedChange[] = [];
    if (old) {
      const licenceChanged = old.licenseSha !== state.licenseSha || (old.spdx ?? "") !== (state.spdx ?? "");
      const before = licenceChanged && old.licenseSha ? await getText(ctx, old.licenseSha) : null;
      changes = compareGithub(old, state, { before, after: licence.text });
    }
    return {
      type: "ok",
      status: repo.status,
      etag: null,
      lastModified: null,
      canonical: stableStringify(state),
      state: { ...state, licenseEtag } satisfies GithubStored,
      changes,
    };
  },
};

const licenceKey = (sha: string) => `license/${sha}`;

async function putText(ctx: Ctx, sha: string, text: string) {
  if (!(await ctx.blobs.has(licenceKey(sha)))) await ctx.blobs.put(licenceKey(sha), await gzip(utf8(text)));
}

async function getText(ctx: Ctx, sha: string): Promise<string | null> {
  const body = await ctx.blobs.get(licenceKey(sha));
  return body ? fromUtf8(await gunzip(body)) : null;
}
