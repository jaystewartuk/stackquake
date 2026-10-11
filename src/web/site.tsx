// Marketing and legal pages (M6): the landing page (SPEC §2 Positioning: services first, repo
// import as the shortcut), /pricing (SPEC §10), /terms, /privacy, /bot (the crawler's own page,
// linked from its User-Agent), robots.txt and sitemap.xml.
import { Hono } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { FREE_PROJECTS, PRICES, TEAM_SIZE } from "../billing/plans";
import { CATALOG } from "../catalog/entries";
import type { Child } from "hono/jsx";
import { groupByCategory } from "./catalog-view";
import { EventList, publishedEvents, subjectName } from "./events-view";
import { Icon, type IconName } from "./icons";
import { Csrf, fmtDate, page } from "./layout";
import { feedTrace } from "./public";
import { Badge, Button, ButtonLink, Callout, DataTable, NoteCard, PageHeader, PlanCard, Quote } from "./ui";
import type { WebContext, WebEnv } from "./session";

export const site = new Hono<WebEnv>();

/** Where people write to. Mail to this address is routed to the owner (Cloudflare Email Routing). */
export const CONTACT = "support@stackquake.com";
/** Role addresses that forward to the owner (Cloudflare Email Routing); security.txt names this one. */
export const SECURITY_CONTACT = "security@stackquake.com";
export const LEGAL_UPDATED = "2026-10-11";
export const OPERATOR = "Jay Stewart";
/** Geographic address (Electronic Commerce Regulations 2002, reg. 6): a business address service, once the owner has one. */
export const ADDRESS: string | null = null;

const startHref = (c: WebContext) => (c.get("user") ? "/app/projects/new" : "/signin?next=/app/projects/new");

const DEMO_QUOTE = "We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.";

/** A static example of an alert, from SPEC scenario 1 (the Deno announcement of 2026-10-09). */
const ExampleAlert: FC = () => (
  <NoteCard
    label="Example alert"
    bar={
      <>
        <span>
          <Icon name="mail" /> Example alert · email
        </span>
        <time datetime="2026-10-09">2026-10-09</time>
      </>
    }
    kind={<Badge tone="act" icon="clock">End of life</Badge>}
    subject="Deno"
    title="Development of the runtime ends in about a year"
    summary="Deno is joining Cloudflare. The runtime gets monthly bug-fix and security releases for one more year, then development stops. Deno Deploy shuts down in six months."
    quote={DEMO_QUOTE}
    quoteHref="https://deno.com/blog/cloudflare"
    facts={[{ term: "Takes effect", value: "2027-10", highlight: true }]}
    because={<>You run Deno in production in “api”.</>}
    options={[
      { name: "Node.js 24 LTS", effort: "medium" },
      { name: "Bun", effort: "medium" },
      { name: "Cloudflare Workers", effort: "high" },
    ]}
  />
);

const WATCH: { icon: IconName; title: string; body: string }[] = [
  { icon: "calendar", title: "Pricing and free tiers", body: "Pricing and limits pages, normalised and diffed. You get the old and new numbers side by side, not “the page changed”." },
  { icon: "shield", title: "Licences", body: "Licence switches like Redis, Terraform or Bitwarden, from the vendor's own announcement, the registry and the repository's LICENSE file." },
  { icon: "clock", title: "End of life and end of development", body: "Runtime and database support dates from endoflife.date, and announcements that a product or service is winding down." },
  { icon: "users", title: "Acquisitions and shutdowns", body: "Vendor blogs and changelogs, read by a classifier that only passes posts that change the deal for customers." },
];

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "search", title: "Pick what you run on", body: "Tick your hosting, databases, APIs and runtimes. Got a repo? Paste it and we pre-tick what we find, from wrangler.toml to docker-compose.yml." },
  { icon: "settings", title: "Say how you use each", body: "Hosted or self-hosted, commercial or personal, free tier or paid. We only tell you about changes that apply to your usage." },
  { icon: "mail", title: "Get one note when the deal changes", body: "A short email that quotes the source, says whether it affects you and lists your ways out. Anything not urgent waits for a weekly digest." },
];

/** "Where Stackquake differs" (docs/COMPETITORS.md); quotes re-checked on the live pages 2026-10-11. */
const COMPARE = [
  {
    tool: "GitHub (Dependabot, dependency review)",
    quote: "The dependency review action scans your pull requests for dependency changes, and will raise an error if any vulnerabilities or invalid licenses are being introduced.",
    url: "https://github.com/actions/dependency-review-action",
  },
  {
    tool: "Socket",
    quote: "Socket currently does not initiate a scan until there is a commit or a pull request (PR) containing manifest files that Socket supports.",
    url: "https://docs.socket.dev/docs/organization-alerts",
  },
  {
    tool: "Snyk",
    quote: "For npm only, a warning icon appears next to the package name if a package is deprecated.",
    url: "https://docs.snyk.io/scan-fix-and-prevent/prevent/dependencies-and-licenses/view-dependencies",
  },
];

const No: FC<{ children?: Child }> = ({ children }) => <span class="cmp-no">{children ?? "No"}</span>;
const Yes: FC<{ children: Child }> = ({ children }) => (
  <span class="cmp-yes">
    <Icon name="check" /> {children}
  </span>
);

/** The comparison, from the table in docs/COMPETITORS.md (vendor docs, 2026-10-11). */
const COMPARE_ROWS: Child[][] = [
  ["A hosted service changes its pricing, free tier or terms", <No />, <No />, <No />, <Yes>With the old and new values</Yes>],
  ["A runtime or service announces the end of development", <No />, <No>Not for services</No>, <No />, <Yes>From the vendor and endoflife.date</Yes>],
  ["A vendor is acquired", <No />, <No />, <No />, <Yes>When it's announced</Yes>],
  ["An upstream package changes its licence", "Checked at pull request time, against an allow/deny list", "Checked at scan time, against a licence policy", "Licence alerts per version, not on a change", <Yes>When it changes, with a quote</Yes>],
  ["A package is deprecated", <No>Not documented</No>, "An icon in the UI, npm only", "An alert, on each pull request", <Yes>When it's marked, npm and PyPI</Yes>],
];

const DIFFERS = [
  { title: "When it changes, not at your next pull request.", body: "A project can relicense or announce its end with no new release, so a manifest scanner often has nothing to see until you upgrade." },
  { title: "Every note quotes the source and says what to do.", body: "The exact line, whether it affects your usage, the deadline, and two or three ways out. We never publish a note whose quote we can't find in the source." },
  { title: "Independent.", body: "No platform to protect, so it can be blunt about any vendor, GitHub included. Works for GitLab users and self-hosters with no repo at all." },
  { title: "Quiet by design.", body: "We aim for about one alert a week at most; anything that isn't urgent waits for a weekly digest." },
];

site.get("/", async (c) => {
  const recent = await publishedEvents(c.get("ctx"), { limit: 5 });
  const groups = groupByCategory(CATALOG);
  const trace = await feedTrace(c, "Changes in the public feed");
  const newest = recent[0];
  return page(
    c,
    "Stackquake",
    <>
      <section class="hero" aria-labelledby="hero-h">
        <div class="hero-copy">
          <p class="kicker">Change radar for your stack</p>
          <h1 id="hero-h">Know when the services you build on change the deal.</h1>
          <p class="lede">
            Pricing and free-tier changes, licence switches, end-of-life notices and acquisitions, for the hosting, databases, APIs and runtimes you run on. One short email when a change affects you, quoting the source, with your options.
          </p>
          <div class="hero-cta">
            <ButtonLink variant="primary" size="lg" href={startHref(c)} iconEnd="arrow-right">
              Pick what you run on
            </ButtonLink>
            <a class="hero-alt" href={startHref(c)}>
              or paste a repo
            </a>
          </div>
          <p class="meta">Free for one project. No card. Takes about a minute.</p>
        </div>
        <div class="hero-demo">
          <ExampleAlert />
          {trace.points.length > 0 && (
            <div class="hero-trace">
              {trace.node}
              {newest && (
                <p class="meta">
                  Every spike is a published change. Newest:{" "}
                  <a href={`/events/${newest.id}`}>
                    {subjectName(newest)}, {fmtDate(newest.publishedAt)}
                  </a>
                  .
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <section class="band" aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol class="steps">
          {STEPS.map((st, i) => (
            <li>
              <span class="step-n num" aria-hidden="true">
                {i + 1}
              </span>
              <Icon name={st.icon} size={20} />
              <h3>{st.title}</h3>
              <p>{st.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section class="band" aria-labelledby="watch-h">
        <h2 id="watch-h">What we watch</h2>
        <p class="section-lede">Most of what changes the deal isn't in a <code>package.json</code>: your host's free tier, your database's pricing, your auth provider's terms.</p>
        <ul class="watch-grid">
          {WATCH.map((w) => (
            <li>
              <Icon name={w.icon} size={20} />
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </li>
          ))}
        </ul>
        <h3 class="proof-h">
          <span class="num">{CATALOG.length}</span> services, runtimes and tools in <span class="num">{groups.length}</span> categories
        </h3>
        <ul class="cat-proof">
          {groups.map((g) => (
            <li>
              <a href={`/catalog#cat-${g.category}`}>
                <span class="cat-name">{g.label}</span> <span class="num">{g.entries.length}</span>
              </a>
              <span class="cat-names">{g.entries.slice(0, 4).map((e) => e.name).join(", ")}{g.entries.length > 4 ? "…" : ""}</span>
            </li>
          ))}
        </ul>
        <p>
          <a href="/catalog">
            Browse the catalog <Icon name="arrow-right" />
          </a>
        </p>
      </section>

      <section class="band" aria-labelledby="differs-h">
        <h2 id="differs-h">Where it differs from Dependabot, Snyk and Socket</h2>
        <p class="section-lede">Keep them for vulnerabilities; Stackquake doesn't do those. What they check, they mostly check when a pull request changes your dependencies, and none of them covers the services you run on.</p>
        <DataTable
          class="compare"
          caption="What each tool tells you about"
          stack={false}
          rowHeader
          columns={[{ label: "When…" }, { label: "GitHub" }, { label: "Snyk" }, { label: "Socket" }, { label: "Stackquake" }]}
          rows={COMPARE_ROWS}
        />
        <p class="meta">From each vendor's documentation, checked 2026-10-11. “No” means their docs don't describe it. In their own words:</p>
        <ul class="cite-grid">
          {COMPARE.map((x) => (
            <li>
              <Quote text={x.quote} href={x.url} size="sm" />
              <span class="cite-tool">{x.tool}</span>
            </li>
          ))}
        </ul>
        <ul class="differs">
          {DIFFERS.map((d) => (
            <li>
              <strong>{d.title}</strong> {d.body}
            </li>
          ))}
        </ul>
      </section>

      {recent.length > 0 && (
        <section class="band" aria-labelledby="recent-h">
          <div class="band-head">
            <h2 id="recent-h">Recent changes</h2>
            <span class="cluster meta">
              <a href="/events">All changes</a>
              <a href="/events.rss">RSS</a>
            </span>
          </div>
          <EventList events={recent} summary={false} />
        </section>
      )}

      <section class="band" aria-labelledby="price-h">
        <h2 id="price-h">Pricing</h2>
        <div class="price-strip">
          <div>
            <p class="ps-plan">Free</p>
            <p class="ps-price num">$0</p>
            <p>{FREE_PROJECTS} project, every service in the catalog, email alerts and a weekly digest.</p>
          </div>
          <div class="featured">
            <p class="ps-plan">Team</p>
            <p class="ps-price">
              <span class="num">${PRICES.month}</span> <span class="meta">a month</span>
            </p>
            <p>Unlimited projects, private repos through our GitHub App, Slack, up to {TEAM_SIZE} people and a CSV export of vendor risk.</p>
          </div>
          <p class="ps-more">
            <a href="/pricing">
              Compare plans <Icon name="arrow-right" />
            </a>
          </p>
        </div>
      </section>

      <section class="cta-band" aria-labelledby="cta-h">
        <h2 id="cta-h">Find out what's changing under you.</h2>
        <p>Pick your services in about a minute. We'll stay quiet until something you use changes the deal.</p>
        <ButtonLink variant="primary" size="lg" href={startHref(c)} iconEnd="arrow-right">
          Pick what you run on
        </ButtonLink>
      </section>
    </>,
    { description: "Stackquake emails you when a service, runtime or package you depend on changes its pricing, free tier, licence or end-of-life date, quoting the source, with your options." },
  );
});

const FREE_FEATURES = [`${FREE_PROJECTS} project: pick services or import a public repo`, "Every service and runtime in the catalog, plus your packages", "Email alerts, at most 3 a day", "Weekly digest"];
const TEAM_FEATURES = ["Unlimited projects", "Private repos through our GitHub App, re-imported on push", "Slack alerts", `Up to ${TEAM_SIZE} people sharing projects`, "CSV export of vendor risk"];

const FAQ: { q: string; a: Child }[] = [
  { q: "What counts as a project?", a: "A list of things one app or service depends on: the services you pick, plus what we find in its repo if you import one. Free watches one; with Team, every project alerts." },
  { q: "Do team members pay?", a: `No. One Team subscription covers up to ${TEAM_SIZE} people, the subscriber included. Members see and edit the team's projects and get alerts by email (and their own Slack).` },
  { q: "Can I cancel?", a: "Any time, from Settings → Billing. Team runs to the end of the period you paid for, then you're back on Free: nothing is deleted, but only your oldest project keeps alerting. Changed your mind? Ask within 14 days of your first payment (or of a yearly renewal) for a full refund." },
  {
    q: "What do you do with my code?",
    a: (
      <>
        We read manifest files (package.json, Dockerfile, wrangler.toml and the like) to learn what you depend on, and nothing else. Private repos are read through a GitHub App with read-only access to contents, on the repos you choose. See the <a href="/privacy">privacy notice</a>.
      </>
    ),
  },
  { q: "Is a note legal advice?", a: "No. Notes summarise what a vendor published and quote it; read the source before you act." },
];

site.get("/pricing", (c) => {
  const user = c.get("user");
  const billing = !!c.get("ctx").config.stripe;
  const canceled = c.req.query("billing") === "canceled";
  return page(
    c,
    "Pricing",
    <>
      <PageHeader title="Pricing" description="Free for one project, for as long as you like. Team when you have more to watch, or people to share it with." />
      {canceled && <Callout tone="info">Checkout cancelled. Nothing was charged.</Callout>}
      <div class="plans">
        <PlanCard name="Free" price="$0" period="for one project" features={FREE_FEATURES}>
          <ButtonLink href={startHref(c)} block>
            {user ? "Go to your stack" : "Start free"}
          </ButtonLink>
        </PlanCard>
        <PlanCard
          name="Team"
          featured
          badge="For teams and agencies"
          price={`$${PRICES.month}`}
          period="a month"
          note={<>or ${PRICES.year} a year (two months free)</>}
          features={["Everything in Free", ...TEAM_FEATURES]}
        >
          {!billing ? (
            <p class="meta">Team opens soon.</p>
          ) : user ? (
            user.plan === "team" ? (
              <ButtonLink href="/app/settings" icon="check" block>
                You're on Team
              </ButtonLink>
            ) : (
              <form method="post" action="/app/billing/checkout" class="plan-buttons">
                <Csrf token={c.get("csrf")} />
                <Button variant="primary" name="interval" value="month">
                  ${PRICES.month} monthly
                </Button>
                <Button name="interval" value="year">
                  ${PRICES.year} yearly
                </Button>
              </form>
            )
          ) : (
            <ButtonLink variant="primary" href="/signin?next=/app/settings" block>
              Sign in to upgrade
            </ButtonLink>
          )}
        </PlanCard>
      </div>
      <p class="meta plans-fine">
        Prices in US dollars and include any VAT or sales tax. Payments are handled by Link, Stripe's merchant of record service. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
      </p>
      <section class="faq" aria-labelledby="faq-h">
        <h2 id="faq-h">Questions</h2>
        <div class="faq-grid">
          {FAQ.map((f) => (
            <div>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}
        </div>
      </section>
    </>,
    { description: `Stackquake is free for one project. Team is $${PRICES.month} a month for unlimited projects, private repos, Slack and up to ${TEAM_SIZE} people.` },
  );
});

const TERMS_TOC = [
  { id: "1-what-stackquake-does", label: "1. What Stackquake does" },
  { id: "2-notes-are-summaries-not-advice", label: "2. Notes are summaries, not advice" },
  { id: "3-your-account", label: "3. Your account" },
  { id: "4-fair-use", label: "4. Fair use" },
  { id: "5-your-data-and-repositories", label: "5. Your data and repositories" },
  { id: "6-plans-payment-and-cancelling", label: "6. Plans, payment and cancelling" },
  { id: "7-our-content", label: "7. Our content" },
  { id: "8-changes-and-availability", label: "8. Changes and availability" },
  { id: "9-our-responsibility-to-you", label: "9. Our responsibility to you" },
  { id: "10-ending", label: "10. Ending" },
  { id: "11-changes-to-these-terms", label: "11. Changes to these terms" },
  { id: "12-complaints-and-law", label: "12. Complaints and law" },
];

const PRIVACY_TOC = [
  { id: "what-we-collect-why-and-our-lawful-basis", label: "What we collect, why, and our lawful basis" },
  { id: "payments", label: "Payments" },
  { id: "who-else-handles-data", label: "Who else handles data" },
  { id: "how-long-we-keep-it", label: "How long we keep it" },
  { id: "your-rights", label: "Your rights" },
  { id: "cookies", label: "Cookies" },
  { id: "changes", label: "Changes" },
];

/** A legal or reference page: title, last-updated line, a contents list beside the text on wide screens. */
const DocPage: FC<PropsWithChildren<{ title: string; updated?: boolean; toc?: { id: string; label: string }[] }>> = ({ title, updated, toc, children }) => (
  <div class={toc ? "doc has-toc" : "doc"}>
    <header class="doc-head">
      <h1>{title}</h1>
      {updated && (
        <p class="meta">
          Last updated <time datetime={LEGAL_UPDATED}>{LEGAL_UPDATED}</time>.
        </p>
      )}
    </header>
    {toc && (
      <nav class="toc" aria-label="Contents">
        <p class="kicker">Contents</p>
        <ol>
          {toc.map((t) => (
            <li>
              <a href={`#${t.id}`}>{t.label}</a>
            </li>
          ))}
        </ol>
      </nav>
    )}
    <article class="prose doc-body" aria-label={title}>
      {children}
    </article>
  </div>
);

const Operator: FC = () => (
  <p>
    Stackquake is run by {OPERATOR}, a sole trader in England (“we”, “us”). {ADDRESS ? <>Postal address: {ADDRESS}. </> : <>Postal address: being set up; until it is listed here, write to {CONTACT} and we'll reply with it. </>}
    Email: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
  </p>
);

site.get("/terms", (c) =>
  page(
    c,
    "Terms",
    <DocPage title="Terms of service" updated toc={TERMS_TOC}>
      <Operator />
      <p>
        These terms apply when you use stackquake.com, with or without an account. By creating an account you agree to them. If you use Stackquake for work, you agree to them for your organisation too. If you're a consumer (using it for yourself, not for a business), you also have legal rights that these terms don't take away.
      </p>

      <h2 id="1-what-stackquake-does">1. What Stackquake does</h2>
      <p>
        Stackquake watches public sources (vendor blogs, pricing, limits and terms pages, package registries, GitHub repositories and endoflife.date) for changes to the services and software you tell us you use, and sends you short notes about the changes that may affect you.
      </p>

      <h2 id="2-notes-are-summaries-not-advice">2. Notes are summaries, not advice</h2>
      <p>
        Notes are written with the help of a language model from what a vendor published, and quote the source. Software checks the quote against the source, and anything uncertain is reviewed by a person before it is published, but a note can still be incomplete or wrong, and a change can be missed or reported late. A note is not legal, financial or professional advice and never says you are compliant with a licence. Read the source before you act, and take advice where it matters.
      </p>

      <h2 id="3-your-account">3. Your account</h2>
      <ul>
        <li>Use an email address you control and keep your sign-in secure. You're responsible for what happens under your account.</li>
        <li>On Team, the subscriber controls the team: they invite and remove members, and members see and edit the team's projects.</li>
        <li>You must be 18 or over, or have a parent's or guardian's permission.</li>
      </ul>

      <h2 id="4-fair-use">4. Fair use</h2>
      <p>
        Don't use Stackquake to break the law; to probe, attack or overload Stackquake or the sites we watch; to scrape our pages in bulk; or to get around plan limits (for example with several free accounts for one project). You may share links to event pages and short quotes from notes. We may suspend or close an account that breaks these rules; where it's reasonable we'll warn you first.
      </p>

      <h2 id="5-your-data-and-repositories">5. Your data and repositories</h2>
      <p>
        What you add (project names, the services you pick, your answers about how you use them) stays yours; you let us use it only to run Stackquake for you. When you import a repository we read its manifest files (package.json, Dockerfile, wrangler.toml and the like) to find dependencies, and keep the dependency list, not your code. Private repositories are read through our GitHub App with read-only access to the repositories you choose; you can remove it at any time in GitHub. The <a href="/privacy">privacy notice</a> explains what we keep and why.
      </p>

      <h2 id="6-plans-payment-and-cancelling">6. Plans, payment and cancelling</h2>
      <ul>
        <li>Free costs nothing and covers one project. We may change what Free includes, with notice.</li>
        <li>
          Team costs ${PRICES.month} a month or ${PRICES.year} a year, <strong>including any VAT or sales tax</strong>, paid in advance. Checkout may show the price converted into your currency.
        </li>
        <li>
          Payments are handled by <strong>Link, Stripe's merchant of record service</strong>: Link sells the subscription to you on our behalf, charges your card, collects and pays the tax, and sends receipts. Your card statement shows “LINK.COM* STACKQUAKE.COM”. Link's own terms apply to the payment.
        </li>
        <li>A subscription renews automatically at the end of each month or year until you cancel. Cancel any time from Settings → “Billing, invoices and cancelling”, or through Link. Team then stays until the end of the period you paid for.</li>
        <li>
          <strong>Refunds:</strong> if you ask within 14 days of your first payment, or of a yearly renewal, we refund that payment in full. Otherwise we don't refund part-used periods, except where the law requires it or we end the service (section 8). To ask, email {CONTACT} or contact Link support.
        </li>
        <li>If we change prices, we'll email Team subscribers at least 30 days before the first renewal at the new price, so you can cancel first.</li>
        <li>If you move back to Free, nothing is deleted: your projects stay, but only your oldest one keeps alerting, and private-repo syncing, Slack and team access stop until you're on Team again.</li>
      </ul>

      <h2 id="7-our-content">7. Our content</h2>
      <p>Stackquake's software, catalog, notes and pages belong to us. Quotes in notes belong to the vendors who published them and are used to report and review their announcements.</p>

      <h2 id="8-changes-and-availability">8. Changes and availability</h2>
      <p>
        We work to keep Stackquake running and its alerts timely, but we can't promise it will always be available or error-free. We may change features. If we close Stackquake, we'll give at least 30 days' notice by email and refund any paid time you haven't used.
      </p>

      <h2 id="9-our-responsibility-to-you">9. Our responsibility to you</h2>
      <ul>
        <li>We provide Stackquake with reasonable care and skill. If you're a consumer, you have legal rights in relation to services that aren't provided that way; nothing in these terms affects them.</li>
        <li>We're responsible for loss you suffer that is a foreseeable result of our breaking these terms or our negligence. We're not responsible for loss that wasn't foreseeable.</li>
        <li>If you use Stackquake for a business, we're not liable for loss of profit, revenue, business, goodwill or data, or for decisions made on the basis of a note, and our total liability for all claims in any 12 months is limited to the greater of what you paid us in those 12 months and £100.</li>
        <li>Nothing in these terms limits liability that the law does not allow us to limit, including for death or personal injury caused by negligence, or for fraud.</li>
      </ul>

      <h2 id="10-ending">10. Ending</h2>
      <p>You can stop using Stackquake and delete your account at any time in Settings; deleting it also cancels a Team subscription. We can close an account under section 4, or as part of closing the service under section 8.</p>

      <h2 id="11-changes-to-these-terms">11. Changes to these terms</h2>
      <p>We'll email account holders about material changes at least 30 days before they apply. If you don't agree, you can cancel and delete your account before then; a refund of unused paid time is available in that case.</p>

      <h2 id="12-complaints-and-law">12. Complaints and law</h2>
      <p>
        If something goes wrong, email {CONTACT}; we aim to reply within five working days. These terms are governed by the law of England and Wales, and claims go to the courts of England and Wales; if you're a consumer living in Scotland or Northern Ireland, you can also bring a claim in your local courts.
      </p>
    </DocPage>,
    { description: "Stackquake terms of service." },
  ),
);

site.get("/privacy", (c) =>
  page(
    c,
    "Privacy",
    <DocPage title="Privacy notice" updated toc={PRIVACY_TOC}>
      <Operator />
      <p>
        {OPERATOR} is the controller of the personal data described here, under the UK GDPR and the Data Protection Act 2018. Short version: we keep what we need to send you alerts, nothing more. No ads, no tracking or analytics scripts, and we never sell data.
      </p>

      <h2 id="what-we-collect-why-and-our-lawful-basis">What we collect, why, and our lawful basis</h2>
      <div class="table-wrap">
      <table class="table-stack">
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Why</th>
            <th scope="col">Lawful basis</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="Data">Email address; GitHub user id and name if you sign in with GitHub</td>
            <td data-label="Why">Your account, sign-in, alerts and service emails</td>
            <td data-label="Lawful basis">Contract</td>
          </tr>
          <tr>
            <td data-label="Data">Projects: services you picked, your answers about how you use them, dependencies found by repo import and the manifest paths they came from; for private repos, the repo name and GitHub App installation id</td>
            <td data-label="Why">Deciding which changes affect you</td>
            <td data-label="Lawful basis">Contract</td>
          </tr>
          <tr>
            <td data-label="Data">Alerts we sent you and your “useful / not relevant” feedback</td>
            <td data-label="Why">Sending alerts and the digest; measuring and improving accuracy</td>
            <td data-label="Lawful basis">Contract; legitimate interests (keeping alerts accurate)</td>
          </tr>
          <tr>
            <td data-label="Data">Slack webhook URL, if you add one (encrypted)</td>
            <td data-label="Why">Posting your alerts to Slack</td>
            <td data-label="Lawful basis">Contract</td>
          </tr>
          <tr>
            <td data-label="Data">Team: invited members' email addresses</td>
            <td data-label="Why">Sending and matching invites</td>
            <td data-label="Lawful basis">Legitimate interests (letting a subscriber share their team)</td>
          </tr>
          <tr>
            <td data-label="Data">Billing: Stripe customer and subscription ids, plan, renewal date</td>
            <td data-label="Why">Knowing which plan you're on</td>
            <td data-label="Lawful basis">Contract; legal obligation (business records)</td>
          </tr>
          <tr>
            <td data-label="Data">Security records: hashed session and sign-in tokens, rate-limit counters keyed by email or IP address; request logs at our host</td>
            <td data-label="Why">Keeping accounts and the service secure; stopping abuse</td>
            <td data-label="Lawful basis">Legitimate interests (security)</td>
          </tr>
        </tbody>
      </table>
      </div>
      <p>An email address is needed to have an account; without one we can't send alerts. We don't send marketing email. Matching changes to your usage is automated, but it only decides which alerts you receive, with no legal or similarly significant effect on you.</p>

      <h2 id="payments">Payments</h2>
      <p>
        Team subscriptions are sold through Link, Stripe's merchant of record service. Link and Stripe collect your payment and billing details (name, address, card) as an independent controller under their own privacy policies; card details never reach us. We receive your Stripe customer id, subscription status and renewal date.
      </p>

      <h2 id="who-else-handles-data">Who else handles data</h2>
      <ul>
        <li>Cloudflare (hosting, database, storage, request logs and our email forwarding)</li>
        <li>Resend (sending email: your address and the alert's content)</li>
        <li>GitHub (sign-in and repo import, when you use them)</li>
        <li>Slack (your alerts, if you connect a webhook)</li>
        <li>Anthropic (the language model that writes notes; it only sees public vendor text, never your data)</li>
      </ul>
      <p>
        These providers are based in or process data in the United States and elsewhere. Where personal data leaves the UK, it is protected by the UK's adequacy regulations (including the UK–US data bridge for certified companies) or by the UK International Data Transfer Addendum to the providers' standard contractual clauses. Ask us for details.
      </p>

      <h2 id="how-long-we-keep-it">How long we keep it</h2>
      <ul>
        <li>Account, projects, alerts and Slack connection: until you delete your account, then removed at once (and from backups within 30 days).</li>
        <li>Sessions: 30 days at most. Sign-in links: expire after 15 minutes and are deleted a day later. Rate-limit counters: deleted within two days.</li>
        <li>Team invites: until accepted, declined or cancelled.</li>
        <li>Host request logs and email delivery logs: kept by Cloudflare and Resend for a short period (days, not months).</li>
        <li>Billing records: kept by Stripe and Link, and by us where tax law requires, for up to six years.</li>
      </ul>

      <h2 id="your-rights">Your rights</h2>
      <p>
        You can ask for a copy of your data, to correct it, to delete it, to restrict how we use it, or to have it in a portable format. Most of this you can do yourself in Settings (change email, delete account; Team can export its list as CSV). Otherwise email {CONTACT}; we reply within one month.
      </p>
      <p>
        <strong>You can object at any time</strong> to our use of your data based on legitimate interests (the alert-feedback, invite and security uses above). We'll stop unless we have compelling grounds, such as preventing abuse.
      </p>
      <p>
        If you're unhappy with how we handle your data, please tell us first. You can also complain to the Information Commissioner's Office: <a href="https://ico.org.uk/make-a-complaint/" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a>, 0303 123 1113.
      </p>

      <h2 id="cookies">Cookies</h2>
      <p>Two, both strictly necessary for the site to work, so no consent banner: a session cookie when you're signed in, and a security cookie that protects forms. No analytics or advertising cookies.</p>

      <h2 id="changes">Changes</h2>
      <p>We'll update this page when what we do changes, and email account holders about significant changes.</p>
    </DocPage>,
    { description: "What Stackquake stores, why, for how long, and your rights." },
  ),
);

site.get("/bot", (c) =>
  page(
    c,
    "StackquakeBot",
    <DocPage title="StackquakeBot">
      <p>
        <code>StackquakeBot/1.0 (+https://stackquake.com/bot)</code> is the crawler behind Stackquake. It reads a small, hand-curated list of public pages: vendor blog feeds, pricing, limits and licence pages, package registries and endoflife.date, so it can tell people when the services they use change their pricing, licence or support dates.
      </p>
      <ul>
        <li>It honours robots.txt (user agent <code>StackquakeBot</code>).</li>
        <li>It makes at most one request to a site per run (a run every few minutes); most pages are fetched once a day, feeds every few hours.</li>
        <li>It sends conditional requests (ETag, Last-Modified) and backs off on 429 and 5xx answers.</li>
        <li>It never follows links, submits forms or fetches URLs that users type in.</li>
      </ul>
      <p>To ask us to stop or slow down, disallow it in robots.txt or write to {CONTACT}.</p>
    </DocPage>,
  ),
);

// RFC 9116. Expires must be renewed yearly.
site.get("/.well-known/security.txt", (c) =>
  c.text(`Contact: mailto:${SECURITY_CONTACT}\nExpires: 2027-10-11T00:00:00.000Z\nPreferred-Languages: en\nCanonical: https://stackquake.com/.well-known/security.txt\n`),
);

site.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /app\nDisallow: /admin\nDisallow: /a/\nDisallow: /auth\n\nSitemap: https://stackquake.com/sitemap.xml\n"));

site.get("/sitemap.xml", async (c) => {
  const origin = "https://stackquake.com";
  const evs = await publishedEvents(c.get("ctx"), { limit: 500 });
  const urls = ["/", "/pricing", "/catalog", "/events", "/terms", "/privacy", ...CATALOG.map((e) => `/catalog/${e.id}`), ...evs.map((e) => `/events/${e.id}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${origin}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  return c.body(body, 200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
});
