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
import { titleHasSubject } from "./events-view";
import { depName } from "./stack-view";
import type { IconName } from "./icons";
import { AuthShell, Button, ButtonLink, ErrorPage } from "./ui";

export const alertLinks = new Hono<WebEnv>();

export const MUTE_MS = 90 * DAY;

const QUESTION: Record<LinkAction, (dep: string | null) => string> = {
  useful: () => "Mark this alert as useful?",
  not_relevant: () => "Mark this alert as not relevant?",
  mute: (dep) => `Mute ${dep ?? "this dependency"} for 90 days?`,
  digest_only: () => "Only send you the weekly digest?",
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

// Neutral marks while asking: a check or an x before anything has happened would read as a result.
const ICON: Record<LinkAction, IconName> = { useful: "mail", not_relevant: "mail", mute: "bell-off", digest_only: "mail" };

const Problem = ({ expired }: { expired: boolean }) => (
  <ErrorPage narrow code={400} icon="link" title={expired ? "This link has expired" : "This link doesn't work"} actions={<ButtonLink href="/app">Go to the dashboard</ButtonLink>}>
    <p>{expired ? "Links in alerts work for 30 days." : "It may have been copied incompletely."} You can give feedback and mute dependencies from your dashboard.</p>
  </ErrorPage>
);

alertLinks.get("/a/:token", async (c) => {
  const v = await check(c);
  if (!v) return c.notFound();
  if (!v.ok) return page(c, "Link problem", <Problem expired={v.reason === "expired"} />, { status: 400, noindex: true });
  let what = "";
  let dep: string | null = null;
  if (v.action === "digest_only") {
    const user = await c.get("ctx").db.select().from(users).where(eq(users.id, v.id)).get();
    if (!user) return page(c, "Link problem", <Problem expired={false} />, { status: 400, noindex: true });
    what = "Urgent changes will wait for your weekly digest instead of being emailed as they happen. You can turn this back on in settings.";
  } else {
    const t = await target(c, v.id);
    if (!t) return page(c, "Link problem", <Problem expired={false} />, { status: 400, noindex: true });
    dep = t.dep ? depName(t.dep) : null;
    const until = fmtDate(c.get("ctx").clock.now() + MUTE_MS);
    what = v.action === "mute" ? (dep ? `No alerts about ${dep} until ${until}.` : "That dependency is no longer in your stack.") : dep && !titleHasSubject(dep, t.title) ? `${dep}: ${t.title}` : t.title;
  }
  return page(
    c,
    "Confirm",
    <AuthShell icon={ICON[v.action]} title={QUESTION[v.action](dep)} description={what}>
      <form method="post" action={`/a/${c.req.param("token")}`} class="auth-form">
        <Csrf token={c.get("csrf")} />
        <Button variant="primary" size="lg">
          {BUTTON[v.action]}
        </Button>
      </form>
      <p class="meta auth-fine">Nothing changes until you press the button. Changed your mind? Close this page.</p>
    </AuthShell>,
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
  let detail: string;
  if (v.action === "digest_only") {
    await ctx.db.update(users).set({ emailImmediate: false }).where(eq(users.id, v.id));
    done = "Digest only";
    detail = "You'll get the weekly digest only. You can turn immediate emails back on in settings.";
  } else {
    const t = await target(c, v.id);
    if (!t) return page(c, "Link problem", <Problem expired={false} />, { status: 400, noindex: true });
    if (v.action === "mute") {
      if (!t.dep) return page(c, "Nothing to mute", <AuthShell icon="info" title="Nothing to mute" description="That dependency is no longer in your stack." />, { noindex: true });
      await ctx.db.update(deps).set({ mutedUntil: now + MUTE_MS }).where(eq(deps.id, t.dep.id));
      done = `Muted ${depName(t.dep)}`;
      detail = `No alerts about it until ${fmtDate(now + MUTE_MS)}.`;
    } else {
      await ctx.db.update(alerts).set({ feedback: v.action, feedbackAt: now }).where(eq(alerts.id, t.alert.id));
      done = v.action === "useful" ? "Noted as useful" : "Noted as not relevant";
      detail = v.action === "useful" ? "Thanks. It helps us decide what is worth an email." : "Thanks. We'll use this to send fewer alerts like it.";
    }
  }
  return page(
    c,
    "Done",
    <AuthShell icon="check" done title={done} description={detail}>
      <p class="auth-fine">
        <ButtonLink href="/app" iconEnd="arrow-right" class="auth-alt">
          Go to the dashboard
        </ButtonLink>
      </p>
    </AuthShell>,
    { noindex: true },
  );
});
