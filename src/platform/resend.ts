// Resend (SPEC §4.1 Email) behind the Mailer port. One POST per message; the Idempotency-Key
// header makes a retried step safe: Resend drops a second send with the same key for 24 hours.
import { MailError, type Http, type Mail, type Mailer } from "../ports";

export const RESEND_API = "https://api.resend.com";
export const DEFAULT_FROM = "Stackquake <alerts@stackquake.com>";

export interface ResendOptions {
  apiKey: string;
  from: string;
  http: Http;
  base?: string;
}

export class ResendMailer implements Mailer {
  constructor(private readonly opts: ResendOptions) {}

  async send(mail: Mail): Promise<void> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" };
    if (mail.idempotencyKey) headers["idempotency-key"] = mail.idempotencyKey.slice(0, 256);
    const body = {
      from: this.opts.from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
    };
    let res: Response;
    try {
      res = await this.opts.http(new Request(`${(this.opts.base || RESEND_API).replace(/\/$/, "")}/emails`, { method: "POST", headers, body: JSON.stringify(body) }));
    } catch (e) {
      throw new MailError(`resend: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    if (res.ok) return;
    const detail = await res.text().catch(() => "");
    // 409 on a reused key means the first send with this key went through (or is in flight).
    if (res.status === 409 && /idempotent/i.test(detail)) return;
    // 429 and 5xx are worth retrying; other 4xx are about this message and will fail again.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw new MailError(`resend ${res.status}: ${detail.slice(0, 300)}`, permanent);
  }
}
