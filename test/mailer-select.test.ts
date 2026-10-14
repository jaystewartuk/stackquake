import { beforeEach, describe, expect, it } from "vitest";
import { makeMailer, type AppEnv } from "../src/env";
import { IdempotentMailer } from "../src/platform/idempotent";
import { ConsoleMailer } from "../src/platform/memory";
import { SesMailer } from "../src/platform/ses";
import { FixtureHttp, resetDb, testCtx } from "./helpers";

beforeEach(resetDb);

const SES = { AWS_SES_ACCESS_KEY_ID: "AKIATEST", AWS_SES_SECRET_ACCESS_KEY: "secret" };
const env = (e: Partial<AppEnv>) => e as AppEnv;
const http = new FixtureHttp().fetch;

describe("makeMailer", () => {
  it("SES when both AWS keys are set", () => {
    expect(makeMailer(env(SES), http)).toBeInstanceOf(SesMailer);
  });

  it("the console when nothing is set, or only one AWS key", () => {
    expect(makeMailer(env({}), http)).toBeInstanceOf(ConsoleMailer);
    expect(makeMailer(env({ AWS_SES_ACCESS_KEY_ID: "AKIATEST" }), http)).toBeInstanceOf(ConsoleMailer);
    expect(makeMailer(env({ AWS_SES_SECRET_ACCESS_KEY: "secret" }), http)).toBeInstanceOf(ConsoleMailer);
  });

  it("SES with a store is keyed-idempotent end to end", async () => {
    const t = testCtx();
    const fixtures = new FixtureHttp().set("http://ses.test/v2/email/outbound-emails", Response.json({ MessageId: "m" }));
    const mailer = makeMailer(env({ ...SES, AWS_SES_API_BASE: "http://ses.test" }), fixtures.fetch, { db: t.ctx.db, clock: t.clock });
    expect(mailer).toBeInstanceOf(IdempotentMailer);
    const mail = { to: "dev@example.com", subject: "s", text: "t", idempotencyKey: "digest-1-2026-10-13" };
    await mailer.send(mail);
    await mailer.send(mail);
    expect(fixtures.requests).toHaveLength(1);
  });
});
