import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mailSends } from "../src/db/schema";
import { MAIL_SENDS_KEEP, prunePersonal } from "../src/jobs/cron";
import { IdempotentMailer } from "../src/platform/idempotent";
import { MemoryMailer } from "../src/platform/memory";
import { MailError, type Mail, type Mailer } from "../src/ports";
import { DAY } from "../src/util";
import { resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

const mail = (over: Partial<Mail> = {}): Mail => ({ to: "dev@example.com", subject: "s", text: "t", idempotencyKey: "alert-1", ...over });
const rows = (t: ReturnType<typeof testCtx>) => t.ctx.db.select().from(mailSends).all();

describe("IdempotentMailer", () => {
  it("a second send with the same key does nothing", async () => {
    const t = testCtx();
    const inner = new MemoryMailer();
    const m = new IdempotentMailer(inner, t.ctx.db, t.clock);
    await m.send(mail());
    await m.send(mail());
    await m.send(mail({ subject: "other subject, same key" }));
    expect(inner.sent).toHaveLength(1);
    expect(await rows(t)).toEqual([{ key: "alert-1", sentAt: t.clock.now() }]);
  });

  it("different keys send; mail without a key always sends and records nothing", async () => {
    const t = testCtx();
    const inner = new MemoryMailer();
    const m = new IdempotentMailer(inner, t.ctx.db, t.clock);
    await m.send(mail({ idempotencyKey: "alert-1" }));
    await m.send(mail({ idempotencyKey: "alert-2" }));
    await m.send(mail({ idempotencyKey: undefined }));
    await m.send(mail({ idempotencyKey: undefined }));
    expect(inner.sent).toHaveLength(4);
    expect((await rows(t)).map((r) => r.key).sort()).toEqual(["alert-1", "alert-2"]);
  });

  it("a failed send records nothing and can be retried", async () => {
    const t = testCtx();
    let fail: Error | null = new MailError("ses 503", false);
    const sent: Mail[] = [];
    const inner: Mailer = {
      send: async (m) => {
        if (fail) throw fail;
        sent.push(m);
      },
    };
    const m = new IdempotentMailer(inner, t.ctx.db, t.clock);
    await expect(m.send(mail())).rejects.toMatchObject({ permanent: false });
    expect(await rows(t)).toEqual([]);
    fail = null;
    await m.send(mail());
    await m.send(mail());
    expect(sent).toHaveLength(1);
  });

  it("the crash window sends twice, never zero times: no row was written, so the retry sends", async () => {
    const t = testCtx();
    const inner = new MemoryMailer();
    await inner.send(mail()); // SES accepted it, then the invocation died before the insert
    await new IdempotentMailer(inner, t.ctx.db, t.clock).send(mail());
    expect(inner.sent).toHaveLength(2);
  });

  it("a send that went out is not retried when only recording it failed", async () => {
    const t = testCtx();
    const inner = new MemoryMailer();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { select: t.ctx.db.select.bind(t.ctx.db), insert: () => { throw new Error("D1 down"); } } as unknown as typeof t.ctx.db;
    await expect(new IdempotentMailer(inner, broken, t.clock).send(mail())).resolves.toBeUndefined();
    expect(inner.sent).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("sent alert-1 but could not record it"));
    log.mockRestore();
  });

  it("the daily prune drops keys older than three days and keeps newer ones", async () => {
    const t = testCtx();
    const m = new IdempotentMailer(new MemoryMailer(), t.ctx.db, t.clock);
    await m.send(mail({ idempotencyKey: "old" }));
    t.clock.advance(MAIL_SENDS_KEEP - DAY);
    await m.send(mail({ idempotencyKey: "new" }));
    t.clock.advance(DAY + 1);
    await prunePersonal(t.ctx);
    expect((await rows(t)).map((r) => r.key)).toEqual(["new"]);
    expect(await t.ctx.db.select().from(mailSends).where(eq(mailSends.key, "old")).get()).toBeUndefined();
  });
});
