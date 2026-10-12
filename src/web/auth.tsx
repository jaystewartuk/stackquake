// Sign-in (SPEC §4.1 Auth, §8): email magic links and GitHub OAuth.
// Magic links: 15-minute, single-use tokens, stored as sha256. Opening the link shows a button
// that POSTs the token, so mail scanners that prefetch links cannot use it up.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { magicLinks, users, type User } from "../db/schema";
import { HOUR, MINUTE, safeEqual, sha256Hex } from "../util";
import { Csrf, page } from "./layout";
import { AuthShell, Button, ButtonLink, ErrorPage, Field } from "./ui";
import { appOrigin, clientIp, createSession, endSession, hitRateLimit, randomToken, safeNext, type WebContext, type WebEnv } from "./session";

export const auth = new Hono<WebEnv>();

export const MAGIC_LINK_MS = 15 * MINUTE;
/** Per email and per IP, per hour (SPEC M3 prompt: rate-limit magic-link requests). */
export const EMAIL_LIMIT = 5;
export const IP_LIMIT = 20;

const OAUTH_COOKIE = "sq_oauth";
const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";

export const normaliseEmail = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e);

async function findOrCreateUser(c: WebContext, email: string, extra: { githubId?: number; name?: string | null } = {}): Promise<User> {
  const ctx = c.get("ctx");
  await ctx.db
    .insert(users)
    .values({ email, githubId: extra.githubId ?? null, name: extra.name ?? null, createdAt: ctx.clock.now() })
    .onConflictDoNothing({ target: users.email });
  return (await ctx.db.select().from(users).where(eq(users.email, email)).get())!;
}


const SignInPage = ({ c, email, next, error }: { c: WebContext; email?: string; next: string; error?: string }) => (
  <AuthShell title="Sign in to Stackquake" description="New here? The same link creates your account.">
    <SignInForm c={c} email={email} next={next} error={error} />
  </AuthShell>
);

const SignInForm = ({ c, email, next, error }: { c: WebContext; email?: string; next: string; error?: string }) => (
  <>
    <form method="post" action="/auth/email" class="panel auth-form">
      <Csrf token={c.get("csrf")} />
      <input type="hidden" name="next" value={next} />
      <Field id="email" type="email" label="Email" required autocomplete="email" value={email ?? ""} error={error} hint="We'll email you a link that signs you in. No password." />
      <Button variant="primary" icon="mail" block>
        Email me a sign-in link
      </Button>
    </form>
    {c.env.GITHUB_CLIENT_ID && (
      <>
        <p class="auth-or">
          <span>or</span>
        </p>
        <ButtonLink href={`/auth/github?next=${encodeURIComponent(next)}`} icon="github" class="auth-alt">
          Sign in with GitHub
        </ButtonLink>
      </>
    )}
    <p class="meta auth-fine">
      By signing in you agree to the <a href="/terms">terms</a>. We use your email only for sign-in and alerts (<a href="/privacy">privacy</a>).
    </p>
  </>
);

auth.get("/signin", (c) => {
  if (c.get("user")) return c.redirect("/app");
  const next = safeNext(c.req.query("next"));
  return page(
    c,
    "Sign in",
    <SignInPage c={c} next={next} />,
    { noindex: true, description: "Sign in to Stackquake to see what is changing in your stack." },
  );
});

/** Creates a magic link and emails it. `userId` makes it an email-change confirmation. */
export async function sendMagicLink(c: WebContext, email: string, opts: { userId?: number; next?: string } = {}): Promise<void> {
  const ctx = c.get("ctx");
  const token = randomToken();
  const now = ctx.clock.now();
  await ctx.db.insert(magicLinks).values({ tokenHash: await sha256Hex(token), email, expiresAt: now + MAGIC_LINK_MS, userId: opts.userId ?? null, createdAt: now });
  const link = `${appOrigin(c)}/auth/email/confirm?token=${token}${opts.next && opts.next !== "/app" ? `&next=${encodeURIComponent(opts.next)}` : ""}`;
  await ctx.mailer.send(
    opts.userId
      ? { to: email, subject: "Confirm your new Stackquake email", text: `Confirm this address for your Stackquake account:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for this, ignore this email.` }
      : { to: email, subject: "Sign in to Stackquake", text: `Sign in to Stackquake:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.` },
  );
}

/** Both limits are counted on every request, so one email cannot be used to probe many IPs or vice versa. */
export async function magicLinkAllowed(c: WebContext, email: string): Promise<boolean> {
  const ctx = c.get("ctx");
  const byEmail = await hitRateLimit(ctx, `ml:email:${email}`, EMAIL_LIMIT, HOUR);
  const byIp = await hitRateLimit(ctx, `ml:ip:${clientIp(c)}`, IP_LIMIT, HOUR);
  return byEmail && byIp;
}

auth.post("/auth/email", async (c) => {
  const form = await c.req.parseBody();
  const email = normaliseEmail(form.email);
  const next = safeNext(typeof form.next === "string" ? form.next : null);
  if (!validEmail(email)) {
    return page(c, "Sign in", <SignInPage c={c} email={email} next={next} error="That doesn't look like an email address." />, { status: 400, noindex: true });
  }
  if (!(await magicLinkAllowed(c, email))) {
    return page(c, "Slow down", <ErrorPage narrow code={429} icon="clock" title="Too many sign-in emails" actions={<ButtonLink href="/">Home</ButtonLink>}><p>Too many links were requested for this address or from this network. Try again in an hour.</p></ErrorPage>, { status: 429, noindex: true });
  }
  await sendMagicLink(c, email, { next });
  return page(
    c,
    "Check your email",
    <AuthShell icon="mail" title="Check your email">
      <div class="panel auth-form" role="status">
        <p>
          We sent a sign-in link to <strong class="email">{email}</strong>. It works once and expires in 15 minutes.
        </p>
        <p class="meta">Nothing after a few minutes? Check your spam folder, or <a href={`/signin${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}>ask for another link</a>.</p>
      </div>
    </AuthShell>,
    { noindex: true },
  );
});

const LinkProblem = () => (
  <ErrorPage
    narrow
    code={400}
    icon="clock"
    title="This link has expired or was already used"
    actions={
      <ButtonLink variant="primary" href="/signin" icon="mail">
        Request a new sign-in link
      </ButtonLink>
    }
  >
    <p>Sign-in links work once and expire after 15 minutes, so a link from an older email, or one already opened, can't be used again.</p>
  </ErrorPage>
);

auth.get("/auth/email/confirm", async (c) => {
  const token = c.req.query("token") ?? "";
  const ctx = c.get("ctx");
  const link = token.length <= 128 ? await ctx.db.select().from(magicLinks).where(and(eq(magicLinks.tokenHash, await sha256Hex(token)), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, ctx.clock.now()))).get() : undefined;
  if (!link) return page(c, "Link expired", <LinkProblem />, { status: 400, noindex: true });
  return page(
    c,
    "Confirm",
    <AuthShell title={link.userId ? "Confirm your new email" : "Sign in to Stackquake"}>
      <form method="post" action="/auth/email/confirm" class="panel auth-form">
        <Csrf token={c.get("csrf")} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={safeNext(c.req.query("next"))} />
        <p>
          {link.userId ? "Use" : "Continue as"} <strong>{link.email}</strong>
          {link.userId ? " for your account." : "."}
        </p>
        <Button variant="primary" block>
          {link.userId ? "Confirm email" : "Sign in"}
        </Button>
      </form>
    </AuthShell>,
    { noindex: true },
  );
});

auth.post("/auth/email/confirm", async (c) => {
  const ctx = c.get("ctx");
  const form = await c.req.parseBody();
  const token = typeof form.token === "string" && form.token.length <= 128 ? form.token : "";
  const now = ctx.clock.now();
  // Single use: one UPDATE claims the link, so two concurrent submits cannot both succeed.
  const [link] = await ctx.db
    .update(magicLinks)
    .set({ usedAt: now })
    .where(and(eq(magicLinks.tokenHash, await sha256Hex(token)), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, now)))
    .returning();
  if (!link) return page(c, "Link expired", <LinkProblem />, { status: 400, noindex: true });
  if (link.userId) {
    const taken = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, link.email)).get();
    if (taken && taken.id !== link.userId) return page(c, "Email in use", <ErrorPage code={400} title="That email belongs to another account" actions={<ButtonLink href="/app/settings">Back to settings</ButtonLink>} />, { status: 400, noindex: true });
    await ctx.db.update(users).set({ email: link.email }).where(eq(users.id, link.userId));
    return c.redirect("/app/settings?msg=email");
  }
  const user = await findOrCreateUser(c, link.email);
  await endSession(c);
  await createSession(c, user.id);
  return c.redirect(safeNext(typeof form.next === "string" ? form.next : null));
});

auth.post("/signout", async (c) => {
  await endSession(c);
  return c.redirect("/");
});

// ---------- GitHub OAuth ----------

auth.get("/auth/github", (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return page(c, "Not available", <ErrorPage narrow code={503} icon="github" title="GitHub sign-in is not configured" actions={<ButtonLink variant="primary" href="/signin" icon="mail">Use an email link instead</ButtonLink>} />, { status: 503, noindex: true });
  const state = randomToken(16);
  const next = safeNext(c.req.query("next"));
  setCookie(c, OAUTH_COOKIE, `${state}|${next}`, { httpOnly: true, secure: true, sameSite: "Lax", path: "/auth/github", maxAge: 600 });
  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${appOrigin(c)}/auth/github/callback`);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return c.redirect(url.toString());
});

const OAuthProblem = ({ why }: { why: string }) => (
  <ErrorPage
    narrow
    code={400}
    icon="github"
    title="GitHub sign-in didn't work"
    actions={
      <ButtonLink variant="primary" href="/signin">
        Try again
      </ButtonLink>
    }
  >
    <p>{why}</p>
    <p>Try again, or use an email link.</p>
  </ErrorPage>
);

auth.get("/auth/github/callback", async (c) => {
  const ctx = c.get("ctx");
  const [state, next] = (getCookie(c, OAUTH_COOKIE) ?? "").split("|");
  deleteCookie(c, OAUTH_COOKIE, { path: "/auth/github", secure: true });
  const code = c.req.query("code");
  if (!state || !code || !safeEqual(state, c.req.query("state") ?? "") || !c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
    return page(c, "Sign-in failed", <OAuthProblem why="The sign-in request expired or did not come from this site." />, { status: 400, noindex: true });
  }
  const headers = { accept: "application/json", "user-agent": ctx.config.userAgent };
  const tokenRes = await ctx.http(
    new Request(GITHUB_TOKEN, {
      method: "POST",
      headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${appOrigin(c)}/auth/github/callback` }),
    }),
  );
  const tokenBody = tokenRes.ok ? await tokenRes.json<{ access_token?: string }>() : {};
  if (!tokenBody.access_token) return page(c, "Sign-in failed", <OAuthProblem why="GitHub did not accept the sign-in code." />, { status: 400, noindex: true });
  const api = (path: string) => ctx.http(new Request(`${ctx.config.githubApi}${path}`, { headers: { ...headers, accept: "application/vnd.github+json", authorization: `Bearer ${tokenBody.access_token}` } }));
  const [userRes, emailsRes] = await Promise.all([api("/user"), api("/user/emails")]);
  if (!userRes.ok || !emailsRes.ok) return page(c, "Sign-in failed", <OAuthProblem why="Could not read your GitHub profile." />, { status: 400, noindex: true });
  const gh = await userRes.json<{ id: number; login: string; name: string | null }>();
  const emails = await emailsRes.json<{ email: string; primary: boolean; verified: boolean }[]>();
  // GitHub's noreply addresses are verified but receive no mail, so they cannot carry alerts.
  const verified = emails.filter((e) => e.verified && !/@users\.noreply\.github\.com$/i.test(e.email));
  const email = normaliseEmail((verified.find((e) => e.primary) ?? verified[0])?.email);
  if (!email) return page(c, "Sign-in failed", <OAuthProblem why="Your GitHub account has no verified email address." />, { status: 400, noindex: true });

  let user = await ctx.db.select().from(users).where(eq(users.githubId, gh.id)).get();
  if (!user) {
    // A verified GitHub email links to the existing account with that email.
    user = await findOrCreateUser(c, email, { githubId: gh.id, name: gh.name ?? gh.login });
    if (user.githubId === null) {
      await ctx.db.update(users).set({ githubId: gh.id, name: sql`coalesce(${users.name}, ${gh.name ?? gh.login})` }).where(eq(users.id, user.id));
    } else if (user.githubId !== gh.id) {
      return page(c, "Sign-in failed", <OAuthProblem why="That email is already linked to a different GitHub account." />, { status: 400, noindex: true });
    }
  }
  await endSession(c);
  await createSession(c, user.id);
  return c.redirect(safeNext(next));
});
