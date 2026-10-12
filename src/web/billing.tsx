// Billing routes (SPEC §10): Checkout and the Customer Portal for signed-in users, and Stripe's
// webhook (signed by Stripe, so no session or CSRF; mounted before the session middleware).
import { Hono } from "hono";
import type { Ctx } from "../context";
import type { AppEnv } from "../env";
import { accountOf } from "../billing/plans";
import { BillingError, createCheckout, createPortal, handleEvent, verifyWebhook, type Interval } from "../billing/stripe";
import { errorMessage } from "../util";
import { problemPage } from "./app-ui";
import { appOrigin, requireUser, type WebContext, type WebEnv } from "./session";

export const billing = new Hono<WebEnv>();
billing.use("*", requireUser);

const problem = (c: WebContext, status: 400 | 404 | 503, heading: string, msg: string) => problemPage(c, { title: "Billing", status, heading, body: <p>{msg}</p>, back: { href: "/app/settings#plan", label: "Back to settings" } });

billing.post("/checkout", async (c) => {
  const ctx = c.get("ctx");
  const cfg = ctx.config.stripe;
  if (!cfg) return problem(c, 503, "Billing isn't open yet", "Billing isn't enabled on this server yet.");
  const user = c.get("user")!;
  const account = await accountOf(ctx, user);
  if (account.role === "member") return problem(c, 400, "You already have Team", `You're on ${account.ownerEmail}'s team, which already has Team. Leave the team first to subscribe on your own.`);
  const form = await c.req.parseBody();
  const interval: Interval = form.interval === "year" ? "year" : "month";
  try {
    return c.redirect(await createCheckout(ctx, cfg, user, interval, appOrigin(c)), 303);
  } catch (err) {
    if (err instanceof BillingError && err.code === "already_subscribed") return c.redirect("/app/settings?msg=subscribed");
    console.error(JSON.stringify({ billing: "checkout", error: errorMessage(err) }));
    return problem(c, 503, "Checkout didn't start", "Stripe didn't start the checkout. Nothing was charged. Try again in a minute.");
  }
});

billing.post("/portal", async (c) => {
  const ctx = c.get("ctx");
  const cfg = ctx.config.stripe;
  if (!cfg) return problem(c, 503, "Billing isn't open yet", "Billing isn't enabled on this server yet.");
  try {
    return c.redirect(await createPortal(ctx, cfg, c.get("user")!, appOrigin(c)), 303);
  } catch (err) {
    if (err instanceof BillingError && err.code === "no_customer") return problem(c, 404, "No billing account yet", "There's no billing account to manage yet.");
    console.error(JSON.stringify({ billing: "portal", error: errorMessage(err) }));
    return problem(c, 503, "The billing portal didn't open", "Stripe didn't open the billing portal. Try again in a minute.");
  }
});

/** POST /stripe/webhook. The signature is checked over the raw body before anything is parsed. */
export function stripeWebhook(makeCtx: (env: AppEnv) => Ctx) {
  const hook = new Hono<{ Bindings: AppEnv }>();
  hook.post("/stripe/webhook", async (c) => {
    const ctx = makeCtx(c.env);
    const cfg = ctx.config.stripe;
    if (!cfg) return c.json({ error: "billing_unavailable" }, 503);
    const raw = await c.req.text();
    if (raw.length > 512 * 1024) return c.json({ error: "too_large" }, 413);
    let event;
    try {
      event = await verifyWebhook(raw, c.req.header("stripe-signature"), cfg.webhookSecret, ctx.clock.now());
    } catch (err) {
      return c.json({ error: err instanceof BillingError ? err.code : "bad_request" }, 400);
    }
    try {
      const outcome = await handleEvent(ctx, event);
      console.log(JSON.stringify({ stripe: event.type, id: event.id, outcome }));
      return c.json({ received: true, outcome });
    } catch (err) {
      console.error(JSON.stringify({ stripe: event.type, id: event.id, error: errorMessage(err) }));
      return c.json({ error: "processing_failed" }, 500); // Stripe retries
    }
  });
  return hook;
}
