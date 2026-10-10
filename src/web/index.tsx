// The Worker's HTTP app. `makeCtx` is injected so tests can run every route against fixture
// HTTP, a fake clock and an in-memory mailer.
import { Hono } from "hono";
import { adminRoutes } from "../admin/routes";
import type { Ctx } from "../context";
import { devRoutes } from "../dev";
import type { AppEnv } from "../env";
import { alertLinks } from "./alert-links";
import { app as appRoutes } from "./app";
import { auth } from "./auth";
import { page } from "./layout";
import { pub } from "./public";
import { sessionMiddleware, type WebEnv } from "./session";

export function createApp(makeCtx: (env: AppEnv) => Ctx) {
  const web = new Hono<WebEnv>();
  web.get("/health", (c) => c.json({ ok: true }));
  // JSON routes for local scripts only (DEV_ROUTES=1 on localhost); no session or CSRF.
  web.route("/__dev", devRoutes as unknown as Hono<WebEnv>);
  web.use("*", async (c, next) => {
    if (c.req.path.startsWith("/__dev")) return next();
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
  web.route("/", pub);
  web.route("/", alertLinks);
  web.route("/app", appRoutes);
  web.route("/admin", adminRoutes);
  web.notFound((c) => (c.get("csrf") !== undefined ? page(c, "Not found", <><h1>Not found</h1><p><a href="/">Home</a></p></>, { status: 404, noindex: true }) : c.text("Not found", 404)));
  return web;
}
