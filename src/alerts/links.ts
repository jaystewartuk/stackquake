// Signed one-click links (SPEC §7.5, §8): "Useful", "Not relevant", "Mute this dependency for 90
// days" (per alert) and "digest only" (per user). HMAC-SHA256 with LINK_SECRET, 30-day expiry.
// The link opens a page with a confirm button that POSTs, because mail scanners prefetch links.
import { DAY, safeEqual, utf8 } from "../util";

export const LINK_TTL_MS = 30 * DAY;

export type LinkAction = "useful" | "not_relevant" | "mute" | "digest_only";

const CODES: Record<LinkAction, string> = { useful: "u", not_relevant: "n", mute: "m", digest_only: "d" };
const ACTIONS = Object.fromEntries(Object.entries(CODES).map(([a, c]) => [c, a as LinkAction]));

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function mac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, utf8(data)));
}

/** `id` is the alert id, or the user id for "digest_only". */
export async function signLink(secret: string, action: LinkAction, id: number, now: number): Promise<string> {
  const body = `${CODES[action]}${id}.${Math.floor((now + LINK_TTL_MS) / 1000).toString(36)}`;
  return `${body}.${await mac(secret, body)}`;
}

export type LinkCheck = { ok: true; action: LinkAction; id: number } | { ok: false; reason: "invalid" | "expired" };

export async function verifyLink(secret: string, token: string, now: number): Promise<LinkCheck> {
  const m = /^([unmd])(\d{1,15})\.([0-9a-z]{1,10})\.([\w-]{43})$/.exec(token);
  if (!m) return { ok: false, reason: "invalid" };
  const body = `${m[1]}${m[2]}.${m[3]}`;
  if (!safeEqual(m[4], await mac(secret, body))) return { ok: false, reason: "invalid" };
  if (parseInt(m[3], 36) * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, action: ACTIONS[m[1]], id: Number(m[2]) };
}

export const linkUrl = (origin: string, token: string) => `${origin}/a/${token}`;
