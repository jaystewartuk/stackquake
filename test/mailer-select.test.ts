import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMailer, type AppEnv } from "../src/env";
import { IdempotentMailer } from "../src/platform/idempotent";
import { ConsoleMailer } from "../src/platform/memory";
import { ResendMailer } from "../src/platform/resend";
import { SesMailer } from "../src/platform/ses";
import { FixtureHttp, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

const SES = { AWS_SES_ACCESS_KEY_ID: "AKIATEST", AWS_SES_SECRET_ACCESS_KEY: "secret" };
const env = (e: Partial<AppEnv>) => e as AppEnv;
const http = new FixtureHttp().fetch;

describe("makeMailer", () => {
  it("SES when both AWS keys are set, even with a Resend key", () => {
    expect(makeMailer(env({ ...SES, RESEND_API_KEY: "re_x" }), http)).toBeInstanceOf(SesMailer);
    expect(makeMailer(env(SES), http)).toBeInstanceOf(SesMailer);
  });

  it("Resend when only RESEND_API_KEY is set, or only one AWS key", () => {
    expect(makeMailer(env({ RESEND_API_KEY: "re_x" }), http)).toBeInstanceOf(ResendMailer);
    expect(makeMailer(env({ AWS_SES_ACCESS_KEY_ID: "AKIATEST", RESEND_API_KEY: "re_x" }), http)).toBeInstanceOf(ResendMailer);
    expect(makeMailer(env({ AWS_SES_SECRET_ACCESS_KEY: "secret", RESEND_API_KEY: "re_x" }), http)).toBeInstanceOf(ResendMailer);
  });

  it("the console when nothing is set, or only one AWS key", () => {
    expect(makeMailer(env({}), http)).toBeInstanceOf(ConsoleMailer);
    expect(makeMailer(env({ AWS_SES_ACCESS_KEY_ID: "AKIATEST" }), http)).toBeInstanceOf(ConsoleMailer);
  });

  it("logs once that SES wins when both are configured, and not when only SES is", async () => {
    vi.resetModules(); // the once-only flag lives in the module
    const { makeMailer } = await import("../src/env");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    makeMailer(env(SES), http);
    expect(log).not.toHaveBeenCalled();
    makeMailer(env({ ...SES, RESEND_API_KEY: "re_x" }), http);
    makeMailer(env({ ...SES, RESEND_API_KEY: "re_x" }), http);
    expect(log.mock.calls.filter(([m]) => String(m).includes("sending with SES"))).toHaveLength(1);
    log.mockRestore();
  });

  it("SES with a store is keyed-idempotent end to end; Resend is not wrapped", async () => {
    const t = testCtx();
    const fixtures = new FixtureHttp().set("http://ses.test/v2/email/outbound-emails", Response.json({ MessageId: "m" }));
    const mailer = makeMailer(env({ ...SES, AWS_SES_API_BASE: "http://ses.test" }), fixtures.fetch, { db: t.ctx.db, clock: t.clock });
    expect(mailer).toBeInstanceOf(IdempotentMailer);
    const mail = { to: "dev@example.com", subject: "s", text: "t", idempotencyKey: "digest-1-2026-10-13" };
    await mailer.send(mail);
    await mailer.send(mail);
    expect(fixtures.requests).toHaveLength(1);
    expect(makeMailer(env({ RESEND_API_KEY: "re_x" }), http, { db: t.ctx.db, clock: t.clock })).toBeInstanceOf(ResendMailer);
  });
});
