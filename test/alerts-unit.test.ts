// Pure parts of M4: urgency, signed links, Slack URL validation, secret box, digest rule, rendering.
import { describe, expect, it } from "vitest";
import { shouldSendDigest } from "../src/alerts/digest";
import { becauseText } from "../src/alerts/fanout";
import { LINK_TTL_MS, signLink, verifyLink } from "../src/alerts/links";
import { renderAlertEmail, renderAlertSlack, renderDigest, type AlertView } from "../src/alerts/render";
import { decrypt, encrypt } from "../src/alerts/secretbox";
import { slackEscape, validSlackWebhook } from "../src/alerts/slack";
import { isUrgent } from "../src/alerts/urgency";
import type { Note } from "../src/llm/schemas";
import { DAY } from "../src/util";
import { TEST_CHANNEL_KEY } from "./helpers";

const NOW = Date.UTC(2026, 9, 10, 12);
const note = (over: Partial<Note> = {}): Note => ({
  material: true,
  kind: "acquisition",
  title: "Acme is acquired by MegaCorp",
  what_changed: "MegaCorp bought Acme.",
  quote: "We are joining MegaCorp.",
  effective_date: null,
  applies_when: { hosting: [], use: [], tier: [] },
  who_is_not_affected: null,
  options: [],
  uncertain: [],
  confidence: 0.95,
  ...over,
});
const ev = (kind: string, effectiveDate: string | null = null, n: Note | null = null) => ({ kind: kind as never, effectiveDate, note: n, quote: n?.quote ?? null });

describe("urgency (SPEC §7.5)", () => {
  it("licence and free-tier changes are immediate", () => {
    expect(isUrgent(ev("license"), NOW)).toBe(true);
    expect(isUrgent(ev("free_tier"), NOW)).toBe(true);
  });

  it("EOL is immediate only within 180 days (or already past); a bare month counts from its first day", () => {
    expect(isUrgent(ev("eol", "2027-03-01"), NOW)).toBe(true); // 142 days
    expect(isUrgent(ev("eol", "2027-04-08"), NOW)).toBe(true); // 179.5 days
    expect(isUrgent(ev("eol", "2027-04-09"), NOW)).toBe(false); // 180.5 days
    expect(isUrgent(ev("eol", "2027-04"), NOW)).toBe(true); // 2027-04-01
    expect(isUrgent(ev("eol", "2027-10"), NOW)).toBe(false); // Deno: about a year out
    expect(isUrgent(ev("eol", "2025-01-01"), NOW)).toBe(true);
    expect(isUrgent(ev("eol", null), NOW)).toBe(false);
  });

  it("an acquisition is immediate only when the note says the service ends", () => {
    expect(isUrgent(ev("acquisition", null, note()), NOW)).toBe(false);
    expect(isUrgent(ev("acquisition", "2027-01-31", note({ what_changed: "MegaCorp bought Acme. The hosted service shuts down on 2027-01-31." })), NOW)).toBe(true);
    expect(isUrgent(ev("acquisition", null, note({ what_changed: "Acme Cloud will be discontinued next year." })), NOW)).toBe(true);
  });

  it("pricing, deprecated, archived and other wait for the digest", () => {
    for (const k of ["pricing", "deprecated", "archived", "other"]) expect(isUrgent(ev(k, "2026-10-11"), NOW)).toBe(false);
  });
});

describe("signed links", () => {
  const secret = "s3cret-for-tests-only-0123456789";

  it("round-trips the action and id", async () => {
    const t = await signLink(secret, "mute", 42, NOW);
    expect(await verifyLink(secret, t, NOW)).toEqual({ ok: true, action: "mute", id: 42 });
    expect(await verifyLink(secret, await signLink(secret, "digest_only", 7, NOW), NOW)).toEqual({ ok: true, action: "digest_only", id: 7 });
  });

  it("expires after 30 days", async () => {
    const t = await signLink(secret, "useful", 1, NOW);
    expect((await verifyLink(secret, t, NOW + LINK_TTL_MS - 1000)).ok).toBe(true);
    expect(await verifyLink(secret, t, NOW + LINK_TTL_MS + 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampering: another action, another id, a later expiry, another key", async () => {
    const t = await signLink(secret, "useful", 1, NOW);
    const [body, exp, sig] = t.split(".");
    expect((await verifyLink(secret, `n${body.slice(1)}.${exp}.${sig}`, NOW)).ok).toBe(false);
    expect((await verifyLink(secret, `u2.${exp}.${sig}`, NOW)).ok).toBe(false);
    expect((await verifyLink(secret, `${body}.${(parseInt(exp, 36) + 86_400).toString(36)}.${sig}`, NOW)).ok).toBe(false);
    expect((await verifyLink("another-secret-entirely-00000000", t, NOW)).ok).toBe(false);
    expect((await verifyLink(secret, `${t}x`, NOW)).ok).toBe(false);
    expect((await verifyLink(secret, "", NOW)).ok).toBe(false);
  });
});

describe("Slack webhook URLs (SSRF, SPEC §8)", () => {
  const good = "https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx";

  it("accepts an incoming webhook URL", () => {
    expect(validSlackWebhook(good)).toBe(good);
    expect(validSlackWebhook(`  ${good}  `)).toBe(good);
  });

  it.each([
    ["http", good.replace("https:", "http:")],
    ["another host", good.replace("hooks.slack.com", "hooks.slack.com.evil.example")],
    ["userinfo", good.replace("https://", "https://hooks.slack.com@")],
    ["userinfo to another host", "https://hooks.slack.com@evil.example/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx"],
    ["a port", good.replace("slack.com", "slack.com:8443")],
    ["a query", `${good}?x=1`],
    ["a fragment", `${good}#x`],
    ["another path", "https://hooks.slack.com/workflows/T0123ABCD/A0456/123/abc"],
    ["path traversal", "https://hooks.slack.com/services/../api/x/T0123ABCD/B0456EFGH/abcdefghijklmnop"],
    ["an IP", "https://127.0.0.1/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx"],
    ["slack.com itself", good.replace("hooks.slack.com", "slack.com")],
    ["not a URL", "hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx"],
    ["javascript", "javascript:alert(1)"],
  ])("rejects %s", (_name, url) => {
    expect(validSlackWebhook(url)).toBeNull();
  });
});

describe("secret box", () => {
  it("encrypts with a fresh IV and decrypts", async () => {
    const a = await encrypt(TEST_CHANNEL_KEY, "https://hooks.slack.com/services/T1/B1/x");
    const b = await encrypt(TEST_CHANNEL_KEY, "https://hooks.slack.com/services/T1/B1/x");
    expect(a).not.toBe(b);
    expect(a).not.toContain("hooks.slack.com");
    expect(await decrypt(TEST_CHANNEL_KEY, a)).toBe("https://hooks.slack.com/services/T1/B1/x");
  });

  it("refuses a modified ciphertext", async () => {
    const a = await encrypt(TEST_CHANNEL_KEY, "secret");
    const bytes = atob(a.slice(3));
    const flipped = `v1:${btoa(bytes.slice(0, -1) + String.fromCharCode(bytes.charCodeAt(bytes.length - 1) ^ 1))}`;
    await expect(decrypt(TEST_CHANNEL_KEY, flipped)).rejects.toThrow();
  });
});

describe("digest send/skip rule", () => {
  const day = Date.UTC(2026, 9, 12);
  it("sends when something affects the user", () => {
    expect(shouldSendDigest(1, day - 2 * DAY, day)).toBe(true);
  });
  it("sends 'all quiet' for the first digest of the month only", () => {
    expect(shouldSendDigest(0, null, day)).toBe(true);
    expect(shouldSendDigest(0, Date.UTC(2026, 8, 28), day)).toBe(true); // last one in September
    expect(shouldSendDigest(0, Date.UTC(2026, 9, 5), day)).toBe(false); // already one in October
  });
});

describe("because text", () => {
  const none = { hosting: [], use: [], tier: [] };
  it("explains a match, an unknown and a non-match", () => {
    expect(becauseText("affected", "Redis", "Shop", { ...none, hosting: ["self_hosted"] }, { hosting: "self_hosted", use: "commercial" })).toBe("you use Redis self-hosted in Shop, which the change applies to.");
    expect(becauseText("affected", "Redis", "Shop", none, {})).toBe("you use Redis in Shop, and the change applies to everyone who uses it.");
    expect(becauseText("unknown", "Redis", "Shop", { ...none, hosting: ["self_hosted"] }, {})).toBe("We don't know how you use Redis, so we assume it does.");
    expect(becauseText("not_affected", "Redis", "Shop", { ...none, hosting: ["self_hosted"] }, { hosting: "hosted" })).toBe("It only applies to use self-hosted, and you use Redis hosted in Shop.");
  });
});

describe("rendering", () => {
  const view: AlertView = {
    name: "Redis <script>",
    event: {
      id: 5,
      kind: "license",
      title: 'Licence moves to "SSPL" & AGPL',
      quote: "Redis is now <b>tri-licensed</b>.",
      quoteUrl: "https://redis.io/blog/x",
      effectiveDate: "2026-11-01",
      note: note({ kind: "license", what_changed: "From 8.0 Redis is AGPL <img src=x>.", options: [{ catalog_id: "valkey", name: "Valkey", why: "BSD fork", effort: "low" }], uncertain: ["Whether 7.x changes"] }),
    },
    because: "you use Redis self-hosted in Shop, which the change applies to.",
    links: { useful: "https://stackquake.test/a/u1", notRelevant: "https://stackquake.test/a/n1", mute: "https://stackquake.test/a/m1" },
    eventUrl: "https://stackquake.test/events/5",
  };

  it("email: subject, sections in order, escaped HTML, links and disclaimer", () => {
    const m = renderAlertEmail(view, { settingsUrl: "https://stackquake.test/app/settings", digestOnly: "https://stackquake.test/a/d1" });
    expect(m.subject).toBe('[Stackquake] Redis <script>: Licence moves to "SSPL" & AGPL');
    const order = ["From 8.0 Redis is AGPL", "> Redis is now <b>tri-licensed</b>.", "Takes effect: 2026-11-01", "Affects you because:", "Your options:", "- Valkey (low effort): BSD fork", "The source doesn't say:", "Summary, not legal advice; read the source.", "Useful: https://stackquake.test/a/u1", "Not relevant:", "Mute this dependency for 90 days:", "Only send me the weekly digest:"];
    let at = -1;
    for (const s of order) {
      const i = m.text.indexOf(s);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;b&gt;tri-licensed&lt;/b&gt;");
    expect(m.html).toContain('<blockquote style=');
    expect(m.html).toContain('href="https://stackquake.test/a/m1"');
    expect(m.html).toContain("Summary, not legal advice");
  });

  it("Slack: Block Kit with escaped mrkdwn and link syntax", () => {
    const s = renderAlertSlack(view);
    const json = JSON.stringify(s.blocks);
    expect((s.blocks as { type: string }[])[0].type).toBe("header");
    expect(json).toContain("&lt;img src=x&gt;");
    expect(json).toContain("<https://stackquake.test/a/u1|Useful>");
    expect(json).toContain("<https://redis.io/blog/x|Source>");
    expect(slackEscape("<!channel> & <@U1>")).toBe("&lt;!channel&gt; &amp; &lt;@U1&gt;");
  });

  it("digest: affects-you items, then the suppressed count", () => {
    const d = renderDigest({ held: [view], suppressed: [{ name: "Neon", title: "Pricing page reworded", eventUrl: "https://stackquake.test/events/9" }], watching: { deps: 12, projects: 2 } }, { settingsUrl: "https://stackquake.test/app/settings" });
    expect(d.subject).toBe("[Stackquake] Weekly digest: 1 change that affects you");
    expect(d.text).toContain("1 change we watched that doesn't affect you:");
    expect(d.text.indexOf("Licence moves")).toBeLessThan(d.text.indexOf("Neon: Pricing page reworded"));
    const quiet = renderDigest({ held: [], suppressed: [], watching: { deps: 1, projects: 1 } }, { settingsUrl: "x" });
    expect(quiet.subject).toBe("[Stackquake] Weekly digest: all quiet");
    expect(quiet.text).toContain("No changes that affect you.");
  });
});
