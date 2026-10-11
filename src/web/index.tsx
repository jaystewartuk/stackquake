// The Worker's HTTP app. `makeCtx` is injected so tests can run every route against fixture
// HTTP, a fake clock and an in-memory mailer.
import { Hono } from "hono";
import { adminRoutes } from "../admin/routes";
import { stagingRoutes } from "../admin/staging";
import type { Ctx } from "../context";
import { devRoutes } from "../dev";
import type { AppEnv } from "../env";
import { githubWebhook } from "../github/webhook";
import { alertLinks } from "./alert-links";
import { app as appRoutes } from "./app";
import { auth } from "./auth";
import { billing, stripeWebhook } from "./billing";
import { github } from "./github";
import { page } from "./layout";
import { pub } from "./public";
import { sessionMiddleware, type WebEnv } from "./session";
import { site } from "./site";
import { team } from "./team";

export function createApp(makeCtx: (env: AppEnv) => Ctx) {
  const web = new Hono<WebEnv>();
  web.get("/health", (c) => c.json({ ok: true }));
  // JSON routes for local scripts only (DEV_ROUTES=1 on localhost); no session or CSRF.
  web.route("/__dev", devRoutes as unknown as Hono<WebEnv>);
  // GitHub App webhooks: signed by GitHub, so no session or CSRF.
  web.route("/", githubWebhook(makeCtx) as unknown as Hono<WebEnv>);
  // Stripe webhooks: signed by Stripe, so no session or CSRF.
  web.route("/", stripeWebhook(makeCtx) as unknown as Hono<WebEnv>);
  web.use("*", async (c, next) => {
    if (c.req.path.startsWith("/__dev") || c.req.path === "/github/webhook" || c.req.path === "/stripe/webhook") return next();
    return sessionMiddleware(makeCtx)(c, next);
  });
  web.use("*", async (c, next) => {
    await next();
    // Signed-in pages and forms are never cached; public pages may be.
    if (c.get("user") || c.req.path.startsWith("/app") || c.req.path.startsWith("/admin")) c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "strict-origin-when-cross-origin");
    c.header("x-frame-options", "DENY");
  });
  web.route("/", auth);
  web.route("/", site);
  web.route("/", pub);
  web.route("/", alertLinks);
  web.route("/app/github", github);
  web.route("/app/billing", billing);
  web.route("/app/team", team);
  web.route("/app", appRoutes);
  web.route("/admin/staging", stagingRoutes);
  web.route("/admin", adminRoutes);
  web.notFound((c) => (c.get("csrf") !== undefined ? page(c, "Not found", <><h1>Not found</h1><p><a href="/">Home</a></p></>, { status: 404, noindex: true }) : c.text("Not found", 404)));
  return web;
}
