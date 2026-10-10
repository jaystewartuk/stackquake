// One-click links from alert emails and Slack (SPEC §7.5, §8): /a/{signed token}. GET shows what
// the link will do with a confirm button; only the POST changes anything, because mail scanners
// and Slack's unfurler fetch links. No sign-in needed: the signature is the authorisation.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { alerts, deps, events, users } from "../db/schema";
import { DAY } from "../util";
import { verifyLink, type LinkAction } from "../alerts/links";
import { Csrf, fmtDate, page } from "./layout";
import type { WebContext, WebEnv } from "./session";
import { depName } from "./stack-view";

export const alertLinks = new Hono<WebEnv>();

export const MUTE_MS = 90 * DAY;

const QUESTION: Record<LinkAction, string> = {
  useful: "Mark this alert as useful?",
  not_relevant: "Mark this alert as not relevant?",
  mute: "Mute this dependency for 90 days?",
  digest_only: "Only send you the weekly digest?",
};

const BUTTON: Record<LinkAction, string> = { useful: "Yes, it was useful", not_relevant: "Yes, not relevant", mute: "Mute for 90 days", digest_only: "Digest only" };

async function check(c: WebContext) {
  const ctx = c.get("ctx");
  const secret = ctx.config.linkSecret;
  if (!secret) return null;
  return verifyLink(secret, c.req.param("token") ?? "", ctx.clock.now());
}

/** The alert behind a per-alert link, with its event title and dep. */
async function target(c: WebContext, id: number) {
  const ctx = c.get("ctx");
  const row = await ctx.db.select({ alert: alerts, title: events.title }).from(alerts).innerJoin(events, eq(events.id, alerts.eventId)).where(eq(alerts.id, id)).get();
  if (!row) return null;
  const dep = await ctx.db.select().from(deps).where(eq(deps.id, row.alert.depId)).get();
  return { ...row, dep };
}

const Problem = ({ expired }: { expired: boolean }) => (
  <>
    <h1>{expired ? "This link has expired" : "This link doesn't work"}</h1>
    <p>{expired ? "Links in alerts work for 30 days." : "It may have been copied incompletely."} You can give feedback and mute dependencies from your dashboard.</p>
    <p>
      <a class="btn" href="/app">
        Go to the dashboard
      </a>
    </p>
  </>
);

alertLinks.get("/a/:token", async (c) => {
  const v = await check(c);
  if (!v) return c.notFound();
  if (!v.ok) return page(c, "Link problem", <Problem expired={v.reason === "expired"} />, { status: 400, noindex: true });
  let what = "";
  if (v.action === "digest_only") {
    const user = await c.get("ctx").db.select().from(users).where(eq(users.id, v.id)).get();
    if (!user) return page(c, "Link problem", <Problem expired={false} />, { status: 400, noindex: true });
    what = "Urgent changes will wait for your weekly digest instead of being emailed as they happen. You can turn this back on in settings.";
  } else {
    const t = await target(c, v.id);
    if (!t) return page(c, "Link problem", <Problem expired={false} />, { status: 400, noindex: true });
    what = v.action === "mute" ? (t.dep ? `${depName(t.dep)}: no alerts about it for 90 days.` : "That dependency is no longer in your stack.") : t.title;
  }
  return page(
    c,
    "Confirm",
    <>
      <h1>{QUESTION[v.action]}</h1>
      <p>{what}</p>
      <form method="post" action={`/a/${c.req.param("token")}`} class="card">
        <Csrf token={c.get("csrf")} />
        <button class="primary" type="submit">
          {BUTTON[v.action]}
        </button>
      </form>
    </>,
    { noindex: true },
  );
});

alertLinks.post("/a/:token", async (c) => {
  const v = await check(c);
  if (!v) return c.notFound();
  if (!v.ok) return page(c, "Link problem", <Problem expired={v.reason === "expired"} />, { status: 400, noindex: true });
  const ctx = c.get("ctx");
  const now = ctx.clock.now();
  let done: string;
  if (v.action === "digest_only") {
    await ctx.db.update(users).set({ emailImmediate: false }).where(eq(users.id, v.id));
    done = "Done. You'll get the weekly digest only.";
  } else {
    const t = await target(c, v.id);
    if (!t) return page(c, "Link problem", <Problem expired={false} />, { status: 400, noindex: true });
    if (v.action === "mute") {
      if (!t.dep) return page(c, "Nothing to mute", <><h1>Nothing to mute</h1><p>That dependency is no longer in your stack.</p></>, { noindex: true });
      await ctx.db.update(deps).set({ mutedUntil: now + MUTE_MS }).where(eq(deps.id, t.dep.id));
      done = `Muted ${depName(t.dep)} until ${fmtDate(now + MUTE_MS)}.`;
    } else {
      await ctx.db.update(alerts).set({ feedback: v.action, feedbackAt: now }).where(eq(alerts.id, t.alert.id));
      done = v.action === "useful" ? "Thanks, noted as useful." : "Thanks. We'll use this to send fewer alerts like it.";
    }
  }
  return page(
    c,
    "Done",
    <>
      <h1>{done}</h1>
      <p>
        <a href="/app">Go to the dashboard</a>
      </p>
    </>,
    { noindex: true },
  );
});
