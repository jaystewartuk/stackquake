// AES-GCM for secrets at rest (SPEC §6): Slack webhook URLs. The key is CHANNEL_KEY, 32 random
// bytes in base64 (`openssl rand -base64 32`). Stored as "v1:" + base64(iv || ciphertext).
import { fromUtf8, utf8 } from "../util";

const VERSION = "v1:";

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64.trim()), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("CHANNEL_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(keyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(keyB64), utf8(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return VERSION + btoa(String.fromCharCode(...out));
}

export async function decrypt(keyB64: string, sealed: string): Promise<string> {
  if (!sealed.startsWith(VERSION)) throw new Error("unknown secret format");
  const bytes = Uint8Array.from(atob(sealed.slice(VERSION.length)), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await importKey(keyB64), bytes.slice(12));
  return fromUtf8(new Uint8Array(plain));
}
