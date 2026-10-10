// Manifest parsers for repo import (SPEC §7.1). Each takes a file's text and returns what it
// declares: packages, runtimes, Docker images, Terraform providers and workspace globs. They are
// small line-based readers, not full YAML/TOML parsers: import only needs a few keys, and the
// 10 ms CPU budget rules out shipping general parsers for files that can be large.
import { pypiName } from "../sources/kinds/pypi";

export const ECOSYSTEMS = ["npm", "pypi", "go", "crates", "gem", "composer"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

export interface FoundPackage {
  ecosystem: Ecosystem;
  name: string;
  spec: string | null;
  dev: boolean;
}

/** A runtime: an endoflife.date product and the version text found, if any. */
export interface FoundRuntime {
  product: string;
  version: string | null;
  /** True when the version is an exact pin (.nvmrc, Docker tag), false for a range (engines). */
  exact: boolean;
}

export interface Found {
  packages: FoundPackage[];
  runtimes: FoundRuntime[];
  /** Image references as written, e.g. "postgres:16-alpine". */
  images: string[];
  /** Provider sources, e.g. "cloudflare/cloudflare". */
  providers: string[];
  /** `uses:` references from GitHub Actions workflows, e.g. "actions/setup-node". */
  actions: string[];
  /** Workspace globs (package.json `workspaces`, pnpm-workspace.yaml, Cargo workspace members). */
  workspaces: string[];
  /** The package's own name (package.json), so workspace-internal deps can be dropped. */
  ownName?: string;
}

export const emptyFound = (): Found => ({ packages: [], runtimes: [], images: [], providers: [], actions: [], workspaces: [] });

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

type Parser = (text: string) => Found;

/** Which parser reads a path, or null when the file only matters by its presence. */
export function parserFor(path: string): Parser | null {
  const name = basename(path).toLowerCase();
  if (name === "package.json") return parsePackageJson;
  if (name === "deno.json" || name === "deno.jsonc") return parseDenoJson;
  if (/^requirements.*\.txt$/.test(name)) return parseRequirements;
  if (name === "pyproject.toml") return parsePyproject;
  if (name === "pipfile") return parsePipfile;
  if (name === "go.mod") return parseGoMod;
  if (name === "cargo.toml") return parseCargoToml;
  if (name === "gemfile") return parseGemfile;
  if (name === "composer.json") return parseComposerJson;
  if (name === "dockerfile" || name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return parseDockerfile;
  if (/^(docker-)?compose.*\.ya?ml$/.test(name)) return parseCompose;
  if (name === ".nvmrc" || name === ".node-version") return (t) => versionFile("nodejs", t);
  if (name === ".python-version") return (t) => versionFile("python", t);
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return parseWorkflow;
  if (name.endsWith(".tf")) return parseTerraform;
  if (name === "pnpm-workspace.yaml") return parsePnpmWorkspace;
  return null;
}

export function parseManifest(path: string, text: string): Found {
  const parser = parserFor(path);
  if (!parser) return emptyFound();
  try {
    return parser(text);
  } catch {
    return emptyFound();
  }
}

// ---------- JSON manifests ----------

/** JSON with comments and trailing commas (deno.jsonc, tsconfig-style files). */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const entries = (v: unknown): [string, string | null][] => (isRecord(v) ? Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x : null]) : []);

/** Local or VCS references are not registry packages. */
const npmLocal = (spec: string | null) => !!spec && /^(workspace:|file:|link:|portal:|git\+|git:|github:|https?:)/.test(spec);

function parsePackageJson(text: string): Found {
  const d = JSON.parse(text) as Record<string, unknown>;
  const f = emptyFound();
  if (typeof d.name === "string") f.ownName = d.name;
  const add = (deps: unknown, dev: boolean) => {
    for (const [name, spec] of entries(deps)) if (!npmLocal(spec)) f.packages.push({ ecosystem: "npm", name, spec, dev });
  };
  add(d.dependencies, false);
  add(d.optionalDependencies, false);
  add(d.devDependencies, true);
  const engines = isRecord(d.engines) ? d.engines : {};
  for (const [engine, product] of [["node", "nodejs"], ["bun", "bun"], ["deno", "deno"]] as const) {
    if (typeof engines[engine] === "string") f.runtimes.push(runtime(product, engines[engine] as string));
  }
  const ws = Array.isArray(d.workspaces) ? d.workspaces : isRecord(d.workspaces) && Array.isArray(d.workspaces.packages) ? d.workspaces.packages : [];
  f.workspaces = ws.filter((w): w is string => typeof w === "string");
  return f;
}

function parseDenoJson(text: string): Found {
  const d = parseJsonc(text) as Record<string, unknown>;
  const f = emptyFound();
  for (const [, spec] of entries(d.imports)) {
    const m = spec && /^npm:(@?[^@/]+(?:\/[^@/]+)?)(?:@([^/]+))?/.exec(spec);
    if (m) f.packages.push({ ecosystem: "npm", name: m[1], spec: m[2] ?? null, dev: false });
  }
  if (Array.isArray(d.workspace)) f.workspaces = d.workspace.filter((w): w is string => typeof w === "string");
  return f;
}

function parseComposerJson(text: string): Found {
  const d = JSON.parse(text) as Record<string, unknown>;
  const f = emptyFound();
  const add = (deps: unknown, dev: boolean) => {
    for (const [name, spec] of entries(deps)) {
      if (name === "php") f.runtimes.push(runtime("php", spec ?? ""));
      else if (name.includes("/")) f.packages.push({ ecosystem: "composer", name, spec, dev });
    }
  };
  add(d.require, false);
  add(d["require-dev"], true);
  return f;
}

// ---------- Python ----------

/** One PEP 508 requirement ("uvicorn[standard]>=0.30; python_version>'3.8'") → name and spec. */
export function pep508(req: string): { name: string; spec: string | null } | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;@]*)/.exec(req);
  if (!m) return null;
  return { name: pypiName(m[1]), spec: m[2].trim() || null };
}

function parseRequirements(text: string): Found {
  const f = emptyFound();
  for (let line of text.split("\n")) {
    line = line.replace(/(^|\s)#.*$/, "").trim();
    if (!line || line.startsWith("-") || /^[a-z+]+:\/\//i.test(line) || line.startsWith(".") || line.startsWith("/")) continue;
    const r = pep508(line);
    if (r) f.packages.push({ ecosystem: "pypi", ...r, dev: false });
  }
  return f;
}

function parsePyproject(text: string): Found {
  const t = parseToml(text);
  const f = emptyFound();
  const reqs = (v: TomlValue | undefined, dev: boolean) => {
    if (!Array.isArray(v)) return;
    for (const s of v) {
      const r = pep508(s);
      if (r) f.packages.push({ ecosystem: "pypi", ...r, dev });
    }
  };
  reqs(t.project?.dependencies, false);
  for (const [, v] of Object.entries(t["dependency-groups"] ?? {})) reqs(v, true);
  for (const [, v] of Object.entries(t["project.optional-dependencies"] ?? {})) reqs(v, true);
  const rp = t.project?.["requires-python"];
  if (typeof rp === "string") f.runtimes.push(runtime("python", rp));
  // Poetry: [tool.poetry.dependencies] name = "^1.0" | { version = "…" }; python is the runtime.
  const poetry = (section: string, dev: boolean) => {
    for (const [name, v] of Object.entries(t[section] ?? {})) {
      const spec = typeof v === "string" ? v : !Array.isArray(v) && typeof v === "object" ? (v.version ?? null) : null;
      if (name.toLowerCase() === "python") f.runtimes.push(runtime("python", spec ?? ""));
      else f.packages.push({ ecosystem: "pypi", name: pypiName(name), spec, dev });
    }
  };
  poetry("tool.poetry.dependencies", false);
  poetry("tool.poetry.dev-dependencies", true);
  for (const section of Object.keys(t)) if (/^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)) poetry(section, true);
  return f;
}

function parsePipfile(text: string): Found {
  const t = parseToml(text);
  const f = emptyFound();
  for (const [section, dev] of [["packages", false], ["dev-packages", true]] as const) {
    for (const [name, v] of Object.entries(t[section] ?? {})) {
      const spec = typeof v === "string" ? v : !Array.isArray(v) && typeof v === "object" ? (v.version ?? null) : null;
      f.packages.push({ ecosystem: "pypi", name: pypiName(name), spec: spec === "*" ? null : spec, dev });
    }
  }
  const py = t.requires?.python_version ?? t.requires?.python_full_version;
  if (typeof py === "string") f.runtimes.push({ product: "python", version: py, exact: true });
  return f;
}

// ---------- Go, Rust, Ruby ----------

function parseGoMod(text: string): Found {
  const f = emptyFound();
  let inRequire = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const go = /^go\s+(\d+\.\d+(?:\.\d+)?)/.exec(line);
    if (go) f.runtimes.push({ product: "go", version: go[1], exact: true });
    if (/^require\s*\($/.test(line)) {
      inRequire = true;
      continue;
    }
    if (inRequire && line === ")") {
      inRequire = false;
      continue;
    }
    const m = (inRequire ? /^([^\s]+)\s+(v[^\s]+)(.*)$/ : /^require\s+([^\s]+)\s+(v[^\s]+)(.*)$/).exec(line);
    // Indirect requirements are not direct dependencies (SPEC §7.1 watches direct ones).
    if (m && !m[3].includes("// indirect")) f.packages.push({ ecosystem: "go", name: m[1], spec: m[2], dev: false });
  }
  return f;
}

function parseCargoToml(text: string): Found {
  const t = parseToml(text);
  const f = emptyFound();
  const add = (section: string, dev: boolean) => {
    for (const [name, v] of Object.entries(t[section] ?? {})) {
      const spec = typeof v === "string" ? v : !Array.isArray(v) && typeof v === "object" ? (v.version ?? null) : null;
      const local = !Array.isArray(v) && typeof v === "object" && (v.path !== undefined || v.git !== undefined || v.workspace === "true");
      if (!local) f.packages.push({ ecosystem: "crates", name, spec, dev });
    }
  };
  add("dependencies", false);
  add("workspace.dependencies", false);
  add("dev-dependencies", true);
  add("build-dependencies", true);
  // [dependencies.serde] tables.
  for (const section of Object.keys(t)) {
    const m = /^(dependencies|dev-dependencies|build-dependencies)\.(.+)$/.exec(section);
    if (m && t[section].path === undefined && t[section].git === undefined) {
      const v = t[section].version;
      f.packages.push({ ecosystem: "crates", name: m[2], spec: typeof v === "string" ? v : null, dev: m[1] !== "dependencies" });
    }
  }
  const members = t.workspace?.members;
  if (Array.isArray(members)) f.workspaces = members;
  return f;
}

function parseGemfile(text: string): Found {
  const f = emptyFound();
  let devDepth = 0;
  let depth = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (/^group\b.*\bdo$/.test(line)) {
      depth++;
      // Gems only in development/test groups are dev-only.
      if (!/:production|"production"|'production'/.test(line) && /(development|test)/.test(line)) devDepth = depth;
      continue;
    }
    if (/^(if|unless|platforms?|source|git|path)\b.*\bdo$/.test(line)) {
      depth++;
      continue;
    }
    if (line === "end") {
      if (devDepth === depth) devDepth = 0;
      depth = Math.max(0, depth - 1);
      continue;
    }
    const ruby = /^ruby\s+["']([^"']+)["']/.exec(line);
    if (ruby) f.runtimes.push(runtime("ruby", ruby[1]));
    const gem = /^gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?(.*)$/.exec(line);
    if (gem) {
      const dev = devDepth > 0 || /group:\s*\[?\s*:(development|test)/.test(gem[3]);
      f.packages.push({ ecosystem: "gem", name: gem[1], spec: gem[2] ?? null, dev });
    }
  }
  return f;
}

// ---------- Containers, CI, Terraform, version files ----------

function parseDockerfile(text: string): Found {
  const f = emptyFound();
  const stages = new Set<string>();
  // Join line continuations, then read FROM lines.
  for (const line of text.replace(/\\\r?\n/g, " ").split("\n")) {
    const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (!m) continue;
    const image = m[1];
    if (m[2]) stages.add(m[2].toLowerCase());
    if (image === "scratch" || image.includes("$") || stages.has(image.toLowerCase())) continue;
    f.images.push(image);
  }
  return f;
}

function parseCompose(text: string): Found {
  const f = emptyFound();
  for (const line of text.split("\n")) {
    const m = /^\s*image:\s*["']?([^"'\s#]+)/.exec(line);
    if (m && !m[1].includes("$")) f.images.push(m[1]);
  }
  return f;
}

function parseWorkflow(text: string): Found {
  const f = emptyFound();
  for (const line of text.split("\n")) {
    const uses = /^\s*-?\s*uses:\s*["']?([^"'\s@#]+)/.exec(line);
    if (uses && !uses[1].startsWith("./") && !uses[1].startsWith("docker://")) f.actions.push(uses[1].split("/").slice(0, 2).join("/"));
    const docker = /^\s*-?\s*uses:\s*["']?docker:\/\/([^"'\s#]+)/.exec(line);
    if (docker) f.images.push(docker[1]);
    const image = /^\s*image:\s*["']?([^"'\s#{]+)/.exec(line);
    if (image && !image[1].includes("$")) f.images.push(image[1]);
  }
  return f;
}

function parseTerraform(text: string): Found {
  const f = emptyFound();
  for (const m of text.matchAll(/source\s*=\s*"([\w.-]+\/[\w.-]+(?:\/[\w.-]+)?)"/g)) {
    // registry.terraform.io/hashicorp/aws → hashicorp/aws; module sources with more parts or "./" are skipped.
    if (m[1].startsWith(".")) continue;
    const parts = m[1].split("/");
    const src = parts.length === 3 && parts[0].includes(".") ? parts.slice(1).join("/") : parts.length === 2 ? m[1] : null;
    if (src) f.providers.push(src.toLowerCase());
  }
  // provider "aws" { … } without required_providers means hashicorp/aws.
  for (const m of text.matchAll(/^\s*provider\s+"([\w-]+)"/gm)) {
    const name = m[1].toLowerCase();
    if (!f.providers.some((p) => p.endsWith(`/${name}`))) f.providers.push(`hashicorp/${name}`);
  }
  return f;
}

function parsePnpmWorkspace(text: string): Found {
  const f = emptyFound();
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s+-\s*["']?([^"'#]+?)["']?\s*$/.exec(line);
      if (m) f.workspaces.push(m[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  return f;
}

function versionFile(product: string, text: string): Found {
  const f = emptyFound();
  const v = text.split("\n")[0].trim();
  if (v) f.runtimes.push({ product, version: v, exact: !/^lts\//i.test(v) });
  return f;
}

/** A version written as a range (>=, ^, ~) says what is supported, not which cycle runs. */
function runtime(product: string, spec: string): FoundRuntime {
  const s = spec.trim();
  return { product, version: s || null, exact: /^v?\d+(\.\d+)*$/.test(s) || /^==\s*\d/.test(s) };
}

// ---------- TOML (the subset manifests use) ----------

export type TomlValue = string | string[] | Record<string, string>;

/** Tables of key → value. Values: strings, arrays of strings, single-line inline tables. */
export function parseToml(text: string): Record<string, Record<string, TomlValue>> {
  const out: Record<string, Record<string, TomlValue>> = { "": {} };
  let table = "";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = stripTomlComment(lines[i]).trim();
    if (!line) continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      table = header[1].split(".").map((p) => p.trim().replace(/^["']|["']$/g, "")).join(".");
      out[table] ??= {};
      continue;
    }
    const kv = /^("[^"]+"|'[^']+'|[\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2];
    // Multi-line arrays: keep reading until the brackets balance (outside strings).
    while (value.startsWith("[") && bracketDepth(value) > 0 && i + 1 < lines.length) value += "\n" + stripTomlComment(lines[++i]);
    const key = kv[1].replace(/^["']|["']$/g, "");
    // Dotted keys (`project.dependencies = …` at top level) belong to the dotted table.
    const dot = !kv[1].startsWith('"') && !kv[1].startsWith("'") ? key.lastIndexOf(".") : -1;
    const t = dot > 0 ? (table ? `${table}.` : "") + key.slice(0, dot) : table;
    out[t] ??= {};
    out[t][dot > 0 ? key.slice(dot + 1) : key] = tomlValue(value.trim());
  }
  return out;
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function bracketDepth(s: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
  }
  return depth;
}

const TOML_STRING = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;

function tomlValue(v: string): TomlValue {
  if (v.startsWith("[")) return [...v.matchAll(TOML_STRING)].map((m) => m[1] ?? m[2]);
  if (v.startsWith("{")) {
    const o: Record<string, string> = {};
    for (const m of v.matchAll(/([\w.-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,}\s]+)/g)) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
    return o;
  }
  const s = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(v);
  return s ? (s[1] ?? s[2]) : v;
}
