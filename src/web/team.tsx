// Team members (SPEC §10: "up to 10 members"). As small as the plan needs: the owner invites by
// email; the invitee signs in with that address and accepts on this page (signing in proves the
// address, so the invite needs no token). Members share the owner's projects and get alerts for
// them. One team per member. Removing a member or leaving takes effect at once.
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { accountOf, TEAM_SIZE } from "../billing/plans";
import { teamMembers, users } from "../db/schema";
import { normaliseEmail, validEmail } from "./auth";
import { Csrf, fmtDate, page } from "./layout";
import { appOrigin, hitRateLimit, requireUser, type WebContext, type WebEnv } from "./session";
import { DAY } from "../util";

export const team = new Hono<WebEnv>();
team.use("*", requireUser);

const INVITES_PER_DAY = 20;

const MESSAGES: Record<string, string> = {
  invited: "Invite sent.",
  removed: "Removed from the team.",
  joined: "You've joined the team. Its projects are on your dashboard.",
  declined: "Invite declined.",
  left: "You've left the team.",
};

const idParam = (c: WebContext) => {
  const n = Number(c.req.param("id"));
  return Number.isSafeInteger(n) && n > 0 ? n : -1;
};

function problem(c: WebContext, msg: string, status: 400 | 403 | 429 = 400) {
  return page(c, "Team", <><h1>Team</h1><p class="flash error">{msg}</p><p><a href="/app/team">Back</a></p></>, { status, noindex: true });
}

team.get("/", async (c) => {
  const ctx = c.get("ctx");
  const user = c.get("user")!;
  const account = await accountOf(ctx, user);
  const msg = MESSAGES[c.req.query("msg") ?? ""];
  const members = await ctx.db.select().from(teamMembers).where(eq(teamMembers.ownerId, user.id)).orderBy(asc(teamMembers.id)).all();
  const invites = await ctx.db
    .select({ id: teamMembers.id, owner: users.email, invitedAt: teamMembers.invitedAt })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.ownerId))
    .where(and(eq(teamMembers.email, user.email.toLowerCase()), isNull(teamMembers.userId), eq(users.plan, "team")))
    .all();
  const csrf = c.get("csrf");
  return page(
    c,
    "Team",
    <>
      <h1>Team</h1>
      {msg && <p class="flash">{msg}</p>}
      {invites.length > 0 && account.role !== "member" && (
        <section class="card">
          <h2 style="margin-top:0">Invites</h2>
          {invites.map((i) => (
            <div class="row" style="margin:.4rem 0">
              <span>
                <strong>{i.owner}</strong> invited you on {fmtDate(i.invitedAt)}.
              </span>
              <form method="post" action={`/app/team/${i.id}/accept`} class="inline">
                <Csrf token={csrf} />
                <button class="primary" type="submit">
                  Join
                </button>
              </form>
              <form method="post" action={`/app/team/${i.id}/decline`} class="inline">
                <Csrf token={csrf} />
                <button type="submit">Decline</button>
              </form>
            </div>
          ))}
          <p class="meta">Members see and edit the team's projects and get its alerts. Your own projects stay yours.</p>
        </section>
      )}
      {account.role === "member" ? (
        <section class="card">
          <p>
            You're on <strong>{account.ownerEmail}</strong>'s team. Its projects are on your <a href="/app">dashboard</a>, and you get alerts for them.
          </p>
          <form method="post" action="/app/team/leave">
            <Csrf token={csrf} />
            <button class="danger" type="submit">
              Leave the team
            </button>
          </form>
        </section>
      ) : account.plan === "team" ? (
        <>
          <p class="muted">
            Up to {TEAM_SIZE} people, you included. Members see and edit your projects, add new ones to the team, and get alerts by email (and their own Slack, if they connect one).
          </p>
          <ul class="plain card">
            <li>
              {user.email} <span class="pill">owner</span>
            </li>
            {members.map((m) => (
              <li class="spread">
                <span>
                  {m.email} {m.joinedAt ? <span class="meta">joined {fmtDate(m.joinedAt)}</span> : <span class="pill warn">invited {fmtDate(m.invitedAt)}</span>}
                </span>
                <form method="post" action={`/app/team/${m.id}/remove`} class="inline">
                  <Csrf token={csrf} />
                  <button class="link" type="submit">
                    {m.joinedAt ? "Remove" : "Cancel invite"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {members.length + 1 < TEAM_SIZE ? (
            <form method="post" action="/app/team/invite" class="card">
              <Csrf token={csrf} />
              <label for="email">Invite by email</label>
              <div class="row">
                <input type="email" id="email" name="email" required autocomplete="off" style="flex:1;min-width:14rem" />
                <button type="submit">Send invite</button>
              </div>
              <p class="meta">They sign in to Stackquake with this address (email link or GitHub) and accept on this page.</p>
            </form>
          ) : (
            <p class="meta">The team is full ({TEAM_SIZE} people).</p>
          )}
        </>
      ) : (
        <section class="card">
          <p>Teams are part of the Team plan: up to {TEAM_SIZE} people sharing projects and alerts, plus private repos, Slack and a CSV export of vendor risk.</p>
          <p>
            <a class="btn primary" href="/pricing">
              See plans
            </a>
          </p>
          {members.length > 0 && <p class="meta">Your team's {members.length} member rows are kept, inactive, until you're on Team again.</p>}
        </section>
      )}
    </>,
    { noindex: true },
  );
});

team.post("/invite", async (c) => {
  const ctx = c.get("ctx");
  const user = c.get("user")!;
  const account = await accountOf(ctx, user);
  if (account.role !== "owner") return problem(c, "Inviting people needs the Team plan, on your own account.", 403);
  const form = await c.req.parseBody();
  const email = normaliseEmail(form.email);
  if (!validEmail(email)) return problem(c, "That doesn't look like an email address.");
  if (email === user.email.toLowerCase()) return problem(c, "That's you.");
  const [{ n }] = await ctx.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM team_members WHERE owner_id = ${user.id}`);
  if (n + 1 >= TEAM_SIZE) return problem(c, `A team has at most ${TEAM_SIZE} people.`);
  if (!(await hitRateLimit(ctx, `invite:${user.id}`, INVITES_PER_DAY, DAY))) return problem(c, "Too many invites today. Try again tomorrow.", 429);
  const rows = await ctx.db.insert(teamMembers).values({ ownerId: user.id, email, invitedAt: ctx.clock.now() }).onConflictDoNothing().returning();
  if (!rows.length) return problem(c, "That address is already on the team or invited.");
  const link = `${appOrigin(c)}/app/team`;
  await ctx.mailer.send({
    to: email,
    subject: `${user.email} invited you to their Stackquake team`,
    text: `${user.email} invited you to their team on Stackquake, which watches the services and packages a stack depends on for pricing, licence and end-of-life changes.\n\nSign in with this address (${email}) and accept the invite here:\n\n${link}\n\nIf you don't want to join, ignore this email.`,
  });
  return c.redirect("/app/team?msg=invited");
});

team.post("/:id/remove", async (c) => {
  await c.get("ctx").db.delete(teamMembers).where(and(eq(teamMembers.id, idParam(c)), eq(teamMembers.ownerId, c.get("user")!.id)));
  return c.redirect("/app/team?msg=removed");
});

team.post("/:id/accept", async (c) => {
  const ctx = c.get("ctx");
  const user = c.get("user")!;
  const invite = await ctx.db
    .select({ id: teamMembers.id, ownerPlan: users.plan })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.ownerId))
    .where(and(eq(teamMembers.id, idParam(c)), eq(teamMembers.email, user.email.toLowerCase()), isNull(teamMembers.userId)))
    .get();
  if (!invite || invite.ownerPlan !== "team") return problem(c, "That invite isn't open any more.");
  if (await ctx.db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.userId, user.id), isNotNull(teamMembers.joinedAt))).get()) return problem(c, "You're already on a team. Leave it first.");
  if (user.plan === "team") return problem(c, "You have your own Team subscription. Cancel it from Settings first, or invite them to your team instead.");
  if (await ctx.db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.ownerId, user.id)).get()) return problem(c, "You have members on your own team. Remove them first.");
  await ctx.db.update(teamMembers).set({ userId: user.id, joinedAt: ctx.clock.now() }).where(and(eq(teamMembers.id, invite.id), isNull(teamMembers.userId)));
  return c.redirect("/app/team?msg=joined");
});

team.post("/:id/decline", async (c) => {
  const user = c.get("user")!;
  await c.get("ctx").db.delete(teamMembers).where(and(eq(teamMembers.id, idParam(c)), eq(teamMembers.email, user.email.toLowerCase()), isNull(teamMembers.userId)));
  return c.redirect("/app/team?msg=declined");
});

team.post("/leave", async (c) => {
  await c.get("ctx").db.delete(teamMembers).where(eq(teamMembers.userId, c.get("user")!.id));
  return c.redirect("/app/team?msg=left");
});
