// Slack incoming webhooks (SPEC §7.5). Only https://hooks.slack.com/services/… URLs are accepted
// (SSRF, SPEC §8): the URL is user input that becomes a fetch target, so the host is fixed and
// redirects are not followed.
import type { Ctx } from "../context";

export function validSlackWebhook(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "hooks.slack.com" || u.port || u.username || u.password || u.search || u.hash) return null;
  if (!/^\/services\/T[A-Z0-9]{4,20}\/B[A-Z0-9]{4,20}\/[A-Za-z0-9]{16,64}$/.test(u.pathname)) return null;
  return `https://hooks.slack.com${u.pathname}`;
}

/** Slack mrkdwn: &, < and > must be escaped in text. */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `<url|label>`; URLs that could break out of the link syntax are left as plain text. */
export const slackLink = (url: string, label: string) => (/^https?:\/\/[^\s|<>]+$/i.test(url) ? `<${url}|${slackEscape(label)}>` : slackEscape(label));

export type SlackResult = { ok: true } | { ok: false; permanent: boolean; error: string };

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

/**
 * Posts to a webhook URL that has already passed validSlackWebhook. 4xx answers (no_service,
 * channel_not_found, invalid_payload…) are permanent; 429, 5xx and network errors may be retried.
 */
export async function postSlack(ctx: Ctx, url: string, msg: SlackMessage): Promise<SlackResult> {
  if (!validSlackWebhook(url)) return { ok: false, permanent: true, error: "not a Slack webhook URL" };
  let res: Response;
  try {
    res = await ctx.http(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg), redirect: "manual" }));
  } catch (e) {
    return { ok: false, permanent: false, error: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = (await res.text().catch(() => "")).slice(0, 200);
  if (res.status === 200) return { ok: true };
  return { ok: false, permanent: res.status >= 300 && res.status < 500 && res.status !== 429, error: `slack ${res.status}: ${body}` };
}
