// Shared by scripts/ui/*.mjs: the dev server's address, the seed, sessions and the page list.
// Everything runs against `npm run dev` (wrangler dev, local D1) with DEV_ROUTES=1 in .dev.vars.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASE = process.env.UI_BASE ?? "http://localhost:8787";
export const OUT = join(process.cwd(), ".ui");

export const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];
export const SCHEMES = ["light", "dark"];

/** The stage name from `npm run ui:shots -- <name>`; required so a run never overwrites another by accident. */
export function stageName(script) {
  const name = process.argv[2];
  if (!name || !/^[\w.-]+$/.test(name)) {
    console.error(`usage: npm run ${script} -- <name>   (e.g. baseline, stage-2)`);
    process.exit(2);
  }
  return name;
}

export async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No dev server at ${BASE}. Start it with \`npm run dev\` (and \`npm run db:migrate:local\` once).`);
}

export async function seed() {
  await waitForServer();
  const res = await fetch(`${BASE}/__dev/seed`, { method: "POST" });
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "seed.json"), JSON.stringify(data, null, 2));
  return data;
}

/** The last seed's ids (seeding first if there is none). */
export async function seedData() {
  const f = join(OUT, "seed.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : seed();
}

export async function session(email) {
  const res = await fetch(`${BASE}/__dev/session`, { method: "POST", body: JSON.stringify({ email }) });
  if (!res.ok) throw new Error(`session for ${email}: ${res.status}`);
  return res.json();
}

export async function signedLink(action, id) {
  return (await (await fetch(`${BASE}/__dev/link?action=${action}&id=${id}`)).json()).path;
}

/**
 * Every page worth looking at. `as` is who is signed in (null: nobody); `public` pages also get
 * Lighthouse. `status` is what the page should answer, so a broken route shows up in the run.
 */
export async function pages() {
  const s = await seedData();
  const ev = s.events;
  const firstAlert = 1;
  return [
    // Public
    { name: "home", path: "/", as: null, public: true },
    { name: "pricing", path: "/pricing", as: null, public: true },
    { name: "catalog", path: "/catalog", as: null, public: true },
    { name: "catalog-empty-search", path: "/catalog?q=zzzz", as: null },
    { name: "catalog-entry", path: "/catalog/redis", as: null, public: true },
    { name: "events", path: "/events", as: null, public: true },
    { name: "event-eol", path: `/events/${ev["deno-eol"]}`, as: null, public: true },
    { name: "event-free-tier", path: `/events/${ev["workers-ai-free"]}`, as: null },
    { name: "event-license", path: `/events/${ev["redis-license"]}`, as: null },
    { name: "terms", path: "/terms", as: null },
    { name: "privacy", path: "/privacy", as: null },
    { name: "bot", path: "/bot", as: null },
    { name: "signin", path: "/signin", as: null, public: true },
    { name: "signin-sent", path: "/signin", as: null, submit: { fill: { "#email": "someone@example.com" }, click: "button[type=submit].primary" } },
    { name: "link-expired", path: "/auth/email/confirm?token=nope", as: null, status: 400 },
    { name: "404", path: "/no-such-page", as: null, status: 404 },
    // App, as the Team owner (also the admin)
    { name: "app-dashboard", path: "/app", as: "owner", lighthouse: true },
    { name: "app-project-import", path: `/app/projects/${s.projects.import}`, as: "owner" },
    { name: "app-project-picker", path: `/app/projects/${s.projects.picker}`, as: "owner" },
    { name: "app-services-imported", path: `/app/projects/${s.projects.import}/services?imported=1`, as: "owner" },
    { name: "app-profiles", path: `/app/projects/${s.projects.picker}/profiles`, as: "owner" },
    { name: "app-new-project", path: "/app/projects/new", as: "owner" },
    { name: "app-dep", path: `/app/deps/${s.depIds.withEvents}`, as: "owner" },
    { name: "app-dep-muted", path: `/app/deps/${s.depIds.muted}`, as: "owner" },
    { name: "app-dep-package", path: `/app/deps/${s.depIds.package}`, as: "owner" },
    { name: "app-settings", path: "/app/settings", as: "owner" },
    { name: "app-team", path: "/app/team", as: "owner" },
    { name: "alert-link-confirm", path: async () => signedLink("mute", firstAlert), as: null },
    // Other people
    { name: "onboarding-empty", path: "/app", as: "fresh" },
    { name: "free-dashboard", path: "/app", as: "free" },
    { name: "free-new-project-limit", path: "/app/projects/new", as: "free" },
    { name: "free-402-export", path: "/app/export.csv", as: "free", status: 402 },
    { name: "free-settings", path: "/app/settings", as: "free" },
    { name: "member-team", path: "/app/team", as: "member" },
    // Admin
    { name: "admin-queue", path: "/admin/events", as: "owner" },
    { name: "admin-published", path: "/admin/events?status=published", as: "owner" },
    { name: "admin-event-edit", path: `/admin/events/${ev["sentry-pricing-review"]}`, as: "owner" },
    { name: "admin-sources", path: "/admin/sources", as: "owner" },
    { name: "admin-requests", path: "/admin/requests", as: "owner" },
  ];
}

/** Session cookies for each role, created once per run. */
export async function cookiesFor(seedUsers) {
  const out = { null: [] };
  for (const [role, email] of Object.entries(seedUsers)) {
    const { token } = await session(email);
    out[role] = [{ name: "sq_session", value: token, url: BASE }];
  }
  return out;
}

/** Only these filters, so a run can be pointed at a few pages: `npm run ui:shots -- name home app-dashboard`. */
export function only() {
  const names = process.argv.slice(3);
  return names.length ? (p) => names.includes(p.name) : () => true;
}
