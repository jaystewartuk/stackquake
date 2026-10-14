// Amazon SES has no Idempotency-Key, and the job runner relies on one so a retried step cannot
// email twice. This wrapper keeps the
// keys in D1: checked before sending, written right after the provider accepts the message.
//
// It fails towards sending twice, never towards not sending: if the invocation dies between the
// provider's 200 and the insert, the retry finds no row and sends again.
import { eq } from "drizzle-orm";
import { mailSends } from "../db/schema";
import type { Clock, Db, Mail, Mailer } from "../ports";

export class IdempotentMailer implements Mailer {
  constructor(
    private readonly inner: Mailer,
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async send(mail: Mail): Promise<void> {
    const key = mail.idempotencyKey?.slice(0, 256);
    if (!key) return this.inner.send(mail);
    if (await this.db.select({ key: mailSends.key }).from(mailSends).where(eq(mailSends.key, key)).get()) return;
    await this.inner.send(mail);
    // The message is out. A failed insert must not turn into a retry that sends it again.
    try {
      await this.db.insert(mailSends).values({ key, sentAt: this.clock.now() }).onConflictDoNothing();
    } catch (e) {
      console.error(`[mail] sent ${key} but could not record it: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
