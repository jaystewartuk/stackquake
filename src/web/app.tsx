// Signed-in pages (SPEC §7.6): dashboard, projects, the service picker (the first onboarding
// step, SPEC §2 Positioning), repo import, usage profiles, deps and settings. Every project and
// dep is loaded through ownProject/ownDep, which scope by the signed-in user: another user's ids
// are a 404.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { canCreateProject, FREE_PROJECTS, PRICES, projectCount, TEAM_FEATURES } from "../billing/plans";
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
import { problemPage, upgradePage } from "./app-ui";
import { CATEGORY_LABELS, catalogEntry, exactMatch, groupByCategory, searchCatalog, searchText } from "./catalog-view";
import { EventList, publishedEvents } from "./events-view";
import { Icon } from "./icons";
import { Csrf, fmtDate, page, safeHref } from "./layout";
import { endSession, getAccount, requireUser, type WebContext, type WebEnv } from "./session";
import { depLevel, depName, levelCounts, loadDeps, projectDeps, RECENT_MS, riskOf, RISK_LABELS, StackView, tracePoints, WATCHED_ECOSYSTEMS } from "./stack-view";
import { Badge, Button, ButtonLink, Callout, Choice, DataList, EmptyState, Field, Flash, InputGroup, PageHeader, Panel, PickTile, ProgressSteps, Severity, StatusLine, Stepper, StickyBar, Trace } from "./ui";

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
  const levels = levelCounts(allDeps, now);
  const trace = tracePoints(allDeps, now);
  const open = recent.filter((a) => a.status !== "suppressed");
  const csrf = c.get("csrf");
  return page(
    c,
    "Dashboard",
    <>
      <PageHeader
        title="Your stack"
        description={
          <>
            <span class="num">{list.length}</span> project{list.length === 1 ? "" : "s"} · <span class="num">{allDeps.length}</span> dependencies watched
          </>
        }
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
        <Callout tone="warn">
          The Free plan alerts on one project, your oldest. {quiet.map((p) => p.name).join(", ")} {quiet.length === 1 ? "is" : "are"} shown but quiet. <a href="/pricing">Team</a> alerts on every project.
        </Callout>
      )}
      <Panel label="Status" class="pulse">
        <StatusLine act={levels.act} watch={levels.watch} quiet={levels.quiet} />
        {trace.length ? (
          <Trace points={trace} from={now - RECENT_MS} to={now} label={`${trace.length} change${trace.length === 1 ? "" : "s"} to your dependencies in the last 90 days`} axis={["90 days ago", "today"]} />
        ) : (
          <p class="meta flush">No changes to your dependencies in the last 90 days.</p>
        )}
      </Panel>
      <section class="attention" aria-labelledby="attention-h">
        <div class="section-head">
          <h2 id="attention-h">Needs your attention</h2>
          {open.length > 0 && (
            <span class="meta">
              Alerts that affect you, most urgent first{levels.act + levels.watch > open.length ? ". The counts above also include changes with no alert for you; they're under each project" : ""}
            </span>
          )}
        </div>
        {open.length === 0 && (
          <div class="all-clear" role="status">
            <Icon name="check" size={20} />
            <div>
              <strong>Nothing needs you right now.</strong>
              <p>When a change affects something you use, it shows up here and we email you{levels.act + levels.watch > 0 ? ". Recent changes to your dependencies are listed under each project below" : ""}.</p>
            </div>
          </div>
        )}
        <AlertList list={recent} csrf={csrf} back="/app" top={5} empty={false} />
      </section>
      {list.map((p) => {
        const ds = byProject.get(p.id)!;
        const lv = levelCounts(ds, now);
        const pt = tracePoints(ds, now);
        return (
          <Panel
            class="project"
            title={<a href={`/app/projects/${p.id}`}>{p.name}</a>}
            meta={
              p.repoFullName || p.userId !== uid(c) ? (
                <>
                  {p.repoFullName && (
                    <span class="repo-name">
                      <Icon name="github" /> <span class="repo">{p.repoFullName}</span>
                    </span>
                  )}
                  {p.userId !== uid(c) && <span>{p.repoFullName ? " · shared with your team" : "Shared with your team"}</span>}
                </>
              ) : undefined
            }
            actions={
              <ButtonLink size="sm" variant="quiet" href={`/app/projects/${p.id}/services`} icon="plus">
                Add services
              </ButtonLink>
            }
          >
            {ds.length ? (
              <>
                {/* With one project the pulse above already is the project's. */}
                {list.length > 1 && (
                  <div class="project-pulse">
                    <StatusLine act={lv.act} watch={lv.watch} quiet={lv.quiet} />
                    {pt.length > 0 && <Trace points={pt} from={now - RECENT_MS} to={now} height={28} label={`${p.name}: ${pt.length} change${pt.length === 1 ? "" : "s"} in the last 90 days`} />}
                  </div>
                )}
                <StackView list={ds} now={now} />
              </>
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

/** The onboarding flow, shown on the pages a new project passes through. */
const ONBOARDING = ["Start a project", "Find what you use", "How you use it", "Your dashboard"];
const Onboarding: FC<{ at: number }> = ({ at }) => <Stepper label="Setting up a project" steps={ONBOARDING.map((label, i) => ({ label, state: i < at ? "done" : i === at ? "current" : "todo" }))} />;

const upgradeForProjects = (c: WebContext, status: 200 | 402) =>
  upgradePage(c, {
    title: "New project",
    status,
    heading: "One project on the Free plan",
    body: (
      <p>
        The Free plan watches one project, and yours is set up. Add services to it from the dashboard, or move to Team for as many projects as you have.
      </p>
    ),
  });

app.get("/projects/new", async (c) => {
  const ctx = c.get("ctx");
  const account = await getAccount(c);
  if (!(await canCreateProject(ctx, account))) return upgradeForProjects(c, 200);
  const first = !(await ctx.db.select({ id: projects.id }).from(projects).where(await visible(c)).get());
  return page(
    c,
    "New project",
    <>
      {first && <Onboarding at={0} />}
      <PageHeader
        crumbs={first ? undefined : [{ href: "/app", label: "Dashboard" }]}
        kicker={first ? "Welcome to Stackquake" : undefined}
        title="What do you run on?"
        description={
          first
            ? "Tell us what this project depends on and we'll watch it for pricing, free-tier, licence and end-of-life changes. It takes about a minute."
            : "A project is one app or service. Pick what it runs on, or import its repo to pre-fill the list."
        }
      />
      <form method="post" action="/app/projects" class="new-project">
        <Csrf token={c.get("csrf")} />
        {/* Enter in either field submits with no `next`: the server imports when a repo is filled in, otherwise opens the picker. */}
        <button type="submit" hidden tabindex={-1} aria-hidden="true" />
        <Field id="name" label="Project name" value="My stack" required maxlength={80} hint="One app or service. You can add more projects later." />
        <details class="defaults">
          <summary>Defaults for every dependency (optional)</summary>
          <p class="meta">Used when you don't answer for a dependency. Unknown means we assume a change affects you.</p>
          <ProfileFields profile={{}} />
        </details>
        <div class="paths">
          <section class="path" aria-labelledby="path-pick">
            <Icon name="layers" size={20} />
            <h2 id="path-pick">Pick from the catalog</h2>
            <p>
              Tick the hosting, databases, APIs and runtimes you use, from <span class="num">{CATALOG.length}</span> services. The common ones are first.
            </p>
            <Button variant="primary" name="next" value="pick" iconEnd="arrow-right" block>
              Pick services
            </Button>
          </section>
          <section class="path" aria-labelledby="path-import">
            <Icon name="github" size={20} />
            <h2 id="path-import">Or import a public GitHub repo</h2>
            <p>We read up to 30 manifest files (package.json, pyproject.toml, Dockerfile, wrangler.toml…) and pre-tick what we find. Usually under 30 seconds.</p>
            <label for="repo">Repository URL</label>
            <InputGroup>
              <input type="url" id="repo" name="repo" placeholder="https://github.com/owner/repo" inputmode="url" autocomplete="off" />
              <Button name="next" value="import" icon="github">
                Import
              </Button>
            </InputGroup>
            {ctx.config.githubApp ? (
              <p class="meta">
                {account.plan === "team" ? (
                  <>
                    Private repo? <a href="/app/github/connect">Import it through the GitHub App</a> (read-only; we re-import when a manifest changes).
                  </>
                ) : (
                  <>Private repos through our GitHub App are on the <a href="/pricing">Team plan</a>.</>
                )}
              </p>
            ) : null}
          </section>
        </div>
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
  if (!(await canCreateProject(ctx, account))) return upgradeForProjects(c, 402);
  const wantsImport = form.next === "import" || (form.next !== "pick" && repoInput !== "");
  const repo = wantsImport ? parseRepoInput(repoInput) : null;
  if (wantsImport && !repo) {
    return problemPage(c, { title: "New project", status: 400, heading: "That isn't a GitHub repo URL", body: <p>Use the form <code>https://github.com/owner/repo</code>, or pick services by hand.</p>, back: { href: "/app/projects/new", label: "Try again" } });
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
  const now = ctx.clock.now();
  const lv = levelCounts(list, now);
  const pt = tracePoints(list, now);
  const csrf = c.get("csrf");
  const privateRepos = ctx.config.githubApp && (await getAccount(c)).plan === "team";
  return page(
    c,
    project.name,
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }]}
        title={project.name}
        description={
          <>
            <span class="num">{list.length}</span> dependencies watched{project.repoFullName ? `, from ${project.repoFullName}` : ""}.
          </>
        }
        actions={
          <>
            <ButtonLink variant="primary" href={`/app/projects/${project.id}/services`} icon="plus">
              Add or remove services
            </ButtonLink>
            <ButtonLink href={`/app/projects/${project.id}/profiles`}>How you use them</ButtonLink>
          </>
        }
      />
      <Flash msg={flash(c)} />
      <div class="split">
        <div class="main-col">
          {list.length ? (
            <>
              <Panel label="Status" class="pulse">
                <StatusLine act={lv.act} watch={lv.watch} quiet={lv.quiet} />
                {pt.length ? (
                  <Trace points={pt} from={now - RECENT_MS} to={now} label={`${pt.length} change${pt.length === 1 ? "" : "s"} to this project's dependencies in the last 90 days`} axis={["90 days ago", "today"]} />
                ) : (
                  <p class="meta flush">No changes to this project's dependencies in the last 90 days.</p>
                )}
              </Panel>
              <StackView list={list} now={now} level={2} />
            </>
          ) : (
            <EmptyState title="Nothing watched yet" actions={<ButtonLink variant="primary" href={`/app/projects/${project.id}/services`}>Pick what you run on</ButtonLink>}>
              Pick services from the catalog, or import the project's repo.
            </EmptyState>
          )}
          <Panel title="Project settings" id="settings">
            <form method="post" action={`/app/projects/${project.id}`}>
              <Csrf token={csrf} />
              <Field id="name" label="Name" value={project.name} required maxlength={80} />
              <p class="meta">Defaults for every dependency you haven't answered for:</p>
              <ProfileFields profile={project.defaultProfile} />
              <Button>Save</Button>
            </form>
          </Panel>
        </div>
        <aside class="rail" aria-label="Repository">
          <Panel title="Repository">
            {project.repoFullName ? (
              <form method="post" action={`/app/projects/${project.id}/import`} class="stack-sm">
                <Csrf token={csrf} />
                <p class="repo-line">
                  <Icon name="github" />
                  <a href={`https://github.com/${project.repoFullName}`} rel="noopener noreferrer">
                    {project.repoFullName}
                  </a>
                </p>
                {project.lastImportAt ? (
                  <p class="meta">
                    Imported <time>{fmtDate(project.lastImportAt)}</time>
                    {project.githubInstallationId ? ", kept in sync through the GitHub App" : ""}.
                  </p>
                ) : imp?.status === "failed" ? (
                  <p class="meta">Last import failed: {imp.error}</p>
                ) : null}
                <input type="hidden" name="repo" value={project.repoFullName} />
                <Button icon="download">Import again</Button>
              </form>
            ) : (
              <form method="post" action={`/app/projects/${project.id}/import`} class="stack-sm">
                <Csrf token={csrf} />
                <p class="meta">Import a public repo to add the services, runtimes and packages that its manifest files list.</p>
                <label for="repo">Repository URL</label>
                <input type="url" id="repo" name="repo" placeholder="https://github.com/owner/repo" required autocomplete="off" />
                <Button icon="github">Import a public repo</Button>
                {privateRepos && <a href={`/app/github/connect?project=${project.id}`}>or a private repo</a>}
              </form>
            )}
          </Panel>
        </aside>
      </div>
      {/* After the rail, so on phones the destructive action comes last, not between the stack and the repository. */}
      <Panel title="Danger zone" danger>
        <form method="post" action={`/app/projects/${project.id}/delete`} class="spread">
          <Csrf token={csrf} />
          <p class="muted flush">Stops watching everything in this project. This can't be undone.</p>
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

const PICKER_JS = `(()=>{const q=document.getElementById('q'),r=document.getElementById('request'),none=document.getElementById('none'),n=document.getElementById('picked');
q.addEventListener('input',()=>{const v=q.value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();let any=false;
for(const el of document.querySelectorAll('[data-s]')){const hit=!v||v.split(' ').every(w=>el.dataset.s.includes(w));el.hidden=!hit;any=any||hit}
for(const g of document.querySelectorAll('[data-g]'))g.hidden=!g.querySelector('[data-s]:not([hidden])');
none.hidden=any;if(!any)r.value=q.value});
q.addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault()});
q.form.addEventListener('change',e=>{if(e.target.name==='ids')n.textContent=q.form.querySelectorAll('[name=ids]:checked').length+' selected'});})();`;

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
  const onboarding = !!imp || current.length === 0;
  const picked = groups.reduce((n, g) => n + g.entries.filter((e) => have.has(e.id)).length, 0);
  return page(
    c,
    "Pick services",
    <>
      {onboarding && <Onboarding at={1} />}
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]}
        title="Find what you use"
        description="Tick the hosting, databases, APIs and runtimes this project uses. We watch their pricing, free tiers, terms, licences and end-of-life dates."
      />
      {imp && counts && (
        <Callout tone="ok" title={`Imported ${imp.repo}`}>
          We found <span class="num">{counts.catalog}</span> services and tools{counts.runtimes ? <>, <span class="num">{counts.runtimes}</span> runtimes</> : ""} and <span class="num">{counts.packages}</span> packages. The ones we recognised are ticked; untick anything you don't use.
        </Callout>
      )}
      <form method="post" action={`/app/projects/${project.id}/services`} class="picker">
        <Csrf token={c.get("csrf")} />
        <div class="picker-search">
          <Icon name="search" />
          <input type="search" id="q" name="q" value={q} placeholder="Search, e.g. postgres, stripe, workers" aria-label="Search the catalog" autocomplete="off" />
        </div>
        {groups.map((g) => (
          <section data-g="1" class="pick-group" aria-labelledby={`g-${g.category}`}>
            <h2 id={`g-${g.category}`}>{g.label}</h2>
            <div class="pick-grid">
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
        <Field id="request" label="Something missing? Tell us what you use" maxlength={200} placeholder="e.g. Hetzner Cloud, CockroachDB" value={groups.length === 0 ? q : ""} hint="We add catalog entries by hand." />
        <StickyBar>
          <Button variant="primary" iconEnd="arrow-right">
            Save and continue
          </Button>
          <ButtonLink variant="quiet" href={`/app/projects/${project.id}`}>
            Cancel
          </ButtonLink>
          <span class="meta sticky-end" id="picked" aria-live="polite">
            {picked} selected
          </span>
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
  const onboarding = !!c.req.query("msg");
  return page(
    c,
    "How you use them",
    <>
      {onboarding && <Onboarding at={2} />}
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]}
        title="How do you use them?"
        description="Optional. It lets us skip changes that don't apply to you (a self-hosting licence change when you use the hosted service, say). Anything you leave unanswered counts as affected."
      />
      <Flash msg={flash(c)} />
      {asked.length === 0 ? (
        <EmptyState title="Nothing to ask" icon="check" actions={<ButtonLink variant="primary" href={`/app/projects/${project.id}`} iconEnd="arrow-right">Go to the project</ButtonLink>}>
          None of this project's services have usage questions.
        </EmptyState>
      ) : (
        <form method="post" action={`/app/projects/${project.id}/profiles`} class="profiles">
          <Csrf token={c.get("csrf")} />
          {asked.map(({ d, entry }) => (
            <Panel title={entry!.name}>
              <ProfileFields profile={d.profile} dims={questionsFor(entry)} prefix={`d${d.id}_`} defaults={project.defaultProfile} />
            </Panel>
          ))}
          <StickyBar>
            <Button variant="primary" iconEnd={onboarding ? "arrow-right" : undefined}>
              {onboarding ? "Save and see the dashboard" : "Save"}
            </Button>
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
  if (!repo) return problemPage(c, { title: "Import", status: 400, heading: "That isn't a GitHub repo URL", body: <p>Use the form <code>https://github.com/owner/repo</code>.</p>, back: { href: `/app/projects/${project.id}`, label: "Back to the project" } });
  const running = await latestImport(c.get("ctx"), project.id);
  // "Import again" keeps the project's GitHub App installation; a different repo is a public import.
  const installation = project.githubInstallationId && repo.toLowerCase() === project.repoFullName?.toLowerCase() ? project.githubInstallationId : null;
  if (installation && (await getAccount(c)).plan !== "team")
    return upgradePage(c, { title: "Import", heading: "Private repos are on the Team plan", body: <p>This project's repo is private, imported through the GitHub App. Team keeps it in sync on every push that changes a manifest.</p>, back: { href: `/app/projects/${project.id}`, label: "Back to the project" } });
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
  // The onboarding stepper only while the project is still empty, as on the picker.
  const fresh = !(await ctx.db.select({ id: deps.id }).from(deps).where(eq(deps.projectId, project.id)).get());
  if (imp.status === "failed")
    return page(
      c,
      "Import failed",
      <>
        {fresh && <Onboarding at={1} />}
        <PageHeader
          crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]}
          title={
            <>
              Couldn't import <span class="repo">{imp.repo}</span>
            </>
          }
        />
        <Callout tone="error" title="Import failed">
          {imp.error}
        </Callout>
        <p class="muted">Nothing is lost: the project is there, and you can tick its services by hand in a minute.</p>
        <div class="cluster">
          <ButtonLink variant="primary" href={`/app/projects/${project.id}/services`} iconEnd="arrow-right">
            Pick services instead
          </ButtonLink>
          <ButtonLink href={`/app/projects/${project.id}`}>Back to the project</ButtonLink>
        </div>
      </>,
      { noindex: true },
    );
  const at = Math.max(0, IMPORT_STEPS.findIndex((s) => s.step === imp!.step));
  return page(
    c,
    "Importing",
    <>
      {fresh && <Onboarding at={1} />}
      <PageHeader crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]} title={<>Importing <span class="repo">{imp.repo}…</span></>} description="Reading its manifests to find the services, runtimes and packages it uses. This usually takes under 30 seconds; the page refreshes itself." />
      <div class="import-progress panel" id="import-live">
        {/* Read out on each step change; the checklist below shows the same thing, so it is for screen readers only. */}
        <p class="ps-status visually-hidden" role="status">
          Step <span class="num">{at + 1}</span> of <span class="num">{IMPORT_STEPS.length}</span>: {IMPORT_STEPS[at].label}
        </p>
        <div class="ps-body">
          <ProgressSteps label="Import progress" current={at} steps={IMPORT_STEPS.map((s) => ({ label: s.label }))} />
          {imp.error && <p class="meta">Retrying after: {imp.error}</p>}
        </div>
        <details class="import-log">
          <summary>Details</summary>
          <ol class="log">
            {st.log.map((l) => (
              <li>{l}</li>
            ))}
          </ol>
        </details>
      </div>
      <p class="meta">
        You can leave this page: the import finishes in the background and the project fills in. <a href={`/app/projects/${project.id}/services`}>Pick services by hand instead</a>.
      </p>
      <script>{raw(IMPORT_JS)}</script>
    </>,
    {
      noindex: true,
      // Without JS the page reloads itself; with JS it fetches itself and swaps the progress in place.
      head: (
        <noscript>
          <meta http-equiv="refresh" content="1" />
        </noscript>
      ),
    },
  );
});

/** Each fetch runs one import step (as a reload would); a redirect means done, a page without progress means failed. */
const IMPORT_JS = `(()=>{const tick=async()=>{try{const r=await fetch(location.href,{headers:{accept:'text/html'}});
if(r.redirected){location.replace(r.url);return}
const d=new DOMParser().parseFromString(await r.text(),'text/html'),n=d.getElementById('import-live'),o=document.getElementById('import-live');
if(!n||!o){location.reload();return}
const open=o.querySelector('details')?.open;o.querySelector('.ps-body').replaceWith(n.querySelector('.ps-body'));
const s=n.querySelector('.ps-status').textContent;if(o.querySelector('.ps-status').textContent!==s)o.querySelector('.ps-status').textContent=s;
o.querySelector('details').replaceWith(n.querySelector('details'));if(open)o.querySelector('details').open=true}catch{}setTimeout(tick,1000)};setTimeout(tick,1000)})();`;

/** The import's steps in order (src/stack/import.ts), for the progress page. */
const IMPORT_STEPS: { step: string; label: string }[] = [
  { step: "repo", label: "Read the repository" },
  { step: "tree", label: "List its folders" },
  { step: "fetch", label: "Read the manifest files" },
  { step: "rank", label: "Rank packages by downloads" },
  { step: "write", label: "Match them to the catalog" },
];

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
  const view = (await projectDeps(ctx, project)).find((v) => v.dep.id === dep.id);
  const level = view ? depLevel(view, now) : "quiet";
  const risk = view ? riskOf(view, now) : "other";
  const csrf = c.get("csrf");
  const type = entry ? CATEGORY_LABELS[entry.category] : dep.ecosystem === "eol" ? "Runtime" : `${dep.ecosystem} package`;
  return page(
    c,
    name,
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Dashboard" }, { href: `/app/projects/${project.id}`, label: project.name }]}
        kicker={type}
        title={`${name}${dep.eolCycle ? ` ${dep.eolCycle}` : ""}`}
        description={view?.detail || undefined}
      />
      <Flash msg={flash(c)} />
      {!muted && (
        <p class="dep-status">
          <Severity level={level} />{" "}
          <span>
            {risk === "other" ? "No known risk." : risk === "recent" ? <>Changed recently, on <time>{fmtDate(view!.latest!.publishedAt)}</time>. The change is below.</> : `${RISK_LABELS[risk]}.`}
          </span>
        </p>
      )}
      <div class="split">
        <div class="main-col">
          {muted && (
            <Callout tone="info" title={`Muted until ${fmtDate(dep.mutedUntil)}`}>
              No alerts for this dependency until then. Unmute it under <a href="#alerts-for-it">Alerts for it</a>.
            </Callout>
          )}
          <h2>Changes</h2>
          {evs.length ? (
            <EventList events={evs} subject={false} />
          ) : (
            <EmptyState title="No published changes yet" level={3} icon="eye">
              We check its sources several times a day and publish a note when something changes the deal.
            </EmptyState>
          )}
          <h2>Your alerts</h2>
          {!depAlerts.some((a) => a.status !== "suppressed") && (
            <p class="muted">{muted ? "No alerts while it is muted." : "No alerts about it yet. When a change affects how you use it, it appears here and in your email."}</p>
          )}
          <AlertList list={depAlerts} csrf={csrf} back={`/app/deps/${dep.id}`} showDep={false} empty={false} />
          {dims.length > 0 && (
            <>
              <h2>How you use it</h2>
              <form method="post" action={`/app/deps/${dep.id}/profile`} class="panel">
                <Csrf token={csrf} />
                <ProfileFields profile={dep.profile} dims={dims} defaults={project.defaultProfile} />
                <p class="meta">Assumed now: {assumed === "not set" ? "nothing yet, so every change counts as affecting you" : assumed}.</p>
                <Button variant="primary">Save</Button>
              </form>
            </>
          )}
        </div>
        <aside class="rail" aria-label="About this dependency">
          <Panel title="About">
            <DataList
              label="About this dependency"
              items={[
                { term: "What", value: entry ? <a href={`/catalog/${entry.id}`}>In the catalog</a> : dep.ecosystem === "eol" ? "Runtime" : `${dep.ecosystem} package${dep.versionSpec ? ` ${dep.versionSpec}` : ""}` },
                { term: "Added", value: <>{dep.origin === "import" ? "By repo import" : "By you"}{dep.foundIn?.length ? <>, from {dep.foundIn.slice(0, 4).map((f, i) => <>{i ? ", " : ""}<code>{f}</code></>)}</> : ""}</> },
                ...(dep.rank ? [{ term: "Importance", value: <span class="num">#{dep.rank}</span> }] : []),
              ]}
            />
          </Panel>
          <Panel title="What we watch">
            {linked.length ? (
              <ul class="source-list dep-sources">
                {linked.map((s) => {
                  const href = safeHref(s.kind === "npm" ? `https://www.npmjs.com/package/${s.key}` : s.kind === "pypi" ? `https://pypi.org/project/${s.key}/` : s.kind === "github_repo" ? `https://github.com/${s.key}` : s.kind === "eol" ? `https://endoflife.date/${s.key.split("@")[0]}` : s.url);
                  return (
                    <li>
                      <span class="src-kind">{SOURCE_LABELS[s.kind] ?? s.kind}</span>
                      <span class="overflow-anywhere">
                        {href ? (
                          <a href={href} rel="noopener noreferrer nofollow">
                            {s.kind === "page" || s.kind === "feed" ? s.url : s.key}
                          </a>
                        ) : (
                          s.key
                        )}
                      </span>
                      {s.state !== "active" ? <Badge tone="act">{s.state}</Badge> : <span class="meta">{s.lastOkAt ? <>checked <time>{fmtDate(s.lastOkAt)}</time></> : "first check pending"}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p class="muted">{dep.ecosystem && !WATCHED_ECOSYSTEMS.has(dep.ecosystem) && dep.ecosystem !== "eol" ? `We don't watch ${dep.ecosystem} packages yet.` : "No sources yet."}</p>
            )}
          </Panel>
          <Panel title="Alerts for it" id="alerts-for-it">
            {muted ? (
              <form method="post" action={`/app/deps/${dep.id}/unmute`} class="stack-sm">
                <Csrf token={csrf} />
                <p class="meta">
                  Muted until <time>{fmtDate(dep.mutedUntil)}</time>.
                </p>
                <Button>Unmute</Button>
              </form>
            ) : (
              <form method="post" action={`/app/deps/${dep.id}/mute`} class="stack-sm">
                <Csrf token={csrf} />
                <p class="meta">Too noisy? Mute it: changes still show here, but we don't email you about it for 90 days.</p>
                <Button icon="bell-off">Mute for 90 days</Button>
              </form>
            )}
            <form method="post" action={`/app/deps/${dep.id}/delete`} class="stack-sm rail-danger">
              <Csrf token={csrf} />
              <Button variant="danger" icon="trash">
                Stop watching
              </Button>
            </form>
          </Panel>
        </aside>
      </div>
    </>,
    { noindex: true },
  );
});

/** Source kinds in words, for the dep page. */
const SOURCE_LABELS: Record<string, string> = { npm: "npm", pypi: "PyPI", github_repo: "GitHub", eol: "End-of-life dates", page: "Page", feed: "Feed" };

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
  if ((await getAccount(c)).plan !== "team")
    return upgradePage(c, { title: "Export", heading: "CSV export is on the Team plan", body: <p>Team exports every dependency across your projects with its risk, latest change and a link to the note: a vendor-risk register for audits and reviews, in one click.</p> });
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

const PlanSection: FC<{ c: WebContext; user: typeof users.$inferSelect; account: Awaited<ReturnType<typeof getAccount>>; billing: boolean; projectsUsed: number }> = ({ c, user, account, billing, projectsUsed }) => {
  const csrf = c.get("csrf");
  if (account.role === "member")
    return (
      <Panel title="Plan" id="plan">
        <p>
          <Badge tone="info">Team</Badge> through <strong>{account.ownerEmail}</strong>'s team. They manage billing.
        </p>
        <ButtonLink href="/app/team" icon="users">
          Team page
        </ButtonLink>
      </Panel>
    );
  if (user.plan === "team")
    return (
      <Panel title="Plan" id="plan">
        <DataList
          items={[
            { term: "Current", value: <Badge tone="info">Team</Badge> },
            ...(user.planInterval ? [{ term: "Billed", value: <>{user.planInterval === "year" ? "yearly" : "monthly"}, <span class="num">${user.planInterval === "year" ? PRICES.year : PRICES.month}</span></> }] : []),
            ...(user.planPeriodEnd ? [{ term: user.cancelAtPeriodEnd ? "Ends on" : "Renews on", value: <time>{fmtDate(user.planPeriodEnd)}</time> }] : []),
          ]}
        />
        {user.planStatus === "past_due" && (
          <Callout tone="error" title="Payment failed">
            Update your card in the billing portal to keep Team.
          </Callout>
        )}
        <div class="cluster">
          <ButtonLink href="/app/team" icon="users">
            Manage the team
          </ButtonLink>
          {billing && user.stripeCustomerId && (
            <form method="post" action="/app/billing/portal" class="inline">
              <Csrf token={csrf} />
              <Button>Billing, invoices and cancelling</Button>
            </form>
          )}
        </div>
      </Panel>
    );
  return (
    <Panel title="Plan" id="plan">
      <DataList
        items={[
          { term: "Current", value: <Badge>Free</Badge> },
          {
            term: "Projects",
            value: (
              <>
                <span class="num">
                  {projectsUsed} of {FREE_PROJECTS}
                </span>{" "}
                used
              </>
            ),
          },
          { term: "Alerts", value: "Email, at most 3 a day, and the weekly digest" },
        ]}
      />
      <div class="upgrade-inline">
        <h3>Team adds</h3>
        <ul class="plan-features">
          {TEAM_FEATURES.map((f) => (
            <li>
              <Icon name="check" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        {billing ? (
          <form method="post" action="/app/billing/checkout" class="cluster">
            <Csrf token={csrf} />
            <Button variant="primary" name="interval" value="month">
              Team, ${PRICES.month}/month
            </Button>
            <Button name="interval" value="year">
              ${PRICES.year}/year (2 months free)
            </Button>
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
          {billing && "Payment by Stripe; cancel any time from the billing portal. "}
          <a href="/pricing">Compare plans</a>
        </p>
      </div>
    </Panel>
  );
};

app.get("/settings", async (c) => {
  const user = c.get("user")!;
  const ctx = c.get("ctx");
  const account = await getAccount(c);
  const slack = await ctx.db.select().from(channels).where(and(eq(channels.userId, user.id), eq(channels.kind, "slack"))).get();
  const billingMsg = c.req.query("billing") === "success" ? (user.plan === "team" ? "Welcome to Team. Thanks for subscribing." : "Thanks. Stripe is confirming the payment; this page shows Team within a minute.") : undefined;
  const csrf = c.get("csrf");
  return page(
    c,
    "Settings",
    <>
      <PageHeader title="Settings" description={<>Signed in as <strong>{user.email}</strong>{user.githubId ? " (GitHub sign-in linked)" : ""}.</>} />
      <Flash msg={billingMsg ?? flash(c)} />
      <div class="split">
      <div class="settings main-col">
        <Panel title="Alerts" id="alerts">
          <form method="post" action="/app/settings">
            <Csrf token={csrf} />
            <label class="check">
              <input type="checkbox" name="email_immediate" value="1" checked={user.emailImmediate} aria-describedby="immediate-hint" />
              <span>Email urgent changes as they happen</span>
            </label>
            <p class="hint" id="immediate-hint">
              Licence changes, end-of-life within 6 months, shutdowns after an acquisition and free-tier changes. At most 3 a day; anything else waits for the weekly digest. Untick to get the digest only.
            </p>
            <div class="field">
              <label for="digest_day">Send the weekly digest on</label>
              <select id="digest_day" name="digest_day">
                {DAYS.map((d, i) => (
                  <option value={String(i)} selected={user.digestDay === i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="primary">Save</Button>
          </form>
        </Panel>
        <Panel title="Email" id="email-address">
          <form method="post" action="/app/settings/email">
            <Csrf token={csrf} />
            <p>
              Alerts go to <strong>{user.email}</strong>.
            </p>
            <Field id="email" type="email" label="Change to" required autocomplete="email" hint="We send a confirmation link to the new address; nothing changes until you open it." />
            <Button icon="mail">Send a confirmation link</Button>
          </form>
        </Panel>
        <Panel title="Slack" id="slack" meta={account.plan === "team" && slack ? <Badge tone="ok" icon="check">Connected</Badge> : undefined}>
          {!ctx.config.channelKey ? (
            <p class="muted">Slack alerts are not available on this server yet.</p>
          ) : account.plan !== "team" ? (
            <p class="muted">
              Slack alerts are on the <a href="/pricing">Team plan</a>.{slack ? ` Your webhook ending …${slack.hint} is kept but gets nothing until then.` : ""}
            </p>
          ) : slack ? (
            <form method="post" action="/app/settings/slack/delete">
              <Csrf token={csrf} />
              <p>
                Urgent alerts also go to a Slack channel (webhook ending …{slack.hint}, added {fmtDate(slack.createdAt)}).
              </p>
              {slack.lastError && <Callout tone="error" title="Last error">{slack.lastError}</Callout>}
              <Button variant="danger">Disconnect Slack</Button>
            </form>
          ) : (
            <form method="post" action="/app/settings/slack">
              <Csrf token={csrf} />
              <p class="muted">Post urgent alerts to a channel too. In Slack, create an app with an incoming webhook for the channel and paste its URL. We post a test message first.</p>
              <Field id="slack_url" name="url" type="url" label="Incoming webhook URL" required placeholder="https://hooks.slack.com/services/T…/B…/…" autocomplete="off" wide />
              <Button icon="slack">Connect Slack</Button>
            </form>
          )}
        </Panel>
        <PlanSection c={c} user={user} account={account} billing={!!ctx.config.stripe} projectsUsed={await projectCount(ctx, user.id)} />
        <Panel title="Delete account" id="delete" danger>
          <form method="post" action="/app/settings/delete">
            <Csrf token={csrf} />
            <p>
              {account.role === "member" ? (
                <>This removes your account, your own projects, your alerts, Slack connection and sessions, and takes you off {account.ownerEmail}'s team. The team's projects stay. It can't be undone.</>
              ) : (
                <>This removes your account, projects, dependencies, alerts, Slack connection, team and sessions{user.stripeSubscriptionId && user.plan === "team" ? ", and cancels your Team subscription now" : ""}. Public events stay, since they are not yours. It can't be undone.</>
              )}
            </p>
            <Field id="confirm" label="Type DELETE to confirm" autocomplete="off" required />
            <Button variant="danger" icon="trash">
              Delete my account
            </Button>
          </form>
        </Panel>
      </div>
      <nav class="rail settings-nav" aria-label="Settings sections">
        <p class="kicker">On this page</p>
        <ul>
          <li><a href="#alerts">Alerts</a></li>
          <li><a href="#email-address">Email</a></li>
          <li><a href="#slack">Slack</a></li>
          <li><a href="#plan">Plan</a></li>
          <li><a href="#delete">Delete account</a></li>
        </ul>
      </nav>
      </div>
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

const slackProblem = (c: WebContext, why: string) => problemPage(c, { title: "Slack", status: 400, heading: "Slack wasn't connected", body: <p>{why}</p>, back: { href: "/app/settings", label: "Back to settings" } });

app.post("/settings/slack", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.config.channelKey) return c.notFound();
  if ((await getAccount(c)).plan !== "team") return upgradePage(c, { title: "Slack", heading: "Slack alerts are on the Team plan", body: <p>Team posts urgent alerts to a Slack channel as well as by email.</p>, back: { href: "/app/settings", label: "Back to settings" } });
  const form = await c.req.parseBody();
  const url = validSlackWebhook(str(form.url, 300));
  if (!url) return slackProblem(c, "That isn't a Slack incoming webhook URL. It should look like https://hooks.slack.com/services/T…/B…/…");
  const test = await postSlack(ctx, url, { text: "Stackquake is connected. Urgent changes to your stack will be posted here." });
  if (!test.ok) return slackProblem(c, `Slack didn't accept the test message (${test.error}). Check the URL and that the app is still installed.`);
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
  if (!validEmail(email)) return problemPage(c, { title: "Settings", status: 400, heading: "That doesn't look like an email address", back: { href: "/app/settings", label: "Back to settings" } });
  if (!(await magicLinkAllowed(c, email))) return problemPage(c, { title: "Slow down", status: 429, heading: "Too many emails requested", body: <p>Try again in an hour.</p>, back: { href: "/app/settings", label: "Back to settings" } });
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
      return problemPage(c, { title: "Settings", status: 503, heading: "Account not deleted", body: <p>We couldn't cancel your subscription with Stripe, so nothing was deleted. Try again in a minute, or cancel it first from the billing portal.</p>, back: { href: "/app/settings", label: "Back to settings" } });
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
