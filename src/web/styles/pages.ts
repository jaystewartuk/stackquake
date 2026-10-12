// Page-level layouts: public pages (stage 3), then the gallery. Stage 4 adds the app's.
export const PAGES = `
/* Shared: a main column with a rail beside it on wide screens */
.split{display:grid;gap:var(--s-6);align-items:start}
.rail{display:grid;gap:var(--s-4)}
.rail .panel{margin:0}
.rail .panel-head h2{font-size:var(--text-base)}
.rail .btn{white-space:normal;text-align:center;height:auto;padding-block:var(--s-2)}
@media (min-width:64rem){.split{grid-template-columns:minmax(0,1fr) minmax(0,20rem);gap:var(--s-7)}.rail{position:sticky;top:var(--s-5)}}

/* Landing */
.hero{display:grid;gap:var(--s-6);padding:var(--s-2) 0 var(--s-7);align-items:start}
.hero .kicker{color:var(--accent-text);margin:0 0 var(--s-3)}
.hero h1{font-size:var(--text-2xl);line-height:var(--lh-2xl);letter-spacing:-.025em;font-weight:700;margin-bottom:var(--s-4)}
.hero .lede{margin-bottom:var(--s-5)}
.hero-cta{display:flex;flex-wrap:wrap;gap:var(--s-3) var(--s-4);align-items:center;margin-bottom:var(--s-3)}
.hero-alt{font-weight:500;color:var(--muted)}
.hero-demo{display:grid;gap:var(--s-4);min-width:0}
.hero-demo .note-card{margin:0;max-width:none}
.hero-trace{display:grid;gap:var(--s-2)}
.hero-trace .meta{margin:0}
@media (min-width:64rem){.hero{grid-template-columns:minmax(0,1fr) minmax(0,28rem);gap:var(--s-7);padding-top:var(--s-6)}.hero-copy{padding-top:var(--s-6)}}
.band{padding:var(--s-7) 0 var(--s-2);border-top:1px solid var(--line)}
.band>h2,.band-head h2{font-size:var(--text-xl);line-height:var(--lh-xl);letter-spacing:-.015em;margin:0 0 var(--s-3)}
.band-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:var(--s-2) var(--s-4)}
.section-lede{color:var(--muted);max-width:var(--measure);margin-bottom:var(--s-5)}
.steps,.watch-grid{list-style:none;padding:0;margin:var(--s-5) 0 var(--s-5);display:grid;gap:var(--s-4)}
.steps li,.watch-grid li{margin:0;position:relative}
.steps svg,.watch-grid svg{color:var(--accent)}
.steps h3,.watch-grid h3{margin:var(--s-2) 0 var(--s-1)}
.steps p,.watch-grid p{margin:0;color:var(--muted);font-size:var(--text-sm)}
.steps li{padding:var(--s-4) 0 0;border-top:2px solid var(--fg)}
.step-n{position:absolute;right:0;top:var(--s-4);color:var(--subtle)}
@media (min-width:48rem){.steps{grid-template-columns:repeat(3,1fr);gap:var(--s-6)}.watch-grid{grid-template-columns:1fr 1fr;gap:var(--s-5) var(--s-6)}}
.proof-h{font-size:var(--text-md);margin:var(--s-6) 0 var(--s-3)}
.cat-proof{list-style:none;padding:0;margin:0 0 var(--s-4);columns:3 15rem;column-gap:var(--s-6)}
@media (max-width:40rem){.cat-proof{columns:2;column-gap:var(--s-4)}.band .event-list .event-row:nth-child(n+4){display:none}.watch-grid,.steps{gap:var(--s-3)}.band{padding-top:var(--s-6)}}
.cat-proof li{break-inside:avoid;margin:0;padding:var(--s-2) 0;border-bottom:1px solid var(--line);display:grid}
.cat-proof a{display:flex;justify-content:space-between;gap:var(--s-2);color:var(--fg);text-decoration:none;font-weight:500;font-size:var(--text-sm)}
.cat-proof a:hover .cat-name{text-decoration:underline}
.cat-proof a .num{color:var(--subtle)}
.cat-names{font-size:var(--text-xs);color:var(--subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.compare th[scope=col]:last-child,.compare td:last-child{background:var(--accent-bg)}
.compare th[scope=row]{width:28%}
.cmp-no{color:var(--subtle)}
.cmp-yes{display:inline-flex;gap:var(--s-1);align-items:baseline;font-weight:500}
.cmp-yes svg{color:var(--ok);flex:none;align-self:center}
.compare table{min-width:44rem}
.compare th[scope=row]{position:sticky;left:0;z-index:1;background:var(--surface)}
@media (max-width:40rem){.compare table{min-width:38rem;font-size:var(--text-xs)}.compare th[scope=row]{width:9rem;box-shadow:1px 0 0 var(--line)}.cat-names{display:none}.cat-proof li{padding:var(--s-1) 0}.cite-grid .quote blockquote{font-size:var(--text-xs)}}
.cite-grid{list-style:none;padding:0;display:grid;gap:var(--s-3);margin:0 0 var(--s-5)}
.cite-grid li{margin:0;display:grid;gap:var(--s-1);align-content:start}
.cite-grid .quote{margin:0;max-width:none}
.cite-tool{font-size:var(--text-xs);color:var(--subtle);padding-left:var(--s-2)}
@media (min-width:56rem){.cite-grid{grid-template-columns:repeat(3,1fr)}}
@media (max-width:55.99rem){.cite-grid{grid-auto-flow:column;grid-auto-columns:min(80%,20rem);overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:var(--s-2);scrollbar-width:thin}.cite-grid li{scroll-snap-align:start}}
.differs{list-style:none;padding:0;display:grid;gap:var(--s-4);margin:var(--s-5) 0}
.differs li{margin:0;padding-left:var(--s-4);border-left:2px solid var(--accent)}
.differs strong{display:block}
@media (min-width:48rem){.differs{grid-template-columns:1fr 1fr;gap:var(--s-5) var(--s-6)}}
.price-strip{display:grid;gap:var(--s-3);align-items:stretch}
.price-strip>div{border:1px solid var(--line);border-radius:var(--r-3);padding:var(--s-4) var(--s-5);background:var(--surface)}
.price-strip>div.featured{border-color:var(--accent)}
.price-strip p{margin:0}
.price-strip>div>p:last-child{color:var(--muted);font-size:var(--text-sm);margin-top:var(--s-2)}
.ps-plan{font-weight:600}
.ps-price{font-size:var(--text-lg);font-weight:600}
.ps-price .num,.ps-price.num{font-size:var(--text-lg)}
.ps-more{align-self:center}
@media (min-width:48rem){.price-strip{grid-template-columns:1fr 1fr auto;gap:var(--s-4)}}
.cta-band{margin-top:var(--s-7);padding:var(--s-6) var(--s-5);border-radius:var(--r-3);background:var(--sunken);border:1px solid var(--line);display:grid;gap:var(--s-3);justify-items:start}
.cta-band h2{margin:0;font-size:var(--text-xl);line-height:var(--lh-xl)}
.cta-band p{margin:0;color:var(--muted);max-width:var(--measure)}
@media (min-width:48rem){.cta-band{padding:var(--s-7)}}

/* Catalog */
.catalog-tools{display:grid;gap:var(--s-3);margin-bottom:var(--s-5)}
.catalog-tools form,.catalog-tools p{margin:0}
.cat-nav{display:flex;flex-wrap:wrap;gap:var(--s-2)}
.cat-nav a{display:inline-flex;gap:var(--s-2);align-items:center;padding:var(--s-1) var(--s-3);border:1px solid var(--line);border-radius:var(--r-pill);font-size:var(--text-sm);color:var(--muted);text-decoration:none;background:var(--surface)}
.cat-nav a:hover{color:var(--fg);border-color:var(--line-strong)}
.cat-nav .num{color:var(--subtle)}
.cat-group{scroll-margin-top:var(--s-4)}
.cat-group h2{display:flex;align-items:baseline;gap:var(--s-2)}
.count-label{font-size:var(--text-sm);color:var(--subtle);font-weight:400}
.entry-grid{list-style:none;padding:0;margin:0 0 var(--s-4);display:grid;gap:var(--s-3);grid-template-columns:repeat(auto-fill,minmax(min(15rem,100%),1fr))}
.entry-card{margin:0;display:grid;gap:var(--s-1);align-content:start;padding:var(--s-3) var(--s-4);border:1px solid var(--line);border-radius:var(--r-3);background:var(--surface);position:relative;transition:border-color var(--dur-1) var(--ease)}
.entry-card:hover{border-color:var(--line-strong)}
.entry-name{font-weight:600;color:var(--fg);text-decoration:none}
.entry-name::after{content:"";position:absolute;inset:0;border-radius:inherit}
.entry-name:focus-visible{outline:none}.entry-card:has(.entry-name:focus-visible){outline:2px solid var(--focus);outline-offset:2px}
.entry-watch{font-size:var(--text-xs);color:var(--subtle)}
.entry-latest{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center;font-size:var(--text-xs);color:var(--subtle);margin-top:var(--s-1)}
.entry-latest.none{font-style:normal}
@media (max-width:40rem){.entry-grid{grid-template-columns:1fr 1fr;gap:var(--s-2)}.entry-card{padding:var(--s-2) var(--s-3)}.entry-latest.none{display:none}.entry-name{font-size:var(--text-sm)}}
.source-list{list-style:none;padding:0;margin:0;display:grid;gap:var(--s-3);font-size:var(--text-sm)}
.source-list li{display:flex;gap:var(--s-2);margin:0;min-width:0}
.source-list svg{color:var(--subtle);margin-top:.2em}
.source-list a{overflow-wrap:anywhere;color:var(--fg)}
.source-kind{display:block;font-size:var(--text-xs);color:var(--subtle)}

/* Events */
.feed-trace{margin:0 0 var(--s-5)}
.month-h{font-size:var(--text-sm);font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--subtle);margin:var(--s-6) 0 0;padding-bottom:var(--s-2)}
.month:first-of-type .month-h{margin-top:0}

/* Event note */
.kicker-subject{font-size:var(--text-sm);font-weight:500;text-transform:none;letter-spacing:0}
.kicker-subject a{color:var(--muted)}
.page-header .kicker{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center}
.page-header .desc{font-size:var(--text-md);line-height:var(--lh-md)}
.note-split{margin-top:var(--s-5)}
.note{max-width:var(--measure);min-width:0}
.note h2{font-size:var(--text-md);margin:var(--s-6) 0 var(--s-2)}
.note .quote{margin-bottom:var(--s-5)}
.note .quote blockquote{font-size:var(--text-lg);line-height:1.45}
.note .uncertain{color:var(--muted)}
.note .disclaimer{display:flex;gap:var(--s-2);align-items:flex-start;margin-top:var(--s-6);padding-top:var(--s-4);border-top:1px solid var(--line);font-size:var(--text-sm);color:var(--subtle)}
.note .disclaimer svg{margin-top:.2em}
.rail input[type=url]{font-family:var(--font-mono);font-size:var(--text-xs);margin-bottom:var(--s-3)}
.rail .meta a{display:inline-flex;gap:var(--s-1);align-items:center}
@media (max-width:30rem){.note .quote blockquote{font-size:var(--text-md)}}

/* Pricing */
.plans{display:grid;gap:var(--s-4);margin:0 0 var(--s-3);max-width:52rem}
@media (min-width:44rem){.plans{grid-template-columns:1fr 1fr}}
.plans-fine{max-width:52rem}
.faq{margin-top:var(--s-7)}
.faq-grid{display:grid;gap:var(--s-2) var(--s-6)}
.faq-grid h3{margin-top:var(--s-4)}
.faq-grid p{color:var(--muted);margin:0}
@media (min-width:48rem){.faq-grid{grid-template-columns:1fr 1fr}}

/* Sign in */
.auth{max-width:26rem;margin:var(--s-5) auto var(--s-6);display:grid;gap:var(--s-2)}
.auth .auth-mark{color:var(--accent);margin-bottom:var(--s-2)}
.auth h1{margin:0}
.auth-desc{color:var(--muted);margin:0 0 var(--s-3)}
.auth-form{margin:0}
.auth-form .field{margin-bottom:var(--s-4)}
.auth-form .btn,.auth-form button{width:100%}
.auth-or{display:flex;align-items:center;gap:var(--s-3);color:var(--subtle);font-size:var(--text-sm);margin:var(--s-2) 0}
.auth-or::before,.auth-or::after{content:"";flex:1;border-top:1px solid var(--line)}
.auth-alt{width:100%}
.auth-fine{margin-top:var(--s-3)}

/* Legal and reference documents */
.doc{display:grid;gap:var(--s-4) var(--s-7);grid-template-areas:"head" "toc" "body"}
.doc-head{grid-area:head}.doc-head h1{margin-bottom:var(--s-1)}.doc-head p{margin:0}
.doc .toc{grid-area:toc;font-size:var(--text-sm);border:1px solid var(--line);border-radius:var(--r-3);padding:var(--s-3) var(--s-4);background:var(--surface)}
.toc .kicker{margin:0 0 var(--s-2)}
.toc ol{list-style:none;padding:0;margin:0;columns:2 11rem;column-gap:var(--s-5)}
.toc li{margin:0;padding:2px 0;break-inside:avoid}
.toc a{color:var(--muted);text-decoration:none}.toc a:hover{color:var(--fg);text-decoration:underline}
.doc-body{grid-area:body;min-width:0}
.doc-body h2{scroll-margin-top:var(--s-4)}
.doc-body>h2:first-child{margin-top:0}
.doc-body .table-wrap{margin:var(--s-3) 0 var(--s-4)}
.doc-body table{display:table}
@media (min-width:64rem){
  .doc.has-toc{grid-template-columns:14rem minmax(0,var(--measure));grid-template-areas:"head head" "toc body"}
  .doc .toc{position:sticky;top:var(--s-5);border:0;padding:0;background:none}
  .doc .toc ol{columns:1}
}

/* Component gallery (/__dev/ui) */
.gallery-grid{display:grid;gap:var(--s-5)}
@media (min-width:64rem){.gallery-grid{grid-template-columns:1fr 1fr}}
.gallery-grid>section{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:var(--r-3);padding:var(--s-5);min-width:0}
.gallery-grid h2:first-child{margin-top:0}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(7rem,1fr));gap:var(--s-2);margin:0 0 var(--s-4)}
.swatches div{border:1px solid var(--line);border-radius:var(--r-2);overflow:hidden;font-size:var(--text-xs);font-family:var(--font-mono);background:var(--surface)}
.swatches span{display:block;height:2rem}
.swatches code{display:block;background:none;padding:var(--s-1) var(--s-2)}

/* App (stage 4) */
.main-col{min-width:0}
.main-col>h2:first-child{margin-top:0}
.section-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:var(--s-1) var(--s-4);margin:0 0 var(--s-3)}
.section-head h2{margin:0}
.pulse{display:grid;gap:var(--s-3)}
.attention{margin:var(--s-6) 0}
.all-clear{display:flex;gap:var(--s-3);align-items:flex-start;padding:var(--s-4) var(--s-5);border:1px solid var(--line);border-radius:var(--r-3);background:var(--surface);margin:0 0 var(--s-3)}
.all-clear>svg{color:var(--ok);margin-top:.1em}
.all-clear p{margin:var(--s-1) 0 0;color:var(--muted);font-size:var(--text-sm)}
.panel.project{padding-bottom:var(--s-3)}
.panel.project .panel-head h2 a{color:var(--fg);text-decoration:none}.panel.project .panel-head h2 a:hover{text-decoration:underline}
.panel.project .panel-head .meta{display:inline-flex;gap:var(--s-1);align-items:center}
.project-pulse{display:grid;gap:var(--s-2);padding:0 0 var(--s-3);border-bottom:1px solid var(--line);margin:0 0 var(--s-1)}
.project-pulse .status-line .n{font-size:var(--text-base)}
@media (min-width:48rem){.project-pulse{grid-template-columns:auto minmax(0,1fr);align-items:center;gap:var(--s-6)}}
.stack-view>.risk-group:first-child>.risk-head{margin-top:var(--s-3)}
.main-col .stack-view h2.risk-head{font-size:var(--text-md)}
.main-col .stack-view{margin:0 0 var(--s-6)}

/* New project: two ways in */
.new-project>.field{max-width:24rem}
.new-project .defaults{margin:0 0 var(--s-5);max-width:48rem}
.new-project .defaults[open]>summary{margin-bottom:var(--s-3)}
.paths{display:grid;gap:var(--s-4);margin:0 0 var(--s-5)}
.path{display:flex;flex-direction:column;gap:var(--s-2);padding:var(--s-5);border:1px solid var(--line);border-radius:var(--r-3);background:var(--surface);box-shadow:var(--shadow-1)}
.path>svg{color:var(--accent)}
.path h2{font-size:var(--text-md);margin:0}
.path p{margin:0;color:var(--muted);font-size:var(--text-sm)}
.path label{margin-top:var(--s-2)}
.path>.btn,.path>button{align-self:flex-start;margin-top:auto}
.path .input-group{max-width:none}
@media (min-width:48rem){.paths{grid-template-columns:1fr 1fr}.path>button{margin-top:auto}}

/* Picker */
.picker-search{position:sticky;top:0;z-index:4;background:var(--bg);padding:var(--s-2) 0 var(--s-3);margin:0 0 var(--s-2)}
.picker-search>svg{position:absolute;left:var(--s-3);top:calc(var(--s-2) + .75rem);color:var(--subtle);pointer-events:none}
.picker-search input{padding-left:2.25rem;max-width:36rem}
.pick-group h2{font-size:var(--text-base);margin:var(--s-5) 0 var(--s-2)}
.pick-grid{display:grid;gap:var(--s-2);grid-template-columns:repeat(auto-fill,minmax(min(10rem,100%),1fr))}
.pick-grid .pick{padding:var(--s-2) var(--s-3);font-size:var(--text-sm);scroll-margin:5rem 0 6rem}
@media (min-width:48rem){.pick-grid{grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))}.pick-grid .pick{padding:var(--s-3);font-size:var(--text-base)}}
.picker>.field{margin-top:var(--s-6)}
.sticky-end{margin-left:auto}

/* Import progress */
.import-progress{max-width:40rem}
.ps-status{font-size:var(--text-sm);color:var(--muted);margin:0 0 var(--s-2)}
.import-log{margin:var(--s-4) 0 0}
.log{font-family:var(--font-mono);font-size:var(--text-xs);color:var(--subtle);padding-left:1.25rem;margin:var(--s-2) 0 0}

/* Dependency page */
.dep-status{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-2) var(--s-3);margin:calc(-1 * var(--s-4)) 0 var(--s-5);color:var(--muted)}
.source-list{list-style:none;padding:0;margin:0;display:grid;gap:var(--s-3);font-size:var(--text-sm)}
.source-list li{display:grid;gap:2px;margin:0}
.src-kind{font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.06em;font-weight:500;color:var(--subtle)}
.rail-danger{border-top:1px solid var(--line);padding-top:var(--s-3);margin-top:var(--s-3)}
.repo-line{display:flex;gap:var(--s-2);align-items:center;margin:0;overflow-wrap:anywhere;min-width:0}
.rail form>input:not([type=hidden]){margin-bottom:0}

/* Settings and team */
.settings{max-width:48rem}
.settings .panel{scroll-margin-top:var(--s-4)}
.settings-nav{display:none;font-size:var(--text-sm)}
.settings-nav ul{list-style:none;padding:0;margin:0}.settings-nav li{margin:0;padding:2px 0}
.settings-nav a{color:var(--muted);text-decoration:none}.settings-nav a:hover{color:var(--fg);text-decoration:underline}
@media (min-width:64rem){.settings-nav{display:block}}
.settings .panel{margin-bottom:var(--s-5)}
label.check{display:flex;gap:var(--s-2);align-items:center;font-size:var(--text-base);font-weight:500;margin:0}
.settings .hint,.panel .hint{font-size:var(--text-sm);color:var(--subtle);margin:var(--s-1) 0 var(--s-4)}
.settings .field select{max-width:16rem}
.upgrade-inline{margin-top:var(--s-4);padding-top:var(--s-4);border-top:1px solid var(--line)}
.upgrade-inline h3{margin:0 0 var(--s-2)}
.upgrade-inline .plan-features{margin:0 0 var(--s-4)}
.panel .input-group{margin-bottom:0}

/* Admin */
.review h2{font-size:var(--text-md);margin:0 0 var(--s-2)}
.review-meta{display:flex;flex-wrap:wrap;gap:var(--s-1) var(--s-3);align-items:center;font-size:var(--text-sm);color:var(--subtle);margin:0 0 var(--s-3)}
.review .quote{max-width:none;margin-bottom:var(--s-2)}
.review-note{max-width:var(--measure)}
.review-actions{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center;padding-top:var(--s-3);border-top:1px solid var(--line)}
.narrow-form{max-width:40rem}
.repo-choices{display:grid;gap:var(--s-2)}
.repo-choices .pick{font-size:var(--text-sm)}
`;
