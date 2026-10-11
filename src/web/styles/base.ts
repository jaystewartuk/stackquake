// Reset, typography, focus, motion and layout primitives. Element defaults live here so pages
// that still use plain markup (and the legacy helper classes at the end) look right.
export const BASE = `
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-sans);font-size:var(--text-base);line-height:var(--lh-base);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:var(--accent);color:var(--on-accent)}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
:focus:not(:focus-visible){outline:none}
img,svg{display:block;max-width:100%}
svg.icon{display:inline-block;vertical-align:-.15em;flex:none}
h1,h2,h3,h4{margin:0;text-wrap:balance;font-weight:600}
h1{font-size:var(--text-xl);line-height:var(--lh-xl);letter-spacing:-.015em;margin-bottom:var(--s-5)}
h2{font-size:var(--text-lg);line-height:var(--lh-lg);letter-spacing:-.01em;margin:var(--s-6) 0 var(--s-3)}
h3{font-size:var(--text-base);line-height:var(--lh-base);margin:var(--s-5) 0 var(--s-2)}
h2+*,h3+*{margin-top:0}
p,ul,ol,dl,blockquote,pre,table,fieldset,details{margin:0 0 var(--s-4)}
ul,ol{padding-left:1.25rem}
li+li{margin-top:var(--s-1)}
a{color:var(--accent-text);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.18em;text-decoration-color:color-mix(in srgb,currentColor 40%,transparent)}
a:hover{text-decoration-color:currentColor}
strong,b{font-weight:600}
small{font-size:var(--text-sm)}
hr{border:0;border-top:1px solid var(--line);margin:var(--s-6) 0}
code,kbd,samp,pre{font-family:var(--font-mono);font-size:.92em}
code{background:var(--sunken);padding:.05em .3em;border-radius:var(--r-1);overflow-wrap:anywhere}
pre{white-space:pre-wrap;word-break:break-word;background:var(--sunken);padding:var(--s-3);border-radius:var(--r-2);font-size:var(--text-xs);max-height:18rem;overflow:auto}
blockquote{padding:var(--s-3) var(--s-4);border-left:3px solid var(--line-strong);background:var(--sunken);border-radius:0 var(--r-2) var(--r-2) 0;white-space:pre-wrap;margin-left:0;margin-right:0}
table{border-collapse:collapse;width:100%;font-size:var(--text-sm)}
th,td{border-bottom:1px solid var(--line);padding:var(--s-2) var(--s-3);text-align:left;vertical-align:top}
th{font-weight:500;color:var(--muted);background:var(--sunken)}
details>summary{cursor:pointer;color:var(--muted)}
details>summary:hover{color:var(--fg)}
time,.mono,.num{font-family:var(--font-mono);font-size:.92em;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}

/* Layout primitives */
.wrap{max-width:var(--max-app);margin:0 auto;padding:0 var(--gutter)}
.wrap.narrow{max-width:var(--max-public)}
.stack>*{margin-top:0;margin-bottom:0}.stack>*+*{margin-top:var(--s-4)}
.stack-sm>*{margin-top:0;margin-bottom:0}.stack-sm>*+*{margin-top:var(--s-2)}
.cluster,.row{display:flex;flex-wrap:wrap;gap:var(--s-2) var(--s-3);align-items:center}
.spread{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--s-2) var(--s-4);align-items:baseline}
.grid{display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fill,minmax(min(15rem,100%),1fr))}
.cols{display:grid;gap:var(--s-4)}
@media (min-width:48rem){.cols{grid-template-columns:1fr 1fr}}
.prose{max-width:var(--measure)}
.prose h2{margin-top:var(--s-7)}
.prose table{display:block;overflow-x:auto}
.visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* Text helpers */
.muted{color:var(--muted)}
.meta{color:var(--subtle);font-size:var(--text-sm);line-height:var(--lh-sm)}
.lede{font-size:var(--text-md);line-height:var(--lh-md);color:var(--muted);max-width:var(--measure)}
.kicker{font-size:var(--text-xs);line-height:var(--lh-xs);text-transform:uppercase;letter-spacing:.06em;font-weight:500;color:var(--subtle)}
ul.plain{list-style:none;padding:0;margin:0 0 var(--s-4)}
ul.plain>li{padding:var(--s-3) 0;border-bottom:1px solid var(--line);margin:0}
ul.plain>li:last-child{border-bottom:0}
ul.plain a{text-decoration:none}ul.plain a:hover{text-decoration:underline}
.overflow-anywhere{overflow-wrap:anywhere}
`;
