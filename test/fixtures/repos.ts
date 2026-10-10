// Fixture repos for import tests, served as a mocked GitHub API (repo, trees) and raw host.
import { GITHUB_API, GITHUB_RAW } from "../../src/context";
import type { FixtureHttp } from "../helpers";

export type RepoFiles = Record<string, string>;

/** A turborepo-style monorepo: two apps with their own package.json, plus infra and CI. */
export const MONOREPO: RepoFiles = {
  "package.json": JSON.stringify({ name: "acme", private: true, workspaces: ["apps/*", "packages/*"], devDependencies: { turbo: "^2.1.0", typescript: "^5.6.0" }, engines: { node: ">=20" } }),
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
  ".nvmrc": "20.11.1\n",
  "README.md": "# Acme\n",
  "vercel.json": "{}",
  "docker-compose.yml": "services:\n  db:\n    image: postgres:16-alpine\n  cache:\n    image: redis:7.2\n",
  ".github/workflows/ci.yml": "jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n",
  "apps/web/package.json": JSON.stringify({ name: "@acme/web", dependencies: { next: "15.0.3", react: "19.0.0", "@supabase/supabase-js": "^2.45.0", "@acme/ui": "workspace:*" }, devDependencies: { eslint: "^9" } }),
  "apps/web/next.config.mjs": "export default {}",
  "apps/api/package.json": JSON.stringify({ name: "@acme/api", dependencies: { hono: "^4.6.0", zod: "^3.23.0", "@acme/ui": "workspace:*" }, devDependencies: { wrangler: "^3.80.0", "@cloudflare/workers-types": "^4" } }),
  "apps/api/wrangler.toml": 'name = "acme-api"\nmain = "src/index.ts"\n',
  "apps/api/src/index.ts": "export default {}",
  "apps/worker/Dockerfile": "FROM python:3.12-slim AS base\nFROM base\nCOPY . .\n",
  "apps/worker/requirements.txt": "fastapi==0.115.0\nuvicorn[standard]>=0.30\n",
  "packages/ui/package.json": JSON.stringify({ name: "@acme/ui", dependencies: { "class-variance-authority": "^0.7.0" }, peerDependencies: { react: "^19" } }),
  "supabase/config.toml": 'project_id = "acme"\n',
  "infra/main.tf": 'terraform {\n  required_providers {\n    cloudflare = { source = "cloudflare/cloudflare" }\n  }\n}\n',
  // Skipped directories: their manifests are not the project's stack.
  "docs/package.json": JSON.stringify({ name: "docs", dependencies: { docusaurus: "^3" } }),
  "examples/demo/package.json": JSON.stringify({ name: "demo", dependencies: { express: "^4" } }),
};

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
