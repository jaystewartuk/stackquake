import { describe, expect, it } from "vitest";
import { signRequest } from "../src/platform/sigv4";

// Vectors from AWS's published Signature Version 4 test suite (aws-sig-v4-test-suite).
const creds = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "service" };
const now = new Date("2015-08-30T12:36:00Z");

describe("signRequest", () => {
  it("get-vanilla", async () => {
    const h = await signRequest({ method: "GET", url: "https://example.amazonaws.com/", headers: {}, body: "" }, creds, now);
    expect(h["x-amz-date"]).toBe("20150830T123600Z");
    expect(h.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });

  it("get-vanilla-query-order-key-case", async () => {
    const h = await signRequest({ method: "GET", url: "https://example.amazonaws.com/?Param2=value2&Param1=value1", headers: {}, body: "" }, creds, now);
    expect(h.authorization).toContain("Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
  });

  it("post-x-www-form-urlencoded (signed content-type and body hash)", async () => {
    const h = await signRequest({ method: "POST", url: "https://example.amazonaws.com/", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "Param1=value1" }, creds, now);
    expect(h.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a");
  });

  it("header whitespace is trimmed and collapsed", async () => {
    const a = await signRequest({ method: "GET", url: "https://example.amazonaws.com/", headers: { "My-Header1": "  value1   value1  " }, body: "" }, creds, now);
    const b = await signRequest({ method: "GET", url: "https://example.amazonaws.com/", headers: { "my-header1": "value1 value1" }, body: "" }, creds, now);
    expect(a.authorization).toBe(b.authorization);
  });
});
