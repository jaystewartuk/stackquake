// Alert and digest content (SPEC §7.5): plain text and HTML email, and Slack Block Kit. Every
// value from a note or a source is escaped; links are only rendered for http(s) URLs.
import type { Note } from "../llm/schemas";
import { KIND_LABELS } from "../web/events-view";
import type { SlackMessage } from "./slack";
import { slackEscape, slackLink } from "./slack";

export const DISCLAIMER = "Summary, not legal advice; read the source.";

export interface AlertLinks {
  useful?: string;
  notRelevant?: string;
  mute?: string;
}

export interface AlertView {
  /** What the user calls it: the catalog entry or package name. */
  name: string;
  event: { id: number; kind: string; title: string; quote: string | null; quoteUrl: string; effectiveDate: string | null; note: Note | null };
  because: string;
  links: AlertLinks;
  eventUrl: string;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const http = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export const alertSubject = (v: Pick<AlertView, "name" | "event">) => oneLine(`[Stackquake] ${v.name}: ${v.event.title}`).slice(0, 200);

// ---------- Email: one alert ----------

function textSections(v: AlertView): string[] {
  const n = v.event.note;
  const out: string[] = [];
  out.push(`${v.name}: ${v.event.title}`);
  if (n?.what_changed) out.push(n.what_changed);
  if (v.event.quote) out.push(`${v.event.quote.split("\n").map((l) => `> ${l}`).join("\n")}\n${v.event.quoteUrl}`);
  if (v.event.effectiveDate) out.push(`Takes effect: ${v.event.effectiveDate}`);
  out.push(`Affects you because: ${v.because}`);
  if (n?.who_is_not_affected) out.push(`Not affected: ${n.who_is_not_affected}`);
  if (n?.options.length) out.push(`Your options:\n${n.options.map((o) => `- ${o.name} (${o.effort} effort): ${o.why}`).join("\n")}`);
  if (n?.uncertain.length) out.push(`The source doesn't say:\n${n.uncertain.map((u) => `- ${u}`).join("\n")}`);
  out.push(DISCLAIMER);
  return out;
}

function textLinks(links: AlertLinks): string[] {
  const out: string[] = [];
  if (links.useful) out.push(`Useful: ${links.useful}`);
  if (links.notRelevant) out.push(`Not relevant: ${links.notRelevant}`);
  if (links.mute) out.push(`Mute this dependency for 90 days: ${links.mute}`);
  return out;
}

const STYLE = {
  body: "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#1b1b1a;max-width:600px;margin:0 auto;padding:16px",
  quote: "margin:12px 0;padding:8px 12px;border-left:3px solid #c2410c;background:#f3f1ec;white-space:pre-wrap",
  meta: "color:#5f5d58;font-size:13px",
  btn: "display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border:1px solid #e2dfd8;border-radius:6px;color:#1b1b1a;text-decoration:none",
};

function htmlAlertBlock(v: AlertView, level: "h1" | "h3"): string {
  const n = v.event.note;
  const src = http(v.event.quoteUrl);
  const parts: string[] = [];
  parts.push(`<${level} style="margin:0 0 8px">${esc(v.name)}: ${esc(v.event.title)}</${level}>`);
  parts.push(`<p style="${STYLE.meta}">${esc(KIND_LABELS[v.event.kind] ?? v.event.kind)}${v.event.effectiveDate ? ` · takes effect ${esc(v.event.effectiveDate)}` : ""}</p>`);
  if (n?.what_changed) parts.push(`<p>${esc(n.what_changed)}</p>`);
  if (v.event.quote) parts.push(`<blockquote style="${STYLE.quote}">${esc(v.event.quote)}</blockquote>${src ? `<p style="${STYLE.meta}"><a href="${esc(src)}">${esc(src)}</a></p>` : ""}`);
  parts.push(`<p><strong>Affects you because:</strong> ${esc(v.because)}</p>`);
  if (n?.who_is_not_affected) parts.push(`<p><strong>Not affected:</strong> ${esc(n.who_is_not_affected)}</p>`);
  if (n?.options.length) parts.push(`<p><strong>Your options</strong></p><ul>${n.options.map((o) => `<li><strong>${esc(o.name)}</strong> (${esc(o.effort)} effort): ${esc(o.why)}</li>`).join("")}</ul>`);
  if (n?.uncertain.length) parts.push(`<p style="${STYLE.meta}">The source doesn't say: ${n.uncertain.map(esc).join(" · ")}</p>`);
  const buttons = [
    [v.links.useful, "Useful"],
    [v.links.notRelevant, "Not relevant"],
    [v.links.mute, "Mute this dependency for 90 days"],
  ].filter(([u]) => http(u));
  if (buttons.length) parts.push(`<p>${buttons.map(([u, l]) => `<a style="${STYLE.btn}" href="${esc(u!)}">${esc(l!)}</a>`).join("")}</p>`);
  return parts.join("\n");
}

export interface Footer {
  eventUrl?: string;
  settingsUrl: string;
  digestOnly?: string;
}

function htmlFooter(f: Footer): string {
  const bits = [`<p style="${STYLE.meta}">${esc(DISCLAIMER)}</p>`];
  if (f.eventUrl) bits.push(`<p style="${STYLE.meta}"><a href="${esc(f.eventUrl)}">Read the full note on Stackquake</a></p>`);
  const prefs = [`<a href="${esc(f.settingsUrl)}">Email settings</a>`];
  if (f.digestOnly) prefs.unshift(`<a href="${esc(f.digestOnly)}">Only send me the weekly digest</a>`);
  bits.push(`<p style="${STYLE.meta}">${prefs.join(" · ")}</p>`);
  return bits.join("\n");
}

const htmlDoc = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head><body style="${STYLE.body}">${body}</body></html>`;

export function renderAlertEmail(v: AlertView, footer: Footer): { subject: string; text: string; html: string } {
  const subject = alertSubject(v);
  const text = [
    ...textSections(v),
    ...textLinks(v.links),
    `Full note: ${v.eventUrl}`,
    footer.digestOnly ? `Only send me the weekly digest: ${footer.digestOnly}` : "",
    `Email settings: ${footer.settingsUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const html = htmlDoc(subject, `${htmlAlertBlock(v, "h1")}\n<hr style="border:0;border-top:1px solid #e2dfd8">\n${htmlFooter({ ...footer, eventUrl: v.eventUrl })}`);
  return { subject, text, html };
}

// ---------- Slack ----------

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderAlertSlack(v: AlertView): SlackMessage {
  const n = v.event.note;
  const blocks: unknown[] = [{ type: "header", text: { type: "plain_text", text: cut(`${v.name}: ${v.event.title}`, 150) } }];
  const section = (text: string) => blocks.push({ type: "section", text: { type: "mrkdwn", text: cut(text, 2_900) } });
  if (n?.what_changed) section(slackEscape(n.what_changed));
  if (v.event.quote) section(`${v.event.quote.split("\n").map((l) => `>${slackEscape(l)}`).join("\n")}\n${slackLink(v.event.quoteUrl, "Source")}`);
  section(`*Affects you because:* ${slackEscape(v.because)}${v.event.effectiveDate ? `\n*Takes effect:* ${slackEscape(v.event.effectiveDate)}` : ""}${n?.who_is_not_affected ? `\n*Not affected:* ${slackEscape(n.who_is_not_affected)}` : ""}`);
  if (n?.options.length) section(`*Your options*\n${n.options.map((o) => `• *${slackEscape(o.name)}* (${o.effort} effort): ${slackEscape(o.why)}`).join("\n")}`);
  const links = [
    [v.eventUrl, "Full note"],
    [v.links.useful, "Useful"],
    [v.links.notRelevant, "Not relevant"],
    [v.links.mute, "Mute 90 days"],
  ]
    .filter(([u]) => http(u))
    .map(([u, l]) => slackLink(u!, l!));
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `${slackEscape(DISCLAIMER)}${links.length ? ` · ${links.join(" · ")}` : ""}` }] });
  return { text: cut(`${v.name}: ${v.event.title}`, 300), blocks };
}

// ---------- Weekly digest ----------

export interface DigestView {
  held: AlertView[];
  /** Changes we watched that don't affect the user (suppressed alerts). */
  suppressed: { name: string; title: string; eventUrl: string }[];
  watching: { deps: number; projects: number };
}

export const DIGEST_SHOW_SUPPRESSED = 10;

export function renderDigest(d: DigestView, footer: Footer): { subject: string; text: string; html: string } {
  const n = d.held.length;
  const subject = n ? `[Stackquake] Weekly digest: ${n} change${n === 1 ? "" : "s"} that affect${n === 1 ? "s" : ""} you` : "[Stackquake] Weekly digest: all quiet";
  const lead = n ? `${n} change${n === 1 ? "" : "s"} that affect${n === 1 ? "s" : ""} you this week.` : "No changes that affect you.";
  const watching = `You're watching ${d.watching.deps} dependenc${d.watching.deps === 1 ? "y" : "ies"} across ${d.watching.projects} project${d.watching.projects === 1 ? "" : "s"}.`;
  const sup = d.suppressed.length;
  const supLine = sup ? `${sup} change${sup === 1 ? "" : "s"} we watched that ${sup === 1 ? "doesn't" : "don't"} affect you:` : "";
  const supShown = d.suppressed.slice(0, DIGEST_SHOW_SUPPRESSED);
  const supMore = sup - supShown.length;

  const text = [
    lead,
    ...d.held.map((v) => [...textSections(v).slice(0, -1), ...textLinks(v.links), `Full note: ${v.eventUrl}`].join("\n\n")),
    supLine ? `${supLine}\n${supShown.map((s) => `- ${s.name}: ${s.title} (${s.eventUrl})`).join("\n")}${supMore > 0 ? `\n- and ${supMore} more` : ""}` : "",
    watching,
    DISCLAIMER,
    `Email settings: ${footer.settingsUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n----\n\n");

  const html = htmlDoc(
    subject,
    [
      `<h1 style="margin:0 0 8px">Weekly digest</h1><p>${esc(lead)}</p>`,
      ...d.held.map((v) => `<hr style="border:0;border-top:1px solid #e2dfd8">${htmlAlertBlock(v, "h3")}<p style="${STYLE.meta}"><a href="${esc(v.eventUrl)}">Full note</a></p>`),
      supLine
        ? `<hr style="border:0;border-top:1px solid #e2dfd8"><p>${esc(supLine)}</p><ul>${supShown.map((s) => `<li><a href="${esc(s.eventUrl)}">${esc(s.name)}: ${esc(s.title)}</a></li>`).join("")}${supMore > 0 ? `<li>and ${supMore} more</li>` : ""}</ul>`
        : "",
      `<p style="${STYLE.meta}">${esc(watching)}</p>`,
      htmlFooter(footer),
    ].join("\n"),
  );
  return { subject, text, html };
}
