// Amazon SES (SPEC §4.1 Email) behind the Mailer port, over the v2 HTTPS API: one signed POST per
// message, no SDK. SES has no idempotency key; IdempotentMailer (idempotent.ts) wraps this.
import { MailError, type Http, type Mail, type Mailer } from "../ports";
import { signRequest } from "./sigv4";

export const SES_DEFAULT_REGION = "eu-west-1";
export const DEFAULT_FROM = "Stackquake <alerts@stackquake.com>";

export interface SesOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  from: string;
  http: Http;
  /** Replaces `https://email.<region>.amazonaws.com` (tests, scripts/measure-cpu.mjs). */
  base?: string;
  now?: () => Date;
}

/** Errors that need the owner (credentials, account state), not a different message: retried, and loud. */
const OWNER_FIXES = new Set([
  "AccountSuspended",
  "SendingPaused",
  "UnrecognizedClient",
  "InvalidClientTokenId",
  "InvalidSignature",
  "SignatureDoesNotMatch",
  "IncompleteSignature",
  "AccessDenied",
  "ExpiredToken",
  "MissingAuthenticationToken",
]);
const RETRYABLE = new Set(["TooManyRequests", "LimitExceeded", "Throttling", "ThrottlingException", "ServiceUnavailable", "InternalFailure", "InternalServerError"]);

/** `com.amazon…#MessageRejected:http://…` or `MessageRejectedException` → `MessageRejected`. */
function errorName(res: Response, detail: string): string {
  let raw = res.headers.get("x-amzn-errortype") ?? "";
  if (!raw) {
    try {
      const j = JSON.parse(detail) as { __type?: string; code?: string; Code?: string };
      raw = j.__type ?? j.code ?? j.Code ?? "";
    } catch {
      // not JSON
    }
  }
  return (raw.split(":")[0].split("#").pop() ?? "").replace(/Exception$/, "");
}

export class SesMailer implements Mailer {
  constructor(private readonly opts: SesOptions) {}

  async send(mail: Mail): Promise<void> {
    const region = this.opts.region || SES_DEFAULT_REGION;
    const url = `${(this.opts.base || `https://email.${region}.amazonaws.com`).replace(/\/$/, "")}/v2/email/outbound-emails`;
    const content = (data: string) => ({ Data: data, Charset: "UTF-8" });
    const headers = Object.entries(mail.headers ?? {}).map(([Name, Value]) => ({ Name, Value }));
    const body = JSON.stringify({
      FromEmailAddress: this.opts.from,
      Destination: { ToAddresses: [mail.to] },
      Content: { Simple: { Subject: content(mail.subject), Body: { Text: content(mail.text), ...(mail.html ? { Html: content(mail.html) } : {}) }, ...(headers.length ? { Headers: headers } : {}) } },
    });
    const base = { "content-type": "application/json" };
    let res: Response;
    try {
      const signed = await signRequest({ method: "POST", url, headers: base, body }, { accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey, region, service: "ses" }, (this.opts.now ?? (() => new Date()))());
      res = await this.opts.http(new Request(url, { method: "POST", headers: { ...base, ...signed }, body }));
    } catch (e) {
      throw new MailError(`ses: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    if (res.ok) return;
    const detail = await res.text().catch(() => "");
    const name = errorName(res, detail);
    const message = `ses ${res.status}${name ? ` ${name}` : ""}: ${detail.slice(0, 300)}`;
    if (OWNER_FIXES.has(name)) {
      console.error(`[ses] needs the owner (${name}): ${detail.slice(0, 300)}`);
      throw new MailError(message, false);
    }
    // 429, 5xx and throttling are worth retrying; other 4xx are about this message and will fail again.
    const permanent = !RETRYABLE.has(name) && res.status >= 400 && res.status < 500 && res.status !== 429;
    throw new MailError(message, permanent);
  }
}
