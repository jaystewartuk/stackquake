// Signed-in pages (SPEC §7.6): dashboard, projects, the service picker (the first onboarding
// step, SPEC §2 Positioning), repo import, usage profiles, deps and settings. Every project and
// dep is loaded through ownProject/ownDep, which scope by the signed-in user: another user's ids
// are a 404.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { CATALOG } from "../catalog/entries";
import { encrypt } from "../alerts/secretbox";
import { postSlack, validSlackWebhook } from "../alerts/slack";
import { alerts, catalogRequests, channels, deps, FEEDBACK, imports, jobs, magicLinks, projects, sessions, sources, users, type Dep, type Feedback, type Profile, type Project } from "../db/schema";
import { addCatalogDeps, deleteDeps } from "../stack/deps";
import { importJobKey, kickImport, latestImport, parseRepoInput, startImport, type ImportState } from "../stack/import";
import { describeProfile, DIMENSIONS, effectiveProfile, profileFromForm, QUESTIONS, questionsFor, type Dimension } from "../stack/profile";
import { MUTE_MS } from "./alert-links";
import { AlertList, userAlerts } from "./alerts-view";
import { magicLinkAllowed, normaliseEmail, sendMagicLink, validEmail } from "./auth";
import { catalogEntry, exactMatch, groupByCategory, searchCatalog, searchText } from "./catalog-view";
import { EventRow, publishedEvents } from "./events-view";
import { Csrf, fmtDate, page, safeHref } from "./layout";
import { endSession, requireUser, type WebContext, type WebEnv } from "./session";
import { depName, loadDeps, projectDeps, StackView, WATCHED_ECOSYSTEMS } from "./stack-view";

export const app = new Hono<WebEnv>();
app.use("*", requireUser);

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const uid = (c: WebContext) => c.get("user")!.id;
const idParam = (c: WebContext) => {
  const n = Number(c.req.param("id"));
  return Number.isSafeInteger(n) && n > 0 ? n : -1;
};
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function ownProject(c: WebContext): Promise<Project | undefined> {
  return c.get("ctx").db.select().from(projects).where(and(eq(projects.id, idParam(c)), eq(projects.userId, uid(c)))).get();
}

async function ownDep(c: WebContext): Promise<{ dep: Dep; project: Project } | undefined> {
  const row = await c
    .get("ctx")
    .db.select({ dep: deps, project: projects })
    .from(deps)
    .innerJoin(projects, eq(projects.id, deps.projectId))
    .where(and(eq(deps.id, idParam(c)), eq(projects.userId, uid(c))))
    .get();
  return row ?? undefined;
}

const Flash: FC<{ msg?: string }> = ({ msg }) => (msg ? <p class="flash">{msg}</p> : null);

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
};
const flash = (c: WebContext) => MESSAGES[c.req.query("msg") ?? ""];

// ---------- Dashboard ----------

app.get("/", async (c) => {
  const ctx = c.get("ctx");
  const list = await ctx.db.select().from(projects).where(eq(projects.userId, uid(c))).orderBy(asc(projects.id)).all();
  if (!list.length) return c.redirect("/app/projects/new");
  const byProject = await loadDeps(ctx, list);
  const recent = await userAlerts(ctx, uid(c), { limit: 30 });
  const now = ctx.clock.now();
  return page(
    c,
    "Dashboard",
    <>
      <div class="spread">
        <h1>Your stack</h1>
        <a class="btn" href="/app/projects/new">
          New project
        </a>
      </div>
      <Flash msg={flash(c)} />
      {recent.length > 0 && (
        <section class="card">
          <h2 style="margin-top:0">Alerts</h2>
          <AlertList list={recent} csrf={c.get("csrf")} back="/app" />
        </section>
      )}
      {list.map((p) => {
        const ds = byProject.get(p.id)!;
        return (
          <section class="card">
            <div class="spread">
              <h2 style="margin:0">
                <a href={`/app/projects/${p.id}`}>{p.name}</a>
              </h2>
              <span class="meta">
                {ds.length} watched{p.repoFullName ? ` · ${p.repoFullName}` : ""}
              </span>
            </div>
            {ds.length ? (
              <StackView list={ds} now={now} />
            ) : (
              <p>
                Nothing here yet. <a href={`/app/projects/${p.id}/services`}>Pick what you run on</a>.
              </p>
            )}
          </section>
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
        <fieldset>
          <legend>{q.label}</legend>
          {q.options.map((o) => (
            <label>
              <input type="radio" name={`${prefix}${d}`} value={o.value} checked={profile[d] === o.value} /> {o.label}
            </label>
          ))}
          <label>
            <input type="radio" name={`${prefix}${d}`} value="" checked={!profile[d]} /> {defaults ? (def ? `Project default (${def.toLowerCase()})` : "Not sure") : "Not sure / it varies"}
          </label>
        </fieldset>
      );
    })}
  </>
);

app.get("/projects/new", (c) => {
  return page(
    c,
    "New project",
    <>
      <h1>What do you run on?</h1>
      <p class="muted">Start a project, then pick the services, runtimes and tools it uses. Have a public repo? Paste it and we'll pre-fill the list.</p>
      <form method="post" action="/app/projects" class="card">
        <Csrf token={c.get("csrf")} />
        <label for="name">Project name</label>
        <input type="text" id="name" name="name" value="My stack" required maxlength={80} />
        <details>
          <summary>Defaults for every dependency (optional)</summary>
          <p class="meta">Used when you don't answer for a dependency. Unknown means we assume a change affects you.</p>
          <ProfileFields profile={{}} />
        </details>
        <p class="row" style="margin-top:1rem">
          <button class="primary" type="submit" name="next" value="pick">
            Pick services
          </button>
        </p>
        <label for="repo">Or import a public GitHub repo</label>
        <div class="row">
          <input type="url" id="repo" name="repo" placeholder="https://github.com/owner/repo" style="flex:1;min-width:14rem" inputmode="url" />
          <button type="submit" name="next" value="import">
            Import
          </button>
        </div>
        <p class="meta">We read up to 30 manifest files (package.json, pyproject.toml, Dockerfile, wrangler.toml…) through the GitHub API. Private repos need the GitHub App, coming soon.</p>
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
  const wantsImport = form.next === "import" || (form.next !== "pick" && repoInput !== "");
  const repo = wantsImport ? parseRepoInput(repoInput) : null;
  if (wantsImport && !repo) {
    return page(c, "New project", <><h1>That isn't a GitHub repo URL</h1><p>Use the form <code>https://github.com/owner/repo</code>.</p><p><a href="/app/projects/new">Back</a></p></>, { status: 400, noindex: true });
  }
  const [project] = await ctx.db
    .insert(projects)
    .values({ userId: uid(c), name, defaultProfile: profileFromForm(form), createdAt: ctx.clock.now() })
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
      <p class="meta">
        <a href="/app">Dashboard</a>
      </p>
      <div class="spread">
        <h1>{project.name}</h1>
        <span class="row">
          <a class="btn primary" href={`/app/projects/${project.id}/services`}>
            Add or remove services
          </a>
          <a class="btn" href={`/app/projects/${project.id}/profiles`}>
            How you use them
          </a>
        </span>
      </div>
      <Flash msg={flash(c)} />
      {list.length ? <StackView list={list} now={ctx.clock.now()} /> : <p>Nothing watched yet.</p>}
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
          <input type="url" name="repo" placeholder="https://github.com/owner/repo" style="flex:1;min-width:14rem" required />
          <button type="submit">Import a public repo</button>
        </form>
      )}
      <h2>Project settings</h2>
      <form method="post" action={`/app/projects/${project.id}`} class="card">
        <Csrf token={c.get("csrf")} />
        <label for="name">Name</label>
        <input type="text" id="name" name="name" value={project.name} required maxlength={80} />
        <p class="meta">Defaults for every dependency you haven't answered for:</p>
        <ProfileFields profile={project.defaultProfile} />
        <button type="submit">Save</button>
      </form>
      <form method="post" action={`/app/projects/${project.id}/delete`}>
        <Csrf token={c.get("csrf")} />
        <button class="danger" type="submit">
          Delete this project
        </button>
      </form>
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
      <p class="meta">
        <a href={`/app/projects/${project.id}`}>{project.name}</a>
      </p>
      <h1>What do you run on?</h1>
      {imp && counts && (
        <p class="flash">
          Imported {imp.repo}: we found {counts.catalog} services and tools{counts.runtimes ? `, ${counts.runtimes} runtimes` : ""} and {counts.packages} packages. The ones we recognised are ticked; untick anything you don't use.
        </p>
      )}
      <p class="muted">Tick the hosting, databases, APIs and runtimes this project uses. We watch their pricing, free tiers, terms, licences and end-of-life dates.</p>
      <form method="post" action={`/app/projects/${project.id}/services`}>
        <Csrf token={c.get("csrf")} />
        <input type="search" id="q" name="q" value={q} placeholder="Search, e.g. postgres, stripe, workers" aria-label="Search the catalog" autocomplete="off" />
        {groups.map((g) => (
          <section data-g="1">
            <h2>{g.label}</h2>
            <div class="grid">
              {g.entries.map((e) => (
                <label class="pick" data-s={searchText(e)}>
                  <input type="checkbox" name="ids" value={e.id} checked={have.has(e.id)} />
                  <span>
                    {e.name}
                    {imported.has(e.id) && <span class="meta"> · found in repo</span>}
                    {e.aliases?.length ? <span class="meta" style="display:block">{e.aliases.slice(0, 3).join(", ")}</span> : null}
                  </span>
                  <input type="hidden" name="shown" value={e.id} />
                </label>
              ))}
            </div>
          </section>
        ))}
        <p id="none" class="flash" hidden={groups.length > 0}>
          Not in the catalog yet. Send it as a request below and we'll consider adding it.
        </p>
        <label for="request">Something missing? Tell us what you use</label>
        <input type="text" id="request" name="request" maxlength={200} placeholder="e.g. Upstash, Hetzner Cloud" value={groups.length === 0 ? q : ""} />
        <div class="sticky row">
          <button class="primary" type="submit">
            Save and continue
          </button>
          <a href={`/app/projects/${project.id}`}>Cancel</a>
        </div>
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
      <p class="meta">
        <a href={`/app/projects/${project.id}`}>{project.name}</a>
      </p>
      <h1>How do you use them?</h1>
      <Flash msg={flash(c)} />
      <p class="muted">Optional. It lets us skip changes that don't apply to you (a self-hosting licence change when you use the hosted service, say). Anything you leave unanswered counts as affected.</p>
      {asked.length === 0 ? (
        <p>
          Nothing to ask: none of this project's services have usage questions. <a href={`/app/projects/${project.id}`}>Go to the project</a>.
        </p>
      ) : (
        <form method="post" action={`/app/projects/${project.id}/profiles`}>
          <Csrf token={c.get("csrf")} />
          {asked.map(({ d, entry }) => (
            <section class="card">
              <h3 style="margin-top:0">{entry!.name}</h3>
              <ProfileFields profile={d.profile} dims={questionsFor(entry)} prefix={`d${d.id}_`} defaults={project.defaultProfile} />
            </section>
          ))}
          <div class="sticky row">
            <button class="primary" type="submit">
              Save
            </button>
            <a href={`/app/projects/${project.id}`}>Skip</a>
          </div>
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
  if (running?.status !== "running") await startImport(c.get("ctx"), project.id, repo);
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
      <p class="meta">
        <a href={`/app/projects/${project.id}`}>{project.name}</a>
      </p>
      <h1>
        {name}
        {dep.eolCycle ? ` ${dep.eolCycle}` : ""}
      </h1>
      <Flash msg={flash(c)} />
      <p class="meta">
        {entry ? (
          <a href={`/catalog/${entry.id}`}>In the catalog</a>
        ) : dep.ecosystem === "eol" ? (
          "Runtime"
        ) : (
          `${dep.ecosystem} package${dep.versionSpec ? ` ${dep.versionSpec}` : ""}`
        )}
        {" · "}
        {dep.origin === "import" ? "found by repo import" : "added by you"}
        {dep.foundIn?.length ? ` in ${dep.foundIn.slice(0, 4).join(", ")}` : ""}
        {dep.rank ? ` · importance #${dep.rank}` : ""}
      </p>
      <h2>Changes</h2>
      {evs.length ? (
        <ul class="plain">
          {evs.map((e) => (
            <EventRow e={e} />
          ))}
        </ul>
      ) : (
        <p class="muted">No published changes yet.</p>
      )}
      {dims.length > 0 && (
        <>
          <h2>How you use it</h2>
          <form method="post" action={`/app/deps/${dep.id}/profile`} class="card">
            <Csrf token={c.get("csrf")} />
            <ProfileFields profile={dep.profile} dims={dims} defaults={project.defaultProfile} />
            <p class="meta">Assumed now: {assumed === "not set" ? "nothing yet, so every change counts as affecting you" : assumed}.</p>
            <button type="submit">Save</button>
          </form>
        </>
      )}
      <h2>What we watch</h2>
      {linked.length ? (
        <ul>
          {linked.map((s) => {
            const href = safeHref(s.kind === "npm" ? `https://www.npmjs.com/package/${s.key}` : s.kind === "pypi" ? `https://pypi.org/project/${s.key}/` : s.kind === "github_repo" ? `https://github.com/${s.key}` : s.kind === "eol" ? `https://endoflife.date/${s.key.split("@")[0]}` : s.url);
            return (
              <li>
                {s.kind}: {href ? <a href={href} rel="noopener noreferrer nofollow">{s.kind === "page" || s.kind === "feed" ? s.url : s.key}</a> : s.key}{" "}
                {s.state !== "active" ? <span class="pill bad">{s.state}</span> : <span class="meta">{s.lastOkAt ? `checked ${fmtDate(s.lastOkAt)}` : "first check pending"}</span>}
              </li>
            );
          })}
        </ul>
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
            <button type="submit">Unmute</button>
          </form>
        ) : (
          <form method="post" action={`/app/deps/${dep.id}/mute`}>
            <Csrf token={c.get("csrf")} />
            <button type="submit">Mute for 90 days</button>
          </form>
        )}
        <form method="post" action={`/app/deps/${dep.id}/delete`}>
          <Csrf token={c.get("csrf")} />
          <button class="danger" type="submit">
            Stop watching
          </button>
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

// ---------- Settings ----------

app.get("/settings", async (c) => {
  const user = c.get("user")!;
  const ctx = c.get("ctx");
  const slack = await ctx.db.select().from(channels).where(and(eq(channels.userId, user.id), eq(channels.kind, "slack"))).get();
  return page(
    c,
    "Settings",
    <>
      <h1>Settings</h1>
      <Flash msg={flash(c)} />
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
      <p>Free. Paid plans with private repos come later.</p>
      <h2>Delete account</h2>
      <form method="post" action="/app/settings/delete" class="card">
        <Csrf token={c.get("csrf")} />
        <p>This removes your account, projects, dependencies, alerts, Slack connection and sessions. Public events stay, since they are not yours. It can't be undone.</p>
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
  const owned = await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.userId, user.id)).orderBy(desc(projects.id)).all();
  for (const p of owned) await deleteProject(c, p.id);
  // SPEC §8: user, projects, deps, alerts and channels go; sources and events are global and stay.
  await ctx.db.run(sql`DELETE FROM jobs WHERE kind = 'deliver' AND json_extract(payload, '$.alertId') IN (SELECT id FROM alerts WHERE user_id = ${user.id})`);
  await ctx.db.run(sql`DELETE FROM jobs WHERE kind = 'digest' AND json_extract(payload, '$.userId') = ${user.id}`);
  await ctx.db.delete(alerts).where(eq(alerts.userId, user.id));
  await ctx.db.delete(channels).where(eq(channels.userId, user.id));
  await ctx.db.delete(catalogRequests).where(eq(catalogRequests.userId, user.id));
  await ctx.db.delete(magicLinks).where(eq(magicLinks.email, user.email));
  await endSession(c);
  await ctx.db.delete(sessions).where(eq(sessions.userId, user.id));
  await ctx.db.delete(users).where(eq(users.id, user.id));
  return c.redirect("/?deleted=1");
});
