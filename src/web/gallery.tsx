// The component gallery at /__dev/ui (local only, behind DEV_ROUTES): every shared component in
// every state, once in the light scheme and once in the dark, side by side.
import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { TEAM_FEATURES } from "../billing/plans";
import type { Dep, User } from "../db/schema";
import { AlertItem, AlertList, type AlertRow } from "./alerts-view";
import { DepRow, StackView, type DepView } from "./stack-view";
import { KIND_LABELS, KindPill } from "./events-view";
import { Icon, ICON_NAMES } from "./icons";
import { Layout, SiteHeader } from "./layout";
import { schemeVars } from "./styles/tokens";
import {
  AuthShell,
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Callout,
  Choice,
  DataList,
  DataTable,
  EmptyState,
  Field,
  InputGroup,
  NoteCard,
  OptionCard,
  PageHeader,
  Panel,
  PickTile,
  Quote,
  Severity,
  StatusLine,
  StickyBar,
  Tabs,
  Trace,
  DiffView,
  ProgressSteps,
  Stepper,
  UpgradePanel,
} from "./ui";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 11);
const USER = { id: 1, email: "dev@example.com" } as User;
const dep = (id: number, extra: Partial<Dep> = {}) => ({ id, projectId: 1, catalogId: null, ecosystem: null, package: null, eolProduct: null, eolCycle: null, versionSpec: null, profile: {}, mutedUntil: null, rank: null, origin: "manual", foundIn: null, ...extra }) as unknown as Dep;
const DEPS: DepView[] = [
  { dep: dep(1), name: "Deno", detail: "", sources: 4, archived: false, deprecated: false, unlicensed: false, latest: { id: 1, title: "Deno runtime development ends in about a year", kind: "eol", publishedAt: NOW - 2 * DAY } },
  { dep: dep(2), name: "Vercel", detail: "hosted (their cloud), paid plan", sources: 3, archived: false, deprecated: false, unlicensed: false, latest: { id: 4, title: "Pro plan bandwidth now billed per GB above 1 TB", kind: "pricing", publishedAt: NOW - 20 * DAY } },
  { dep: dep(3, { ecosystem: "npm", package: "left-justify" }), name: "left-justify", detail: "npm 1.0.3", sources: 1, archived: false, deprecated: false, unlicensed: true },
  { dep: dep(4, { mutedUntil: NOW + 80 * DAY }), name: "Docker Desktop", detail: "", sources: 2, archived: false, deprecated: false, unlicensed: false, latest: { id: 9, title: "Docker Business price rises to $24 per user", kind: "pricing", publishedAt: NOW - 120 * DAY } },
  { dep: dep(5), name: "Supabase", detail: "hosted (their cloud), free tier", sources: 3, archived: false, deprecated: false, unlicensed: false },
];
const alert = (id: number, kind: string, status: AlertRow["status"], extra: Partial<AlertRow> = {}): AlertRow => ({ id, eventId: id, depId: id, channel: "email", status, held: null, because: "you self-host Redis in homelab.", feedback: null, createdAt: NOW, sentAt: NOW, emailedAt: NOW, slackAt: null, title: "Redis moves from BSD to a dual RSALv2 and SSPLv1 licence", kind, name: "Redis", ...extra });

const COLOURS = ["bg", "surface", "sunken", "line", "line-strong", "control", "fg", "muted", "subtle", "accent", "accent-text", "act", "watch", "info", "ok", "focus"];
const QUOTE = "We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.";

const Demo: FC<{ p: string }> = ({ p }) => (
  <>
    <h2>Colour</h2>
    <div class="swatches">
      {COLOURS.map((c) => (
        <div>
          <span style={`background:var(--${c})`} />
          <code>{c}</code>
        </div>
      ))}
    </div>

    <h2>Type</h2>
    <div class="stack-sm">
      <p class="kicker">Kicker · text-xs</p>
      <p style="font-size:var(--text-2xl);line-height:var(--lh-2xl);font-weight:700;letter-spacing:-.025em;margin:0">Landing h1</p>
      <p style="font-size:var(--text-xl);line-height:var(--lh-xl);font-weight:600;margin:0">Page title h1</p>
      <p style="font-size:var(--text-lg);line-height:var(--lh-lg);font-weight:600;margin:0">Section h2</p>
      <p class="lede">Lede: one sentence that sets up the page, in text-md and muted.</p>
      <p>
        Body text with <a href="#x">a link</a>, <strong>strong</strong>, <code>inline code</code> and a machine fact: <time>2027-10-01</time>, <span class="num">$19</span>, <span class="num">v20.11</span>.
      </p>
      <p class="meta">Meta text: secondary details, timestamps, counts.</p>
    </div>

    <h2>Shell</h2>
    <p class="meta">Signed out, on /events</p>
    <div class="panel flush" style="overflow:hidden">
      <SiteHeader csrf="" path="/events" navLabel={`Example ${p} 1`} />
    </div>
    <p class="meta">Signed in, on the dashboard</p>
    <div class="panel flush" style="overflow:hidden">
      <SiteHeader user={USER} csrf="" path="/app" navLabel={`Example ${p} 2`} />
    </div>
    <p class="meta">Admin, account menu open</p>
    <div class="panel flush" style="padding-bottom:13rem">
      <SiteHeader user={USER} csrf="" path="/admin" admin menuOpen navLabel={`Example ${p} 3`} />
    </div>

    <h2>Page header</h2>
    <div class="panel">
      <PageHeader
        crumbsLabel={`Breadcrumb (${p === "l" ? "light" : "dark"} demo)`}
        crumbs={[
          { href: "#x", label: "Dashboard" },
          { href: "#x", label: "platform" },
        ]}
        kicker={<KindPill kind="eol" />}
        title="Deno 1.46"
        description="Breadcrumb, kicker, title, description and actions. Actions wrap under the title on phones."
        actions={
          <>
            <ButtonLink href="#x" variant="primary">
              Primary action
            </ButtonLink>
            <ButtonLink href="#x">Secondary</ButtonLink>
          </>
        }
      />
    </div>

    <h2>Buttons</h2>
    <div class="stack-sm">
      <div class="cluster">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="quiet">Quiet</Button>
        <Button variant="danger">Danger</Button>
      </div>
      <div class="cluster">
        <Button variant="primary" size="sm">
          Small
        </Button>
        <Button variant="primary">Medium</Button>
        <Button variant="primary" size="lg">
          Large
        </Button>
      </div>
      <div class="cluster">
        <Button variant="primary" iconEnd="arrow-right">
          Continue
        </Button>
        <Button icon="github">Import</Button>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
        <Button size="sm" variant="quiet" icon="check" pressed>
          Useful
        </Button>
        <Button size="sm" variant="quiet" icon="x" pressed={false}>
          Not relevant
        </Button>
      </div>
      <div class="cluster">
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button disabled>Disabled</Button>
        <ButtonLink href="#x" disabled>
          Disabled link
        </ButtonLink>
        <button class="link" type="button">
          Text button
        </button>
      </div>
    </div>

    <h2>Fields</h2>
    <Field id={`${p}-email`} type="email" label="Email" placeholder="you@example.com" hint="We'll email you a link that signs you in." />
    <Field id={`${p}-bad`} type="email" label="Email" value="not-an-email" error="That doesn't look like an email address." />
    <div class="field">
      <label for={`${p}-sel`}>Weekly digest day</label>
      <select id={`${p}-sel`}>
        <option>Monday</option>
        <option>Friday</option>
      </select>
    </div>
    <div class="field">
      <label for={`${p}-ta`}>Note</label>
      <textarea id={`${p}-ta`} rows={2} />
    </div>
    <label for={`${p}-repo`}>Input group</label>
    <InputGroup>
      <input type="url" id={`${p}-repo`} placeholder="https://github.com/owner/repo" />
      <Button icon="github">Import</Button>
    </InputGroup>

    <h2>Choice and pick tiles</h2>
    <Choice
      legend="How do you run it?"
      name={`${p}-hosting`}
      options={[
        { value: "hosted", label: "Their hosted service", checked: true },
        { value: "self", label: "Self-hosted" },
        { value: "", label: "Not sure / it varies" },
      ]}
    />
    <Choice
      legend="Checkbox chips"
      type="checkbox"
      name={`${p}-days`}
      options={[
        { value: "a", label: "Email", checked: true },
        { value: "b", label: "Slack", checked: true },
        { value: "c", label: "Digest only" },
      ]}
    />
    <div class="pick-grid">
      <PickTile name={`${p}-ids`} value="a" label="Cloudflare Workers" sub="workers, wrangler" />
      <PickTile name={`${p}-ids`} value="b" label="Supabase" checked note="found in repo" sub="postgres, auth" />
      <PickTile name={`${p}-ids`} value="c" label="Disabled tile" disabled />
    </div>

    <h2>Panels</h2>
    <Panel title="Panel title" meta="meta on the right" actions={<ButtonLink href="#x" size="sm">Action</ButtonLink>}>
      <p>Panels hold a project, a form or a group of settings.</p>
    </Panel>
    <Panel title="Danger zone" danger>
      <div class="spread">
        <p class="muted" style="margin:0">Destructive actions live here, apart from Save.</p>
        <Button variant="danger" icon="trash">
          Delete this project
        </Button>
      </div>
    </Panel>

    <h2>Badges and severity</h2>
    <div class="stack-sm">
      <div class="cluster">
        {Object.keys(KIND_LABELS).map((k) => (
          <KindPill kind={k} />
        ))}
      </div>
      <div class="cluster">
        <Badge>Neutral</Badge>
        <Badge tone="act">Act</Badge>
        <Badge tone="watch">Watch</Badge>
        <Badge tone="info">Info</Badge>
        <Badge tone="ok" icon="check">
          Sent
        </Badge>
        <Badge count>24</Badge>
        <Avatar email="dev@example.com" />
      </div>
      <div class="cluster">
        <Severity level="act" />
        <Severity level="watch" />
        <Severity level="quiet" />
      </div>
      <StatusLine act={2} watch={3} quiet={19} />
    </div>

    <h2>Callouts</h2>
    <Callout>Info: the Free plan alerts on one project, your oldest.</Callout>
    <Callout tone="ok">Saved.</Callout>
    <Callout tone="warn" title="Muted until 2027-01-09">
      No alerts for this dependency until then.
    </Callout>
    <Callout tone="error">We couldn't cancel your subscription with Stripe, so nothing was deleted.</Callout>

    <h2>Table</h2>
    <p class="meta">As on the landing page's comparison: row headers, and a keyboard-scrollable region on phones.</p>
    <DataTable
      class="compare"
      caption="What each tool tells you about"
      stack={false}
      rowHeader
      columns={[{ label: "When…" }, { label: "Stackquake" }, { label: "GitHub" }]}
      rows={[
        ["A hosted service changes its pricing", "With the old and new values", "No"],
        ["A package is deprecated", "When it's marked, npm and PyPI", "Not documented"],
      ]}
    />

    <h2>Tabs</h2>
    <Tabs
      label={`Tabs ${p}`}
      items={[
        { href: "#x", label: "Events", current: true },
        { href: "#x", label: "Sources" },
        { href: "#x", label: "Requests" },
      ]}
    />
    <Tabs
      variant="segmented"
      label={`Segmented ${p}`}
      items={[
        { href: "#x", label: "Pending review", count: 1, current: true },
        { href: "#x", label: "Published", count: 10 },
        { href: "#x", label: "Rejected", count: 1 },
      ]}
    />

    <h2>Empty state</h2>
    <EmptyState title="Nothing here yet" level={3} actions={<ButtonLink href="#x" variant="primary">Pick what you run on</ButtonLink>}>
      Tick the services, runtimes and tools this project uses.
    </EmptyState>

    <h2>Ways out</h2>
    <p class="meta">PlanCard and ErrorPage carry headings and ids, so they are shown live on /pricing and /no-such-page instead.</p>
    <ul class="options">
      <OptionCard name={<a href="#x">Node.js</a>} effort="low" why="Mature runtime with long support windows." />
      <OptionCard name="Bun" effort="medium" why="TypeScript-first and fast to start." />
      <OptionCard name="Cloudflare Workers" effort="high" />
    </ul>

    <h2>Quote</h2>
    <Quote text={QUOTE} href="https://deno.com/blog/cloudflare" />
    <Quote text="Redis is now available under the AGPLv3 in addition to RSALv2 and SSPLv1." url="(no link: the source URL was not http)" size="sm" />

    <h2>Definition list</h2>
    <DataList
      items={[
        { term: "What", value: <a href="#x">In the catalog</a> },
        { term: "Added", value: "found by repo import in package.json, wrangler.toml" },
        { term: "Importance", value: <span class="num">#3</span> },
      ]}
    />
    <DataList
      strip
      items={[
        { term: "Published", value: "2026-10-09" },
        { term: "Takes effect", value: "2027-10", highlight: true },
        { term: "Source", value: "deno.com" },
      ]}
    />

    <h2>Icons</h2>
    <div class="cluster">
      {ICON_NAMES.map((n) => (
        <span class="badge" title={n}>
          <Icon name={n} size={20} />
          {n}
        </span>
      ))}
    </div>

    <h2>Event note card</h2>
    <NoteCard
      bar={
        <>
          <span>
            <Icon name="mail" /> Alert · email
          </span>
          <time>2026-10-09</time>
        </>
      }
      kind={
        <Badge tone="act" icon="clock">
          End of life
        </Badge>
      }
      subject="Deno"
      title="Development of the runtime ends in about a year"
      summary="Deno is joining Cloudflare. The runtime gets monthly bug-fix and security releases for one more year, then development stops."
      quote={QUOTE}
      quoteHref="https://deno.com/blog/cloudflare"
      facts={[{ term: "Takes effect", value: "2027-10", highlight: true }]}
      because="You run Deno in production in “api”."
      options={[{ name: "Node.js 24 LTS", effort: "medium" }, { name: "Bun", effort: "medium" }]}
      href="#x"
    />

    <h2>Trace</h2>
    <Panel label={`Trace ${p}`}>
      <StatusLine act={2} watch={3} quiet={19} />
      <Trace
        from={NOW - 90 * DAY}
        to={NOW}
        label="5 changes in the last 90 days"
        axis={["90 days ago", "today"]}
        points={[
          { at: NOW - 80 * DAY, level: "quiet", label: "quiet", href: "#x" },
          { at: NOW - 61 * DAY, level: "watch", label: "pricing", href: "#x" },
          { at: NOW - 40 * DAY, level: "act", label: "licence", href: "#x" },
          { at: NOW - 12 * DAY, level: "watch", label: "free tier", href: "#x" },
          { at: NOW - 2 * DAY, level: "act", label: "end of life", href: "#x" },
        ]}
      />
    </Panel>
    <p class="meta">Public variant (event kinds, no severity):</p>
    <Trace from={NOW - 90 * DAY} to={NOW} label="Public feed" height={32} points={[20, 45, 46, 70, 88].map((d) => ({ at: NOW - (90 - d) * DAY, level: "kind" as const, label: "event" }))} />

    <h2>Dependency rows</h2>
    <ul class="dep-list">
      {DEPS.map((v) => (
        <DepRow v={v} now={NOW} />
      ))}
    </ul>

    <h2>Alert rows</h2>
    <ul class="alert-list">
      <AlertItem a={alert(1, "license", "sent", { feedback: "useful" })} csrf="" back="/app" showDep />
      <AlertItem a={alert(2, "pricing", "queued", { channel: "digest", held: "not_urgent", title: "Pro plan bandwidth now billed per GB above 1 TB", name: "Vercel" })} csrf="" back="/app" showDep />
      <AlertItem a={alert(3, "free_tier", "failed", { title: "Hobby plan retired", name: "PlanetScale" })} csrf="" back="/app" showDep />
      <AlertItem a={alert(4, "pricing", "suppressed", { because: "Only Docker Business changes; you use Docker Desktop personally.", name: "Docker Desktop", title: "Docker Business price rises" })} csrf="" back="/app" showDep />
    </ul>

    <h2>Stack view</h2>
    <p class="meta">Dependency rows grouped by risk, as on the dashboard and project pages; "No known risk" folds.</p>
    <StackView list={DEPS} now={NOW} />

    <h2>Alert list</h2>
    <p class="meta">As on the dashboard: act first, the first two shown and the rest folded, then the changes that didn't affect you.</p>
    <AlertList
      list={[alert(11, "license", "sent"), alert(12, "pricing", "queued", { channel: "digest", held: "not_urgent", name: "Vercel", title: "Pro plan bandwidth now billed per GB above 1 TB" }), alert(13, "free_tier", "sent", { match: "unknown", name: "Supabase", title: "Free projects pause after 7 days without activity" }), alert(14, "pricing", "suppressed", { name: "Docker Desktop", title: "Docker Business price rises", because: "Only Docker Business changes; you use Docker Desktop personally." })]}
      csrf=""
      back="/app"
      top={2}
    />

    <h2>Narrow column</h2>
    <div class="panel">
      <AuthShell icon="bell-off" title="Mute Deno for 90 days?" description="No alerts about Deno until 2027-01-09.">
        <Button variant="primary" size="lg">
          Mute for 90 days
        </Button>
        <p class="meta auth-fine">Nothing changes until you press the button.</p>
      </AuthShell>
    </div>

    <h2>Long content</h2>
    <p class="meta">The longest names and quotes the data allows, to check wrapping at 360 px.</p>
    <ul class="dep-list">
      <DepRow v={{ dep: dep(6, { ecosystem: "npm", package: "@aws-sdk/client-cognito-identity-provider" }), name: "@aws-sdk/client-cognito-identity-provider", detail: "npm ^3.658.1 · services/authentication-gateway/package.json", sources: 1, archived: true, deprecated: true, unlicensed: false, latest: { id: 12, title: "AWS SDK for JavaScript v3 drops support for Node.js 18 and older runtimes on 2026-01-06 across every client package", kind: "deprecated", publishedAt: NOW - 3 * DAY } }} now={NOW} />
    </ul>
    <ul class="alert-list">
      <AlertItem a={alert(5, "free_tier", "sent", { name: "Cloudflare Workers AI (serverless GPU inference)", title: "Workers AI free allocation drops from 10,000 to 2,500 neurons a day for every account on the Workers Free plan", because: "you run Cloudflare Workers AI on the free tier in a-very-long-project-name-from-a-monorepo." })} csrf="" back="/app" showDep />
    </ul>
    <Quote text={`${QUOTE} ${QUOTE} See https://docs.deno.com/runtime/fundamentals/stability_and_releases/#long-term-support-releases-and-end-of-life-schedule for the schedule.`} href="https://docs.deno.com/runtime/fundamentals/stability_and_releases/#long-term-support-releases-and-end-of-life-schedule" />

    <h2>Stepper and progress</h2>
    <Stepper label={`Onboarding demo ${p}`} steps={[{ label: "Start a project", state: "done" }, { label: "Find what you use", state: "current" }, { label: "How you use it", state: "todo" }, { label: "Your dashboard", state: "todo" }]} />
    <ProgressSteps label={`Import progress demo ${p}`} current={2} steps={[{ label: "Read the repository" }, { label: "List its folders" }, { label: "Read the manifest files" }, { label: "Rank packages by downloads" }, { label: "Match them to the catalog" }]} />

    <h2>Upgrade panel</h2>
    <UpgradePanel id={`upgrade-${p}`} title={<>CSV export is on the Team plan<span class="visually-hidden"> ({p === "l" ? "light" : "dark"} demo)</span></>} features={TEAM_FEATURES} price="$19 a month, or $190 a year." back={{ href: "#x", label: "Back to the dashboard" }}>
      <p>Every dependency with its risk and latest change, for audits and reviews.</p>
    </UpgradePanel>

    <h2>Before and after</h2>
    <DiffView label={`Diff demo ${p}`} before={"Hobby: free, 1 database, 5 GB storage."} after={"Hobby: retired on 2026-11-30. Scaler Pro from $39 a month."} />

    <h2>Sticky bar</h2>
    <div class="panel" style="max-height:9rem;overflow:auto;padding-bottom:0">
      <p>Long forms keep their actions in reach.</p>
      <p class="meta">Scroll this box.</p>
      <p class="meta">…</p>
      <p class="meta">…</p>
      <StickyBar>
        <Button variant="primary">Save and continue</Button>
        <ButtonLink href="#x" variant="quiet">
          Cancel
        </ButtonLink>
      </StickyBar>
    </div>
  </>
);

export const Gallery: FC = () => (
  <>
    {raw("<!doctype html>")}
    <Layout title="Components" csrf="" noindex path="/__dev/ui" head={<style>{raw(`.scheme-light{${schemeVars("light")}}.scheme-dark{${schemeVars("dark")}}`)}</style>}>
      <PageHeader title="Components" description="Every shared component (src/web/ui.tsx) in every state, in the light scheme and the dark one. Local only." />
      <div class="gallery-grid">
        <section class="scheme-light" aria-label="Light">
          <p class="kicker">Light</p>
          <Demo p="l" />
        </section>
        <section class="scheme-dark" aria-label="Dark">
          <p class="kicker">Dark</p>
          <Demo p="d" />
        </section>
      </div>
    </Layout>
  </>
);

/** For src/dev.ts, which is plain TypeScript. */
export const galleryHtml = () => (<Gallery />).toString();
