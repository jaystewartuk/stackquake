// Shared page shell: doctype, head, skip link, header with the main nav and account menu, footer.
// Server-rendered; the only client JS is the picker's search filter.
// Everything fetched from sources is rendered as text (JSX escapes it).
import { raw } from "hono/html";
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import type { User } from "../db/schema";
import { FAVICON, Icon } from "./icons";
import { appOrigin, isAdmin, type WebContext } from "./session";
import { CSS } from "./styles";
import { THEME_COLOR } from "./styles/tokens";
import { Avatar, ButtonLink } from "./ui";

export const Csrf: FC<{ token: string }> = ({ token }) => <input type="hidden" name="_csrf" value={token} />;

type NavItem = { href: string; label: string; match: (path: string) => boolean };

const under = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}/`);
const NAV_PUBLIC: NavItem[] = [
  { href: "/catalog", label: "Catalog", match: under("/catalog") },
  { href: "/events", label: "Events", match: under("/events") },
  { href: "/pricing", label: "Pricing", match: under("/pricing") },
];
const NAV_USER: NavItem[] = [
  { href: "/app", label: "Dashboard", match: (p) => p === "/app" || under("/app/projects")(p) || under("/app/deps")(p) },
  { href: "/catalog", label: "Catalog", match: under("/catalog") },
  { href: "/events", label: "Events", match: under("/events") },
];

/** Settings, Team, Admin and Sign out live in a <details> menu, so the header stays one line on a phone. */
const AccountMenu: FC<{ user: User; csrf: string; admin?: boolean; path: string; open?: boolean }> = ({ user, csrf, admin, path, open }) => (
  <details class="menu" open={open}>
    <summary>
      <Avatar email={user.email} hidden />
      <span class="visually-hidden">Account menu</span>
      <Icon name="chevron-down" />
    </summary>
    <div class="menu-panel">
      <div class="menu-who">Signed in as {user.email}</div>
      <a href="/app/settings" aria-current={under("/app/settings")(path) ? "page" : undefined}>
        <Icon name="settings" /> Settings
      </a>
      <a href="/app/team" aria-current={under("/app/team")(path) ? "page" : undefined}>
        <Icon name="users" /> Team
      </a>
      {admin && (
        <a href="/admin" aria-current={under("/admin")(path) ? "page" : undefined}>
          <Icon name="shield" /> Admin
        </a>
      )}
      <form method="post" action="/signout">
        <Csrf token={csrf} />
        <button type="submit">
          <Icon name="log-out" /> Sign out
        </button>
      </form>
    </div>
  </details>
);

/** Logo, main nav (a scrolling second row on phones) and Sign in or the account menu. `menuOpen` is for the gallery. */
export const SiteHeader: FC<{ user?: User | null; csrf: string; admin?: boolean; path: string; menuOpen?: boolean; navLabel?: string }> = ({ user, csrf, admin, path, menuOpen, navLabel = "Main" }) => (
  <header class="site-header">
    <div class="wrap">
      <a class="brand" href={user ? "/app" : "/"}>
        <Icon name="logo" size={20} />
        Stackquake
      </a>
      <nav class="nav-main" aria-label={navLabel}>
        {(user ? NAV_USER : NAV_PUBLIC).map((n) => (
          <a href={n.href} aria-current={n.match(path) ? "page" : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
      <div class="header-end">
        {user ? (
          <AccountMenu user={user} csrf={csrf} admin={admin} path={path} open={menuOpen} />
        ) : (
          <ButtonLink href="/signin" size="sm" variant={under("/signin")(path) || under("/auth")(path) ? "quiet" : "secondary"}>
            Sign in
          </ButtonLink>
        )}
      </div>
    </div>
  </header>
);

/** Link-preview metadata for an indexable page. No og:image: no remote images, and the main consumers don't render SVG. */
export type OpenGraph = { url: string; type?: "website" | "article" };

export const Layout: FC<PropsWithChildren<{ title: string; user?: User | null; csrf: string; admin?: boolean; noindex?: boolean; head?: Child; description?: string; path?: string; og?: OpenGraph }>> = ({
  title,
  og,
  user,
  csrf,
  admin,
  noindex,
  head,
  description,
  path = "",
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <meta name="theme-color" content={THEME_COLOR.light} media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content={THEME_COLOR.dark} media="(prefers-color-scheme: dark)" />
      {noindex && <meta name="robots" content="noindex" />}
      {description && <meta name="description" content={description} />}
      <title>{title === "Stackquake" ? title : `${title} · Stackquake`}</title>
      {og && !noindex && (
        <>
          <link rel="canonical" href={og.url} />
          <meta property="og:site_name" content="Stackquake" />
          <meta property="og:type" content={og.type ?? "website"} />
          <meta property="og:title" content={title === "Stackquake" ? "Stackquake: know when the services you build on change the deal" : title} />
          {description && <meta property="og:description" content={description} />}
          <meta property="og:url" content={og.url} />
          <meta name="twitter:card" content="summary" />
        </>
      )}
      <link rel="icon" href={FAVICON} type="image/svg+xml" />
      <link rel="alternate" type="application/rss+xml" title="Stackquake events" href="/events.rss" />
      <style>{raw(CSS)}</style>
      {head}
    </head>
    <body>
      <a class="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader user={user} csrf={csrf} admin={admin} path={path} />
      <main id="main" tabindex={-1}>
        <div class="wrap">{children}</div>
      </main>
      <footer class="site-footer">
        <div class="wrap">
          <span class="brand">
            <Icon name="logo" /> Stackquake
          </span>
          <p class="footer-note">Stackquake watches vendor announcements, pricing pages, licences and end-of-life dates. Notes are summaries, not legal advice; read the source.</p>
          <nav aria-label="Footer">
            <a href="/pricing">Pricing</a>
            <a href="/catalog">Catalog</a>
            <a href="/events">Events</a>
            <a href="/events.rss">RSS</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/bot">Bot</a>
          </nav>
        </div>
      </footer>
    </body>
  </html>
);

export const safeHref = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : undefined);

export const fmtDate = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

type PageOpts = { status?: 200 | 400 | 402 | 403 | 404 | 429 | 503; noindex?: boolean; head?: Child; description?: string; ogType?: OpenGraph["type"] };

/** Pages worth a canonical URL and a link preview: not the app, admin or one-click alert links. */
const publicPage = (path: string) => !/^\/(app|admin|a|auth)(\/|$)/.test(path);

/** Renders a page in the shared layout with the request's user and CSRF token. */
export function page(c: WebContext, title: string, body: Child, opts: PageOpts = {}) {
  return c.html(
    <>
      {raw("<!doctype html>")}
      <Layout title={title} user={c.get("user")} csrf={c.get("csrf")} admin={isAdmin(c)} noindex={opts.noindex} head={opts.head} description={opts.description} path={c.req.path} og={publicPage(c.req.path) && (opts.status ?? 200) === 200 ? { url: appOrigin(c) + c.req.path, type: opts.ogType } : undefined}>
        {body}
      </Layout>
    </>,
    opts.status ?? 200,
  );
}
