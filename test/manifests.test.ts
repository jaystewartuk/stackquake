import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../src/catalog/catalog";
import { eolCycle, fileMatcher, imageRuntime, mapStack, parseImage } from "../src/stack/mapping";
import { parseJsonc, parseManifest, parserFor, parseToml, pep508 } from "../src/stack/manifests";

const pkgs = (path: string, text: string) => parseManifest(path, text).packages.map((p) => `${p.ecosystem}:${p.name}${p.spec ? `@${p.spec}` : ""}${p.dev ? " (dev)" : ""}`);

describe("manifest parsers (one fixture per SPEC §7.1 type)", () => {
  it("package.json: deps, dev deps, engines, workspaces; skips workspace and file refs", () => {
    const f = parseManifest(
      "package.json",
      JSON.stringify({
        name: "@acme/web",
        dependencies: { next: "15.0.0", "@supabase/supabase-js": "^2.45.0", "@acme/ui": "workspace:*", local: "file:../local", zod: "catalog:" },
        optionalDependencies: { fsevents: "^2" },
        devDependencies: { wrangler: "^3.80.0" },
        engines: { node: ">=20" },
        workspaces: ["apps/*", "packages/*"],
      }),
    );
    expect(f.packages.map((p) => [p.name, p.dev])).toEqual([["next", false], ["@supabase/supabase-js", false], ["zod", false], ["fsevents", false], ["wrangler", true]]);
    expect(f.packages.find((p) => p.name === "zod")!.spec).toBeNull();
    expect(f.runtimes).toEqual([{ product: "nodejs", version: ">=20", exact: false }]);
    expect(f.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(f.ownName).toBe("@acme/web");
    // Yarn's object form.
    expect(parseManifest("package.json", '{"workspaces":{"packages":["libs/*"]}}').workspaces).toEqual(["libs/*"]);
  });

  it("deno.json / deno.jsonc: npm: imports, with comments and trailing commas", () => {
    const text = `{
      // Deno config
      "imports": {
        "hono": "npm:hono@^4.6.0",
        "@std/assert": "jsr:@std/assert@1", /* not npm */
        "zod": "npm:zod",
        "@scope/pkg": "npm:@scope/pkg@1.2.3/sub",
      },
      "workspace": ["./api"],
    }`;
    expect(pkgs("deno.jsonc", text)).toEqual(["npm:hono@^4.6.0", "npm:zod", "npm:@scope/pkg@1.2.3"]);
    expect(parseManifest("deno.json", text).workspaces).toEqual(["./api"]);
    expect(parseJsonc('{"url": "https://x//y", "a": [1,],}')).toEqual({ url: "https://x//y", a: [1] });
  });

  it("requirements*.txt: names, extras, markers; skips options, URLs and local paths", () => {
    const text = ["# web", "Django>=5.0,<6", "uvicorn[standard]==0.30.1 ; python_version >= '3.9'", "-r base.txt", "-e .", "git+https://github.com/x/y.git", "./wheels/thing.whl", "Flask_Login  # comment", ""].join("\n");
    expect(pkgs("requirements-prod.txt", text)).toEqual(["pypi:django@>=5.0,<6", "pypi:uvicorn@==0.30.1", "pypi:flask-login"]);
    expect(parserFor("requirements/dev.txt")).toBeNull();
    expect(parserFor("requirements.txt")).not.toBeNull();
  });

  it("pyproject.toml: PEP 621 dependencies (multi-line), groups, requires-python, and Poetry", () => {
    const pep621 = `[project]
name = "svc"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",   # web
  "anthropic",
  "pydantic[email]>=2",
]
[project.optional-dependencies]
dev = ["pytest"]
[dependency-groups]
lint = ["ruff"]`;
    expect(pkgs("pyproject.toml", pep621)).toEqual(["pypi:fastapi@>=0.110", "pypi:anthropic", "pypi:pydantic@>=2", "pypi:ruff (dev)", "pypi:pytest (dev)"]);
    expect(parseManifest("pyproject.toml", pep621).runtimes).toEqual([{ product: "python", version: ">=3.11", exact: false }]);
    const poetry = `[tool.poetry.dependencies]
python = "^3.12"
Django = "^5.0"
celery = { version = "^5.3", extras = ["redis"] }

[tool.poetry.group.dev.dependencies]
black = "*"`;
    expect(pkgs("pyproject.toml", poetry)).toEqual(["pypi:django@^5.0", "pypi:celery@^5.3", "pypi:black@* (dev)"]);
    expect(parseManifest("pyproject.toml", poetry).runtimes[0].product).toBe("python");
  });

  it("Pipfile: packages, dev-packages and python_version", () => {
    const text = `[[source]]
url = "https://pypi.org/simple"

[packages]
requests = "*"
sqlalchemy = {version = ">=2.0"}

[dev-packages]
pytest = "*"

[requires]
python_version = "3.12"`;
    expect(pkgs("Pipfile", text)).toEqual(["pypi:requests", "pypi:sqlalchemy@>=2.0", "pypi:pytest (dev)"]);
    expect(parseManifest("Pipfile", text).runtimes).toEqual([{ product: "python", version: "3.12", exact: true }]);
  });

  it("go.mod: go directive and direct requirements only", () => {
    const text = `module example.com/app

go 1.22.3

require github.com/gin-gonic/gin v1.10.0

require (
	github.com/redis/go-redis/v9 v9.5.1
	golang.org/x/net v0.25.0 // indirect
)`;
    expect(pkgs("go.mod", text)).toEqual(["go:github.com/gin-gonic/gin@v1.10.0", "go:github.com/redis/go-redis/v9@v9.5.1"]);
    expect(parseManifest("go.mod", text).runtimes).toEqual([{ product: "go", version: "1.22.3", exact: true }]);
  });

  it("Cargo.toml: dependency tables, inline tables, dotted tables; skips path and workspace deps", () => {
    const text = `[package]
name = "svc"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1"
shared = { path = "../shared" }
common = { workspace = true }

[dependencies.reqwest]
version = "0.12"

[dev-dependencies]
insta = "1"

[workspace]
members = ["crates/*"]`;
    expect(pkgs("Cargo.toml", text)).toEqual(["crates:serde@1.0", "crates:tokio@1", "crates:insta@1 (dev)", "crates:reqwest@0.12"]);
    expect(parseManifest("Cargo.toml", text).workspaces).toEqual(["crates/*"]);
  });

  it("Gemfile: gems, dev/test groups and the ruby version", () => {
    const text = `source "https://rubygems.org"
ruby "3.3.0"
gem "rails", "~> 7.1"
gem "pg"
group :development, :test do
  gem "rspec-rails"
end
gem "rubocop", group: :development`;
    expect(pkgs("Gemfile", text)).toEqual(["gem:rails@~> 7.1", "gem:pg", "gem:rspec-rails (dev)", "gem:rubocop (dev)"]);
    expect(parseManifest("Gemfile", text).runtimes).toEqual([{ product: "ruby", version: "3.3.0", exact: true }]);
  });

  it("composer.json: require, require-dev and the php runtime; skips extensions", () => {
    const text = JSON.stringify({ require: { php: "^8.2", "ext-json": "*", "laravel/framework": "^11.0" }, "require-dev": { "phpunit/phpunit": "^11" } });
    expect(pkgs("composer.json", text)).toEqual(["composer:laravel/framework@^11.0", "composer:phpunit/phpunit@^11 (dev)"]);
    expect(parseManifest("composer.json", text).runtimes).toEqual([{ product: "php", version: "^8.2", exact: false }]);
  });

  it("Dockerfile: base images, skipping build stages, scratch and ARG-built names", () => {
    const text = `ARG NODE=20
FROM --platform=linux/amd64 node:20.11-alpine AS build
RUN npm ci
FROM build AS test
FROM \${BASE_IMAGE}
FROM gcr.io/distroless/nodejs20-debian12
FROM scratch`;
    expect(parseManifest("Dockerfile", text).images).toEqual(["node:20.11-alpine", "gcr.io/distroless/nodejs20-debian12"]);
    expect(parserFor("docker/api.Dockerfile")).not.toBeNull();
    expect(parserFor("Dockerfile.prod")).not.toBeNull();
  });

  it("docker-compose*.yml / compose.yaml: service images", () => {
    const text = `services:
  db:
    image: postgres:16-alpine
  cache:
    image: "redis:7.2"
  app:
    build: .
    image: \${APP_IMAGE}`;
    expect(parseManifest("docker-compose.prod.yml", text).images).toEqual(["postgres:16-alpine", "redis:7.2"]);
    expect(parserFor("compose.yaml")).not.toBeNull();
  });

  it(".nvmrc, .node-version and .python-version", () => {
    expect(parseManifest(".nvmrc", "v20.11.1\n").runtimes).toEqual([{ product: "nodejs", version: "v20.11.1", exact: true }]);
    expect(parseManifest(".node-version", "lts/iron").runtimes).toEqual([{ product: "nodejs", version: "lts/iron", exact: false }]);
    expect(parseManifest("api/.python-version", "3.12.4").runtimes).toEqual([{ product: "python", version: "3.12.4", exact: true }]);
  });

  it(".github/workflows/*.yml: actions used and container images", () => {
    const text = `jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:22
    steps:
      - uses: actions/checkout@v4
      - uses: "actions/setup-node@v4"
      - uses: ./.github/actions/local
      - uses: docker://alpine:3.20
      - uses: cloudflare/wrangler-action/sub@v3`;
    const f = parseManifest(".github/workflows/ci.yml", text);
    expect(f.actions).toEqual(["actions/checkout", "actions/setup-node", "cloudflare/wrangler-action"]);
    expect(f.images).toEqual(["node:22", "alpine:3.20"]);
    expect(parserFor("apps/web/.github/workflows/ci.yml")).toBeNull();
  });

  it("*.tf: required_providers sources and bare provider blocks", () => {
    const text = `terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4" }
    neon = {
      source = "registry.terraform.io/kislerdm/neon"
    }
  }
}
provider "aws" { region = "eu-west-1" }
provider "cloudflare" {}
module "x" { source = "./modules/x" }`;
    expect(parseManifest("infra/main.tf", text).providers).toEqual(["cloudflare/cloudflare", "kislerdm/neon", "hashicorp/aws"]);
  });

  it("pnpm-workspace.yaml: package globs", () => {
    expect(parseManifest("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - packages/*\ncatalog:\n  react: ^19\n").workspaces).toEqual(["apps/*", "packages/*"]);
  });

  it("files that only matter by presence have no parser, and broken files parse to nothing", () => {
    for (const p of ["wrangler.toml", "wrangler.jsonc", "vercel.json", "vercel.ts", "fly.toml", "netlify.toml", "render.yaml", "supabase/config.toml", "bun.lockb", "bunfig.toml"]) expect(parserFor(p)).toBeNull();
    expect(parseManifest("package.json", "{ not json").packages).toEqual([]);
  });

  it("pep508 and the TOML subset", () => {
    expect(pep508("Some_Pkg.Name[extra] >= 1.0 ; sys_platform == 'linux'")).toEqual({ name: "some-pkg-name", spec: ">= 1.0" });
    expect(parseToml(`a = "x # not a comment" # comment\n[t."quoted.key"]\nb = ['y', "z"]`)).toEqual({ "": { a: "x # not a comment" }, "t.quoted.key": { b: ["y", "z"] } });
  });
});

describe("runtimes and images", () => {
  it("normalises image references", () => {
    expect(parseImage("docker.io/library/node:20-alpine@sha256:abc")).toEqual({ name: "node", tag: "20-alpine" });
    expect(parseImage("localhost:5000/team/app")).toEqual({ name: "localhost:5000/team/app", tag: null });
    expect(parseImage("valkey/valkey:8")).toEqual({ name: "valkey/valkey", tag: "8" });
  });

  it("derives endoflife.date cycles", () => {
    expect(eolCycle("nodejs", "v20.11.1")).toBe("20");
    expect(eolCycle("python", "3.12-slim-bookworm")).toBe("3.12");
    expect(eolCycle("python", "3")).toBeNull();
    expect(eolCycle("postgresql", "16.2-alpine")).toBe("16");
    expect(eolCycle("go", "1.22.3")).toBe("1.22");
    expect(eolCycle("debian", "bookworm-slim")).toBe("12");
    expect(eolCycle("ubuntu", "24.04")).toBe("24.04");
    expect(eolCycle("nodejs", "lts")).toBeNull();
    expect(eolCycle("unknown-product", "1.2")).toBeNull();
    expect(imageRuntime("golang:1.22-alpine")).toEqual({ product: "go", version: "1.22-alpine", exact: true });
    expect(imageRuntime("ghcr.io/acme/app:1")).toBeNull();
  });

  it("matches detect.files patterns", () => {
    expect(fileMatcher("wrangler.toml").test("apps/api/wrangler.toml")).toBe(true);
    expect(fileMatcher("wrangler.toml").test("apps/api/wrangler.toml.bak")).toBe(false);
    expect(fileMatcher("supabase/config.toml").test("supabase/config.toml")).toBe(true);
    expect(fileMatcher("supabase/config.toml").test("config.toml")).toBe(false);
    expect(fileMatcher("*.tf").test("infra/main.tf")).toBe(true);
    expect(fileMatcher("*.tf").test("infra/main.tfvars")).toBe(false);
    expect(fileMatcher(".github/workflows/").test(".github/workflows/ci.yml")).toBe(true);
    expect(fileMatcher(".github/workflows/").test("docs/.github/workflows")).toBe(false);
  });
});

const CAT: CatalogEntry[] = [
  { id: "cloudflare-workers", name: "Cloudflare Workers", category: "hosting", detect: { files: ["wrangler.toml"], npm: ["wrangler"] }, sources: [{ kind: "npm", package: "wrangler" }] },
  { id: "supabase", name: "Supabase", category: "database", detect: { files: ["supabase/config.toml"], npm: ["@supabase/supabase-js"], pypi: ["supabase"] }, sources: [{ kind: "npm", package: "@supabase/supabase-js" }] },
  { id: "nodejs", name: "Node.js", category: "runtime", detect: { files: [".nvmrc"] }, sources: [{ kind: "eol", product: "nodejs" }] },
  { id: "redis", name: "Redis", category: "database", detect: { npm: ["redis"], docker: ["redis"] }, sources: [{ kind: "eol", product: "redis" }] },
  { id: "terraform", name: "Terraform", category: "infrastructure", detect: { files: ["*.tf"] }, sources: [{ kind: "eol", product: "terraform" }] },
  { id: "cloudflare-r2", name: "R2", category: "storage", detect: { terraform: ["cloudflare/cloudflare"] }, sources: [{ kind: "npm", package: "x" }] },
];

describe("mapStack", () => {
  it("maps a monorepo with two package.json files onto catalog deps, runtimes and packages", () => {
    const paths = ["package.json", ".nvmrc", "apps/web/package.json", "apps/api/package.json", "apps/api/wrangler.toml", "supabase/config.toml", "docker-compose.yml", "infra/main.tf", "worker/Dockerfile"];
    const found = Object.fromEntries(
      Object.entries({
        "package.json": JSON.stringify({ name: "acme", devDependencies: { turbo: "^2" } }),
        ".nvmrc": "22.3.0",
        "apps/web/package.json": JSON.stringify({ name: "@acme/web", dependencies: { next: "15", "@supabase/supabase-js": "^2", "@acme/api": "1.0.0" } }),
        "apps/api/package.json": JSON.stringify({ name: "@acme/api", dependencies: { hono: "^4", next: "15", redis: "^4" }, devDependencies: { wrangler: "^3" }, engines: { node: ">=18" } }),
        "docker-compose.yml": "services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7.2-alpine\n",
        "infra/main.tf": 'terraform { required_providers { cloudflare = { source = "cloudflare/cloudflare" } } }',
        "worker/Dockerfile": "FROM node:20-slim\n",
      }).map(([p, t]) => [p, parseManifest(p, t)]),
    );
    const m = mapStack(paths, found, CAT);
    const byId = Object.fromEntries(m.catalog.map((d) => [d.catalogId, d]));
    expect(Object.keys(byId).sort()).toEqual(["cloudflare-r2", "cloudflare-workers", "nodejs", "redis", "supabase", "terraform"]);
    expect(byId["cloudflare-workers"].foundIn).toEqual(["apps/api/wrangler.toml", "apps/api/package.json"]);
    expect(byId.supabase.foundIn).toEqual(["supabase/config.toml", "apps/web/package.json"]);
    // The oldest exact Node.js cycle wins (engines ">=18" is a range, not a cycle).
    expect(byId.nodejs).toMatchObject({ eolProduct: "nodejs", eolCycle: "20" });
    expect(byId.redis).toMatchObject({ eolProduct: "redis", eolCycle: "7.2" });
    // PostgreSQL is not in this catalog, so it is a runtime dep of its own.
    expect(m.runtimes).toEqual([expect.objectContaining({ depKey: "eol:postgresql", eolProduct: "postgresql", eolCycle: "16", foundIn: ["docker-compose.yml"] })]);
    // Packages: direct, non-dev, not workspace-internal, not covered by the catalog; deduped across apps.
    expect(m.packages.map((p) => p.depKey)).toEqual(["npm:next", "npm:hono"]);
    expect(m.packages[0].foundIn).toEqual(["apps/web/package.json", "apps/api/package.json"]);
  });
});
