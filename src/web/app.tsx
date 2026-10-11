// Signed-in pages (SPEC §7.6): dashboard, projects, the service picker (the first onboarding
// step, SPEC §2 Positioning), repo import, usage profiles, deps and settings. Every project and
// dep is loaded through ownProject/ownDep, which scope by the signed-in user: another user's ids
// are a 404.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { canCreateProject, FREE_PROJECTS, PRICES } from "../billing/plans";
import { cancelSubscriptionNow } from "../billing/stripe";
import { CATALOG } from "../catalog/entries";
import { encrypt } from "../alerts/secretbox";
import { postSlack, validSlackWebhook } from "../alerts/slack";
import { alerts, catalogRequests, channels, deps, FEEDBACK, imports, jobs, magicLinks, projects, sessions, sources, teamMembers, users, type Dep, type Feedback, type Profile, type Project } from "../db/schema";
import { addCatalogDeps, deleteDeps } from "../stack/deps";
import { importJobKey, kickImport, latestImport, parseRepoInput, startImport, type ImportState } from "../stack/import";
import { describeProfile, DIMENSIONS, effectiveProfile, profileFromForm, QUESTIONS, questionsFor, type Dimension } from "../stack/profile";
import { MUTE_MS } from "./alert-links";
import { AlertList, userAlerts } from "./alerts-view";
import { magicLinkAllowed, normaliseEmail, sendMagicLink, validEmail } from "./auth";
import { catalogEntry, exactMatch, groupByCategory, searchCatalog, searchText } from "./catalog-view";
import { EventRow, publishedEvents } from "./events-view";
import { Csrf, fmtDate, page, safeHref } from "./layout";
import { endSession, getAccount, requireUser, type WebContext, type WebEnv } from "./session";
import { depLevel, depName, loadDeps, projectDeps, RECENT_MS, riskOf, RISK_LABELS, StackView, tracePoints, WATCHED_ECOSYSTEMS } from "./stack-view";
import { Badge, Button, ButtonLink, Callout, Choice, DataList, DataTable, EmptyState, Field, Flash, InputGroup, PageHeader, Panel, PickTile, StatusLine, StickyBar, Trace } from "./ui";

export const app = new Hono<WebEnv>();
app.use("*", requireUser);

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const uid = (c: WebContext) => c.get("user")!.id;
const idParam = (c: WebContext) => {
  const n = Number(c.req.param("id"));
  return Number.isSafeInteger(n) && n > 0 ? n : -1;
};
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Projects the user can see: their own, plus their team owner's (src/billing/plans.ts). */
const visible = async (c: WebContext) => inArray(projects.userId, (await getAccount(c)).projectOwners);

async function ownProject(c: WebContext): Promise<Project | undefined> {
  return c.get("ctx").db.select().from(projects).where(and(eq(projects.id, idParam(c)), await visible(c))).get();
}

async function ownDep(c: WebContext): Promise<{ dep: Dep; project: Project } | undefined> {
  const row = await c
    .get("ctx")
    .db.select({ dep: deps, project: projects })
    .from(deps)
    .innerJoin(projects, eq(projects.id, deps.projectId))
    .where(and(eq(deps.id, idParam(c)), await visible(c)))
    .get();
  return row ?? undefined;
}


const MESSAGES: Record<string, string> = {
  saved: "Saved.",
  profiles: "Usage saved. Changes are matched against these answers.",
  email: "Email updated.",
  emailsent: "Check the new address for a confirmation link.",
  requested: "Thanks, we've noted the request. We add catalog entries by hand.",
  muted: "Muted for 90 days.",
  unmuted: "Alerts are back on.",
  removed: "Removed.",
  feedback: "Thanks for the feedback.",
  slack: "Slack connected. We posted a test message to the channel.",
  slackremoved: "Slack disconnected.",
  subscribed: "You're already on Team.",
};
const flash = (c: WebContext) => MESSAGES[c.req.query("msg") ?? ""];

// ---------- Dashboard ----------

app.get("/", async (c) => {
  const ctx = c.get("ctx");
  const account = await getAccount(c);
  const list = await ctx.db.select().from(projects).where(await visible(c)).orderBy(asc(projects.id)).all();
  if (!list.length) return c.redirect("/app/projects/new");
  // On Free only the oldest project alerts (src/billing/plans.ts); say so when there are more.
  const quiet = account.plan === "free" ? list.filter((p) => p.userId === uid(c)).slice(FREE_PROJECTS) : [];
  const byProject = await loadDeps(ctx, list);
  const recent = await userAlerts(ctx, uid(c), { limit: 30 });
  const now = ctx.clock.now();
  const allDeps = [...byProject.values()].flat();
  const levels = { act: 0, watch: 0, quiet: 0 };
  for (const v of allDeps) levels[depLevel(v, now)]++;
  const trace = tracePoints(allDeps, now);
  return page(
    c,
    "Dashboard",
    <>
      <PageHeader
        title="Your stack"
        actions={
          <>
            {account.plan === "team" && (
              <ButtonLink href="/app/export.csv" icon="download">
                Export CSV
              </ButtonLink>
            )}
            <ButtonLink href="/app/projects/new" icon="plus">
              New project
            </ButtonLink>
          </>
        }
      />
      <Flash msg={flash(c)} />
      {quiet.length > 0 && (
        <Callout>
          The Free plan alerts on one project, your oldest. {quiet.map((p) => p.name).join(", ")} {quiet.length === 1 ? "is" : "are"} shown but quiet. <a href="/pricing">Team</a> alerts on every project.
        </Callout>
      )}
      <Panel label="Status">
        <StatusLine act={levels.act} watch={levels.watch} quiet={levels.quiet} />
        <Trace points={trace} from={now - RECENT_MS} to={now} label={`${trace.length} change${trace.length === 1 ? "" : "s"} to your dependencies in the last 90 days`} axis={["90 days ago", "today"]} />
      </Panel>
      {recent.length > 0 && (
        <Panel title="Alerts">
          <AlertList list={recent} csrf={c.get("csrf")} back="/app" />
        </Panel>
      )}
      {list.map((p) => {
        const ds = byProject.get(p.id)!;
        return (
          <Panel
            title={<a href={`/app/projects/${p.id}`}>{p.name}</a>}
            meta={
              <>
                <span class="num">{ds.length}</span> watched{p.repoFullName ? ` · ${p.repoFullName}` : ""}
                {p.userId !== uid(c) ? " · team" : ""}
              </>
            }
          >
            {ds.length ? (
              <StackView list={ds} now={now} />
            ) : (
              <EmptyState title="Nothing here yet" level={3} actions={<ButtonLink variant="primary" href={`/app/projects/${p.id}/services`}>Pick what you run on</ButtonLink>}>
                Tick the services, runtimes and tools this project uses.
              </EmptyState>
            )}
          </Panel>
        );
      })}
    </>,
    { noindex: true },
  );
});

// ---------- Projects ----------

const ProfileFields: FC<{ profile: Profile; dims?: Dimension[]; prefix?: string; defaults?: Profile }> = ({ profile, dims = DIMENSIONS, prefix = "", defaults }) => (
  <>
    {dims.map((d) => {
      const q = QUESTIONS[d];
      const def = defaults?.[d] ? q.options.find((o) => o.value === defaults[d])?.label : null;
      return (
        <Choice
          legend={q.label}
          name={`${prefix}${d}`}
          options={[
            ...q.options.map((o) => ({ value: o.value, label: o.label, checked: profile[d] === o.value })),
            { value: "", label: defaults ? (def ? `Project default (${def.toLowerCase()})` : "Not sure") : "Not sure / it varies", checked: !profile[d] },
          ]}
        />
      );
    })}
  </>
);

const UpgradeForProjects: FC = () => (
  <>
    <h1>One project on the Free plan</h1>
    <p>
      The Free plan watches one project. Add services to it, or move to <a href="/pricing">Team</a> (${PRICES.month}/month) for unlimited projects, private repos, Slack and up to 10 people.
    </p>
    <p class="row">
      <a class="btn primary" href="/pricing">
        See plans
      </a>
      <a class="btn" href="/app">
        Back to the dashboard
      </a>
    </p>
  </>
);

app.get("/projects/new", async (c) => {
  const ctx = c.get("ctx");
  const account = await getAccount(c);
  if (!(await canCreateProject(ctx, account))) return page(c, "New project", <UpgradeForProjects />, { noindex: true });
  return page(
    c,
    "New project",
    <>
      <PageHeader title="What do you run on?" description="Start a project, then pick the services, runtimes and tools it uses. Have a public repo? Paste it and we'll pre-fill the list." />
      <form method="post" action="/app/projects" class="panel">
        <Csrf token={c.get("csrf")} />
        <Field id="name" label="Project name" value="My stack" required maxlength={80} />
        <details>
          <summary>Defaults for every dependency (optional)</summary>
          <p class="meta">Used when you don't answer for a dependency. Unknown means we assume a change affects you.</p>
          <ProfileFields profile={{}} />
        </details>
        <p class="row" style="margin-top:1rem">
          <Button variant="primary" name="next" value="pick" iconEnd="arrow-right">
            Pick services
          </Button>
        </p>
        <label for="repo">Or import a public GitHub repo</label>
        <InputGroup>
          <input type="url" id="repo" name="repo" placeholder="https://github.com/owner/repo" inputmode="url" />
          <Button name="next" value="import" icon="github">
            Import
          </Button>
        </InputGroup>
        <p class="meta">
          We read up to 30 manifest files (package.json, pyproject.toml, Dockerfile, wrangler.toml…) through the GitHub API.
          {ctx.config.githubApp ? (
            account.plan === "team" ? (
              <>
                {" "}
                Private repo? <a href="/app/github/connect">Import it through the GitHub App</a> (read-only; we re-import when a manifest changes).
              </>
            ) : (
              <> Private repos through our GitHub App are on the <a href="/pricing">Team plan</a>.</>
            )
          ) : null}
        </p>
      </form>
    </>,
    { noindex: true },
  );
});

app.post("/projects", async (c) => {
  const ctx = c.get("ctx");
  const form = await c.req.parseBody();
  const name = str(form.name, 80) || "My stack";
  const repoInput = str(form.repo, 300);
  const account = await getAccount(c);
  if (!(await canCreateProject(ctx, account))) return page(c, "New project", <UpgradeForProjects />, { status: 402, noindex: true });
  const wantsImport = form.next === "import" || (form.next !== "pick" && repoInput !== "");
  const repo = wantsImport ? parseRepoInput(repoInput) : null;
  if (wantsImport && !repo) {
    return page(c, "New project", <><h1>That isn't a GitHub repo URL</h1><p>Use the form <code>https://github.com/owner/repo</code>.</p><p><a href="/app/projects/new">Back</a></p></>, { status: 400, noindex: true });
  }
  const [project] = await ctx.db
    .insert(projects)
    .values({ userId: account.ownerId, name, defaultProfile: profileFromForm(form), createdAt: ctx.clock.now() })
    .returning();
  if (repo) {
    await startImport(ctx, project.id, repo);
    return c.redirect(`/app/projects/${project.id}/import`);
  }
  return c.redirect(`/app/projects/${project.id}/services`);
});

app.get("/projects/:id", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const ctx = c.get("ctx");
  const list = await projectDeps(ctx, project);
  const imp = project.repoFullName ? await latestImport(ctx, project.id) : undefined;
  return page(
    c,
    project.name,
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }]}
        title={project.name}
        actions={
          <>
            <ButtonLink variant="primary" href={`/app/projects/${project.id}/services`}>
              Add or remove services
            </ButtonLink>
            <ButtonLink href={`/app/projects/${project.id}/profiles`}>How you use them</ButtonLink>
          </>
        }
      />
      <Flash msg={flash(c)} />
      {list.length ? (
        <StackView list={list} now={ctx.clock.now()} level={2} />
      ) : (
        <EmptyState title="Nothing watched yet" actions={<ButtonLink variant="primary" href={`/app/projects/${project.id}/services`}>Pick what you run on</ButtonLink>}>
          Pick services from the catalog or import a repo below.
        </EmptyState>
      )}
      <h2>Repository</h2>
      {project.repoFullName ? (
        <form method="post" action={`/app/projects/${project.id}/import`} class="row">
          <Csrf token={c.get("csrf")} />
          <span>
            <a href={`https://github.com/${project.repoFullName}`} rel="noopener noreferrer">
              {project.repoFullName}
            </a>
            {project.lastImportAt ? <span class="meta"> · imported {fmtDate(project.lastImportAt)}</span> : imp?.status === "failed" ? <span class="meta"> · last import failed: {imp.error}</span> : null}
          </span>
          <input type="hidden" name="repo" value={project.repoFullName} />
          <button type="submit">Import again</button>
        </form>
      ) : (
        <form method="post" action={`/app/projects/${project.id}/import`} class="row">
          <Csrf token={c.get("csrf")} />
          <InputGroup>
            <input type="url" name="repo" placeholder="https://github.com/owner/repo" aria-label="Public GitHub repo URL" required />
            <Button icon="github">Import a public repo</Button>
          </InputGroup>
          {ctx.config.githubApp && (await getAccount(c)).plan === "team" && <a href={`/app/github/connect?project=${project.id}`}>or a private repo</a>}
        </form>
      )}
      <h2>Project settings</h2>
      <form method="post" action={`/app/projects/${project.id}`} class="panel">
        <Csrf token={c.get("csrf")} />
        <Field id="name" label="Name" value={project.name} required maxlength={80} />
        <p class="meta">Defaults for every dependency you haven't answered for:</p>
        <ProfileFields profile={project.defaultProfile} />
        <Button variant="primary">Save</Button>
      </form>
      <Panel title="Danger zone" danger>
        <form method="post" action={`/app/projects/${project.id}/delete`} class="spread">
          <Csrf token={c.get("csrf")} />
          <p class="muted" style="margin:0">Stops watching everything in this project. This can't be undone.</p>
          <Button variant="danger" icon="trash">
            Delete this project
          </Button>
        </form>
      </Panel>
    </>,
    { noindex: true },
  );
});

app.post("/projects/:id", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const form = await c.req.parseBody();
  await c
    .get("ctx")
    .db.update(projects)
    .set({ name: str(form.name, 80) || project.name, defaultProfile: profileFromForm(form) })
    .where(eq(projects.id, project.id));
  return c.redirect(`/app/projects/${project.id}?msg=saved`);
});

/** Removes a project and everything under it (deps, links, imports and their jobs). */
async function deleteProject(c: WebContext, projectId: number): Promise<void> {
  const ctx = c.get("ctx");
  const depIds = (await ctx.db.select({ id: deps.id }).from(deps).where(eq(deps.projectId, projectId)).all()).map((d) => d.id);
  await deleteDeps(ctx, projectId, depIds);
  const imps = await ctx.db.select({ id: imports.id }).from(imports).where(eq(imports.projectId, projectId)).all();
  if (imps.length) await ctx.db.delete(jobs).where(inArray(jobs.dedupeKey, imps.map((i) => importJobKey(i.id))));
  await ctx.db.delete(imports).where(eq(imports.projectId, projectId));
  await ctx.db.delete(projects).where(eq(projects.id, projectId));
}

app.post("/projects/:id/delete", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  await deleteProject(c, project.id);
  return c.redirect("/app?msg=removed");
});

// ---------- Service picker (SPEC §7.1 "Manual add") ----------

const PICKER_JS = `(()=>{const q=document.getElementById('q'),r=document.getElementById('request'),none=document.getElementById('none');
q.addEventListener('input',()=>{const v=q.value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();let any=false;
for(const el of document.querySelectorAll('[data-s]')){const hit=!v||v.split(' ').every(w=>el.dataset.s.includes(w));el.hidden=!hit;any=any||hit}
for(const g of document.querySelectorAll('[data-g]'))g.hidden=!g.querySelector('[data-s]:not([hidden])');
none.hidden=any;if(!any)r.value=q.value});
q.addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault()});})();`;

app.get("/projects/:id/services", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const ctx = c.get("ctx");
  const current = await ctx.db.select({ catalogId: deps.catalogId, origin: deps.origin }).from(deps).where(eq(deps.projectId, project.id)).all();
  const have = new Set(current.map((d) => d.catalogId).filter(Boolean));
  const imported = new Set(current.filter((d) => d.origin === "import").map((d) => d.catalogId));
  const q = str(c.req.query("q"), 100);
  const shown = searchCatalog(q);
  const groups = groupByCategory(shown);
  const imp = c.req.query("imported") === "1" ? await latestImport(ctx, project.id) : undefined;
  const counts = (imp?.state as ImportState | undefined)?.counts;
  return page(
    c,
    "Pick services",
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]}
        title="What do you run on?"
        description="Tick the hosting, databases, APIs and runtimes this project uses. We watch their pricing, free tiers, terms, licences and end-of-life dates."
      />
      {imp && counts && (
        <Callout tone="ok">
          Imported {imp.repo}: we found {counts.catalog} services and tools{counts.runtimes ? `, ${counts.runtimes} runtimes` : ""} and {counts.packages} packages. The ones we recognised are ticked; untick anything you don't use.
        </Callout>
      )}
      <form method="post" action={`/app/projects/${project.id}/services`}>
        <Csrf token={c.get("csrf")} />
        <input type="search" id="q" name="q" value={q} placeholder="Search, e.g. postgres, stripe, workers" aria-label="Search the catalog" autocomplete="off" />
        {groups.map((g) => (
          <section data-g="1">
            <h2>{g.label}</h2>
            <div class="grid">
              {g.entries.map((e) => (
                <PickTile name="ids" value={e.id} checked={have.has(e.id)} search={searchText(e)} label={e.name} note={imported.has(e.id) ? "found in repo" : undefined} sub={e.aliases?.length ? e.aliases.slice(0, 3).join(", ") : undefined}>
                  <input type="hidden" name="shown" value={e.id} />
                </PickTile>
              ))}
            </div>
          </section>
        ))}
        <Callout id="none" hidden={groups.length > 0}>
          Not in the catalog yet. Send it as a request below and we'll consider adding it.
        </Callout>
        <label for="request">Something missing? Tell us what you use</label>
        <input type="text" id="request" name="request" maxlength={200} placeholder="e.g. Hetzner Cloud, CockroachDB" value={groups.length === 0 ? q : ""} />
        <StickyBar>
          <Button variant="primary" iconEnd="arrow-right">
            Save and continue
          </Button>
          <ButtonLink variant="quiet" href={`/app/projects/${project.id}`}>
            Cancel
          </ButtonLink>
        </StickyBar>
      </form>
      <script>{raw(PICKER_JS)}</script>
    </>,
    { noindex: true },
  );
});

/** Form values for a repeated field (`ids`), as strings. */
async function formList(c: WebContext, key: string): Promise<string[]> {
  const all = await c.req.parseBody({ all: true });
  const v = all[key];
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
}

app.post("/projects/:id/services", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const ctx = c.get("ctx");
  const known = new Set(CATALOG.map((e) => e.id));
  const checked = new Set((await formList(c, "ids")).filter((id) => known.has(id)));
  // Only entries that were on the page can be unticked (the page may have been filtered).
  const shown = new Set((await formList(c, "shown")).filter((id) => known.has(id)));
  const form = await c.req.parseBody();
  const request = str(form.request, 200);
  let msg = "saved";
  if (request) {
    const match = exactMatch(request);
    if (match) checked.add(match.id);
    else {
      await ctx.db.insert(catalogRequests).values({ userId: uid(c), text: request, createdAt: ctx.clock.now() });
      msg = "requested";
    }
  }
  const current = await ctx.db.select({ id: deps.id, catalogId: deps.catalogId }).from(deps).where(eq(deps.projectId, project.id)).all();
  const remove = current.filter((d) => d.catalogId && shown.has(d.catalogId) && !checked.has(d.catalogId)).map((d) => d.id);
  await deleteDeps(ctx, project.id, remove);
  await addCatalogDeps(ctx, project.id, [...checked]);
  const anyQuestions = CATALOG.some((e) => checked.has(e.id) && questionsFor(e).length > 0);
  return c.redirect(anyQuestions ? `/app/projects/${project.id}/profiles?msg=${msg}` : `/app/projects/${project.id}?msg=${msg}`);
});

// ---------- Usage profiles ----------

app.get("/projects/:id/profiles", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const list = await c.get("ctx").db.select().from(deps).where(eq(deps.projectId, project.id)).orderBy(asc(deps.id)).all();
  const asked = list.map((d) => ({ d, entry: catalogEntry(d.catalogId) })).filter((x) => x.entry && questionsFor(x.entry).length > 0);
  return page(
    c,
    "How you use them",
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]}
        title="How do you use them?"
        description="Optional. It lets us skip changes that don't apply to you (a self-hosting licence change when you use the hosted service, say). Anything you leave unanswered counts as affected."
      />
      <Flash msg={flash(c)} />
      {asked.length === 0 ? (
        <p>
          Nothing to ask: none of this project's services have usage questions. <a href={`/app/projects/${project.id}`}>Go to the project</a>.
        </p>
      ) : (
        <form method="post" action={`/app/projects/${project.id}/profiles`}>
          <Csrf token={c.get("csrf")} />
          {asked.map(({ d, entry }) => (
            <Panel title={entry!.name}>
              <ProfileFields profile={d.profile} dims={questionsFor(entry)} prefix={`d${d.id}_`} defaults={project.defaultProfile} />
            </Panel>
          ))}
          <StickyBar>
            <Button variant="primary">Save</Button>
            <ButtonLink variant="quiet" href={`/app/projects/${project.id}`}>
              Skip
            </ButtonLink>
          </StickyBar>
        </form>
      )}
    </>,
    { noindex: true },
  );
});

app.post("/projects/:id/profiles", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const ctx = c.get("ctx");
  const form = await c.req.parseBody();
  const list = await ctx.db.select().from(deps).where(eq(deps.projectId, project.id)).all();
  for (const d of list) {
    const entry = catalogEntry(d.catalogId);
    const dims = questionsFor(entry);
    if (!entry || !dims.length || !dims.some((dim) => `d${d.id}_${dim}` in form)) continue;
    const profile = profileFromForm(form, dims, `d${d.id}_`);
    if (JSON.stringify(profile) !== JSON.stringify(d.profile)) await ctx.db.update(deps).set({ profile }).where(eq(deps.id, d.id));
  }
  return c.redirect(`/app/projects/${project.id}?msg=profiles`);
});

// ---------- Repo import ----------

app.post("/projects/:id/import", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const form = await c.req.parseBody();
  const repo = parseRepoInput(str(form.repo, 300));
  if (!repo) return page(c, "Import", <><h1>That isn't a GitHub repo URL</h1><p><a href={`/app/projects/${project.id}`}>Back</a></p></>, { status: 400, noindex: true });
  const running = await latestImport(c.get("ctx"), project.id);
  // "Import again" keeps the project's GitHub App installation; a different repo is a public import.
  const installation = project.githubInstallationId && repo.toLowerCase() === project.repoFullName?.toLowerCase() ? project.githubInstallationId : null;
  if (installation && (await getAccount(c)).plan !== "team") return page(c, "Import", <><h1>Private repos are on the Team plan</h1><p>This project's repo is private, imported through the GitHub App. <a href="/pricing">Team</a> keeps it in sync.</p><p><a href={`/app/projects/${project.id}`}>Back</a></p></>, { status: 402, noindex: true });
  if (running?.status !== "running") await startImport(c.get("ctx"), project.id, installation ? project.repoFullName! : repo, installation);
  return c.redirect(`/app/projects/${project.id}/import`);
});

/** Progress page. Each load runs one import step (see src/stack/import.ts) and refreshes itself. */
app.get("/projects/:id/import", async (c) => {
  const project = await ownProject(c);
  if (!project) return c.notFound();
  const ctx = c.get("ctx");
  let imp = await latestImport(ctx, project.id);
  if (!imp) return c.redirect(`/app/projects/${project.id}`);
  if (imp.status === "running") {
    await kickImport(ctx, imp.id, CATALOG);
    imp = (await latestImport(ctx, project.id))!;
  }
  if (imp.status === "done") return c.redirect(`/app/projects/${project.id}/services?imported=1`);
  const st = imp.state as unknown as ImportState;
  return page(
    c,
    "Importing",
    <>
      <p class="meta">
        <a href={`/app/projects/${project.id}`}>{project.name}</a>
      </p>
      <h1>{imp.status === "failed" ? "Import failed" : `Importing ${imp.repo}…`}</h1>
      {imp.status === "failed" ? (
        <>
          <p class="flash error">{imp.error}</p>
          <p class="row">
            <a class="btn primary" href={`/app/projects/${project.id}/services`}>
              Pick services instead
            </a>
            <a class="btn" href={`/app/projects/${project.id}`}>
              Back to the project
            </a>
          </p>
        </>
      ) : (
        <>
          <ul>
            {st.log.map((l) => (
              <li>{l}</li>
            ))}
            <li class="muted">Working…</li>
          </ul>
          {imp.error && <p class="meta">Retrying after: {imp.error}</p>}
          <noscript>
            <p>This page refreshes itself every second.</p>
          </noscript>
        </>
      )}
    </>,
    { noindex: true, head: imp.status === "running" ? <meta http-equiv="refresh" content="1" /> : undefined },
  );
});

// ---------- Deps ----------

app.get("/deps/:id", async (c) => {
  const own = await ownDep(c);
  if (!own) return c.notFound();
  const { dep, project } = own;
  const ctx = c.get("ctx");
  const entry = catalogEntry(dep.catalogId);
  const linked = await ctx.db
    .select({ id: sources.id, kind: sources.kind, key: sources.key, url: sources.url, state: sources.state, lastOkAt: sources.lastOkAt })
    .from(sources)
    .where(sql`${sources.id} IN (SELECT source_id FROM dep_sources WHERE dep_id = ${dep.id})`)
    .orderBy(asc(sources.kind), asc(sources.id))
    .all();
  const evs = await publishedEvents(ctx, { limit: 20, sourceIds: linked.map((s) => s.id) });
  const depAlerts = await userAlerts(ctx, uid(c), { depId: dep.id, limit: 50 });
  const dims = questionsFor(entry);
  const now = ctx.clock.now();
  const muted = dep.mutedUntil && dep.mutedUntil > now;
  const name = depName(dep, entry);
  const assumed = describeProfile(effectiveProfile(dep.profile, project.defaultProfile, dims));
  return page(
    c,
    name,
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]}
        title={`${name}${dep.eolCycle ? ` ${dep.eolCycle}` : ""}`}
      />
      <Flash msg={flash(c)} />
      {muted && (
        <Callout tone="warn" title={`Muted until ${fmtDate(dep.mutedUntil)}`}>
          No alerts for this dependency until then. Unmute at the bottom of the page.
        </Callout>
      )}
      <DataList
        label="About this dependency"
        items={[
          { term: "What", value: entry ? <a href={`/catalog/${entry.id}`}>In the catalog</a> : dep.ecosystem === "eol" ? "Runtime" : `${dep.ecosystem} package${dep.versionSpec ? ` ${dep.versionSpec}` : ""}` },
          { term: "Added", value: `${dep.origin === "import" ? "found by repo import" : "added by you"}${dep.foundIn?.length ? ` in ${dep.foundIn.slice(0, 4).join(", ")}` : ""}` },
          ...(dep.rank ? [{ term: "Importance", value: <span class="num">#{dep.rank}</span> }] : []),
        ]}
      />
      <h2>Changes</h2>
      {evs.length ? (
        <ul class="plain">
          {evs.map((e) => (
            <EventRow e={e} />
          ))}
        </ul>
      ) : (
        <EmptyState title="No published changes yet" level={3} icon="eye">
          We check its sources several times a day and publish a note when something changes the deal.
        </EmptyState>
      )}
      {dims.length > 0 && (
        <>
          <h2>How you use it</h2>
          <form method="post" action={`/app/deps/${dep.id}/profile`} class="panel">
            <Csrf token={c.get("csrf")} />
            <ProfileFields profile={dep.profile} dims={dims} defaults={project.defaultProfile} />
            <p class="meta">Assumed now: {assumed === "not set" ? "nothing yet, so every change counts as affecting you" : assumed}.</p>
            <Button>Save</Button>
          </form>
        </>
      )}
      <h2>What we watch</h2>
      {linked.length ? (
        <DataTable
          caption="Sources we watch"
          columns={[{ label: "Kind" }, { label: "Source" }, { label: "Status" }]}
          rows={linked.map((s) => {
            const href = safeHref(s.kind === "npm" ? `https://www.npmjs.com/package/${s.key}` : s.kind === "pypi" ? `https://pypi.org/project/${s.key}/` : s.kind === "github_repo" ? `https://github.com/${s.key}` : s.kind === "eol" ? `https://endoflife.date/${s.key.split("@")[0]}` : s.url);
            return [
              s.kind,
              <span class="overflow-anywhere">
                {href ? (
                  <a href={href} rel="noopener noreferrer nofollow">
                    {s.kind === "page" || s.kind === "feed" ? s.url : s.key}
                  </a>
                ) : (
                  s.key
                )}
              </span>,
              s.state !== "active" ? <Badge tone="act">{s.state}</Badge> : <span class="meta">{s.lastOkAt ? <>checked <time>{fmtDate(s.lastOkAt)}</time></> : "first check pending"}</span>,
            ];
          })}
        />
      ) : (
        <p class="muted">{dep.ecosystem && !WATCHED_ECOSYSTEMS.has(dep.ecosystem) && dep.ecosystem !== "eol" ? `We don't watch ${dep.ecosystem} packages yet.` : "No sources yet."}</p>
      )}
      <h2>Alerts</h2>
      {depAlerts.length > 0 && <AlertList list={depAlerts} csrf={c.get("csrf")} back={`/app/deps/${dep.id}`} showDep={false} />}
      <div class="row" style="margin-top:.75rem">
        {muted ? (
          <form method="post" action={`/app/deps/${dep.id}/unmute`}>
            <Csrf token={c.get("csrf")} />
            <span>Muted until {fmtDate(dep.mutedUntil)}. </span>
            <Button>Unmute</Button>
          </form>
        ) : (
          <form method="post" action={`/app/deps/${dep.id}/mute`}>
            <Csrf token={c.get("csrf")} />
            <Button icon="bell-off">Mute for 90 days</Button>
          </form>
        )}
        <form method="post" action={`/app/deps/${dep.id}/delete`}>
          <Csrf token={c.get("csrf")} />
          <Button variant="danger" icon="trash">
            Stop watching
          </Button>
        </form>
      </div>
    </>,
    { noindex: true },
  );
});

app.post("/deps/:id/profile", async (c) => {
  const own = await ownDep(c);
  if (!own) return c.notFound();
  const form = await c.req.parseBody();
  await c
    .get("ctx")
    .db.update(deps)
    .set({ profile: profileFromForm(form, questionsFor(catalogEntry(own.dep.catalogId))) })
    .where(eq(deps.id, own.dep.id));
  return c.redirect(`/app/deps/${own.dep.id}?msg=saved`);
});

app.post("/deps/:id/mute", async (c) => {
  const own = await ownDep(c);
  if (!own) return c.notFound();
  const ctx = c.get("ctx");
  await ctx.db.update(deps).set({ mutedUntil: ctx.clock.now() + MUTE_MS }).where(eq(deps.id, own.dep.id));
  return c.redirect(`/app/deps/${own.dep.id}?msg=muted`);
});

app.post("/deps/:id/unmute", async (c) => {
  const own = await ownDep(c);
  if (!own) return c.notFound();
  await c.get("ctx").db.update(deps).set({ mutedUntil: null }).where(eq(deps.id, own.dep.id));
  return c.redirect(`/app/deps/${own.dep.id}?msg=unmuted`);
});

app.post("/deps/:id/delete", async (c) => {
  const own = await ownDep(c);
  if (!own) return c.notFound();
  await deleteDeps(c.get("ctx"), own.project.id, [own.dep.id]);
  return c.redirect(`/app/projects/${own.project.id}?msg=removed`);
});

// ---------- Alerts ----------

app.post("/alerts/:id/feedback", async (c) => {
  const ctx = c.get("ctx");
  const form = await c.req.parseBody();
  const value = str(form.value) as Feedback;
  if (!FEEDBACK.includes(value)) return c.text("Unknown feedback", 400);
  await ctx.db
    .update(alerts)
    .set({ feedback: value, feedbackAt: ctx.clock.now() })
    .where(and(eq(alerts.id, idParam(c)), eq(alerts.userId, uid(c))));
  const back = str(form.back);
  return c.redirect(`${/^\/app(\/deps\/\d+)?$/.test(back) ? back : "/app"}?msg=feedback`);
});

// ---------- CSV export of vendor risk (Team) ----------

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Spreadsheet formula injection: a cell starting with = + - @ is read as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

app.get("/export.csv", async (c) => {
  const ctx = c.get("ctx");
  if ((await getAccount(c)).plan !== "team") return page(c, "Export", <><h1>CSV export is on the Team plan</h1><p><a href="/pricing">See plans</a></p></>, { status: 402, noindex: true });
  const list = await ctx.db.select().from(projects).where(await visible(c)).orderBy(asc(projects.id)).all();
  const byProject = await loadDeps(ctx, list);
  const now = ctx.clock.now();
  const origin = ctx.config.appOrigin;
  const lines = [["project", "repository", "dependency", "type", "details", "risk", "latest_change", "latest_change_kind", "latest_change_date", "latest_change_url", "muted_until", "catalog_url"].join(",")];
  for (const p of list)
    for (const v of byProject.get(p.id) ?? []) {
      const type = v.entry ? v.entry.category : v.dep.ecosystem === "eol" ? "runtime" : `${v.dep.ecosystem} package`;
      lines.push(
        [p.name, p.repoFullName, v.name, type, v.detail, RISK_LABELS[riskOf(v, now)], v.latest?.title, v.latest?.kind, v.latest ? fmtDate(v.latest.publishedAt) : "", v.latest ? `${origin}/events/${v.latest.id}` : "", v.dep.mutedUntil && v.dep.mutedUntil > now ? fmtDate(v.dep.mutedUntil) : "", v.entry ? `${origin}/catalog/${v.entry.id}` : ""]
          .map(csvCell)
          .join(","),
      );
    }
  return c.body(lines.join("\r\n") + "\r\n", 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="stackquake-vendor-risk-${fmtDate(now)}.csv"` });
});

// ---------- Settings ----------

const PlanSection: FC<{ c: WebContext; user: typeof users.$inferSelect; account: Awaited<ReturnType<typeof getAccount>>; billing: boolean }> = ({ c, user, account, billing }) => {
  const csrf = c.get("csrf");
  if (account.role === "member")
    return (
      <div class="card">
        <p>
          Team, through <strong>{account.ownerEmail}</strong>'s team. <a href="/app/team">Team page</a>
        </p>
      </div>
    );
  if (user.plan === "team")
    return (
      <div class="card">
        <p>
          <strong>Team</strong>
          {user.planInterval ? `, billed ${user.planInterval === "year" ? "yearly" : "monthly"}` : ""}.
          {user.planStatus === "past_due" && <span class="pill bad"> payment failed: update your card</span>}
          {user.planPeriodEnd ? (user.cancelAtPeriodEnd ? ` Ends on ${fmtDate(user.planPeriodEnd)}.` : ` Renews on ${fmtDate(user.planPeriodEnd)}.`) : ""}
        </p>
        <p class="row">
          <a class="btn" href="/app/team">
            Manage the team
          </a>
          {billing && user.stripeCustomerId && (
            <form method="post" action="/app/billing/portal" class="inline">
              <Csrf token={csrf} />
              <button type="submit">Billing, invoices and cancelling</button>
            </form>
          )}
        </p>
      </div>
    );
  return (
    <div class="card">
      <p>
        <strong>Free</strong>: one project, email alerts and the weekly digest.
      </p>
      <p class="meta">Team: unlimited projects, private repos through the GitHub App, Slack, up to 10 people and a CSV export of vendor risk.</p>
      {billing ? (
        <form method="post" action="/app/billing/checkout" class="row">
          <Csrf token={csrf} />
          <button class="primary" type="submit" name="interval" value="month">
            Team, ${PRICES.month}/month
          </button>
          <button type="submit" name="interval" value="year">
            ${PRICES.year}/year (2 months free)
          </button>
          {user.stripeCustomerId && (
            <button class="link" type="submit" formaction="/app/billing/portal">
              Past invoices
            </button>
          )}
        </form>
      ) : (
        <p class="meta">Paid plans aren't open on this server yet.</p>
      )}
      <p class="meta">
        <a href="/app/team">Team invites</a> · <a href="/pricing">Plans</a>
      </p>
    </div>
  );
};

app.get("/settings", async (c) => {
  const user = c.get("user")!;
  const ctx = c.get("ctx");
  const account = await getAccount(c);
  const slack = await ctx.db.select().from(channels).where(and(eq(channels.userId, user.id), eq(channels.kind, "slack"))).get();
  const billingMsg = c.req.query("billing") === "success" ? (user.plan === "team" ? "Welcome to Team. Thanks for subscribing." : "Thanks. Stripe is confirming the payment; this page shows Team within a minute.") : undefined;
  return page(
    c,
    "Settings",
    <>
      <h1>Settings</h1>
      <Flash msg={billingMsg ?? flash(c)} />
      <h2>Email</h2>
      <form method="post" action="/app/settings/email" class="card">
        <Csrf token={c.get("csrf")} />
        <p>
          Alerts go to <strong>{user.email}</strong>
          {user.githubId ? " (GitHub sign-in linked)" : ""}.
        </p>
        <label for="email">Change to</label>
        <input type="email" id="email" name="email" required autocomplete="email" />
        <p>
          <button type="submit">Send a confirmation link</button>
        </p>
      </form>
      <h2>Alerts</h2>
      <form method="post" action="/app/settings" class="card">
        <Csrf token={c.get("csrf")} />
        <label>
          <input type="checkbox" name="email_immediate" value="1" checked={user.emailImmediate} /> Email urgent changes as they happen
        </label>
        <p class="meta">Licence changes, end-of-life within 6 months, shutdowns after an acquisition and free-tier changes. At most 3 a day; anything else waits for the weekly digest. Untick to get the digest only.</p>
        <label for="digest_day">Send the weekly digest on</label>
        <select id="digest_day" name="digest_day">
          {DAYS.map((d, i) => (
            <option value={String(i)} selected={user.digestDay === i}>
              {d}
            </option>
          ))}
        </select>
        <p>
          <button type="submit">Save</button>
        </p>
      </form>
      <h2>Slack</h2>
      <div class="card">
        {!ctx.config.channelKey ? (
          <p class="muted">Slack alerts are not available on this server yet.</p>
        ) : account.plan !== "team" ? (
          <p class="muted">
            Slack alerts are on the <a href="/pricing">Team plan</a>.{slack ? ` Your webhook ending …${slack.hint} is kept but gets nothing until then.` : ""}
          </p>
        ) : slack ? (
          <form method="post" action="/app/settings/slack/delete">
            <Csrf token={c.get("csrf")} />
            <p>
              Urgent alerts also go to a Slack channel (webhook ending …{slack.hint}, added {fmtDate(slack.createdAt)}).
              {slack.lastError && <span class="meta"> Last error: {slack.lastError}</span>}
            </p>
            <button class="danger" type="submit">
              Disconnect Slack
            </button>
          </form>
        ) : (
          <form method="post" action="/app/settings/slack">
            <Csrf token={c.get("csrf")} />
            <p class="meta">
              Post urgent alerts to a channel too. In Slack, create an app with an incoming webhook for the channel and paste its URL (https://hooks.slack.com/services/…). We post a test message first.
            </p>
            <label for="slack_url">Incoming webhook URL</label>
            <input type="url" id="slack_url" name="url" required placeholder="https://hooks.slack.com/services/T…/B…/…" autocomplete="off" />
            <p>
              <button type="submit">Connect Slack</button>
            </p>
          </form>
        )}
      </div>
      <h2>Plan</h2>
      <PlanSection c={c} user={user} account={account} billing={!!ctx.config.stripe} />
      <h2>Delete account</h2>
      <form method="post" action="/app/settings/delete" class="card">
        <Csrf token={c.get("csrf")} />
        <p>
          This removes your account, projects, dependencies, alerts, Slack connection, team and sessions{user.stripeSubscriptionId && user.plan === "team" ? ", and cancels your Team subscription now" : ""}. Public events stay, since they are not yours. It can't be undone.
        </p>
        <label for="confirm">Type DELETE to confirm</label>
        <input type="text" id="confirm" name="confirm" autocomplete="off" required />
        <p>
          <button class="danger" type="submit">
            Delete my account
          </button>
        </p>
      </form>
    </>,
    { noindex: true },
  );
});

app.post("/settings", async (c) => {
  const form = await c.req.parseBody();
  const day = Number(form.digest_day);
  const set: Partial<typeof users.$inferInsert> = { emailImmediate: form.email_immediate === "1" };
  if (Number.isInteger(day) && day >= 0 && day <= 6) set.digestDay = day;
  await c.get("ctx").db.update(users).set(set).where(eq(users.id, uid(c)));
  return c.redirect("/app/settings?msg=saved");
});

const SlackProblem: FC<{ why: string }> = ({ why }) => (
  <>
    <h1>Slack wasn't connected</h1>
    <p>{why}</p>
    <p>
      <a href="/app/settings">Back to settings</a>
    </p>
  </>
);

app.post("/settings/slack", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.config.channelKey) return c.notFound();
  if ((await getAccount(c)).plan !== "team") return page(c, "Slack", <SlackProblem why="Slack alerts are on the Team plan." />, { status: 402, noindex: true });
  const form = await c.req.parseBody();
  const url = validSlackWebhook(str(form.url, 300));
  if (!url) return page(c, "Slack", <SlackProblem why="That isn't a Slack incoming webhook URL. It should look like https://hooks.slack.com/services/T…/B…/…" />, { status: 400, noindex: true });
  const test = await postSlack(ctx, url, { text: "Stackquake is connected. Urgent changes to your stack will be posted here." });
  if (!test.ok) return page(c, "Slack", <SlackProblem why={`Slack didn't accept the test message (${test.error}). Check the URL and that the app is still installed.`} />, { status: 400, noindex: true });
  const now = ctx.clock.now();
  await ctx.db.delete(channels).where(and(eq(channels.userId, uid(c)), eq(channels.kind, "slack")));
  await ctx.db.insert(channels).values({ userId: uid(c), kind: "slack", webhookUrlEnc: await encrypt(ctx.config.channelKey, url), verifiedAt: now, hint: url.slice(-4), createdAt: now });
  return c.redirect("/app/settings?msg=slack");
});

app.post("/settings/slack/delete", async (c) => {
  await c.get("ctx").db.delete(channels).where(and(eq(channels.userId, uid(c)), eq(channels.kind, "slack")));
  return c.redirect("/app/settings?msg=slackremoved");
});

app.post("/settings/email", async (c) => {
  const form = await c.req.parseBody();
  const email = normaliseEmail(form.email);
  if (!validEmail(email)) return page(c, "Settings", <><h1>That doesn't look like an email address</h1><p><a href="/app/settings">Back</a></p></>, { status: 400, noindex: true });
  if (!(await magicLinkAllowed(c, email))) return page(c, "Slow down", <><h1>Too many emails requested</h1><p>Try again in an hour.</p></>, { status: 429, noindex: true });
  await sendMagicLink(c, email, { userId: uid(c) });
  return c.redirect("/app/settings?msg=emailsent");
});

app.post("/settings/delete", async (c) => {
  const form = await c.req.parseBody();
  if (str(form.confirm) !== "DELETE") return c.redirect("/app/settings");
  const ctx = c.get("ctx");
  const user = c.get("user")!;
  if (ctx.config.stripe && user.stripeSubscriptionId && user.plan === "team") {
    try {
      await cancelSubscriptionNow(ctx, ctx.config.stripe, user.stripeSubscriptionId);
    } catch {
      return page(c, "Settings", <><h1>Account not deleted</h1><p class="flash error">We couldn't cancel your subscription with Stripe, so nothing was deleted. Try again in a minute, or cancel it first from the billing portal.</p><p><a href="/app/settings">Back</a></p></>, { status: 503, noindex: true });
    }
  }
  const owned = await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.userId, user.id)).orderBy(desc(projects.id)).all();
  for (const p of owned) await deleteProject(c, p.id);
  // SPEC §8: user, projects, deps, alerts and channels go; sources and events are global and stay.
  await ctx.db.run(sql`DELETE FROM jobs WHERE kind = 'deliver' AND json_extract(payload, '$.alertId') IN (SELECT id FROM alerts WHERE user_id = ${user.id})`);
  await ctx.db.run(sql`DELETE FROM jobs WHERE kind = 'digest' AND json_extract(payload, '$.userId') = ${user.id}`);
  await ctx.db.delete(alerts).where(eq(alerts.userId, user.id));
  await ctx.db.delete(channels).where(eq(channels.userId, user.id));
  // Their team (members lose access to its projects, which go with it), their memberships and invites.
  await ctx.db.delete(teamMembers).where(sql`${teamMembers.ownerId} = ${user.id} OR ${teamMembers.userId} = ${user.id} OR ${teamMembers.email} = ${user.email.toLowerCase()}`);
  await ctx.db.delete(catalogRequests).where(eq(catalogRequests.userId, user.id));
  await ctx.db.delete(magicLinks).where(eq(magicLinks.email, user.email));
  await endSession(c);
  await ctx.db.delete(sessions).where(eq(sessions.userId, user.id));
  await ctx.db.delete(users).where(eq(users.id, user.id));
  return c.redirect("/?deleted=1");
});
