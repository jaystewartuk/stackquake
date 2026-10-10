// Admin session until M3 adds real auth: the owner enters ADMIN_TOKEN once and gets a signed,
// expiring cookie (HttpOnly, Secure, SameSite=Strict). POST forms also carry a CSRF token
// derived from the session (SPEC §8).
import { utf8 } from "../util";

export const SESSION_COOKIE = "sq_admin";
export const SESSION_MS = 7 * 24 * 3_600_000;

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(message)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Compares without an early exit, so timing does not reveal a prefix match. */
export function safeEqual(a: string, b: string): boolean {
  const x = utf8(a);
  const y = utf8(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function makeSession(secret: string, now: number): Promise<string> {
  const exp = now + SESSION_MS;
  return `${exp}.${await hmac(secret, `session:${exp}`)}`;
}

/** The session's expiry if the cookie is valid and current, else null. */
export async function checkSession(secret: string, cookie: string | undefined, now: number): Promise<number | null> {
  const m = /^(\d+)\.([\w-]+)$/.exec(cookie ?? "");
  if (!m) return null;
  const exp = Number(m[1]);
  if (exp <= now) return null;
  return safeEqual(m[2], await hmac(secret, `session:${exp}`)) ? exp : null;
}

export function csrfToken(secret: string, sessionExp: number): Promise<string> {
  return hmac(secret, `csrf:${sessionExp}`);
}
