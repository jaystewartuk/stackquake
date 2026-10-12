// Private repos through the GitHub App (M5, SPEC §7.1). "Import a private repo" runs the app's
// OAuth flow (instant once authorised) to learn which installations and repos *this user* can
// see, lists them, and creates the project from the one picked. The user's token is used for
// that one request and never stored; imports then use the installation token (src/github/app.ts).
// GitHub App settings: callback URL /app/github/callback; setup URL /app/github/connect
// ("redirect on update" on), so a fresh install comes straight back here.
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { projects } from "../db/schema";
import { ghApiHeaders, rememberInstallation } from "../github/app";
import { startImport } from "../stack/import";
import { HOUR, safeEqual, utf8 } from "../util";
import { problemPage, upgradePage } from "./app-ui";
import { Icon } from "./icons";
import { Csrf, page } from "./layout";
import { AuthShell, Button, ButtonLink, EmptyState, Field, PageHeader } from "./ui";
import { appOrigin, getAccount, randomToken, requireUser, type WebContext, type WebEnv } from "./session";

export const github = new Hono<WebEnv>();
github.use("*", requireUser);
// Private repos are a Team feature (SPEC §10).
github.use("*", async (c, next) => {
  if (c.get("ctx").config.githubApp && (await getAccount(c)).plan !== "team")
    return upgradePage(c, {
      title: "Team plan",
      heading: "Private repos are on the Team plan",
      body: <p>Importing private repos through our GitHub App, with re-import on every push that changes a manifest, is part of Team. Public repos and the service picker work on Free.</p>,
      back: { href: "/app/projects/new", label: "Import a public repo instead" },
    });
  await next();
});

const STATE_COOKIE = "sq_ghapp";
const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
/** Installations and repos listed per installation (MVP: one page of each). */
const MAX_INSTALLATIONS = 5;
const MAX_REPOS = 100;
/** A listed repo can be picked for this long. */
const CHOICE_MS = HOUR;

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function mac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(`repo-choice:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, utf8(data)));
}

/** A repo the user was shown, bound to them, so the form cannot name another installation's repo. */
export async function signChoice(secret: string, userId: number, installationId: number, repo: string, now: number): Promise<string> {
  const body = `${installationId}:${repo}:${userId}:${Math.floor((now + CHOICE_MS) / 1000).toString(36)}`;
  return `${body}:${await mac(secret, body)}`;
}

export async function verifyChoice(secret: string, userId: number, value: string, now: number): Promise<{ installationId: number; repo: string } | null> {
  const m = /^(\d{1,15}):([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}):(\d{1,15}):([0-9a-z]{1,10}):([\w-]{43})$/.exec(value);
  if (!m || Number(m[3]) !== userId) return null;
  if (!safeEqual(m[5], await mac(secret, `${m[1]}:${m[2]}:${m[3]}:${m[4]}`))) return null;
  if (parseInt(m[4], 36) * 1000 < now) return null;
  return { installationId: Number(m[1]), repo: m[2] };
}

const notConfigured = (c: WebContext) =>
  problemPage(c, { title: "Not available", status: 404, heading: "Private repos aren't available here", body: <p>The GitHub App is not configured on this server.</p>, back: { href: "/app/projects/new", label: "Pick services or import a public repo" } });

const problem = (c: WebContext, status: 400 | 503, why: string) =>
  problemPage(c, {
    title: "GitHub",
    status,
    heading: "Couldn't list your GitHub repos",
    body: <p>{why}</p>,
    extra: (
      <ButtonLink variant="primary" href="/app/github/connect" icon="github">
        Try again
      </ButtonLink>
    ),
    back: { href: "/app/projects/new", label: "Back" },
  });

github.get("/connect", (c) => {
  const app = c.get("ctx").config.githubApp;
  if (!app) return notConfigured(c);
  const state = randomToken(16);
  const project = /^\d{1,15}$/.test(c.req.query("project") ?? "") ? c.req.query("project")! : "";
  setCookie(c, STATE_COOKIE, `${state}|${project}`, { httpOnly: true, secure: true, sameSite: "Lax", path: "/app/github", maxAge: 600 });
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", `${appOrigin(c)}/app/github/callback`);
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

interface Installation {
  id: number;
  account: { login: string; type?: string };
  repository_selection?: string;
}
interface Repo {
  full_name: string;
  private: boolean;
}

github.get("/callback", async (c) => {
  const ctx = c.get("ctx");
  const app = ctx.config.githubApp;
  if (!app) return notConfigured(c);
  const [state, project] = (getCookie(c, STATE_COOKIE) ?? "").split("|");
  const code = c.req.query("code");
  if (!state || !code || !safeEqual(state, c.req.query("state") ?? "")) {
    // Straight back from installing the app (no state of ours): start the flow properly.
    if (c.req.query("installation_id") || c.req.query("setup_action")) return c.redirect("/app/github/connect");
    return problem(c, 400, "The request expired or did not come from this site.");
  }
  deleteCookie(c, STATE_COOKIE, { path: "/app/github", secure: true });
  const tokenRes = await ctx.http(
    new Request(TOKEN, {
      method: "POST",
      headers: { accept: "application/json", "user-agent": ctx.config.userAgent, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: `${appOrigin(c)}/app/github/callback` }),
    }),
  );
  const userToken = tokenRes.ok ? (await tokenRes.json<{ access_token?: string }>()).access_token : undefined;
  if (!userToken) return problem(c, 400, "GitHub did not accept the authorisation code.");
  const api = (path: string) => ctx.http(new Request(`${ctx.config.githubApi}${path}`, { headers: ghApiHeaders(ctx, userToken) }));

  const instRes = await api("/user/installations?per_page=100");
  if (!instRes.ok) return problem(c, 503, "Could not read your GitHub App installations.");
  const installations = (await instRes.json<{ installations: Installation[] }>()).installations.slice(0, MAX_INSTALLATIONS);
  const installUrl = `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`;
  if (!installations.length) {
    return page(
      c,
      "Install the GitHub App",
      <AuthShell icon="github" title="Install the Stackquake GitHub App" description="To import a private repo, install the app on your account or organisation and choose which repositories it may read.">
        <ul class="plan-features">
          <li>
            <Icon name="check" />
            <span>Read-only access to contents and metadata</span>
          </li>
          <li>
            <Icon name="check" />
            <span>Told about pushes, so we re-import when a manifest changes</span>
          </li>
        </ul>
        <ButtonLink variant="primary" href={installUrl} icon="github" class="auth-alt">
          Install on GitHub
        </ButtonLink>
        <p class="meta auth-fine">
          <a href="/app/projects/new">Import a public repo instead</a>
        </p>
      </AuthShell>,
      { noindex: true },
    );
  }
  const lists = await Promise.all(
    installations.map(async (inst) => {
      await rememberInstallation(ctx, inst.id, inst.account.login);
      const r = await api(`/user/installations/${inst.id}/repositories?per_page=${MAX_REPOS}`);
      const repos = r.ok ? (await r.json<{ repositories: Repo[] }>()).repositories : [];
      return { inst, repos };
    }),
  );
  const now = ctx.clock.now();
  const userId = c.get("user")!.id;
  const options = await Promise.all(
    lists.flatMap(({ inst, repos }) => repos.map(async (r) => ({ repo: r, account: inst.account.login, value: await signChoice(app.clientSecret, userId, inst.id, r.full_name, now) }))),
  );
  return page(
    c,
    "Pick a repo",
    <>
      <PageHeader crumbs={[{ href: "/app", label: "Dashboard" }]} title="Import a repo through the GitHub App" description="Pick the repository this project runs from. We read its manifests with the app's read-only access." />
      {options.length ? (
        <form method="post" action="/app/github/import" class="panel narrow-form">
          <Csrf token={c.get("csrf")} />
          {project && <input type="hidden" name="project" value={project} />}
          {!project && <Field id="name" label="Project name" value="My stack" required maxlength={80} />}
          <fieldset>
            <legend>Repository</legend>
            <div class="repo-choices">
              {options.map((o, i) => (
                <label class="pick">
                  <input type="radio" name="choice" value={o.value} required checked={i === 0} />
                  <span>
                    <span class="pick-name">{o.repo.full_name}</span>
                    {o.repo.private && <span class="meta"> · private</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button variant="primary" icon="github">
            Import
          </Button>
        </form>
      ) : (
        <EmptyState title="No repositories to show" icon="github">
          The app is installed, but it can't see any repositories you have access to.
        </EmptyState>
      )}
      <p class="meta">
        Missing a repo? <a href={installUrl}>Change which repositories the app can read</a>.
      </p>
    </>,
    { noindex: true },
  );
});

github.post("/import", async (c) => {
  const ctx = c.get("ctx");
  const app = ctx.config.githubApp;
  if (!app) return notConfigured(c);
  const form = await c.req.parseBody();
  const userId = c.get("user")!.id;
  const choice = typeof form.choice === "string" ? await verifyChoice(app.clientSecret, userId, form.choice, ctx.clock.now()) : null;
  if (!choice) return problem(c, 400, "That choice expired. List your repos again.");
  let projectId: number;
  const existing = typeof form.project === "string" && /^\d{1,15}$/.test(form.project) ? Number(form.project) : null;
  if (existing) {
    const own = await ctx.db.select().from(projects).where(and(eq(projects.id, existing), inArray(projects.userId, (await getAccount(c)).projectOwners))).get();
    if (!own) return c.notFound();
    projectId = own.id;
  } else {
    const name = typeof form.name === "string" ? form.name.trim().slice(0, 80) || "My stack" : "My stack";
    const [row] = await ctx.db.insert(projects).values({ userId: (await getAccount(c)).ownerId, name, createdAt: ctx.clock.now() }).returning();
    projectId = row.id;
  }
  await startImport(ctx, projectId, choice.repo, choice.installationId);
  return c.redirect(`/app/projects/${projectId}/import`);
});
