// Maps what repo import found onto catalog deps, runtimes (`eol` deps) and packages (SPEC §7.1).
import type { CatalogEntry } from "../catalog/catalog";
import type { Ecosystem, Found, FoundRuntime } from "./manifests";

export interface ProposedDep {
  depKey: string;
  catalogId: string | null;
  ecosystem: string | null;
  package: string | null;
  versionSpec: string | null;
  eolProduct: string | null;
  eolCycle: string | null;
  foundIn: string[];
}

export interface Proposal {
  /** Catalog entries, with a runtime cycle attached when the entry watches that product's EOL. */
  catalog: ProposedDep[];
  /** Runtimes whose endoflife.date product no catalog entry covers. */
  runtimes: ProposedDep[];
  /** Direct, non-dev packages not covered by a catalog entry, in the order found. */
  packages: ProposedDep[];
}

export const catalogDepKey = (id: string) => `catalog:${id}`;
export const packageDepKey = (ecosystem: string, name: string) => `${ecosystem}:${name}`;
export const eolDepKey = (product: string) => `eol:${product}`;

// ---------- Docker images → endoflife.date products ----------

/** Docker Hub image → endoflife.date product. */
const IMAGE_PRODUCTS: Record<string, string> = {
  node: "nodejs",
  python: "python",
  postgres: "postgresql",
  redis: "redis",
  golang: "go",
  ruby: "ruby",
  php: "php",
  mysql: "mysql",
  mariadb: "mariadb",
  mongo: "mongodb",
  alpine: "alpine",
  debian: "debian",
  ubuntu: "ubuntu",
  nginx: "nginx",
  "oven/bun": "bun",
  "denoland/deno": "deno",
  elasticsearch: "elasticsearch",
  rabbitmq: "rabbitmq",
  "valkey/valkey": "valkey",
  "eclipse-temurin": "eclipse-temurin",
  haproxy: "haproxy",
  traefik: "traefik",
  memcached: "memcached",
};

/** How many version components make an endoflife.date cycle for each product. */
const CYCLE_PARTS: Record<string, number> = {
  nodejs: 1,
  python: 2,
  postgresql: 1,
  go: 2,
  ruby: 2,
  php: 2,
  redis: 2,
  mysql: 2,
  mariadb: 2,
  mongodb: 2,
  alpine: 2,
  debian: 1,
  ubuntu: 2,
  nginx: 2,
  valkey: 2,
  "eclipse-temurin": 1,
  rabbitmq: 2,
  elasticsearch: 1,
  haproxy: 2,
  traefik: 1,
  memcached: 2,
};

const CODENAMES: Record<string, string> = { trixie: "13", bookworm: "12", bullseye: "11", buster: "10", noble: "24.04", jammy: "22.04", focal: "20.04" };

/** "docker.io/library/node:20-alpine@sha256:…" → { name: "node", tag: "20-alpine" }. */
export function parseImage(ref: string): { name: string; tag: string | null } {
  let s = ref.split("@")[0];
  const slash = s.lastIndexOf("/");
  const colon = s.lastIndexOf(":");
  const tag = colon > slash ? s.slice(colon + 1) : null;
  if (colon > slash) s = s.slice(0, colon);
  s = s.toLowerCase().replace(/^(docker\.io|index\.docker\.io|registry-1\.docker\.io)\//, "").replace(/^library\//, "");
  return { name: s, tag };
}

/** The endoflife.date cycle for a version string, or null when it does not pin one. */
export function eolCycle(product: string, version: string | null): string | null {
  if (!version) return null;
  const v = version.trim().replace(/^v/i, "");
  const code = Object.keys(CODENAMES).find((c) => v.toLowerCase().split(/[-.]/).includes(c));
  if (code && (product === "debian" || product === "ubuntu")) return CODENAMES[code];
  const m = /^(\d+(?:\.\d+)*)/.exec(v);
  const parts = CYCLE_PARTS[product];
  if (!m || !parts) return null;
  const nums = m[1].split(".");
  if (nums.length < parts) return null;
  return nums.slice(0, parts).join(".");
}

/** A runtime implied by an image ("node:20-alpine" → nodejs 20), if the image is one we know. */
export function imageRuntime(ref: string): FoundRuntime | null {
  const { name, tag } = parseImage(ref);
  const product = IMAGE_PRODUCTS[name];
  if (!product) return null;
  return { product, version: tag, exact: true };
}

// ---------- detect.files patterns ----------

const patternCache = new Map<string, RegExp>();

/** `wrangler.toml`, `supabase/config.toml`, `*.tf`, `.github/workflows/` (directory). */
export function fileMatcher(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    const dir = pattern.endsWith("/");
    const body = pattern
      .replace(/\/$/, "")
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*");
    re = new RegExp(`(^|/)${body}${dir ? "/" : "$"}`, "i");
    patternCache.set(pattern, re);
  }
  return re;
}

// ---------- Mapping ----------

interface Index {
  files: { re: RegExp; id: string }[];
  npm: Map<string, string>;
  pypi: Map<string, string>;
  docker: Map<string, string>;
  terraform: Map<string, string>;
  eol: Map<string, string>;
}

function buildIndex(entries: CatalogEntry[]): Index {
  const ix: Index = { files: [], npm: new Map(), pypi: new Map(), docker: new Map(), terraform: new Map(), eol: new Map() };
  for (const e of entries) {
    for (const f of e.detect?.files ?? []) ix.files.push({ re: fileMatcher(f), id: e.id });
    for (const n of e.detect?.npm ?? []) ix.npm.set(n, e.id);
    for (const n of e.detect?.pypi ?? []) ix.pypi.set(n.toLowerCase().replace(/[-_.]+/g, "-"), e.id);
    for (const n of e.detect?.docker ?? []) ix.docker.set(n.toLowerCase(), e.id);
    for (const n of e.detect?.terraform ?? []) ix.terraform.set(n.toLowerCase(), e.id);
    for (const s of e.sources) if (s.kind === "eol" && !ix.eol.has(s.product)) ix.eol.set(s.product, e.id);
  }
  return ix;
}

const cmpVersion = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/**
 * @param paths every file path import saw (detection by file presence)
 * @param found parsed manifests by path
 */
export function mapStack(paths: string[], found: Record<string, Found>, entries: CatalogEntry[]): Proposal {
  const ix = buildIndex(entries);
  const catalog = new Map<string, ProposedDep>();
  const hitCatalog = (id: string, path: string) => {
    let d = catalog.get(id);
    if (!d) catalog.set(id, (d = { depKey: catalogDepKey(id), catalogId: id, ecosystem: null, package: null, versionSpec: null, eolProduct: null, eolCycle: null, foundIn: [] }));
    if (!d.foundIn.includes(path)) d.foundIn.push(path);
    return d;
  };

  for (const path of paths) for (const f of ix.files) if (f.re.test(path)) hitCatalog(f.id, path);

  // Workspace packages depend on each other by name; those are not third-party packages.
  const internal = new Set(Object.values(found).map((f) => f.ownName).filter((n): n is string => !!n));
  const packages = new Map<string, ProposedDep>();
  const runtimes: { product: string; cycle: string | null; path: string }[] = [];

  for (const [path, f] of Object.entries(found)) {
    for (const p of f.packages) {
      if (p.ecosystem === "npm" && internal.has(p.name)) continue;
      const id = p.ecosystem === "npm" ? ix.npm.get(p.name) : p.ecosystem === "pypi" ? ix.pypi.get(p.name) : undefined;
      // Catalog detection counts dev dependencies too (wrangler is usually a devDependency).
      if (id) {
        hitCatalog(id, path);
        continue;
      }
      if (p.dev) continue;
      const key = packageDepKey(p.ecosystem, p.name);
      const d = packages.get(key);
      if (d) {
        if (!d.foundIn.includes(path)) d.foundIn.push(path);
      } else packages.set(key, { depKey: key, catalogId: null, ecosystem: p.ecosystem satisfies Ecosystem, package: p.name, versionSpec: p.spec, eolProduct: null, eolCycle: null, foundIn: [path] });
    }
    for (const r of f.runtimes) runtimes.push({ product: r.product, cycle: r.exact ? eolCycle(r.product, r.version) : null, path });
    for (const ref of f.images) {
      const { name } = parseImage(ref);
      const id = ix.docker.get(name);
      if (id) hitCatalog(id, path);
      const r = imageRuntime(ref);
      if (r) runtimes.push({ product: r.product, cycle: eolCycle(r.product, r.version), path });
    }
    for (const p of f.providers) {
      const id = ix.terraform.get(p);
      if (id) hitCatalog(id, path);
    }
  }

  // One dep per runtime product. With several cycles (two apps on different Node versions) keep
  // the oldest: it reaches end of life first.
  const byProduct = new Map<string, { cycle: string | null; paths: string[] }>();
  for (const r of runtimes) {
    const cur = byProduct.get(r.product);
    if (!cur) byProduct.set(r.product, { cycle: r.cycle, paths: [r.path] });
    else {
      if (!cur.paths.includes(r.path)) cur.paths.push(r.path);
      if (r.cycle && (!cur.cycle || cmpVersion(r.cycle, cur.cycle) < 0)) cur.cycle = r.cycle;
    }
  }
  const eolDeps: ProposedDep[] = [];
  for (const [product, r] of byProduct) {
    const id = ix.eol.get(product);
    if (id) {
      let d: ProposedDep | undefined;
      for (const p of r.paths) d = hitCatalog(id, p);
      d!.eolProduct = product;
      d!.eolCycle = r.cycle;
    } else eolDeps.push({ depKey: eolDepKey(product), catalogId: null, ecosystem: "eol", package: product, versionSpec: null, eolProduct: product, eolCycle: r.cycle, foundIn: r.paths });
  }
  return { catalog: [...catalog.values()], runtimes: eolDeps, packages: [...packages.values()] };
}
