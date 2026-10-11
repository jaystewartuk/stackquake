// Page-level layouts. Stages 3 and 4 replace these as they redesign each page.
export const PAGES = `
.hero{padding:var(--s-5) 0 var(--s-6)}
.hero h1{font-size:var(--text-2xl);line-height:var(--lh-2xl);letter-spacing:-.025em;font-weight:700;max-width:44rem;margin-bottom:var(--s-4)}
.hero .lede{margin-bottom:var(--s-5)}
.tags{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center}
.tags .pill{font-size:var(--text-sm);padding:var(--s-1) var(--s-3);text-decoration:none;color:var(--fg)}
.plans{grid-template-columns:repeat(auto-fit,minmax(min(16rem,100%),1fr));align-items:stretch}
.plans .featured{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.price{font-size:var(--text-xl);font-weight:600;font-variant-numeric:tabular-nums;margin:var(--s-1) 0 var(--s-3)}
.price .meta{font-size:var(--text-sm);font-weight:400}
.gallery-grid{display:grid;gap:var(--s-5)}
@media (min-width:64rem){.gallery-grid{grid-template-columns:1fr 1fr}}
.gallery-grid>section{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:var(--r-3);padding:var(--s-5);min-width:0}
.gallery-grid h2:first-child{margin-top:0}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(7rem,1fr));gap:var(--s-2);margin:0 0 var(--s-4)}
.swatches div{border:1px solid var(--line);border-radius:var(--r-2);overflow:hidden;font-size:var(--text-xs);font-family:var(--font-mono);background:var(--surface)}
.swatches span{display:block;height:2rem}
.swatches code{display:block;background:none;padding:var(--s-1) var(--s-2)}
`;
