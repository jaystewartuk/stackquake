// GitHub App for private repos (SPEC §4.1, §7.1, §8): contents read, metadata read, `push` webhook
// only. The app signs a short JWT with its private key (RS256) and trades it for an installation
// token (1 hour), which is cached in D1, encrypted with CHANNEL_KEY. Imports of a project that has
// an installation use that token instead of GITHUB_TOKEN.
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "../alerts/secretbox";
import type { Ctx } from "../context";
import { githubInstallations } from "../db/schema";
import { MINUTE, safeEqual, utf8 } from "../util";

export interface GithubAppConfig {
  /** App slug, for https://github.com/apps/{slug}/installations/new. */
  slug: string;
  /** The app's client ID: the JWT issuer and the OAuth client for listing a user's repos. */
  clientId: string;
  clientSecret: string;
  /** PEM, PKCS#1 ("BEGIN RSA PRIVATE KEY", as GitHub issues it) or PKCS#8. */
  privateKey: string;
  webhookSecret: string;
}

export class GithubAppError extends Error {}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pemBody(pem: string): { der: Uint8Array; pkcs1: boolean } {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  // Secrets pasted through a shell sometimes arrive with literal "\n".
  const body = pem.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return { der: Uint8Array.from(atob(body), (c) => c.charCodeAt(0)), pkcs1 };
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

const derSeq = (tag: number, body: Uint8Array) => new Uint8Array([tag, ...derLength(body.length), ...body]);

/** Wraps a PKCS#1 RSAPrivateKey in a PKCS#8 PrivateKeyInfo; WebCrypto only imports PKCS#8. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  // version 0, AlgorithmIdentifier { rsaEncryption, NULL }
  const head = [0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = derSeq(0x04, pkcs1);
  return derSeq(0x30, new Uint8Array([...head, ...octet]));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(pem: string): Promise<CryptoKey> {
  let key = keyCache.get(pem);
  if (!key) {
    const { der, pkcs1 } = pemBody(pem);
    key = crypto.subtle.importKey("pkcs8", pkcs1 ? pkcs1ToPkcs8(der) : der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(pem, key);
  }
  return key;
}

/** The app's JWT: back-dated 60 s for clock drift, expires 8 minutes from now (GitHub allows 10). */
export async function appJwt(app: Pick<GithubAppConfig, "clientId" | "privateKey">, now: number): Promise<string> {
  const iat = Math.floor(now / 1000) - 60;
  const enc = (o: object) => b64url(utf8(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat, exp: iat + 540, iss: app.clientId })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(app.privateKey), utf8(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

export const ghApiHeaders = (ctx: Ctx, token?: string): Record<string, string> => ({
  "user-agent": ctx.config.userAgent,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/** Refresh a cached token this long before it expires (an import step must not outlive it). */
const TOKEN_MARGIN_MS = 10 * MINUTE;

/**
 * An installation token, from the encrypted cache or freshly minted. Throws GithubAppError when the
 * app is not configured, the installation is gone or suspended.
 */
export async function installationToken(ctx: Ctx, installationId: number): Promise<string> {
  const app = ctx.config.githubApp;
  const key = ctx.config.channelKey;
  if (!app || !key) throw new GithubAppError("Private repos are not available here (the GitHub App is not configured).");
  const now = ctx.clock.now();
  const row = await ctx.db.select().from(githubInstallations).where(eq(githubInstallations.id, installationId)).get();
  if (row?.suspendedAt) throw new GithubAppError("The Stackquake GitHub App is suspended on this account. Unsuspend it in GitHub's settings.");
  if (row?.tokenEnc && (row.tokenExpiresAt ?? 0) - TOKEN_MARGIN_MS > now) {
    try {
      return await decrypt(key, row.tokenEnc);
    } catch {
      // CHANNEL_KEY rotated: mint a new token below.
    }
  }
  const res = await ctx.http(
    new Request(`${ctx.config.githubApi}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: ghApiHeaders(ctx, await appJwt(app, now)),
      // Only what an import needs, whatever else the app may be granted later.
      body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
      signal: AbortSignal.timeout(20_000),
    }),
  );
  if (res.status === 404 || res.status === 403) {
    await res.body?.cancel();
    if (row) await ctx.db.update(githubInstallations).set({ tokenEnc: null, tokenExpiresAt: null, updatedAt: now }).where(eq(githubInstallations.id, installationId));
    throw new GithubAppError("The Stackquake GitHub App is no longer installed for this repository. Install it again to import.");
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} minting an installation token`);
  const body = await res.json<{ token: string; expires_at: string }>();
  const expires = Date.parse(body.expires_at) || now + 60 * MINUTE;
  const tokenEnc = await encrypt(key, body.token);
  await ctx.db
    .insert(githubInstallations)
    .values({ id: installationId, account: row?.account ?? "", tokenEnc, tokenExpiresAt: expires, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: githubInstallations.id, set: { tokenEnc, tokenExpiresAt: expires, updatedAt: now } });
  return body.token;
}

/** Records an installation the signed-in user can access (account name for display). */
export async function rememberInstallation(ctx: Ctx, id: number, account: string): Promise<void> {
  const now = ctx.clock.now();
  await ctx.db
    .insert(githubInstallations)
    .values({ id, account, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: githubInstallations.id, set: { account, updatedAt: now } });
}

// ---------- Webhooks ----------

/** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>` (SPEC §8). */
export async function verifyWebhookSignature(secret: string, body: Uint8Array, header: string | undefined | null): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(hex, header.slice(7).toLowerCase());
}
