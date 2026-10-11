// Marketing and legal pages (M6): the landing page (SPEC §2 Positioning: services first, repo
// import as the shortcut), /pricing (SPEC §10), /terms, /privacy, /bot (the crawler's own page,
// linked from its User-Agent), robots.txt and sitemap.xml.
import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { FREE_PROJECTS, PRICES, TEAM_SIZE } from "../billing/plans";
import { CATALOG } from "../catalog/entries";
import { EventRow, publishedEvents } from "./events-view";
import { Csrf, page } from "./layout";
import type { WebContext, WebEnv } from "./session";

export const site = new Hono<WebEnv>();

/** Where people write to. Mail to this address is routed to the owner (Cloudflare Email Routing). */
export const CONTACT = "hello@stackquake.com";
export const LEGAL_UPDATED = "2026-10-11";
export const OPERATOR = "Jay Stewart";

const startHref = (c: WebContext) => (c.get("user") ? "/app/projects/new" : "/signin?next=/app/projects/new");

const DEMO_QUOTE = "We will support the Deno runtime for another year with monthly releases containing bug fixes and security updates. After that year we will end our development of the Deno runtime.";

/** A static example of an alert, from SPEC scenario 1 (the Deno announcement of 2026-10-09). */
const ExampleAlert: FC = () => (
  <figure class="card example" aria-label="Example alert">
    <p class="meta" style="margin:0 0 .4rem">Example alert · email</p>
    <p style="margin:0">
      <span class="pill bad">end of life</span> <strong>Deno: development of the runtime ends in about a year</strong>
    </p>
    <p>Deno is joining Cloudflare. The runtime gets monthly bug-fix and security releases for one more year, then development stops. Deno Deploy shuts down in six months.</p>
    <blockquote>
      {DEMO_QUOTE}{" "}
      <a href="https://deno.com/blog/cloudflare" rel="noopener noreferrer">
        deno.com/blog/cloudflare
      </a>
    </blockquote>
    <p>
      <strong>Takes effect:</strong> 2027-10 · <strong>Affects you because:</strong> you run Deno in production in “api”.
    </p>
    <p style="margin-bottom:0">
      <strong>Options:</strong> Node.js 24 LTS (medium effort) · Bun (medium) · Cloudflare Workers (high)
    </p>
  </figure>
);

const WATCH = [
  { title: "Pricing and free tiers", body: "Pricing and limits pages, normalised and diffed. You get the old and new numbers side by side, not “the page changed”." },
  { title: "Licences", body: "Licence switches like Redis, Terraform or Bitwarden, from the vendor's own announcement, the registry and the repository's LICENSE file." },
  { title: "End of life and end of development", body: "Runtime and database support dates from endoflife.date, and announcements that a product or service is winding down." },
  { title: "Acquisitions and shutdowns", body: "Vendor blogs and changelogs, read by a classifier that only passes posts that change the deal for customers." },
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

site.get("/", async (c) => {
  const recent = await publishedEvents(c.get("ctx"), { limit: 5 });
  const common = CATALOG.filter((e) => e.common);
  const categories = [...new Set(CATALOG.map((e) => e.category))].length;
  return page(
    c,
    "Stackquake",
    <>
      <section class="hero">
        <h1>Know when the services you build on change the deal.</h1>
        <p class="lede">
          Pricing and free-tier changes, licence switches, end-of-life notices and acquisitions, for the hosting, databases, APIs and runtimes you run on. One short email when a change affects you, quoting the source, with your options.
        </p>
        <p class="row">
          <a class="btn primary big" href={startHref(c)}>
            Pick what you run on
          </a>
          <a class="btn big" href={startHref(c)}>
            Or paste a repo
          </a>
        </p>
        <p class="meta">Free for one project. No card. Takes about a minute.</p>
      </section>

      <ExampleAlert />

      <h2>What we watch</h2>
      <div class="grid">
        {WATCH.map((w) => (
          <div class="card" style="margin:0">
            <h3 style="margin-top:0">{w.title}</h3>
            <p style="margin-bottom:0" class="muted">
              {w.body}
            </p>
          </div>
        ))}
      </div>

      <h2>Start from your services, not your manifests</h2>
      <p>
        Most of what changes the deal isn't in a <code>package.json</code>: your host's free tier, your database's pricing, your auth provider's terms. Tick what you use from {CATALOG.length} services, runtimes and tools in {categories} categories, say how you use each (hosted or self-hosted, commercial or personal, free tier or paid) and we only tell you about changes that apply. Got a repo? Paste it and we pre-tick what we find, from <code>wrangler.toml</code> to <code>docker-compose.yml</code>.
      </p>
      <p class="tags">
        {common.map((e) => (
          <a class="pill" href={`/catalog/${e.id}`}>
            {e.name}
          </a>
        ))}{" "}
        <a href="/catalog">All {CATALOG.length} →</a>
      </p>

      <h2>Where it differs from the tools you already have</h2>
      <p>Keep Dependabot, Snyk or Socket for vulnerabilities; Stackquake doesn't do those. What they check, they mostly check when a pull request changes your dependencies:</p>
      <ul class="plain">
        {COMPARE.map((x) => (
          <li>
            <strong>{x.tool}:</strong> “{x.quote}”{" "}
            <a class="meta" href={x.url} rel="noopener noreferrer">
              source
            </a>
          </li>
        ))}
      </ul>
      <ul>
        <li>
          <strong>It watches the services you run on, not only your packages.</strong> None of those tools covers a hosted service's pricing, free tier, terms, end of development or acquisition.
        </li>
        <li>
          <strong>It tells you when something changes, not when you next open a pull request.</strong> A project can relicense or announce its end with no new release, so a manifest scanner often has nothing to see until you upgrade.
        </li>
        <li>
          <strong>Every alert quotes the source and says what to do.</strong> The exact line, whether it affects your usage, the deadline, and two or three ways out. We never publish a note whose quote we can't find in the source.
        </li>
        <li>
          <strong>Independent.</strong> No platform to protect, so it can be blunt about any vendor, GitHub included. Works for GitLab users and self-hosters with no repo at all.
        </li>
        <li>
          <strong>Quiet by design.</strong> We aim for about one alert a week at most; anything that isn't urgent waits for a weekly digest.
        </li>
      </ul>

      {recent.length > 0 && (
        <>
          <h2>Recent changes</h2>
          <ul class="plain">
            {recent.map((e) => (
              <EventRow e={e} />
            ))}
          </ul>
          <p>
            <a href="/events">All events</a> · <a href="/events.rss">RSS</a>
          </p>
        </>
      )}

      <section class="card" style="margin-top:2rem">
        <h2 style="margin-top:0">Free for one project. Team is ${PRICES.month} a month.</h2>
        <p>Team adds unlimited projects, private repos through our GitHub App, Slack, up to {TEAM_SIZE} people and a CSV export of vendor risk for audits and procurement.</p>
        <p class="row" style="margin-bottom:0">
          <a class="btn primary" href={startHref(c)}>
            Start free
          </a>
          <a class="btn" href="/pricing">
            Pricing
          </a>
        </p>
      </section>
    </>,
    { description: "Stackquake emails you when a service, runtime or package you depend on changes its pricing, free tier, licence or end-of-life date, quoting the source, with your options." },
  );
});

const FREE_FEATURES = [`${FREE_PROJECTS} project: pick services or import a public repo`, "Every service and runtime in the catalog, plus your packages", "Email alerts, at most 3 a day", "Weekly digest"];
const TEAM_FEATURES = ["Unlimited projects", "Private repos through our GitHub App, re-imported on push", "Slack alerts", `Up to ${TEAM_SIZE} people sharing projects`, "CSV export of vendor risk"];

site.get("/pricing", (c) => {
  const user = c.get("user");
  const billing = !!c.get("ctx").config.stripe;
  const canceled = c.req.query("billing") === "canceled";
  return page(
    c,
    "Pricing",
    <>
      <h1>Pricing</h1>
      {canceled && <p class="flash">Checkout cancelled. Nothing was charged.</p>}
      <div class="grid plans">
        <div class="card">
          <h2 style="margin-top:0">Free</h2>
          <p class="price">$0</p>
          <ul>
            {FREE_FEATURES.map((f) => (
              <li>{f}</li>
            ))}
          </ul>
          <a class="btn" href={startHref(c)}>
            {user ? "Go to your stack" : "Start free"}
          </a>
        </div>
        <div class="card featured">
          <h2 style="margin-top:0">Team</h2>
          <p class="price">
            ${PRICES.month}
            <span class="meta"> a month, or ${PRICES.year} a year (two months free)</span>
          </p>
          <ul>
            <li>Everything in Free</li>
            {TEAM_FEATURES.map((f) => (
              <li>{f}</li>
            ))}
          </ul>
          {!billing ? (
            <p class="meta">Team opens soon.</p>
          ) : user ? (
            user.plan === "team" ? (
              <a class="btn" href="/app/settings">
                You're on Team
              </a>
            ) : (
              <form method="post" action="/app/billing/checkout" class="row">
                <Csrf token={c.get("csrf")} />
                <button class="primary" type="submit" name="interval" value="month">
                  ${PRICES.month} monthly
                </button>
                <button type="submit" name="interval" value="year">
                  ${PRICES.year} yearly
                </button>
              </form>
            )
          ) : (
            <a class="btn primary" href="/signin?next=/app/settings">
              Sign in to upgrade
            </a>
          )}
        </div>
      </div>
      <h2>Questions</h2>
      <h3>What counts as a project?</h3>
      <p>A list of things one app or service depends on: the services you pick, plus what we find in its repo if you import one. Free watches one; with Team, every project alerts.</p>
      <h3>Do team members pay?</h3>
      <p>No. One Team subscription covers up to {TEAM_SIZE} people, the subscriber included. Members see and edit the team's projects and get alerts by email (and their own Slack).</p>
      <h3>Can I cancel?</h3>
      <p>Any time, from Settings → Billing. Team runs to the end of the period you paid for, then you're back on Free: nothing is deleted, but only your oldest project keeps alerting.</p>
      <h3>What do you do with my code?</h3>
      <p>We read manifest files (package.json, Dockerfile, wrangler.toml and the like) to learn what you depend on, and nothing else. Private repos are read through a GitHub App with read-only access to contents, on the repos you choose. See the <a href="/privacy">privacy notice</a>.</p>
      <h3>Is a note legal advice?</h3>
      <p>No. Notes summarise what a vendor published and quote it; read the source before you act.</p>
      <p class="meta">
        Prices in US dollars. Payments by Stripe. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
      </p>
    </>,
    { description: `Stackquake is free for one project. Team is $${PRICES.month} a month for unlimited projects, private repos, Slack and up to ${TEAM_SIZE} people.` },
  );
});

site.get("/terms", (c) =>
  page(
    c,
    "Terms",
    <article class="prose">
      <h1>Terms of service</h1>
      <p class="meta">Last updated {LEGAL_UPDATED}.</p>
      <p>These terms cover your use of Stackquake (stackquake.com), run by {OPERATOR} (“we”). By creating an account you agree to them. Questions: {CONTACT}.</p>
      <h2>What Stackquake is</h2>
      <p>
        Stackquake watches public sources (vendor blogs, pricing and terms pages, package registries, GitHub repositories and endoflife.date) for changes to the services and software you tell us you use, and sends you short notes about the changes that may affect you.
      </p>
      <h2>Notes are summaries, not advice</h2>
      <p>
        Notes are written with the help of a language model from what a vendor published, and quote the source. They can be incomplete or wrong, and a change can be missed or reported late. A note is not legal, financial or professional advice and never says you are compliant with a licence. Read the source and decide for yourself, or ask a lawyer.
      </p>
      <h2>Your account</h2>
      <p>Keep your sign-in secure; you're responsible for what happens under your account. Don't use Stackquake to break the law, to attack or overload the sites we watch, or to get around the plan limits. We may suspend accounts that do.</p>
      <h2>Plans and payment</h2>
      <p>
        Free is free. Team is billed in advance, monthly or yearly, through Stripe, and renews until you cancel. Cancelling stops the next renewal; Team stays until the end of the paid period. We don't refund partial periods, except where the law requires it. If we change prices, we'll email Team subscribers at least 30 days before a renewal at the new price.
      </p>
      <h2>Availability</h2>
      <p>We work to keep Stackquake running and its alerts timely, but the service is provided “as is”, without warranties of any kind, to the extent the law allows. We may change or stop features; if we shut Stackquake down, we'll give at least 30 days' notice and refund unused prepaid time.</p>
      <h2>Liability</h2>
      <p>To the extent the law allows, we're not liable for indirect or consequential losses, or for decisions made on the basis of a note, and our total liability is limited to what you paid us in the 12 months before the claim.</p>
      <h2>Ending</h2>
      <p>You can delete your account at any time in Settings; that also cancels a subscription. We'll tell you by email about material changes to these terms before they apply.</p>
    </article>,
    { description: "Stackquake terms of service." },
  ),
);

site.get("/privacy", (c) =>
  page(
    c,
    "Privacy",
    <article class="prose">
      <h1>Privacy notice</h1>
      <p class="meta">Last updated {LEGAL_UPDATED}.</p>
      <p>Stackquake is run by {OPERATOR}, who is responsible for the data described here. Short version: we keep what we need to send you alerts, nothing more. No ads, no tracking scripts, no analytics cookies, and we don't sell data. Questions or requests: {CONTACT}.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your email address, and your GitHub user id and name if you sign in with GitHub.</li>
        <li>Your projects: the services you picked, how you said you use them, and what repo import found (dependency names, versions and the manifest paths they came from). If you import a private repo, the repo's name and the GitHub App installation id. We read manifest files to find dependencies; we don't keep your code.</li>
        <li>Alerts we sent you and your feedback on them; your Slack webhook URL if you add one (encrypted).</li>
        <li>For Team: your Stripe customer and subscription ids and plan status. Card details are handled by Stripe and never reach us.</li>
        <li>Team members' email addresses, when a Team subscriber invites them.</li>
        <li>Short-lived security records: hashed session and sign-in tokens, and rate-limit counters keyed by email or IP address.</li>
      </ul>
      <h2>Cookies</h2>
      <p>Two, both needed for the site to work: a session cookie when you're signed in, and a CSRF-protection cookie for forms.</p>
      <h2>Who processes data for us</h2>
      <ul>
        <li>Cloudflare: hosting, database and storage.</li>
        <li>Resend: sending email (your address and the alert's content).</li>
        <li>Stripe: payments, for Team subscribers.</li>
        <li>GitHub: sign-in and repo import, when you use them.</li>
        <li>Anthropic: the language model that writes notes. It only sees public vendor text, never your data.</li>
      </ul>
      <h2>Your choices</h2>
      <p>You can change your email, turn off immediate alerts, export your vendor-risk list (Team) or delete your account in Settings. Deleting your account removes your projects, dependencies, alerts, Slack connection and sessions at once. Stripe keeps billing records as the law requires. Public event pages are about vendors, not you, and stay.</p>
    </article>,
    { description: "What Stackquake stores and why." },
  ),
);

site.get("/bot", (c) =>
  page(
    c,
    "StackquakeBot",
    <article class="prose">
      <h1>StackquakeBot</h1>
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
    </article>,
  ),
);

site.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /app\nDisallow: /admin\nDisallow: /a/\nDisallow: /auth\n\nSitemap: https://stackquake.com/sitemap.xml\n"));

site.get("/sitemap.xml", async (c) => {
  const origin = "https://stackquake.com";
  const evs = await publishedEvents(c.get("ctx"), { limit: 500 });
  const urls = ["/", "/pricing", "/catalog", "/events", "/terms", "/privacy", ...CATALOG.map((e) => `/catalog/${e.id}`), ...evs.map((e) => `/events/${e.id}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${origin}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  return c.body(body, 200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
});
