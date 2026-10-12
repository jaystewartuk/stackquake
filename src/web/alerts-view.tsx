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
  /** How the alert matched the user's usage; optional so callers that only render a row needn't pass it. */
  match?: "affected" | "unknown" | "not_affected";
}

/** Newest first; only alerts whose event is still published. */
export async function userAlerts(ctx: Ctx, userId: number, opts: { depId?: number; limit: number }): Promise<AlertRow[]> {
  const rows = await ctx.db.all<{
    id: number; event_id: number; dep_id: number; channel: AlertChannel; status: AlertStatus; held: HeldReason | null; because: string; feedback: Feedback | null;
    created_at: number; sent_at: number | null; emailed_at: number | null; slack_at: number | null; title: string; kind: string; match: AlertRow["match"];
    catalog_id: string | null; ecosystem: string | null; package: string | null; eol_product: string | null;
  }>(sql`
    SELECT a.id, a.event_id, a.dep_id, a.channel, a.status, a.held, a.because, a.feedback, a.match, a.created_at, a.sent_at, a.emailed_at, a.slack_at,
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
    match: r.match,
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

/** Compact "Useful? Yes / No"; the pressed state shows the answer already given. */
export const FeedbackButtons: FC<{ a: AlertRow; csrf: string; back: string }> = ({ a, csrf, back }) => (
  <form class="feedback" method="post" action={`/app/alerts/${a.id}/feedback`}>
    <Csrf token={csrf} />
    <input type="hidden" name="back" value={back} />
    <span class="fb-q" aria-hidden="true">
      Useful?
    </span>
    <Button size="sm" variant="quiet" name="value" value="useful" pressed={a.feedback === "useful"} label="Yes, useful">
      Yes
    </Button>
    <Button size="sm" variant="quiet" name="value" value="not_relevant" pressed={a.feedback === "not_relevant"} label="No, not relevant">
      No
    </Button>
  </form>
);

/** Act for an urgent kind that affects the user, watch for the rest (and when the note can't tell), quiet when it didn't affect them (DIRECTION.md). */
export const alertLevel = (a: Pick<AlertRow, "status" | "kind" | "match">): Level => (a.status === "suppressed" || a.match === "not_affected" ? "quiet" : a.match !== "unknown" && URGENT.has(a.kind) ? "act" : "watch");

/** One alert: severity, dependency and kind, the change (links to its note), why it affects you, delivery and feedback. */
export const AlertItem: FC<{ a: AlertRow; csrf: string; back: string; showDep: boolean }> = ({ a, csrf, back, showDep }) => {
  const s = alertState(a);
  const level = alertLevel(a);
  return (
    <li class={`alert-row ${level}`}>
      <Severity level={level} />
      <div class="ar-body">
        <div class="ar-kick">
          {showDep && (
            <a class="ar-dep" href={`/app/deps/${a.depId}`}>
              {a.name}
            </a>
          )}
          <KindPill kind={a.kind} />
        </div>
        <a class="ar-title" href={`/events/${a.eventId}`}>
          {a.title}
        </a>
        <p class="ar-why">{a.status === "suppressed" ? a.because : `Affects you because: ${a.because}`}</p>
        <div class="ar-foot">
          {s.tone === "bad" ? (
            <Badge tone="act" icon="alert-triangle">
              {s.label}
            </Badge>
          ) : (
            <span class="meta">{s.label}</span>
          )}
          {a.status !== "suppressed" && <FeedbackButtons a={a} csrf={csrf} back={back} />}
        </div>
      </div>
    </li>
  );
};

const RANK: Record<Level, number> = { act: 0, watch: 1, quiet: 2 };

/**
 * Alerts that matter first: act before watch, newest first within each. `top` shows only that many
 * and folds the rest under "All alerts"; the ones that didn't affect the user are always folded.
 */
export const AlertList: FC<{ list: AlertRow[]; csrf: string; back: string; showDep?: boolean; top?: number; empty?: boolean }> = ({ list, csrf, back, showDep = true, top, empty = true }) => {
  const main = list.filter((a) => a.status !== "suppressed").sort((x, y) => RANK[alertLevel(x)] - RANK[alertLevel(y)] || y.createdAt - x.createdAt || y.id - x.id);
  const quiet = list.filter((a) => a.status === "suppressed");
  const shown = top ? main.slice(0, top) : main;
  const rest = top ? main.slice(top) : [];
  const item = (a: AlertRow) => <AlertItem a={a} csrf={csrf} back={back} showDep={showDep} />;
  return (
    <>
      {main.length ? (
        <ul class="alert-list">{shown.map(item)}</ul>
      ) : (
        empty && (
          <EmptyState title="No alerts yet" icon="mail" level={3}>
            We'll email you when a change affects you.
          </EmptyState>
        )
      )}
      {rest.length > 0 && (
        <details class="more">
          <summary>
            <span class="num">{rest.length}</span> more alert{rest.length === 1 ? "" : "s"}
          </summary>
          <ul class="alert-list">{rest.map(item)}</ul>
        </details>
      )}
      {quiet.length > 0 && (
        <details class="more">
          <summary>
            {quiet.length} change{quiet.length === 1 ? "" : "s"} we watched that didn't affect you
          </summary>
          <ul class="alert-list">{quiet.map(item)}</ul>
        </details>
      )}
    </>
  );
};
