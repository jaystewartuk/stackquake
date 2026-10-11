// Stripe billing (SPEC §10), the same pattern as Beckon: Checkout starts a subscription, the
// Customer Portal changes or cancels it, and the webhook is the only writer of `users.plan`.
// Nothing trusts the redirect back from Stripe. Plain REST through ctx.http, no SDK: three calls
// and a signature check do not justify the bundle or the CPU.
import { eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { stripeEvents, users, type User } from "../db/schema";
import { safeEqual } from "../util";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceMonthly: string;
  priceYearly: string;
  api: string;
}

export type Interval = "month" | "year";

export class BillingError extends Error {
  constructor(
    public code: string,
    public status: 400 | 404 | 409 | 502 | 503,
    message = code,
  ) {
    super(message);
  }
}

export const STRIPE_API = "https://api.stripe.com";
/** Replay window for signed webhooks, as in Stripe's libraries. */
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

function form(params: Record<string, string | number | boolean | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out.append(k, String(v));
  return out.toString();
}

async function call<T>(ctx: Ctx, cfg: StripeConfig, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const body = method === "POST" ? form(params) : undefined;
  const res = await ctx.http(
    new Request(`${cfg.api}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.secretKey}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body,
    }),
  );
  const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!res.ok) {
    const err = new BillingError(json.error?.code ?? `http_${res.status}`, res.status === 404 ? 404 : 502, `Stripe: ${json.error?.message ?? res.status}`);
    throw err;
  }
  return json;
}

/** The user's Stripe customer, created on first checkout so every subscription hangs off one customer. */
async function ensureCustomer(ctx: Ctx, cfg: StripeConfig, user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const c = await call<{ id: string }>(ctx, cfg, "POST", "/v1/customers", { email: user.email, "metadata[user_id]": user.id });
  await ctx.db.update(users).set({ stripeCustomerId: c.id }).where(eq(users.id, user.id));
  return c.id;
}

/** A Checkout Session for a new Team subscription; returns Stripe's hosted page URL. */
export async function createCheckout(ctx: Ctx, cfg: StripeConfig, user: User, interval: Interval, origin: string): Promise<string> {
  if (user.plan === "team" && user.stripeSubscriptionId) throw new BillingError("already_subscribed", 409, "You're already on Team. Manage it from Settings.");
  const customer = await ensureCustomer(ctx, cfg, user);
  const s = await call<{ url?: string }>(ctx, cfg, "POST", "/v1/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": interval === "year" ? cfg.priceYearly : cfg.priceMonthly,
    "line_items[0][quantity]": 1,
    customer,
    client_reference_id: user.id,
    "subscription_data[metadata][user_id]": user.id,
    success_url: `${origin}/app/settings?billing=success`,
    cancel_url: `${origin}/pricing?billing=canceled`,
    allow_promotion_codes: true,
  });
  if (!s.url) throw new BillingError("no_url", 502, "Stripe returned no checkout URL");
  return s.url;
}

/** A Customer Portal session: payment method, invoices, switching interval, cancelling. */
export async function createPortal(ctx: Ctx, cfg: StripeConfig, user: User, origin: string): Promise<string> {
  if (!user.stripeCustomerId) throw new BillingError("no_customer", 404, "No billing account yet");
  const s = await call<{ url: string }>(ctx, cfg, "POST", "/v1/billing_portal/sessions", { customer: user.stripeCustomerId, return_url: `${origin}/app/settings` });
  return s.url;
}

/** Account deletion: ends the subscription now. A subscription Stripe no longer has is fine. */
export async function cancelSubscriptionNow(ctx: Ctx, cfg: StripeConfig, subscriptionId: string | null): Promise<void> {
  if (!subscriptionId) return;
  try {
    await call(ctx, cfg, "DELETE", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
  } catch (err) {
    if (err instanceof BillingError && (err.code === "resource_missing" || err.status === 404)) return;
    throw err;
  }
}

// ---------- Webhook ----------

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

/** Checks `Stripe-Signature` (t=…, v1=…) over the raw body and the timestamp's age. */
export async function verifyWebhook(rawBody: string, header: string | null | undefined, secret: string, now: number): Promise<StripeEvent> {
  if (!header) throw new BillingError("bad_signature", 400, "missing Stripe-Signature");
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || !sigs.length) throw new BillingError("bad_signature", 400, "malformed Stripe-Signature");
  if (Math.abs(now - Number(t) * 1000) > SIGNATURE_TOLERANCE_MS) throw new BillingError("bad_signature", 400, "timestamp outside tolerance");
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  if (!sigs.some((s) => safeEqual(s, expected))) throw new BillingError("bad_signature", 400, "signature mismatch");
  try {
    return JSON.parse(rawBody) as StripeEvent;
  } catch {
    throw new BillingError("bad_body", 400, "body is not JSON");
  }
}

const idOf = (x: unknown): string | null => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" ? (x as { id: string }).id : null);

async function findUser(ctx: Ctx, customerId: string | null, userId: unknown): Promise<User | undefined> {
  if (customerId) {
    const u = await ctx.db.select().from(users).where(eq(users.stripeCustomerId, customerId)).get();
    if (u) return u;
  }
  const n = Number(userId);
  if (Number.isSafeInteger(n) && n > 0) return ctx.db.select().from(users).where(eq(users.id, n)).get();
  return undefined;
}

/** Stripe subscription status → our plan. `plan: null`: leave the plan alone (payment not confirmed yet). */
export function planFromStatus(status: string): { plan: "team" | "free" | null; status: "active" | "past_due" | "none" } {
  switch (status) {
    case "active":
    case "trialing":
      return { plan: "team", status: "active" };
    case "past_due":
      // Stripe's retry schedule (Billing settings) ends in cancellation; until then Team stays.
      return { plan: "team", status: "past_due" };
    case "unpaid":
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return { plan: "free", status: "none" };
    default: // incomplete
      return { plan: null, status: "none" };
  }
}

export type WebhookOutcome = "applied" | "duplicate" | "ignored";

const SUB_EVENTS = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);

/**
 * Applies one verified event, once. Every change is idempotent and ordered by the event's
 * `created` (planEventAt), so if the invocation dies before the id is recorded, Stripe's retry
 * re-applies the same values; a replay after that is a no-op.
 */
export async function handleEvent(ctx: Ctx, event: StripeEvent): Promise<WebhookOutcome> {
  if (await ctx.db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id)).get()) return "duplicate";
  const outcome = await apply(ctx, event);
  await ctx.db.insert(stripeEvents).values({ id: event.id, type: event.type, createdAt: ctx.clock.now() }).onConflictDoNothing();
  return outcome;
}

async function apply(ctx: Ctx, event: StripeEvent): Promise<WebhookOutcome> {
  const at = event.created * 1000;
  const o = event.data.object;
  const newer = (u: User) => u.planEventAt === null || at >= u.planEventAt;

  if (event.type === "checkout.session.completed") {
    if (o.mode !== "subscription") return "ignored";
    const u = await findUser(ctx, idOf(o.customer), o.client_reference_id);
    if (!u) return "ignored";
    const paid = o.payment_status === "paid" || o.payment_status === "no_payment_required";
    await ctx.db
      .update(users)
      .set({
        stripeCustomerId: idOf(o.customer) ?? u.stripeCustomerId,
        stripeSubscriptionId: idOf(o.subscription) ?? u.stripeSubscriptionId,
        // Not planEventAt: that orders subscription events only. Stripe creates the subscription
        // (and its event) before the session completes, so the checkout's own later timestamp would
        // make customer.subscription.created look stale and drop its interval and period end.
        ...(paid && newer(u) ? { plan: "team", planStatus: "active" } : {}),
      })
      .where(eq(users.id, u.id));
    return "applied";
  }

  if (SUB_EVENTS.has(event.type)) {
    const sub = o as {
      id: string;
      status: string;
      customer: unknown;
      metadata?: Record<string, string>;
      cancel_at_period_end?: boolean;
      cancel_at?: number | null;
      current_period_end?: number;
      items?: { data?: Array<{ current_period_end?: number; price?: { recurring?: { interval?: string } } }> };
      plan?: { interval?: string };
    };
    const u = await findUser(ctx, idOf(sub.customer), sub.metadata?.user_id);
    if (!u) return "ignored";
    if (!newer(u)) return "ignored"; // an older event arriving late
    const deleted = event.type === "customer.subscription.deleted";
    // An old subscription ending must not undo a newer one.
    if (deleted && u.stripeSubscriptionId && u.stripeSubscriptionId !== sub.id) return "ignored";
    const next = planFromStatus(deleted ? "canceled" : sub.status);
    const item = sub.items?.data?.[0];
    const periodEnd = sub.cancel_at ?? item?.current_period_end ?? sub.current_period_end;
    const interval = item?.price?.recurring?.interval ?? sub.plan?.interval;
    const set: Partial<typeof users.$inferInsert> = {
      stripeCustomerId: idOf(sub.customer) ?? u.stripeCustomerId,
      stripeSubscriptionId: sub.id,
      planPeriodEnd: periodEnd ? periodEnd * 1000 : u.planPeriodEnd,
      planInterval: interval === "year" || interval === "month" ? interval : u.planInterval,
      // A scheduled end can be cancel_at (a date) as well as cancel_at_period_end.
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at) && next.plan === "team",
      planEventAt: at,
    };
    if (next.plan !== null) {
      set.plan = next.plan;
      set.planStatus = next.status;
      if (next.plan === "free") Object.assign(set, { cancelAtPeriodEnd: false, planPeriodEnd: null, planInterval: null });
    }
    await ctx.db.update(users).set(set).where(eq(users.id, u.id));
    return "applied";
  }
  return "ignored";
}
