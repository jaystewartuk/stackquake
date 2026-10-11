// The component gallery at /__dev/ui (local only, behind DEV_ROUTES): every shared component in
// every state, once in the light scheme and once in the dark, side by side.
import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { User } from "../db/schema";
import { KIND_LABELS, KindPill } from "./events-view";
import { Icon, ICON_NAMES } from "./icons";
import { Layout, SiteHeader } from "./layout";
import { schemeVars } from "./styles/tokens";
import {
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
  PageHeader,
  Panel,
  PickTile,
  Quote,
  Severity,
  StatusLine,
  StickyBar,
  Tabs,
  Trace,
} from "./ui";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 11);
const USER = { id: 1, email: "dev@example.com" } as User;
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
    <div class="grid">
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
    <DataTable
      caption="Sources"
      columns={[{ label: "Kind" }, { label: "Source" }, { label: "Checked", num: true }]}
      rows={[
        ["page", <a href="#x">https://www.cloudflare.com/plans/developer-platform/</a>, "2026-10-11"],
        ["github_repo", <a href="#x">denoland/deno</a>, "2026-10-10"],
        ["npm", "left-pad", <Badge tone="act">blocked</Badge>],
      ]}
    />

    <h2>Tabs</h2>
    <Tabs
      label={`Tabs ${p}`}
      items={[
        { href: "#x", label: "Review queue", current: true },
        { href: "#x", label: "Blocked sources" },
        { href: "#x", label: "Catalog requests" },
      ]}
    />
    <Tabs
      variant="segmented"
      label={`Segmented ${p}`}
      items={[
        { href: "#x", label: "pending review", count: 1, current: true },
        { href: "#x", label: "published", count: 10 },
        { href: "#x", label: "rejected", count: 1 },
      ]}
    />

    <h2>Empty state</h2>
    <EmptyState title="Nothing here yet" level={3} actions={<ButtonLink href="#x" variant="primary">Pick what you run on</ButtonLink>}>
      Tick the services, runtimes and tools this project uses.
    </EmptyState>

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
