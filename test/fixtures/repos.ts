// Fixture repos for import tests, served as a mocked GitHub API (repo, trees) and raw host.
import monorepo from "../../testdata/repos/monorepo.json";
import { GITHUB_API, GITHUB_RAW } from "../../src/context";
import type { FixtureHttp } from "../helpers";

export type RepoFiles = Record<string, string>;

/**
 * A turborepo-style monorepo: two apps with their own package.json, plus infra and CI. Kept as
 * JSON so scripts/measure-cpu.mjs can serve the same repo.
 */
export const MONOREPO: RepoFiles = monorepo;

const treeSha = (dir: string) => `t${dir.replace(/[^\w]/g, "_")}`;

/** Serves `files` as owner/name on the fixture GitHub API and raw host. */
export function serveRepo(http: FixtureHttp, repo: string, files: RepoFiles, opts: { branch?: string; api?: string; raw?: string } = {}) {
  const branch = opts.branch ?? "main";
  const api = opts.api ?? GITHUB_API;
  const raw = opts.raw ?? GITHUB_RAW;
  http.set(`${api}/repos/${repo}`, { full_name: repo, default_branch: branch, private: false });
  // Directory → entries.
  const dirs = new Map<string, Map<string, { type: "blob" | "tree"; size?: number }>>();
  const ensure = (d: string) => dirs.get(d) ?? (dirs.set(d, new Map()), dirs.get(d)!);
  ensure("");
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      const name = parts[i];
      const isFile = i === parts.length - 1;
      ensure(parent).set(name, isFile ? { type: "blob", size: content.length } : { type: "tree" });
      if (!isFile) ensure(parts.slice(0, i + 1).join("/"));
    }
    http.set(`${raw}/${repo}/${branch}/${path}`, new Response(content));
  }
  for (const [dir, entries] of dirs) {
    const tree = [...entries].map(([name, e]) => ({ path: name, type: e.type, sha: e.type === "tree" ? treeSha(dir ? `${dir}/${name}` : name) : `b${name}`, ...(e.size !== undefined ? { size: e.size } : {}) }));
    http.set(`${api}/repos/${repo}/git/trees/${dir === "" ? branch : treeSha(dir)}`, { sha: treeSha(dir), tree, truncated: false });
  }
}
