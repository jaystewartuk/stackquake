import { describe, expect, it, vi } from "vitest";
import { SesMailer } from "../src/platform/ses";
import { MailError } from "../src/ports";

const ENDPOINT = "https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails";
const mail = { to: "dev@example.com", subject: "[Stackquake] Redis: licence", text: "plain", html: "<p>html</p>", headers: { "List-Unsubscribe": "<https://stackquake.com/u/x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };

function mailer(respond: (req: Request) => Response | Promise<Response>, over: Partial<ConstructorParameters<typeof SesMailer>[0]> = {}) {
  const requests: Request[] = [];
  const m = new SesMailer({ accessKeyId: "AKIATEST", secretAccessKey: "secret", from: "Stackquake <alerts@stackquake.com>", now: () => new Date("2026-10-13T20:00:00Z"), http: async (req) => (requests.push(req.clone()), respond(req)), ...over });
  return { m, requests };
}

const fail = (status: number, type: string, message = "nope") => new Response(JSON.stringify({ message }), { status, headers: { "x-amzn-errortype": type } });
async function error(res: Response): Promise<MailError> {
  const { m } = mailer(() => res);
  return m.send(mail).then(() => Promise.reject(new Error("sent")), (e) => e as MailError);
}

describe("SesMailer request", () => {
  it("posts a signed SendEmail to the eu-west-1 v2 endpoint, headers passed through", async () => {
    const { m, requests } = mailer(() => Response.json({ MessageId: "m1" }));
    await m.send(mail);
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe(ENDPOINT);
    expect(req.headers.get("content-type")).toBe("application/json");
    expect(req.headers.get("x-amz-date")).toBe("20261013T200000Z");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/20261013\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(await req.json()).toEqual({
      FromEmailAddress: "Stackquake <alerts@stackquake.com>",
      Destination: { ToAddresses: ["dev@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "[Stackquake] Redis: licence", Charset: "UTF-8" },
          Body: { Text: { Data: "plain", Charset: "UTF-8" }, Html: { Data: "<p>html</p>", Charset: "UTF-8" } },
          Headers: [
            { Name: "List-Unsubscribe", Value: "<https://stackquake.com/u/x>" },
            { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
          ],
        },
      },
    });
  });

  it("omits Html and Headers when the mail has none; honours region and base", async () => {
    const { m, requests } = mailer(() => Response.json({}), { region: "eu-central-1" });
    await m.send({ to: "a@b.test", subject: "s", text: "t" });
    expect(requests[0].url).toBe("https://email.eu-central-1.amazonaws.com/v2/email/outbound-emails");
    expect(requests[0].headers.get("authorization")).toContain("/eu-central-1/ses/");
    expect(((await requests[0].json()) as { Content: { Simple: object } }).Content.Simple).toEqual({ Subject: { Data: "s", Charset: "UTF-8" }, Body: { Text: { Data: "t", Charset: "UTF-8" } } });
    const stub = mailer(() => Response.json({}), { base: "http://127.0.0.1:9/ses/" });
    await stub.m.send(mail);
    expect(stub.requests[0].url).toBe("http://127.0.0.1:9/ses/v2/email/outbound-emails");
  });

  it("sends non-ASCII text as UTF-8", async () => {
    const { m, requests } = mailer(() => Response.json({}));
    await m.send({ to: "a@b.test", subject: "Licence – ändert sich", text: "Größe ✓" });
    const body = (await requests[0].json()) as { Content: { Simple: { Subject: { Data: string } } } };
    expect(body.Content.Simple.Subject.Data).toBe("Licence – ändert sich");
  });
});

describe("SesMailer errors", () => {
  it.each([
    [429, "TooManyRequestsException"],
    [400, "LimitExceededException"],
    [400, "ThrottlingException"],
    [500, "InternalFailure"],
    [503, "ServiceUnavailable"],
    [502, ""],
  ])("%i %s is retried", async (status, type) => {
    expect((await error(type ? fail(status, type) : new Response("bad gateway", { status }))).permanent).toBe(false);
  });

  it.each([
    [400, "MessageRejected"],
    [400, "MailFromDomainNotVerifiedException"],
    [400, "BadRequestException"],
    [404, "NotFoundException"],
    [422, ""],
  ])("%i %s is permanent", async (status, type) => {
    const e = await error(type ? fail(status, type) : new Response("{}", { status }));
    expect(e).toBeInstanceOf(MailError);
    expect(e.permanent).toBe(true);
  });

  it("reads the error type from the body and strips namespace and suffix", async () => {
    expect((await error(new Response(JSON.stringify({ __type: "com.amazonaws.sesv2#MessageRejected", message: "x" }), { status: 400 }))).permanent).toBe(true);
    expect((await error(fail(400, "TooManyRequestsException:http://internal.amazon.com/coral/com.amazonaws.sesv2/"))).permanent).toBe(false);
  });

  it.each([
    [400, "AccountSuspendedException"],
    [400, "SendingPausedException"],
    [403, "UnrecognizedClientException"],
    [403, "InvalidSignatureException"],
  ])("%i %s needs the owner: retried, logged loudly", async (status, type) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await error(fail(status, type, "check the account"));
    expect(e.permanent).toBe(false);
    expect(e.message).toContain(type.replace(/Exception$/, ""));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("needs the owner"));
    log.mockRestore();
  });

  it("a network failure is retried", async () => {
    const { m } = mailer(() => Promise.reject(new TypeError("connection reset")));
    await expect(m.send(mail)).rejects.toMatchObject({ permanent: false, message: "ses: connection reset" });
  });
});
