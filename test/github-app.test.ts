import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GITHUB_API } from "../src/context";
import { githubInstallations, imports, jobs, projects, users } from "../src/db/schema";
import { appJwt, GithubAppError, installationToken, pkcs1ToPkcs8, verifyWebhookSignature, type GithubAppConfig } from "../src/github/app";
import { handlePush, isManifestPath } from "../src/github/webhook";
import { startImport } from "../src/stack/import";
import { signChoice, verifyChoice } from "../src/web/github";
import { utf8 } from "../src/util";
import { MONOREPO, serveRepo } from "./fixtures/repos";
import { resetDb, type FixtureHttp } from "./helpers";
import { Browser, location, webCtx } from "./web";

beforeEach(resetDb);

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const pem = (label: string, der: Uint8Array) => `-----BEGIN ${label}-----\n${b64(der).replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;

/** The RSAPrivateKey inside a PKCS#8 PrivateKeyInfo (what GitHub hands out as PKCS#1 PEM). */
function pkcs8ToPkcs1(der: Uint8Array): Uint8Array {
  let i = 1;
  i += der[i] & 0x80 ? 1 + (der[i] & 0x7f) : 1; // outer SEQUENCE length
  i += 3 + 15; // version, AlgorithmIdentifier
  expect(der[i]).toBe(0x04);
  i++;
  let len = der[i];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 1; k <= n; k++) len = (len << 8) | der[i + k];
    i += n;
  }
  return der.slice(i + 1, i + 1 + len);
}

let keys: { pkcs1Pem: string; pkcs8: Uint8Array; publicKey: CryptoKey } | undefined;
async function appKeys() {
  if (!keys) {
    const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    keys = { pkcs8, pkcs1Pem: pem("RSA PRIVATE KEY", pkcs8ToPkcs1(pkcs8)), publicKey: pair.publicKey };
  }
  return keys;
}

async function appConfig(): Promise<GithubAppConfig> {
  return { slug: "stackquake-test", clientId: "Iv23testclient", clientSecret: "app-client-secret-0123456789", privateKey: (await appKeys()).pkcs1Pem, webhookSecret: "webhook-secret-0123456789" };
}

const tokenUrl = (id: number) => `${GITHUB_API}/app/installations/${id}/access_tokens`;

function serveToken(http: FixtureHttp, id: number, token: string, expiresAt: number) {
  http.set(tokenUrl(id), (req) => (req.method === "POST" ? Response.json({ token, expires_at: new Date(expiresAt).toISOString() }, { status: 201 }) : new Response("", { status: 405 })));
}

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("app JWT", () => {
  it("wraps GitHub's PKCS#1 key and signs a JWT that verifies with the public key", async () => {
    const k = await appKeys();
    const der = Uint8Array.from(atob(k.pkcs1Pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
    expect(pkcs1ToPkcs8(der)).toEqual(k.pkcs8);
    const now = Date.UTC(2026, 9, 11, 12);
    const jwt = await appJwt(await appConfig(), now);
    const [h, p, s] = jwt.split(".");
    const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", k.publicKey, dec(s), utf8(`${h}.${p}`))).toBe(true);
    const claims = JSON.parse(new TextDecoder().decode(dec(p)));
    expect(claims.iss).toBe("Iv23testclient");
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(600);
  });
});

describe("installation tokens", () => {
  it("mints with the app JWT, stores the token encrypted and reuses it until near expiry", async () => {
    const { ctx, http, clock } = await webCtx();
    ctx.config.githubApp = await appConfig();
    serveToken(http, 42, "ghs_first", clock.now() + 60 * 60_000);
    expect(await installationToken(ctx, 42)).toBe("ghs_first");
    const req = http.requests.find((r) => r.url === tokenUrl(42))!;
    expect(req.headers.get("authorization")).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(await req.clone().json()).toEqual({ permissions: { contents: "read", metadata: "read" } });
    const row = (await ctx.db.select().from(githubInstallations).where(eq(githubInstallations.id, 42)).get())!;
    expect(row.tokenEnc).toMatch(/^v1:/);
    expect(row.tokenEnc).not.toContain("ghs_first");

    expect(await installationToken(ctx, 42)).toBe("ghs_first");
    expect(http.count(tokenUrl(42))).toBe(1);
    // 55 minutes later the cached token has under 10 minutes left: a new one is minted.
    clock.advance(55 * 60_000);
    serveToken(http, 42, "ghs_second", clock.now() + 60 * 60_000);
    expect(await installationToken(ctx, 42)).toBe("ghs_second");
    expect(http.count(tokenUrl(42))).toBe(2);
  });

  it("explains an uninstalled app, and a suspended one, without minting", async () => {
    const { ctx, http } = await webCtx();
    ctx.config.githubApp = await appConfig();
    http.set(tokenUrl(7), new Response("{}", { status: 404 }));
    await expect(installationToken(ctx, 7)).rejects.toThrow(GithubAppError);
    await ctx.db.insert(githubInstallations).values({ id: 8, account: "acme", suspendedAt: 1, createdAt: 1, updatedAt: 1 });
    await expect(installationToken(ctx, 8)).rejects.toThrow(/suspended/);
    expect(http.count(tokenUrl(8))).toBe(0);
    ctx.config.githubApp = undefined;
    await expect(installationToken(ctx, 7)).rejects.toThrow(/not configured/);
  });
});

describe("webhook", () => {
  const push = (over: object = {}) => ({
    ref: "refs/heads/main",
    repository: { full_name: "Acme/Private", default_branch: "main" },
    installation: { id: 42 },
    commits: [{ added: [], modified: ["apps/web/package.json"], removed: [] }],
    ...over,
  });

  it("knows manifests and detect files", () => {
    for (const p of ["package.json", "apps/api/pyproject.toml", "wrangler.jsonc", ".github/workflows/ci.yml", "infra/main.tf", "fly.toml"]) expect(isManifestPath(p)).toBe(true);
    for (const p of ["README.md", "src/index.ts", "docs/guide.md"]) expect(isManifestPath(p)).toBe(false);
  });

  it("refuses bad signatures and accepts GitHub's", async () => {
    const { ctx } = await webCtx();
    ctx.config.githubApp = await appConfig();
    const b = new Browser(ctx);
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const send = (sig: string | null) => b.fetch("/github/webhook", { method: "POST", body, headers: { "content-type": "application/json", "x-github-event": "ping", ...(sig ? { "x-hub-signature-256": sig } : {}) } });
    expect((await send(null)).status).toBe(401);
    expect((await send(await sign("wrong-secret", body))).status).toBe(401);
    const ok = await send(await sign("webhook-secret-0123456789", body));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, result: "pong" });
    expect(await verifyWebhookSignature("s", utf8(body), "sha1=abc")).toBe(false);
  });

  it("re-imports connected projects on a default-branch push that touches a manifest", async () => {
    const { ctx } = await webCtx();
    await ctx.db.insert(users).values({ id: 1, email: "team@example.com", plan: "team", createdAt: 0 }); // private repos are a Team feature
    const [p] = await ctx.db.insert(projects).values({ userId: 1, name: "x", repoFullName: "acme/private", githubInstallationId: 42, createdAt: 0 }).returning();
    // Same repo, imported publicly (no installation): not this webhook's business.
    await ctx.db.insert(projects).values({ userId: 2, name: "y", repoFullName: "acme/private", createdAt: 0 });

    expect(await handlePush(ctx, push({ ref: "refs/heads/feature" }))).toBe("ignored");
    expect(await handlePush(ctx, push({ deleted: true }))).toBe("ignored");
    expect(await handlePush(ctx, push({ commits: [{ modified: ["README.md"] }] }))).toBe("no_manifest");
    expect(await handlePush(ctx, push({ installation: { id: 99 } }))).toBe("no_project");
    expect(await handlePush(ctx, push())).toEqual({ reimported: [p.id] });
    const imp = (await ctx.db.select().from(imports).where(eq(imports.projectId, p.id)).get())!;
    expect(imp.state).toMatchObject({ installationId: 42 });
    expect(await ctx.db.select().from(jobs).where(eq(jobs.kind, "import")).all()).toHaveLength(1);
    // A second push while that import runs starts nothing new.
    expect(await handlePush(ctx, push())).toEqual({ reimported: [] });
  });

  it("forgets an uninstalled installation's token and marks a suspended one", async () => {
    const { ctx } = await webCtx();
    ctx.config.githubApp = await appConfig();
    const b = new Browser(ctx);
    await ctx.db.insert(githubInstallations).values([
      { id: 5, account: "acme", tokenEnc: "v1:x", tokenExpiresAt: 1, createdAt: 1, updatedAt: 1 },
      { id: 6, account: "beta", tokenEnc: "v1:y", tokenExpiresAt: 1, createdAt: 1, updatedAt: 1 },
    ]);
    const send = async (payload: object) => {
      const body = JSON.stringify(payload);
      return b.fetch("/github/webhook", { method: "POST", body, headers: { "x-github-event": "installation", "x-hub-signature-256": await sign("webhook-secret-0123456789", body) } });
    };
    expect((await send({ action: "deleted", installation: { id: 5 } })).status).toBe(200);
    expect((await send({ action: "suspend", installation: { id: 6 } })).status).toBe(200);
    const rows = await ctx.db.select().from(githubInstallations).all();
    expect(rows.map((r) => [r.id, r.tokenEnc, !!r.suspendedAt])).toEqual([[6, null, true]]);
  });

  it("is off when the app is not configured", async () => {
    const { ctx } = await webCtx();
    const res = await new Browser(ctx).fetch("/github/webhook", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });
});

describe("private repo import through the GitHub App", () => {
  it("lists the user's repos, imports the picked one with the installation token, and refuses forged choices", async () => {
    const { ctx, http, clock } = await webCtx();
    ctx.config.githubApp = await appConfig();
    serveRepo(http, "acme/private", MONOREPO, { private: true });
    serveToken(http, 42, "ghs_install", clock.now() + 60 * 60_000);
    http.set("https://github.com/login/oauth/access_token", { access_token: "ghu_user" });
    http.set(`${GITHUB_API}/user/installations?per_page=100`, { installations: [{ id: 42, account: { login: "acme" } }] });
    http.set(`${GITHUB_API}/user/installations/42/repositories?per_page=100`, { repositories: [{ full_name: "acme/private", private: true }] });
    const b = new Browser(ctx);
    await b.signIn("dev@example.com");
    expect(await b.html("/app/projects/new")).toContain("Private repos through our GitHub App are on the");
    expect((await b.get("/app/github/connect")).status).toBe(402);
    await ctx.db.update(users).set({ plan: "team" }).where(eq(users.email, "dev@example.com"));

    expect(await b.html("/app/projects/new")).toContain('href="/app/github/connect"');
    const go = await b.get("/app/github/connect");
    const authorize = new URL(location(go)!);
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("Iv23testclient");
    const state = authorize.searchParams.get("state")!;

    // A callback with someone else's state is refused.
    expect((await b.get(`/app/github/callback?code=c&state=forged`)).status).toBe(400);
    const listed = await b.html(`/app/github/callback?code=c&state=${state}`);
    expect(listed).toContain("acme/private");
    const choice = /name="choice" value="([^"]+)"/.exec(listed)![1];

    // Forged: another installation id, or another user's signed value.
    const forged = choice.replace(/^42:/, "43:");
    expect((await b.post("/app/github/import", { name: "Secret", choice: forged })).status).toBe(400);
    const otherUser = await signChoice("app-client-secret-0123456789", 999, 42, "acme/private", clock.now());
    expect((await b.post("/app/github/import", { name: "Secret", choice: otherUser })).status).toBe(400);

    const res = await b.post("/app/github/import", { name: "Secret", choice });
    expect(res.status).toBe(302);
    const progress = location(res)!;
    for (let i = 0; i < 20; i++) {
      const r = await b.get(progress);
      if (r.status === 302) {
        expect(location(r)).toMatch(/\/services\?imported=1$/);
        break;
      }
    }
    const project = (await ctx.db.select().from(projects).where(eq(projects.name, "Secret")).get())!;
    expect(project).toMatchObject({ repoFullName: "acme/private", githubInstallationId: 42, lastImportAt: expect.any(Number) });
    // Every repo read carried the installation token; manifests came from the contents API.
    const repoReads = http.requests.filter((r) => r.url.startsWith(`${GITHUB_API}/repos/acme/private`));
    expect(repoReads.length).toBeGreaterThan(3);
    expect(repoReads.every((r) => r.headers.get("authorization") === "Bearer ghs_install")).toBe(true);
    expect(repoReads.some((r) => r.url.includes("/contents/package.json?ref=main"))).toBe(true);
    expect(http.count(tokenUrl(42))).toBe(1);
    // The user's OAuth token was used only to list repos.
    expect(http.requests.filter((r) => r.headers.get("authorization") === "Bearer ghu_user").every((r) => r.url.includes("/user/installations"))).toBe(true);
  });

  it("a private repo pasted as a public one says to use the GitHub App", async () => {
    const { ctx, http } = await webCtx();
    serveRepo(http, "acme/private", MONOREPO, { private: true });
    const [p] = await ctx.db.insert(projects).values({ userId: 1, name: "x", createdAt: 0 }).returning();
    const imp = await startImport(ctx, p.id, "acme/private");
    const { advanceImport } = await import("../src/stack/import");
    const row = (await advanceImport(ctx, imp.id, []))!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/GitHub App/);
  });

  it("signed choices expire after an hour", async () => {
    const v = await signChoice("s3cret", 1, 42, "a/b", 0);
    expect(await verifyChoice("s3cret", 1, v, 59 * 60_000)).toEqual({ installationId: 42, repo: "a/b" });
    expect(await verifyChoice("s3cret", 1, v, 61 * 60_000)).toBeNull();
    expect(await verifyChoice("other", 1, v, 0)).toBeNull();
  });
});
