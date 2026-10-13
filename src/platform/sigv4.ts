// AWS Signature Version 4 with Web Crypto (no SDK: bundle size and CPU on Workers). One pure
// function so the AWS test-suite vectors can pin it down (test/sigv4.test.ts).

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface SigV4Request {
  method: string;
  url: string;
  /** Every header here is signed, plus host and x-amz-date. */
  headers: Record<string, string>;
  body: string;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function hmac(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** RFC 3986 unreserved characters stay, everything else is percent-encoded (uppercase hex). */
const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Returns the headers to add to the request: `x-amz-date` and `authorization`. The path is encoded
 * a second time, as every AWS service except S3 expects.
 */
export async function signRequest(req: SigV4Request, creds: SigV4Credentials, now: Date): Promise<{ "x-amz-date": string; authorization: string }> {
  const url = new URL(req.url);
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: url.host, "x-amz-date": amzDate };
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const names = Object.keys(headers).sort();
  const canonicalPath = url.pathname.split("/").map(uriEncode).join("/") || "/";
  const canonicalQuery = [...url.searchParams].map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [req.method, canonicalPath, canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), await sha256Hex(req.body)].join("\n");
  const scope = `${day}/${creds.region}/${creds.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonical)].join("\n");
  let key = await hmac(`AWS4${creds.secretAccessKey}`, day);
  for (const part of [creds.region, creds.service, "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return { "x-amz-date": amzDate, authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}
