// Whole-page answers the signed-in pages share: plain-words errors (400, 403, 404, 429, 503) and
// the Team upgrade page every 402 uses, so each limit explains itself the same way.
import type { Child } from "hono/jsx";
import { PRICES, TEAM_FEATURES } from "../billing/plans";
import { page } from "./layout";
import type { WebContext } from "./session";
import { ButtonLink, ErrorPage, UpgradePanel } from "./ui";

type Back = { href: string; label: Child };

/** An error page with what happened and the way back. */
export function problemPage(c: WebContext, opts: { title: string; status: 400 | 403 | 404 | 429 | 503; heading: Child; body?: Child; back?: Back; extra?: Child }) {
  return page(
    c,
    opts.title,
    <ErrorPage
      code={opts.status}
      title={opts.heading}
      actions={
        <>
          {opts.extra}
          {opts.back && (
            <ButtonLink variant={opts.extra ? "quiet" : "secondary"} href={opts.back.href}>
              {opts.back.label}
            </ButtonLink>
          )}
        </>
      }
    >
      {opts.body}
    </ErrorPage>,
    { status: opts.status, noindex: true },
  );
}

/** The Team price, as every upgrade page states it. */
export const TeamPrice = () => (
  <>
    <span class="num">${PRICES.month}</span> a month, or <span class="num">${PRICES.year}</span> a year (2 months free), for up to 10 people.
  </>
);

/** A 402: the feature is on Team. Says what Team adds, what it costs and how to get it. */
export function upgradePage(c: WebContext, opts: { title: string; heading: Child; body: Child; back?: Back; status?: 200 | 402 }) {
  return page(
    c,
    opts.title,
    <UpgradePanel page title={opts.heading} features={TEAM_FEATURES} price={<TeamPrice />} back={opts.back ?? { href: "/app", label: "Back to the dashboard" }}>
      {opts.body}
    </UpgradePanel>,
    { status: opts.status ?? 402, noindex: true },
  );
}
