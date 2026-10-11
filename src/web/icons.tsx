// Inline SVG icons (docs/design/DIRECTION.md "Iconography"): 1.5 px stroke, currentColor, hidden
// from assistive tech because the text beside each icon carries the meaning.
import type { FC } from "hono/jsx";

const PATHS = {
  // The logo mark: a trace in a rounded square.
  logo: <><rect x="1.75" y="1.75" width="16.5" height="16.5" rx="4" /><path d="M4.5 10.5h3l1.5-5 2.25 9 1.5-6 1 2h1.75" /></>,
  "arrow-right": <path d="M4 10h12m-5-5 5 5-5 5" />,
  "external-link": <path d="M11 4h5v5m0-5-7 7M14 12v3.25c0 .41-.34.75-.75.75h-8.5a.75.75 0 0 1-.75-.75v-8.5c0-.41.34-.75.75-.75H8" />,
  quote: <path d="M4 15c2.5-1 3.5-3 3.5-5.5V5H4v4.5h3.5M12.5 15c2.5-1 3.5-3 3.5-5.5V5h-3.5v4.5H16" />,
  calendar: <><rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><path d="M3 8.5h14M7 3v3m6-3v3" /></>,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></>,
  "alert-triangle": <><path d="M8.7 3.6 2.4 14.5c-.58 1 .14 2.25 1.3 2.25h12.6c1.16 0 1.88-1.25 1.3-2.25L11.3 3.6a1.5 1.5 0 0 0-2.6 0Z" /><path d="M10 8v3.5m0 2.5v.01" /></>,
  eye: <><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" /><circle cx="10" cy="10" r="2.25" /></>,
  check: <path d="m4 10.5 4 4 8-9" />,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v4.5m0-7v.01" /></>,
  "bell-off": <path d="M7.5 16.5a2.5 2.5 0 0 0 5 0M5.5 6.6A4.5 4.5 0 0 0 5.5 8v3L4 13.5h9.5M8 4a4.5 4.5 0 0 1 6.5 4v3l.8 1.3M3 3l14 14" />,
  search: <><circle cx="9" cy="9" r="5.5" /><path d="m13 13 4 4" /></>,
  plus: <path d="M10 4v12M4 10h12" />,
  trash: <path d="M4 6h12M8 6V4.5h4V6m-6.5 0 .7 9.6c.05.8.7 1.4 1.5 1.4h4.6c.8 0 1.45-.6 1.5-1.4L14.5 6M8.5 9v5m3-5v5" />,
  github: <path d="M10 2.5a7.5 7.5 0 0 0-2.37 14.62c.37.07.5-.16.5-.36v-1.3c-2.08.45-2.52-.9-2.52-.9-.34-.87-.83-1.1-.83-1.1-.68-.46.05-.45.05-.45.75.05 1.15.77 1.15.77.67 1.15 1.75.82 2.18.62.07-.48.26-.82.48-1-1.66-.2-3.4-.83-3.4-3.7 0-.82.29-1.49.77-2.01-.08-.19-.33-.95.07-1.98 0 0 .63-.2 2.06.77a7.1 7.1 0 0 1 3.75 0c1.43-.97 2.06-.77 2.06-.77.4 1.03.15 1.8.07 1.98.48.52.77 1.19.77 2.01 0 2.88-1.75 3.5-3.41 3.69.27.23.5.69.5 1.39v2.06c0 .2.14.44.51.36A7.5 7.5 0 0 0 10 2.5Z" />,
  slack: <path d="M8 3.5a1.5 1.5 0 1 0 0 3h1.5V5A1.5 1.5 0 0 0 8 3.5Zm-4 4.5a1.5 1.5 0 0 0 1.5 1.5h4V8A1.5 1.5 0 0 0 8 6.5H5.5A1.5 1.5 0 0 0 4 8Zm12.5 0A1.5 1.5 0 0 0 13.5 8v1.5H15A1.5 1.5 0 0 0 16.5 8ZM12 3.5A1.5 1.5 0 0 0 10.5 5v4h1.5A1.5 1.5 0 0 0 13.5 7.5V5A1.5 1.5 0 0 0 12 3.5Zm0 13a1.5 1.5 0 1 0 0-3h-1.5V15a1.5 1.5 0 0 0 1.5 1.5Zm4-4.5a1.5 1.5 0 0 0-1.5-1.5h-4V12a1.5 1.5 0 0 0 1.5 1.5h2.5A1.5 1.5 0 0 0 16 12Zm-12.5 0A1.5 1.5 0 0 0 6.5 12v-1.5H5A1.5 1.5 0 0 0 3.5 12ZM8 16.5A1.5 1.5 0 0 0 9.5 15v-4H8a1.5 1.5 0 0 0-1.5 1.5V15A1.5 1.5 0 0 0 8 16.5Z" />,
  mail: <><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path d="m3 5.5 7 5.5 7-5.5" /></>,
  "chevron-down": <path d="m5.5 8 4.5 4.5L14.5 8" />,
  x: <path d="m5 5 10 10M15 5 5 15" />,
  users: <><circle cx="7.5" cy="7" r="2.75" /><path d="M2.5 16c.4-2.6 2.4-4.25 5-4.25s4.6 1.65 5 4.25M13 4.4a2.75 2.75 0 0 1 0 5.2m2 2.6c1.4.6 2.3 1.9 2.5 3.8" /></>,
  download: <path d="M10 3v9.5m-4-4 4 4 4-4M3.5 13.5V16c0 .28.22.5.5.5h12a.5.5 0 0 0 .5-.5v-2.5" />,
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
  settings: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2m0 11v2M2.5 10h2m11 0h2M4.7 4.7l1.4 1.4m7.8 7.8 1.4 1.4M4.7 15.3l1.4-1.4m7.8-7.8 1.4-1.4" /></>,
  "log-out": <path d="M8 16.5H4.75a.75.75 0 0 1-.75-.75V4.25c0-.41.34-.75.75-.75H8M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" />,
  shield: <path d="M10 2.5 3.5 5v4.5c0 4 2.8 6.9 6.5 8 3.7-1.1 6.5-4 6.5-8V5L10 2.5Z" />,
  inbox: <path d="M2.5 11h4l1.5 2.5h4L13.5 11h4M4.5 4.5h11l2 6.5v4.5c0 .55-.45 1-1 1h-13a1 1 0 0 1-1-1V11l2-6.5Z" />,
} as const;

export type IconName = keyof typeof PATHS;
/** Brand marks are solid shapes, not strokes. */
const FILLED = new Set<IconName>(["github", "slack"]);
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export const Icon: FC<{ name: IconName; size?: 16 | 20 | 24; class?: string }> = ({ name, size = 16, class: cls }) => (
  <svg class={cls ? `icon ${cls}` : "icon"} width={size} height={size} viewBox="0 0 20 20" fill={FILLED.has(name) ? "currentColor" : "none"} stroke={FILLED.has(name) ? "none" : "currentColor"} stroke-width={1.5} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    {PATHS[name]}
  </svg>
);

/** The logo mark as a favicon data URI (no request, no 404). Orange stroke on a light tile. */
export const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" rx="4.5" fill="#1a1917"/><path d="M4.5 10.5h3l1.5-5 2.25 9 1.5-6 1 2h1.75" fill="none" stroke="#f97316" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );
