// Shared UI components (docs/design/DIRECTION.md "Components"). Styles are in
// src/web/styles/components.ts; every component here renders plain HTML that works without JS.
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import { Icon, type IconName } from "./icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ") || undefined;

// ---------- Buttons ----------

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonLook = { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; icon?: IconName; iconEnd?: IconName; block?: boolean; class?: string };

const btnClass = ({ variant = "secondary", size = "md", block, class: extra }: ButtonLook) =>
  cx("btn", variant !== "secondary" && `btn-${variant}`, size !== "md" && `btn-${size}`, block && "btn-block-sm", extra);

const Inner: FC<PropsWithChildren<ButtonLook>> = ({ icon, iconEnd, children }) => (
  <>
    {icon && <Icon name={icon} />}
    {children}
    {iconEnd && <Icon name={iconEnd} />}
  </>
);

/** A form button. `name`/`value` submit with the form, as with a plain <button>. */
export const Button: FC<PropsWithChildren<ButtonLook & { type?: "submit" | "button"; name?: string; value?: string; disabled?: boolean; pressed?: boolean; form?: string; label?: string }>> = (p) => (
  <button
    class={btnClass(p)}
    type={p.type ?? "submit"}
    name={p.name}
    value={p.value}
    disabled={p.disabled}
    form={p.form}
    aria-label={p.label}
    aria-pressed={p.pressed === undefined ? undefined : p.pressed ? "true" : "false"}
  >
    <Inner {...p} />
  </button>
);

/** A link that looks like a button. Disabled links keep their text but lose their href. */
export const ButtonLink: FC<PropsWithChildren<ButtonLook & { href: string; disabled?: boolean; rel?: string }>> = (p) => (
  <a class={btnClass(p)} href={p.disabled ? undefined : p.href} rel={p.rel} aria-disabled={p.disabled ? "true" : undefined} role={p.disabled ? "link" : undefined}>
    <Inner {...p} />
  </a>
);

// ---------- Form fields ----------

type InputProps = {
  id: string;
  name?: string;
  type?: "text" | "email" | "url" | "search" | "number" | "password";
  value?: string;
  placeholder?: string;
  required?: boolean;
  maxlength?: number;
  autocomplete?: string;
  inputmode?: "email" | "url" | "search" | "text" | "numeric";
  autofocus?: boolean;
  pattern?: string;
};

const describedBy = (id: string, hint?: Child, error?: Child) => cx(hint ? `${id}-hint` : null, error ? `${id}-error` : null);

/** Label, input, hint and error, wired together with aria-describedby and aria-invalid. */
export const Field: FC<InputProps & { label: Child; hint?: Child; error?: Child; wide?: boolean; class?: string }> = ({ label, hint, error, wide, class: cls, ...input }) => (
  <div class={cx("field", wide && "wide", cls)}>
    <label for={input.id}>{label}</label>
    <input type="text" name={input.id} {...input} aria-describedby={describedBy(input.id, hint, error)} aria-invalid={error ? "true" : undefined} />
    {error && (
      <p class="error-text" id={`${input.id}-error`}>
        <Icon name="alert-triangle" /> {error}
      </p>
    )}
    {hint && (
      <p class="hint" id={`${input.id}-hint`}>
        {hint}
      </p>
    )}
  </div>
);

/** An input with its button on one line (stacks under 30rem): search boxes, repo import. */
export const InputGroup: FC<PropsWithChildren<{ class?: string }>> = ({ class: cls, children }) => <div class={cx("input-group", cls)}>{children}</div>;

// ---------- Choice (radio/checkbox chips) and PickTile ----------

export type ChoiceOption = { value: string; label: Child; checked?: boolean };

/** A question answered by one (radio) or several (checkbox) chips; native inputs, so no JS. */
export const Choice: FC<{ legend: Child; name: string; options: ChoiceOption[]; type?: "radio" | "checkbox"; hint?: Child }> = ({ legend, name, options, type = "radio", hint }) => (
  <fieldset>
    <legend>{legend}</legend>
    {hint && <p class="meta">{hint}</p>}
    <div class="choice">
      {options.map((o) => (
        <label>
          <input type={type} name={name} value={o.value} checked={o.checked} /> {o.label}
        </label>
      ))}
    </div>
  </fieldset>
);

/** A checkbox tile for the service picker. `search` feeds the picker's filter script. */
export const PickTile: FC<PropsWithChildren<{ name: string; value: string; label: Child; sub?: Child; note?: Child; checked?: boolean; disabled?: boolean; search?: string }>> = (p) => (
  <label class="pick" data-s={p.search}>
    <input type="checkbox" name={p.name} value={p.value} checked={p.checked} disabled={p.disabled} />
    <span>
      <span class="pick-name">{p.label}</span>
      {p.note && <span class="meta"> · {p.note}</span>}
      {p.sub && <span class="pick-sub">{p.sub}</span>}
    </span>
    {p.children}
  </label>
);

// ---------- Panels ----------

/** A bordered section with an optional heading row. `danger` marks a Danger zone. */
export const Panel: FC<PropsWithChildren<{ title?: Child; level?: 2 | 3; meta?: Child; actions?: Child; danger?: boolean; class?: string; id?: string; label?: string }>> = ({ title, level = 2, meta, actions, danger, class: cls, id, label, children }) => (
  <section class={cx("panel", danger && "danger", cls)} id={id} aria-label={title ? undefined : label}>
    {(title || meta || actions) && (
      <div class="panel-head">
        {title && (level === 2 ? <h2>{title}</h2> : <h3>{title}</h3>)}
        {meta && <span class="meta">{meta}</span>}
        {actions && <span class="cluster">{actions}</span>}
      </div>
    )}
    {children}
  </section>
);

// ---------- Badges and severity ----------

export type Tone = "neutral" | "act" | "watch" | "info" | "ok";

export const Badge: FC<PropsWithChildren<{ tone?: Tone; icon?: IconName; count?: boolean }>> = ({ tone = "neutral", icon, count, children }) => (
  <span class={cx("badge", tone !== "neutral" && tone, count && "count")}>
    {icon && <Icon name={icon} />}
    {children}
  </span>
);

/** How much a change needs the user (DIRECTION.md "Severity mapping"). Presentation only. */
export type Level = "act" | "watch" | "quiet";
export const LEVEL_LABELS: Record<Level, string> = { act: "Act", watch: "Watch", quiet: "Quiet" };

/** A severity mark: shape and word, so colour is never the only signal. `mark` shows only the shape, with the word for screen readers (rows that say why in words beside it). */
export const Severity: FC<{ level: Level; label?: string; mark?: boolean }> = ({ level, label, mark }) =>
  mark ? (
    <span class={`sev ${level} mark`}>
      <span class="visually-hidden">{label ?? LEVEL_LABELS[level]}</span>
    </span>
  ) : (
    <span class={`sev ${level}`}>{label ?? LEVEL_LABELS[level]}</span>
  );

// ---------- Callouts ----------

const CALLOUT_ICON: Record<"info" | "ok" | "warn" | "error", IconName> = { info: "info", ok: "check", warn: "alert-triangle", error: "alert-triangle" };

/** A notice. Errors are announced at once (role=alert), the rest politely (role=status). */
export const Callout: FC<PropsWithChildren<{ tone?: "info" | "ok" | "warn" | "error"; title?: Child; id?: string; hidden?: boolean }>> = ({ tone = "info", title, id, hidden, children }) => (
  <div class={cx("callout", tone !== "info" && tone)} role={tone === "error" ? "alert" : "status"} id={id} hidden={hidden}>
    <Icon name={CALLOUT_ICON[tone]} />
    <div>
      {title && <strong style="display:block">{title}</strong>}
      {children}
    </div>
  </div>
);

/** The message carried by `?msg=` after a redirect. */
export const Flash: FC<{ msg?: string; tone?: "info" | "ok" | "error" }> = ({ msg, tone = "ok" }) => (msg ? <Callout tone={tone}>{msg}</Callout> : null);

// ---------- Page header ----------

export type Crumb = { href: string; label: Child };

/** Breadcrumb, kicker, h1, description and actions, in that order. */
export const PageHeader: FC<{ title: Child; crumbs?: Crumb[]; kicker?: Child; description?: Child; actions?: Child }> = ({ title, crumbs, kicker, description, actions }) => (
  <header class="page-header">
    {crumbs && crumbs.length > 0 && (
      <nav class="crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((c) => (
            <li>
              <a href={c.href}>{c.label}</a>
            </li>
          ))}
        </ol>
      </nav>
    )}
    {kicker && <div class="kicker">{kicker}</div>}
    <div class="title-row">
      <h1>{title}</h1>
      {actions && <div class="actions">{actions}</div>}
    </div>
    {description && <p class="desc">{description}</p>}
  </header>
);

// ---------- Tables ----------

export type Column = { label: string; num?: boolean };

/** A table that scrolls sideways when it must, or (`stack`) becomes label/value rows under 40rem. */
export const DataTable: FC<{ columns: Column[]; rows: Child[][]; caption?: Child; stack?: boolean; rowHeader?: boolean; class?: string }> = ({ columns, rows, caption, stack = true, rowHeader, class: cls }) => (
  <div class={cx("table-wrap", cls)} {...(stack ? {} : { tabindex: 0, role: "region", "aria-label": typeof caption === "string" ? caption : undefined })}>
    <table class={stack ? "table-stack" : undefined}>
      {caption && <caption class="visually-hidden">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th scope="col" class={c.num ? "num" : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            {r.map((cell, i) =>
              rowHeader && i === 0 ? (
                <th scope="row" data-label={columns[i]?.label}>
                  {cell}
                </th>
              ) : (
                <td data-label={columns[i]?.label} class={columns[i]?.num ? "num" : undefined}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ---------- Tabs ----------

export type TabItem = { href: string; label: Child; current?: boolean; count?: number };

/** Navigation tabs as links (each tab is its own URL), or a compact segmented control. */
export const Tabs: FC<{ items: TabItem[]; label: string; variant?: "tabs" | "segmented" }> = ({ items, label, variant = "tabs" }) => (
  <nav class={variant} aria-label={label}>
    {items.map((t) => (
      <a href={t.href} aria-current={t.current ? "page" : undefined}>
        {t.label}
        {t.count !== undefined && (
          <>
            {" "}
            <span class="num">{t.count}</span>
          </>
        )}
      </a>
    ))}
  </nav>
);

// ---------- Empty state ----------

/** Nothing to show yet, and what to do about it. `page` makes it the page's main content (h1). */
export const EmptyState: FC<PropsWithChildren<{ title: Child; icon?: IconName; actions?: Child; page?: boolean; level?: 2 | 3 }>> = ({ title, icon = "inbox", actions, page, level = 2, children }) => (
  <div class={cx("empty", page && "page")}>
    <Icon name={icon} size={24} />
    {page ? <h1>{title}</h1> : level === 2 ? <h2>{title}</h2> : <h3>{title}</h3>}
    {children && <p>{children}</p>}
    {actions && <div class="actions">{actions}</div>}
  </div>
);

// ---------- Source quote ----------

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The quoted source text with its citation. `href` must already be checked with safeHref. */
export const Quote: FC<{ text: string; href?: string; url?: string | null; size?: "md" | "sm" }> = ({ text, href, url, size = "md" }) => (
  <figure class={cx("quote", size === "sm" && "sm")}>
    <Icon name="quote" size={size === "sm" ? 16 : 20} />
    <blockquote>{text}</blockquote>
    {(href || url) && (
      <figcaption>
        —{" "}
        {href ? (
          <a href={href} rel="noopener noreferrer nofollow">
            {hostOf(href)}, read the source <Icon name="external-link" />
          </a>
        ) : (
          url
        )}
      </figcaption>
    )}
  </figure>
);

// ---------- Definition list ----------

export type DataItem = { term: Child; value: Child; highlight?: boolean };

/** Metadata as dt/dd pairs; `strip` lays them out in one row (the note's fact strip). */
export const DataList: FC<{ items: DataItem[]; strip?: boolean; label?: string }> = ({ items, strip, label }) => (
  <dl class={cx("dl", strip && "strip")} aria-label={label}>
    {items.map((i) =>
      strip ? (
        <div>
          <dt>{i.term}</dt>
          <dd class={i.highlight ? "hl" : undefined}>{i.value}</dd>
        </div>
      ) : (
        <>
          <dt>{i.term}</dt>
          <dd class={i.highlight ? "hl" : undefined}>{i.value}</dd>
        </>
      ),
    )}
  </dl>
);

// ---------- Event note card ----------

export type NoteCardOption = { name: Child; effort?: string };

/** A note in compact form, as an alert reads in an inbox: the landing example and alert previews. No headings, so it sits anywhere in a page's outline. */
export const NoteCard: FC<{
  bar?: Child;
  kind: Child;
  subject: Child;
  title: Child;
  summary?: Child;
  quote?: string;
  quoteHref?: string;
  facts?: DataItem[];
  because?: Child;
  options?: NoteCardOption[];
  href?: string;
  label?: string;
}> = (p) => (
  <figure class="note-card" aria-label={p.label}>
    {p.bar && <div class="note-bar">{p.bar}</div>}
    <div class="note-body">
      <div class="kick">
        {p.kind} <span>{p.subject}</span>
      </div>
      <p class="note-title">{p.title}</p>
      {p.summary && <p>{p.summary}</p>}
      {p.quote && <Quote text={p.quote} href={p.quoteHref} size="sm" />}
      {p.facts && <DataList items={p.facts} strip />}
      {p.because && (
        <>
          <p class="note-h">What this means for you</p>
          <p>{p.because}</p>
        </>
      )}
      {p.options && p.options.length > 0 && (
        <>
          <p class="note-h">Ways out</p>
          <p>
            {p.options.map((o, i) => (
              <>
                {i > 0 && " · "}
                {o.name}
                {o.effort && <span class="meta"> ({o.effort} effort)</span>}
              </>
            ))}
          </p>
        </>
      )}
      {p.href && (
        <div class="note-foot">
          <span class="meta">Summary, not legal advice; read the source.</span>
          <a href={p.href}>
            Read the note <Icon name="arrow-right" />
          </a>
        </div>
      )}
    </div>
  </figure>
);

// ---------- Status line and trace ----------

/** "2 need action · 3 to watch · 19 quiet", counts in mono, each with its severity shape. */
export const StatusLine: FC<{ act: number; watch: number; quiet: number }> = ({ act, watch, quiet }) => (
  <p class="status-line">
    <span>
      <Severity level="act" label="" />
      <span class="n">{act}</span>
      {act === 1 ? "needs" : "need"} action
    </span>
    <span>
      <Severity level="watch" label="" />
      <span class="n">{watch}</span>to watch
    </span>
    <span>
      <Severity level="quiet" label="" />
      <span class="n">{quiet}</span>quiet
    </span>
  </p>
);

export type TracePoint = { at: number; level: Level | "kind"; label: string; href?: string };

const SPIKE: Record<TracePoint["level"], number> = { act: 18, watch: 12, quiet: 6, kind: 14 };

/**
 * The seismograph trace: flat for quiet stretches, a spike at each change, height by severity.
 * Server-rendered SVG; each spike links to its change and carries its title for screen readers.
 */
export const Trace: FC<{ points: TracePoint[]; from: number; to: number; label: string; height?: number; axis?: [string, string] }> = ({ points, from, to, label, height = 48, axis }) => {
  const W = 600;
  const mid = height / 2;
  const span = Math.max(1, to - from);
  const xs = points
    .filter((p) => p.at >= from && p.at <= to)
    .map((p) => ({ ...p, x: Math.round(((p.at - from) / span) * (W - 16) + 8) }))
    .sort((a, b) => a.x - b.x);
  const peaks = (x: number, h: number) => `L${x - 1} ${mid - h}L${x + 1.5} ${mid + h * 0.6}L${x + 3} ${mid}`;
  const zig = (x: number, h: number) => `L${x - 3} ${mid}${peaks(x, h)}`;
  const base = `M0 ${mid}${xs.map((p) => zig(p.x, SPIKE[p.level])).join("")}L${W} ${mid}`;
  const svg = (
    <svg class="trace" viewBox={`0 0 ${W} ${height}`} height={height} preserveAspectRatio="none" role={points.some((p) => p.href) ? "group" : "img"} aria-label={label}>
      <path class="base" d={base} fill="none" stroke-width={1.25} vector-effect="non-scaling-stroke" />
      {xs.map((p) => {
        const mark = <path class={`spike ${p.level}`} d={`M${p.x - 3} ${mid}${peaks(p.x, SPIKE[p.level])}`} fill="none" stroke-width={2} vector-effect="non-scaling-stroke" />;
        return p.href ? (
          <a href={p.href}>
            <title>{p.label}</title>
            {mark}
          </a>
        ) : (
          <g>
            <title>{p.label}</title>
            {mark}
          </g>
        );
      })}
    </svg>
  );
  return axis ? (
    <div class="trace-wrap">
      {svg}
      <div class="axis" aria-hidden="true">
        <span>{axis[0]}</span>
        <span>{axis[1]}</span>
      </div>
    </div>
  ) : (
    svg
  );
};

// ---------- Sticky action bar, avatar ----------

export const StickyBar: FC<PropsWithChildren> = ({ children }) => <div class="sticky">{children}</div>;

/** Initials from an email address, for the account menu and team lists. */
export const Avatar: FC<{ email: string; hidden?: boolean }> = ({ email, hidden }) => <span class="avatar" aria-hidden={hidden ? "true" : undefined}>{email.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "?"}</span>;

// ---------- Ways out, plans, error pages ----------

export type Effort = "low" | "medium" | "high";
const EFFORT_BARS: Record<Effort, number> = { low: 1, medium: 2, high: 3 };

/** How much work a way out is: three bars, filled by level, with the word beside them. */
export const EffortMeter: FC<{ effort: Effort }> = ({ effort }) => (
  <span class={`effort ${effort}`}>
    <span class="bars" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span class={i <= EFFORT_BARS[effort] ? "on" : undefined} />
      ))}
    </span>
    {effort[0].toUpperCase() + effort.slice(1)} effort
  </span>
);

/** One alternative in a note's "Ways out": name (linked when it is in the catalog), effort, why. */
export const OptionCard: FC<{ name: Child; effort: Effort; why?: Child }> = ({ name, effort, why }) => (
  <li class="option">
    <div class="option-head">
      <strong>{name}</strong>
      <EffortMeter effort={effort} />
    </div>
    {why && <p>{why}</p>}
  </li>
);

/** A plan on /pricing and in Settings. `featured` is the plan we recommend. */
export const PlanCard: FC<PropsWithChildren<{ name: string; price: Child; period?: Child; note?: Child; features: Child[]; featured?: boolean; badge?: Child }>> = (p) => (
  <section class={cx("plan", p.featured && "featured")} aria-labelledby={`plan-${p.name.toLowerCase()}`}>
    <div class="plan-head">
      <h2 id={`plan-${p.name.toLowerCase()}`}>{p.name}</h2>
      {p.badge && <Badge tone="info">{p.badge}</Badge>}
    </div>
    <p class="plan-price">
      <span class="amount">{p.price}</span>
      {p.period && <span class="period">{p.period}</span>}
    </p>
    {p.note && <p class="plan-note">{p.note}</p>}
    <ul class="plan-features">
      {p.features.map((f) => (
        <li>
          <Icon name="check" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
    <div class="plan-action">{p.children}</div>
  </section>
);

/** A whole-page error (404, 400, 429, 503): what happened, in plain words, and the next step. */
export const ErrorPage: FC<PropsWithChildren<{ code: number; title: Child; icon?: IconName; actions?: Child }>> = ({ code, title, icon = "alert-triangle", actions, children }) => (
  <div class="error-page">
    <p class="error-code">
      <Icon name={icon} /> Error <span class="num">{code}</span>
    </p>
    <h1>{title}</h1>
    {children && <div class="error-body">{children}</div>}
    {actions && <div class="actions">{actions}</div>}
  </div>
);

// ---------- Narrow pages, steps, upgrades, diffs ----------

/** The narrow, centred column of the sign-in pages and the one-click alert links. */
export const AuthShell: FC<PropsWithChildren<{ title: string; description?: Child; icon?: IconName }>> = ({ title, description, icon = "logo", children }) => (
  <div class="auth">
    <Icon name={icon} size={24} class="auth-mark" />
    <h1>{title}</h1>
    {description && <p class="auth-desc">{description}</p>}
    {children}
  </div>
);

export type Step = { label: Child; state: "done" | "current" | "todo" };

/** Where the user is in a short flow (onboarding: start, find, usage, dashboard). */
export const Stepper: FC<{ steps: Step[]; label?: string }> = ({ steps, label = "Progress" }) => (
  <ol class="stepper" aria-label={label}>
    {steps.map((s, i) => (
      <li class={s.state} aria-current={s.state === "current" ? "step" : undefined}>
        <span class="step-dot" aria-hidden="true">
          {s.state === "done" ? <Icon name="check" /> : i + 1}
        </span>
        <span>
          {s.label}
          {s.state === "done" && <span class="visually-hidden"> (done)</span>}
        </span>
      </li>
    ))}
  </ol>
);

/** A live checklist: the steps of a job that runs while the page refreshes (repo import). */
export const ProgressSteps: FC<{ steps: { label: Child; detail?: Child }[]; current: number; label: string }> = ({ steps, current, label }) => (
  <div class="progress-steps">
    <progress max={steps.length} value={current} aria-label={label}>
      {current} of {steps.length}
    </progress>
    <ol>
      {steps.map((s, i) => (
        <li class={i < current ? "done" : i === current ? "current" : "todo"}>
          <span class="ps-mark" aria-hidden="true">
            {i < current ? <Icon name="check" /> : null}
          </span>
          <span>
            {s.label}
            {i < current ? <span class="visually-hidden"> (done)</span> : i === current ? <span class="visually-hidden"> (working)</span> : null}
            {s.detail && <span class="ps-detail">{s.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  </div>
);

/**
 * What the Team plan adds, its price and one way to get it: every 402 and plan-limit page.
 * `page` makes it the page's h1 (a whole 402 page); otherwise it sits in a page under an h2.
 */
export const UpgradePanel: FC<PropsWithChildren<{ title: Child; features: Child[]; price: Child; page?: boolean; back?: { href: string; label: Child }; action?: Child; id?: string }>> = ({ title, features, price, page, back, action, id = "upgrade-title", children }) => (
  <section class={cx("upgrade", page && "page")} aria-labelledby={id}>
    <p class="kicker">
      <Icon name="layers" /> Team plan
    </p>
    {page ? <h1 id={id}>{title}</h1> : <h2 id={id}>{title}</h2>}
    {children && <div class="upgrade-why">{children}</div>}
    <ul class="plan-features">
      {features.map((f) => (
        <li>
          <Icon name="check" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
    <p class="upgrade-price">{price}</p>
    <div class="actions">
      {action ?? (
        <ButtonLink variant="primary" href="/pricing" iconEnd="arrow-right">
          See the Team plan
        </ButtonLink>
      )}
      {back && (
        <ButtonLink variant="quiet" href={back.href}>
          {back.label}
        </ButtonLink>
      )}
    </div>
  </section>
);

/** Before and after, side by side on wide screens (admin review; source text is escaped). */
export const DiffView: FC<{ before: string | null; after: string | null; label?: string }> = ({ before, after, label = "Source text" }) => (
  <div class="diff" role="group" aria-label={label}>
    <div>
      <p class="kicker">Before</p>
      <pre>{before ?? ""}</pre>
    </div>
    <div>
      <p class="kicker">After</p>
      <pre>{after ?? ""}</pre>
    </div>
  </div>
);
