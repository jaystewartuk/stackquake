// Design tokens (docs/design/DIRECTION.md "Tokens"). Colours are defined once per scheme so the
// page can follow `prefers-color-scheme` and the component gallery can show both side by side.

const LIGHT = {
  bg: "#f8f8f6",
  surface: "#ffffff",
  sunken: "#f1f1ee",
  line: "#e3e2de",
  "line-strong": "#c9c7c1",
  control: "#8a8781",
  fg: "#1a1917",
  muted: "#56544f",
  subtle: "#6b6963",
  accent: "#c2410c",
  "on-accent": "#ffffff",
  "accent-text": "#b13a09",
  "accent-bg": "#fdeee6",
  act: "#b42318",
  "act-bg": "#fdecea",
  watch: "#8f5200",
  "watch-bg": "#fdf3e1",
  info: "#38597a",
  "info-bg": "#eaf0f6",
  ok: "#1c6e3c",
  "ok-bg": "#e8f4ec",
  focus: "#1d5fd1",
  "shadow-1": "0 1px 2px rgb(0 0 0 / .06)",
  "shadow-2": "0 4px 16px rgb(0 0 0 / .10)",
};

const DARK: typeof LIGHT = {
  bg: "#121211",
  surface: "#1a1a18",
  sunken: "#0d0d0c",
  line: "#2c2b28",
  "line-strong": "#45433f",
  control: "#6f6c66",
  fg: "#edece8",
  muted: "#aeaba4",
  subtle: "#93908a",
  accent: "#f97316",
  "on-accent": "#1a1917",
  "accent-text": "#fb923c",
  "accent-bg": "#2e1c10",
  act: "#ff8a80",
  "act-bg": "#3a1a17",
  watch: "#f5b94a",
  "watch-bg": "#33270f",
  info: "#9cc0e3",
  "info-bg": "#172636",
  ok: "#6fd391",
  "ok-bg": "#14291c",
  focus: "#7ab0ff",
  "shadow-1": "0 0 #0000", // not `none`: it sits in shadow lists (.upgrade, .plan.featured), where `none` voids the whole declaration
  "shadow-2": "0 4px 16px rgb(0 0 0 / .5)",
};

export const THEME_COLOR = { light: LIGHT.surface, dark: DARK.surface };

const vars = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");

/** The custom properties for one scheme, for a selector of your choice (the gallery uses this). */
export const schemeVars = (scheme: "light" | "dark") => `${vars(scheme === "light" ? LIGHT : DARK)};color-scheme:${scheme}`;

export const TOKENS = `
:root{
  --font-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --text-xs:.75rem;--lh-xs:1.4;--text-sm:.875rem;--lh-sm:1.45;--text-base:1rem;--lh-base:1.55;
  --text-md:1.125rem;--lh-md:1.5;--text-lg:1.375rem;--lh-lg:1.3;--text-xl:1.75rem;--lh-xl:1.2;
  --text-2xl:clamp(2rem,1.4rem + 3vw,3rem);--lh-2xl:1.08;
  --s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--s-6:32px;--s-7:48px;--s-8:64px;
  --r-1:4px;--r-2:6px;--r-3:10px;--r-pill:999px;
  --measure:40rem;--max-app:72rem;--max-public:64rem;--gutter:16px;
  --ease:cubic-bezier(.2,.7,.2,1);--dur-1:120ms;--dur-2:200ms;
  ${schemeVars("light")}
}
@media (min-width:40rem){:root{--gutter:24px}}
@media (prefers-color-scheme:dark){:root{${schemeVars("dark")}}}
`;
