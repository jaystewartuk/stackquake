// A user's alerts on the dashboard and dep page (sent, held for the digest, suppressed), with
// the feedback buttons.
import { sql } from "drizzle-orm";
import type { FC } from "hono/jsx";
import type { Ctx } from "../context";
import type { AlertChannel, AlertStatus, Feedback, HeldReason } from "../db/schema";
import { KindPill, URGENT } from "./events-view";
import { Csrf, fmtDate } from "./layout";
import { Badge, Button, EmptyState, Severity, type Level } from "./ui";
import { depName } from "./stack-view";

export interface AlertRow {
  id: number;
  eventId: number;
  depId: number;
  channel: AlertChannel;
  status: AlertStatus;
  held: HeldReason | null;
  because: string;
  feedback: Feedback | null;
  createdAt: number;
  sentAt: number | null;
  emailedAt: number | null;
  slackAt: number | null;
  title: string;
  kind: string;
  name: string;
}

/** Newest first; only alerts whose event is still published. */
export async function userAlerts(ctx: Ctx, userId: number, opts: { depId?: number; limit: number }): Promise<AlertRow[]> {
  const rows = await ctx.db.all<{
    id: number; event_id: number; dep_id: number; channel: AlertChannel; status: AlertStatus; held: HeldReason | null; because: string; feedback: Feedback | null;
    created_at: number; sent_at: number | null; emailed_at: number | null; slack_at: number | null; title: string; kind: string;
    catalog_id: string | null; ecosystem: string | null; package: string | null; eol_product: string | null;
  }>(sql`
    SELECT a.id, a.event_id, a.dep_id, a.channel, a.status, a.held, a.because, a.feedback, a.created_at, a.sent_at, a.emailed_at, a.slack_at,
           e.title, e.kind, d.catalog_id, d.ecosystem, d.package, d.eol_product
    FROM alerts a
    JOIN events e ON e.id = a.event_id AND e.status = 'published'
    LEFT JOIN deps d ON d.id = a.dep_id
    WHERE a.user_id = ${userId} ${opts.depId ? sql`AND a.dep_id = ${opts.depId}` : sql``}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${opts.limit}`);
  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    depId: r.dep_id,
    channel: r.channel,
    status: r.status,
    held: r.held,
    because: r.because,
    feedback: r.feedback,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    emailedAt: r.emailed_at,
    slackAt: r.slack_at,
    title: r.title,
    kind: r.kind,
    name: r.catalog_id || r.package || r.eol_product ? depName({ catalogId: r.catalog_id, ecosystem: r.ecosystem, package: r.package, eolProduct: r.eol_product }) : "removed dependency",
  }));
}

const HELD: Record<HeldReason, string> = { not_urgent: "not urgent", rate_limit: "daily limit of 3 reached", digest_only: "you chose digest only" };

export function alertState(a: Pick<AlertRow, "status" | "channel" | "held" | "sentAt" | "emailedAt" | "slackAt">): { label: string; tone: "" | "ok" | "warn" | "bad" } {
  if (a.status === "suppressed") return { label: "Didn't affect you", tone: "" };
  if (a.status === "failed") return { label: "Not delivered", tone: "bad" };
  if (a.channel === "digest") return a.status === "sent" ? { label: `In the digest of ${fmtDate(a.sentAt)}`, tone: "ok" } : { label: `Held for the digest (${HELD[a.held ?? "not_urgent"]})`, tone: "warn" };
  if (a.status === "sent") {
    const how = [a.emailedAt ? "email" : "", a.slackAt ? "Slack" : ""].filter(Boolean).join(" and ");
    return { label: `Sent ${fmtDate(a.sentAt)}${how ? ` by ${how}` : ""}`, tone: "ok" };
  }
  return { label: "Sending", tone: "" };
}

/** Compact "Useful / Not relevant" feedback; the pressed state shows the answer already given. */
export const FeedbackButtons: FC<{ a: AlertRow; csrf: string; back: string }> = ({ a, csrf, back }) => (
  <form class="inline cluster" method="post" action={`/app/alerts/${a.id}/feedback`} style="gap:var(--s-1)">
    <Csrf token={csrf} />
    <input type="hidden" name="back" value={back} />
    <Button size="sm" variant="quiet" name="value" value="useful" pressed={a.feedback === "useful"} icon="check">
      Useful
    </Button>
    <Button size="sm" variant="quiet" name="value" value="not_relevant" pressed={a.feedback === "not_relevant"} icon="x">
      Not relevant
    </Button>
  </form>
);

/** Act for an urgent kind that affects the user, watch for the rest, quiet when it didn't affect them. */
export const alertLevel = (a: Pick<AlertRow, "status" | "kind">): Level => (a.status === "suppressed" ? "quiet" : URGENT.has(a.kind) ? "act" : "watch");

const AlertItem: FC<{ a: AlertRow; csrf: string; back: string; showDep: boolean }> = ({ a, csrf, back, showDep }) => {
  const s = alertState(a);
  return (
    <li>
      <div class="spread">
        <span class="cluster" style="gap:var(--s-2)">
          <Severity level={alertLevel(a)} /> <KindPill kind={a.kind} />
          <span>
            {showDep && <a href={`/app/deps/${a.depId}`}>{a.name}</a>}
            {showDep ? ": " : ""}
            <a href={`/events/${a.eventId}`}>{a.title}</a>
          </span>
        </span>
        {s.tone === "bad" ? (
          <Badge tone="act" icon="alert-triangle">
            {s.label}
          </Badge>
        ) : (
          <span class="meta">{s.label}</span>
        )}
      </div>
      <div class="meta">{a.status === "suppressed" ? a.because : `Affects you because: ${a.because}`}</div>
      {a.status !== "suppressed" && (
        <div style="margin-top:var(--s-1)">
          <FeedbackButtons a={a} csrf={csrf} back={back} />
        </div>
      )}
    </li>
  );
};

/** Alerts that matter first; the ones that didn't affect the user are collapsed. */
export const AlertList: FC<{ list: AlertRow[]; csrf: string; back: string; showDep?: boolean }> = ({ list, csrf, back, showDep = true }) => {
  const main = list.filter((a) => a.status !== "suppressed");
  const quiet = list.filter((a) => a.status === "suppressed");
  return (
    <>
      {main.length ? (
        <ul class="plain">
          {main.map((a) => (
            <AlertItem a={a} csrf={csrf} back={back} showDep={showDep} />
          ))}
        </ul>
      ) : (
        <EmptyState title="No alerts yet" icon="mail" level={3}>
          We'll email you when a change affects you.
        </EmptyState>
      )}
      {quiet.length > 0 && (
        <details>
          <summary>
            {quiet.length} change{quiet.length === 1 ? "" : "s"} we watched that didn't affect you
          </summary>
          <ul class="plain">
            {quiet.map((a) => (
              <AlertItem a={a} csrf={csrf} back={back} showDep={showDep} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
};
