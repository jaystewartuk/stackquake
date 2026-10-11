// Shared page shell. Server-rendered; the only client JS is the picker's search filter.
// Everything fetched from sources is rendered as text (JSX escapes it).
import { raw } from "hono/html";
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import type { User } from "../db/schema";
import { isAdmin, type WebContext } from "./session";

const CSS = `
:root{--bg:#fbfaf7;--fg:#1b1b1a;--muted:#5f5d58;--line:#e2dfd8;--card:#fff;--accent:#c2410c;--accent-fg:#fff;--soft:#f3f1ec;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe8;--muted:#a3a19b;--line:#33322f;--card:#1f1f1d;--accent:#fb923c;--accent-fg:#1b1b1a;--soft:#262624;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171}}
*{box-sizing:border-box} [hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit;text-decoration-color:var(--accent);text-underline-offset:2px}
header.top{border-bottom:1px solid var(--line);background:var(--card)}
.wrap{max-width:62rem;margin:0 auto;padding:0 16px}
header.top .wrap{display:flex;align-items:center;gap:1rem;min-height:3.25rem;flex-wrap:wrap}
.brand{font-weight:700;text-decoration:none;letter-spacing:-.01em}
.brand span{color:var(--accent)}
nav.main{display:flex;gap:1rem;flex-wrap:wrap;margin-left:auto;align-items:center;font-size:.95rem}
nav.main a{text-decoration:none;color:var(--muted)} nav.main a:hover{color:var(--fg)}
main{padding:1.5rem 0 3rem}
h1{font-size:1.6rem;line-height:1.2;margin:.2rem 0 1rem;letter-spacing:-.015em} h2{font-size:1.15rem;margin:1.6rem 0 .6rem} h3{font-size:1rem;margin:1rem 0 .4rem}
.muted,.meta{color:var(--muted)} .meta{font-size:.875rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.1rem;margin:.75rem 0}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))}
.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
.spread{display:flex;justify-content:space-between;gap:1rem;align-items:baseline;flex-wrap:wrap}
button,.btn{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:.45rem .9rem;text-decoration:none;display:inline-block}
button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:600}
button.link{border:0;background:none;padding:0;color:var(--muted);font-size:inherit} button.link:hover{color:var(--fg)}
nav.main form{display:flex} nav.main button.link{line-height:inherit}
button.danger{border-color:var(--bad);color:var(--bad)}
input[type=text],input[type=email],input[type=url],input[type=search],select,textarea{font:inherit;width:100%;padding:.5rem .65rem;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}
label{display:block;font-weight:600;margin:.8rem 0 .3rem}
fieldset{border:1px solid var(--line);border-radius:8px;margin:.8rem 0;padding:.4rem .9rem .8rem} legend{font-weight:600;padding:0 .3rem}
fieldset label{display:inline-flex;gap:.35rem;font-weight:400;margin:.3rem 1rem .1rem 0}
form.inline{display:inline}
.pill{display:inline-block;font-size:.75rem;padding:.05rem .5rem;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.pill.bad{border-color:var(--bad);color:var(--bad)} .pill.warn{border-color:var(--warn);color:var(--warn)} .pill.ok{border-color:var(--ok);color:var(--ok)}
.flash{border-left:3px solid var(--accent);background:var(--soft);padding:.6rem .9rem;border-radius:4px;margin:1rem 0}
.error{border-left-color:var(--bad)}
blockquote{margin:.6rem 0;padding:.5rem .9rem;border-left:3px solid var(--accent);background:var(--soft);white-space:pre-wrap;border-radius:0 6px 6px 0}
pre{white-space:pre-wrap;word-break:break-word;background:var(--soft);padding:.6rem;border-radius:6px;font-size:.8rem;max-height:18rem;overflow:auto}
ul.plain{list-style:none;padding:0;margin:0} ul.plain a{text-decoration:none} ul.plain a:hover{text-decoration:underline} ul.plain li{padding:.5rem 0;border-bottom:1px solid var(--line)} ul.plain li:last-child{border-bottom:0}
.pick{display:flex;gap:.55rem;align-items:flex-start;padding:.55rem .7rem;border:1px solid var(--line);border-radius:8px;background:var(--card);font-weight:400;margin:0;cursor:pointer}
.pick:has(input:checked){border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.pick input{margin-top:.3rem}
details summary{cursor:pointer;color:var(--muted)}
footer{border-top:1px solid var(--line);padding:1.2rem 0;color:var(--muted);font-size:.85rem}
.sticky{position:sticky;bottom:0;background:var(--bg);padding:.8rem 0;border-top:1px solid var(--line)}
.hero{padding:1.5rem 0 .5rem} .hero h1{font-size:2.3rem;max-width:44rem;letter-spacing:-.025em} .lede{font-size:1.15rem;color:var(--muted);max-width:42rem}
.btn.big{padding:.65rem 1.2rem;font-size:1.05rem}
.example{max-width:44rem;border-left:4px solid var(--accent)} .example blockquote{font-size:.95rem}
.tags{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center} .tags .pill{font-size:.85rem;padding:.2rem .65rem;text-decoration:none;color:var(--fg)}
.plans{grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));align-items:start} .plans .featured{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.price{font-size:2rem;font-weight:700;margin:.2rem 0} .price .meta{font-size:.9rem;font-weight:400}
.prose{max-width:44rem} .prose h2{margin-top:1.8rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;margin:.6rem 0} th,td{border:1px solid var(--line);padding:.45rem .6rem;text-align:left;vertical-align:top} th{background:var(--soft)}
.prose table{display:block;overflow-x:auto}
code{font-size:.9em;background:var(--soft);padding:.05rem .3rem;border-radius:4px}
footer nav{display:flex;gap:1rem;flex-wrap:wrap;margin-top:.4rem} footer a{color:var(--muted)}
@media (max-width:40rem){h1{font-size:1.35rem} .hero h1{font-size:1.7rem} nav.main{margin-left:0}}
`;

export const Csrf: FC<{ token: string }> = ({ token }) => <input type="hidden" name="_csrf" value={token} />;

export const Layout: FC<PropsWithChildren<{ title: string; user?: User | null; csrf: string; admin?: boolean; noindex?: boolean; head?: Child; description?: string }>> = ({ title, user, csrf, admin, noindex, head, description, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {noindex && <meta name="robots" content="noindex" />}
      {description && <meta name="description" content={description} />}
      <title>{title === "Stackquake" ? title : `${title} · Stackquake`}</title>
      <link rel="alternate" type="application/rss+xml" title="Stackquake events" href="/events.rss" />
      <style>{raw(CSS)}</style>
      {head}
    </head>
    <body>
      <header class="top">
        <div class="wrap">
          <a class="brand" href={user ? "/app" : "/"}>
            Stack<span>quake</span>
          </a>
          <nav class="main">
            <a href="/catalog">Catalog</a>
            <a href="/events">Events</a>
            {!user && <a href="/pricing">Pricing</a>}
            {user ? (
              <>
                <a href="/app">Dashboard</a>
                <a href="/app/settings">Settings</a>
                {admin && <a href="/admin">Admin</a>}
                <form class="inline" method="post" action="/signout">
                  <Csrf token={csrf} />
                  <button class="link" type="submit">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <a href="/signin">Sign in</a>
            )}
          </nav>
        </div>
      </header>
      <main>
        <div class="wrap">{children}</div>
      </main>
      <footer>
        <div class="wrap">
          Stackquake watches vendor announcements, pricing pages, licences and end-of-life dates. Notes are summaries, not legal advice; read the source.
          <nav>
            <a href="/pricing">Pricing</a>
            <a href="/catalog">Catalog</a>
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

type PageOpts = { status?: 200 | 400 | 402 | 403 | 404 | 429 | 503; noindex?: boolean; head?: Child; description?: string };

/** Renders a page in the shared layout with the request's user and CSRF token. */
export function page(c: WebContext, title: string, body: Child, opts: PageOpts = {}) {
  return c.html(
    <Layout title={title} user={c.get("user")} csrf={c.get("csrf")} admin={isAdmin(c)} noindex={opts.noindex} head={opts.head} description={opts.description}>
      {body}
    </Layout>,
    opts.status ?? 200,
  );
}
