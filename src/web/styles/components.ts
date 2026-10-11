// Component styles; each block pairs with a component in src/web/ui.tsx or the shell in layout.tsx.
export const COMPONENTS = `
/* Shell */
.skip{position:absolute;left:var(--s-3);top:-4rem;z-index:20;background:var(--surface);color:var(--fg);padding:var(--s-2) var(--s-3);border-radius:var(--r-2);box-shadow:var(--shadow-2);font-weight:500}
.skip:focus{top:var(--s-3)}
.site-header{background:var(--surface);border-bottom:1px solid var(--line);position:relative;z-index:10}
.site-header .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:0 var(--s-5);min-height:3.5rem}
.brand{display:inline-flex;align-items:center;gap:var(--s-2);font-weight:600;letter-spacing:-.01em;color:var(--fg);text-decoration:none;padding:var(--s-1) 0;margin-right:auto}
.brand svg{color:var(--accent)}
.nav-main{display:flex;gap:var(--s-1);font-size:var(--text-sm);font-weight:500}
.nav-main a{color:var(--muted);text-decoration:none;padding:var(--s-2);border-radius:var(--r-2);white-space:nowrap}
.nav-main a:hover{color:var(--fg);background:var(--sunken)}
.nav-main a[aria-current=page]{color:var(--fg);box-shadow:inset 0 -2px 0 var(--accent);border-radius:0}
.header-end{display:flex;align-items:center;gap:var(--s-2)}
@media (max-width:40rem){
  .site-header .wrap{gap:0 var(--s-3)}
  .nav-main{order:3;width:calc(100% + 2 * var(--gutter));margin:0 calc(-1 * var(--gutter));padding:0 calc(var(--gutter) - var(--s-2));overflow-x:auto;border-top:1px solid var(--line);scrollbar-width:none}
  .nav-main a{padding:var(--s-3) var(--s-2)}
}
.menu{position:relative;margin:0}
.menu>summary{list-style:none;display:flex;align-items:center;gap:var(--s-1);padding:var(--s-1);border-radius:var(--r-pill);color:var(--muted)}
.menu>summary::-webkit-details-marker{display:none}
.menu>summary:hover{color:var(--fg)}
.menu[open]>summary{color:var(--fg)}
.menu-panel{position:absolute;right:0;top:calc(100% + var(--s-2));min-width:14rem;max-width:calc(100vw - 2 * var(--gutter));background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-3);box-shadow:var(--shadow-2);padding:var(--s-2);z-index:30}
.menu-panel .menu-who{padding:var(--s-2) var(--s-3);font-size:var(--text-sm);color:var(--subtle);border-bottom:1px solid var(--line);margin-bottom:var(--s-1);overflow-wrap:anywhere}
.menu-panel a,.menu-panel button{display:flex;width:100%;align-items:center;gap:var(--s-2);padding:var(--s-2) var(--s-3);border-radius:var(--r-2);color:var(--fg);text-decoration:none;font:inherit;font-size:var(--text-sm);background:none;border:0;cursor:pointer;text-align:left}
.menu-panel button{justify-content:flex-start;min-height:0;box-shadow:none;font-weight:400}
.menu-panel a:hover,.menu-panel button:hover{background:var(--sunken)}
.menu-panel form{margin:0;border-top:1px solid var(--line);margin-top:var(--s-1);padding-top:var(--s-1)}
.avatar{display:inline-grid;place-items:center;width:2rem;height:2rem;border-radius:var(--r-pill);background:var(--sunken);border:1px solid var(--line-strong);color:var(--fg);font-size:var(--text-xs);font-weight:600;text-transform:uppercase}
main{padding:var(--s-6) 0 var(--s-8);overflow-wrap:break-word}
main:focus{outline:none}
.site-footer{border-top:1px solid var(--line);padding:var(--s-6) 0;color:var(--subtle);font-size:var(--text-sm)}
.site-footer .wrap{display:grid;gap:var(--s-3)}
.site-footer nav{display:flex;flex-wrap:wrap;gap:var(--s-1) var(--s-4)}
.site-footer a{color:var(--muted);text-decoration:none}.site-footer a:hover{color:var(--fg);text-decoration:underline}
.site-footer .brand{margin:0;font-size:var(--text-sm)}

/* Page header */
.page-header{display:grid;gap:var(--s-2);margin-bottom:var(--s-6)}
.page-header .crumbs{font-size:var(--text-sm);color:var(--subtle);display:flex;flex-wrap:wrap;gap:var(--s-1)}
.page-header .crumbs a{color:var(--muted);text-decoration:none}.page-header .crumbs a:hover{text-decoration:underline}
.page-header .crumbs li{list-style:none;margin:0}
.page-header .crumbs ol{display:flex;flex-wrap:wrap;gap:var(--s-1);padding:0;margin:0}
.page-header .crumbs li+li::before{content:"/";margin-right:var(--s-1);color:var(--line-strong)}
.page-header .title-row{display:flex;flex-wrap:wrap;gap:var(--s-3) var(--s-4);align-items:flex-start;justify-content:space-between}
.page-header .title-row h1{flex:1 1 20rem;margin:0}
.page-header .actions{display:flex;flex-wrap:wrap;gap:var(--s-2)}
.page-header .kicker .badge{text-transform:none;letter-spacing:0}
.page-header .desc{color:var(--muted);max-width:var(--measure);margin:0}
@media (max-width:40rem){.page-header .actions{width:100%}}

/* Buttons. A bare <button> is a secondary button; legacy .primary/.danger/.link still apply. */
button,.btn{--h:2.25rem;display:inline-flex;align-items:center;justify-content:center;gap:var(--s-2);min-height:var(--h);padding:0 var(--s-4);font:inherit;font-size:var(--text-sm);font-weight:500;line-height:1.2;border-radius:var(--r-2);border:1px solid var(--line-strong);background:var(--surface);color:var(--fg);text-decoration:none;cursor:pointer;white-space:nowrap;box-shadow:var(--shadow-1);transition:background-color var(--dur-1) var(--ease),border-color var(--dur-1) var(--ease),color var(--dur-1) var(--ease)}
button:hover,.btn:hover{border-color:var(--control);background:var(--sunken);text-decoration:none}
button:active,.btn:active{transform:translateY(.5px)}
.btn-primary,button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.btn-primary:hover,button.primary:hover,.btn.primary:hover{background:color-mix(in srgb,var(--accent) 88%,var(--fg));border-color:color-mix(in srgb,var(--accent) 88%,var(--fg))}
.btn-quiet,button.quiet{background:transparent;border-color:transparent;box-shadow:none;color:var(--muted)}
.btn-quiet:hover,button.quiet:hover{background:var(--sunken);border-color:transparent;color:var(--fg)}
.btn-danger,button.danger{color:var(--act);border-color:color-mix(in srgb,var(--act) 55%,var(--line-strong))}
.btn-danger:hover,button.danger:hover{background:var(--act-bg);border-color:var(--act)}
.btn-danger.solid{background:var(--act);border-color:var(--act);color:var(--surface)}
.btn-sm{--h:1.875rem;padding:0 var(--s-3);font-size:var(--text-xs)}
.btn-lg,.btn.big{--h:2.75rem;padding:0 var(--s-5);font-size:var(--text-base)}
.btn[aria-disabled=true],button:disabled{opacity:.5;cursor:not-allowed;pointer-events:none;box-shadow:none}
button[aria-pressed=true]{background:var(--fg);border-color:var(--fg);color:var(--bg)}
button.link{all:unset;color:var(--accent-text);text-decoration:underline;text-underline-offset:.18em;cursor:pointer;font:inherit}
button.link:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
button,.btn{max-width:100%}
@media (max-width:30rem){.btn-lg,.btn.big{white-space:normal;text-align:center;padding-block:var(--s-2)}}
@media (max-width:40rem){.btn-block-sm{width:100%}}
form.inline{display:inline}

/* Fields */
label{display:block;font-weight:500;font-size:var(--text-sm);margin:0 0 var(--s-1)}
input[type=text],input[type=email],input[type=url],input[type=search],input[type=number],input[type=password],select,textarea{font:inherit;font-size:var(--text-base);width:100%;min-height:2.5rem;padding:var(--s-2) var(--s-3);border:1px solid var(--control);border-radius:var(--r-2);background:var(--surface);color:var(--fg);transition:border-color var(--dur-1) var(--ease)}
input::placeholder,textarea::placeholder{color:var(--subtle);opacity:1}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--focus);outline-offset:0;border-color:var(--focus)}
[aria-invalid=true]{border-color:var(--act)!important}
form>input:not([type=hidden],[type=checkbox],[type=radio]),form>select,form>textarea{margin-bottom:var(--s-3)}
input[type=checkbox],input[type=radio]{accent-color:var(--accent);width:1rem;height:1rem;margin:0}
.field{margin:0 0 var(--s-5);max-width:32rem}
.field.wide{max-width:none}
.field .hint{font-size:var(--text-sm);color:var(--subtle);margin:var(--s-1) 0 0}
.field .error-text{display:flex;gap:var(--s-1);align-items:center;font-size:var(--text-sm);color:var(--act);font-weight:500;margin:var(--s-1) 0 0}
.input-group{display:flex;gap:var(--s-2);max-width:36rem}
.input-group>input{flex:1;min-width:0}
.row>.input-group{flex:1 1 20rem}
@media (max-width:30rem){.input-group{flex-direction:column}}
fieldset{border:0;padding:0;min-width:0;margin:0 0 var(--s-5)}
legend{font-weight:500;font-size:var(--text-sm);padding:0;margin-bottom:var(--s-2)}
fieldset label{display:inline-flex;gap:var(--s-2);align-items:center;font-weight:400;font-size:var(--text-base);margin:0 var(--s-4) var(--s-1) 0}

/* Choice: radio or checkbox chips (segmented on wide screens) */
.choice{display:flex;flex-wrap:wrap;gap:var(--s-2)}
.choice label{position:relative;display:inline-flex;align-items:center;gap:var(--s-2);margin:0;min-height:2.25rem;padding:0 var(--s-3);border:1px solid var(--line-strong);border-radius:var(--r-2);background:var(--surface);font-size:var(--text-sm);font-weight:400;cursor:pointer;transition:border-color var(--dur-1) var(--ease)}
.choice label:hover{border-color:var(--control)}
.choice input{position:absolute;opacity:0;width:1px;height:1px}
.choice label:has(:checked){border-color:var(--fg);background:var(--fg);color:var(--bg);font-weight:500}
.choice label:has(:focus-visible){outline:2px solid var(--focus);outline-offset:2px}

/* Pick tile (the service picker) */
.pick{display:flex;gap:var(--s-3);align-items:flex-start;padding:var(--s-3);border:1px solid var(--line);border-radius:var(--r-2);background:var(--surface);font-weight:400;font-size:var(--text-base);margin:0;cursor:pointer;transition:border-color var(--dur-1) var(--ease)}
.pick:hover{border-color:var(--line-strong)}
.pick input{margin-top:.2rem;flex:none}
.pick .pick-name{font-weight:500}
.pick .pick-sub{display:block;font-size:var(--text-xs);color:var(--subtle)}
.pick:has(:checked){border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:color-mix(in srgb,var(--accent) 4%,var(--surface))}
.pick:has(:focus-visible){outline:2px solid var(--focus);outline-offset:2px}
.pick:has(:disabled){opacity:.55;cursor:not-allowed}

/* Panels and cards */
.card,.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-3);padding:var(--s-4) var(--s-5);margin:0 0 var(--s-4);box-shadow:var(--shadow-1)}
.panel>:last-child,.card>:last-child{margin-bottom:0}
.panel-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:var(--s-2) var(--s-4);margin-bottom:var(--s-3)}
.panel-head h2,.panel-head h3{margin:0;font-size:var(--text-md)}
.panel.danger{border-color:color-mix(in srgb,var(--act) 45%,var(--line))}
.panel.danger .panel-head h2{color:var(--act)}
.panel.flush{padding:0}
@media (max-width:40rem){.card,.panel{padding:var(--s-4)}}
a.card{display:block;color:inherit;text-decoration:none;transition:border-color var(--dur-1) var(--ease)}
a.card:hover{border-color:var(--line-strong)}

/* Badges, severity, legacy pills */
.badge,.pill{display:inline-flex;align-items:center;gap:var(--s-1);font-size:var(--text-xs);line-height:1.5;font-weight:500;padding:0 var(--s-2);border-radius:var(--r-1);border:1px solid var(--line-strong);color:var(--muted);background:var(--surface);white-space:nowrap;vertical-align:.1em}
.badge.act,.pill.bad{color:var(--act);background:var(--act-bg);border-color:transparent}
.badge.watch,.pill.warn{color:var(--watch);background:var(--watch-bg);border-color:transparent}
.badge.info{color:var(--info);background:var(--info-bg);border-color:transparent}
.badge.ok,.pill.ok{color:var(--ok);background:var(--ok-bg);border-color:transparent}
.badge.count{font-family:var(--font-mono);border-radius:var(--r-pill);font-variant-numeric:tabular-nums}
.sev{display:inline-flex;align-items:center;gap:var(--s-2);font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.sev::before{content:"";flex:none;width:.25rem;height:.875rem;border-radius:1px}
.sev.act{color:var(--act)}.sev.act::before{background:var(--act)}
.sev.watch{color:var(--watch)}.sev.watch::before{box-shadow:inset 0 0 0 1.5px var(--watch)}
.sev.quiet{color:var(--subtle)}.sev.quiet::before{width:.375rem;height:.375rem;border-radius:50%;background:var(--subtle)}

/* Callouts (flash messages and notices) */
.callout,.flash{display:flex;gap:var(--s-3);align-items:flex-start;padding:var(--s-3) var(--s-4);border-radius:var(--r-2);background:var(--info-bg);color:var(--fg);border:1px solid color-mix(in srgb,var(--info) 25%,transparent);margin:0 0 var(--s-4);max-width:48rem}
.callout>svg{color:var(--info);margin-top:.2em}
.callout>div>:last-child{margin-bottom:0}
.callout.ok{background:var(--ok-bg);border-color:color-mix(in srgb,var(--ok) 25%,transparent)}.callout.ok>svg{color:var(--ok)}
.callout.warn{background:var(--watch-bg);border-color:color-mix(in srgb,var(--watch) 25%,transparent)}.callout.warn>svg{color:var(--watch)}
.callout.error,.flash.error{background:var(--act-bg);border-color:color-mix(in srgb,var(--act) 30%,transparent)}.callout.error>svg{color:var(--act)}
.flash{display:block}

/* Tables: scroll on small screens, or stack into cards with .table-stack */
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r-3);background:var(--surface);margin:0 0 var(--s-4)}
.table-wrap table{margin:0}
.table-wrap tr:last-child td{border-bottom:0}
.table-wrap td{overflow-wrap:anywhere}
td.num,th.num{white-space:nowrap;text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums}
@media (max-width:40rem){
  .table-stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .table-stack tr{display:block;padding:var(--s-2) 0;border-bottom:1px solid var(--line)}
  .table-stack tr:last-child{border-bottom:0}
  .table-stack td{display:grid;grid-template-columns:6.5rem 1fr;gap:var(--s-2);border:0;padding:var(--s-1) var(--s-3);overflow-wrap:anywhere}
  .table-stack td::before{content:attr(data-label);color:var(--subtle);font-size:var(--text-xs);font-weight:500;padding-top:.15em}
  .table-stack td.num{text-align:left}
}

/* Tabs and segmented control (links) */
.tabs{display:flex;gap:var(--s-1);border-bottom:1px solid var(--line);margin:0 0 var(--s-5);overflow-x:auto;scrollbar-width:thin}
.tabs a{padding:var(--s-2) var(--s-3);color:var(--muted);text-decoration:none;font-size:var(--text-sm);font-weight:500;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs a:hover{color:var(--fg)}
.tabs a[aria-current]{color:var(--fg);border-bottom-color:var(--accent)}
.segmented{display:inline-flex;padding:2px;background:var(--sunken);border:1px solid var(--line);border-radius:var(--r-2);margin:0 0 var(--s-4);max-width:100%;overflow-x:auto}
.segmented a{padding:var(--s-1) var(--s-3);border-radius:calc(var(--r-2) - 2px);color:var(--muted);text-decoration:none;font-size:var(--text-sm);font-weight:500;white-space:nowrap}
.segmented a[aria-current]{background:var(--surface);color:var(--fg);box-shadow:var(--shadow-1)}

/* Empty state */
.empty{display:grid;justify-items:start;gap:var(--s-2);padding:var(--s-6) var(--s-5);border:1px dashed var(--line-strong);border-radius:var(--r-3);margin:0 0 var(--s-4)}
.empty>svg{color:var(--subtle)}
.empty h2,.empty h3{margin:0;font-size:var(--text-md)}
.empty p{margin:0;color:var(--muted);max-width:var(--measure)}
.empty .actions{display:flex;flex-wrap:wrap;gap:var(--s-2);margin-top:var(--s-2)}
.empty.page{border:0;padding:var(--s-7) 0}
.empty.page h1{font-size:var(--text-xl);margin:0}

/* Source quote */
.quote{margin:0 0 var(--s-5);background:var(--sunken);border-radius:var(--r-3);padding:var(--s-5) var(--s-5) var(--s-4) var(--s-7);position:relative;max-width:var(--measure)}
.quote>svg{position:absolute;left:var(--s-4);top:var(--s-5);color:var(--accent)}
.quote blockquote{margin:0 0 var(--s-3);padding:0;border:0;background:none;border-radius:0;font-size:var(--text-md);line-height:var(--lh-md);white-space:pre-wrap;overflow-wrap:anywhere}
.quote figcaption{font-size:var(--text-sm);color:var(--subtle);overflow-wrap:anywhere}
.quote figcaption a{color:var(--muted)}
.quote.sm{padding:var(--s-3) var(--s-4) var(--s-3) var(--s-6)}.quote.sm>svg{left:var(--s-3);top:var(--s-3)}.quote.sm blockquote{font-size:var(--text-sm)}

/* Definition list for metadata */
.dl{display:grid;grid-template-columns:max-content 1fr;gap:var(--s-2) var(--s-5);margin:0 0 var(--s-4);font-size:var(--text-sm)}
.dl dt{color:var(--subtle)}
.dl dd{margin:0;overflow-wrap:anywhere}
.dl.strip{display:flex;flex-wrap:wrap;gap:var(--s-3) var(--s-6)}
.dl.strip>div{display:grid;gap:2px}
.dl.strip dt{font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.06em;font-weight:500}
.dl.strip dd{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.dl .hl{color:var(--accent-text);font-weight:600}
@media (max-width:30rem){.dl:not(.strip){grid-template-columns:1fr;gap:0}.dl:not(.strip) dd{margin-bottom:var(--s-2)}}

/* Event note card (the compact note, as sent by email and shown on the landing page) */
.note-card{background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-3);box-shadow:var(--shadow-1);overflow:hidden;max-width:var(--measure);margin:0 0 var(--s-4)}
.note-card .note-bar{display:flex;flex-wrap:wrap;gap:var(--s-1) var(--s-3);justify-content:space-between;align-items:center;padding:var(--s-2) var(--s-4);border-bottom:1px solid var(--line);background:var(--sunken);font-size:var(--text-xs);color:var(--subtle)}
.note-card .note-body{padding:var(--s-4) var(--s-5) var(--s-5)}
.note-card .note-body>:last-child{margin-bottom:0}
.note-card .note-title{font-size:var(--text-md);line-height:var(--lh-md);font-weight:600;margin:var(--s-2) 0}
.note-card .note-h{font-size:var(--text-sm);font-weight:600;margin:var(--s-4) 0 var(--s-1)}
.note-card .kick{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center;font-size:var(--text-sm);color:var(--muted)}
.note-card .note-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--s-2);align-items:center;margin-top:var(--s-4);padding-top:var(--s-3);border-top:1px solid var(--line);font-size:var(--text-sm)}

/* Status line and trace */
.status-line{display:flex;flex-wrap:wrap;gap:var(--s-2) var(--s-5);align-items:center;font-size:var(--text-sm);margin:0}
.status-line>span{display:inline-flex;align-items:center;gap:var(--s-1)}
.status-line .sev{gap:0;margin-right:2px}
.status-line .n{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--text-md);font-weight:600;color:var(--fg)}
.trace{display:block;width:100%;color:var(--line-strong);overflow:visible}
.trace .base{stroke:currentColor}
.trace .spike{stroke-linecap:round}
.trace .act{stroke:var(--act)}.trace .watch{stroke:var(--watch)}.trace .quiet{stroke:var(--control)}.trace .kind{stroke:var(--accent)}
.trace a:focus-visible{outline:none}.trace a:focus-visible path{stroke-width:4;stroke:var(--focus)}
.trace-wrap{display:grid;gap:var(--s-1)}
.trace-wrap .axis{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--subtle)}

/* Risk group heading (same look at h2 and h3) */
.risk-head{font-size:var(--text-base);line-height:var(--lh-base);margin:var(--s-5) 0 var(--s-1);display:flex;align-items:center;gap:var(--s-2)}

/* Sticky action bar for long forms */
.sticky{position:sticky;bottom:0;z-index:5;display:flex;flex-wrap:wrap;gap:var(--s-3);align-items:center;background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:blur(6px);padding:var(--s-3) var(--gutter);margin:var(--s-5) calc(-1 * var(--gutter)) 0;border-top:1px solid var(--line);box-shadow:var(--shadow-2)}

/* Data table: a row header column */
.table-wrap th[scope=row]{background:none;color:var(--fg);font-weight:500}
@media (max-width:40rem){.table-stack th[scope=row]{display:block;padding:var(--s-2) var(--s-3) var(--s-1);border:0;font-weight:600}}

/* Event rows: the date in a margin column, then subject and title, kind, summary */
.event-list{list-style:none;padding:0;margin:0 0 var(--s-4);border-top:1px solid var(--line)}
.event-row{display:grid;grid-template-columns:1fr;gap:var(--s-1) var(--s-5);padding:var(--s-4) 0;border-bottom:1px solid var(--line);margin:0}
.event-row .er-date{color:var(--subtle);font-size:var(--text-sm);padding-top:.1em}
.event-row .er-body{display:grid;gap:var(--s-2);min-width:0}
.event-row .er-title{color:var(--fg);text-decoration:none;font-size:var(--text-base);line-height:var(--lh-base)}
.event-row .er-title strong{color:var(--accent-text)}
.event-row .er-title:hover{text-decoration:underline}
.event-row .er-meta{display:flex;flex-wrap:wrap;gap:var(--s-2) var(--s-3);align-items:center;font-size:var(--text-sm);color:var(--subtle)}
.event-row .er-summary{margin:0;color:var(--muted);font-size:var(--text-sm);max-width:var(--measure)}
@media (min-width:40rem){.event-row{grid-template-columns:7.5rem 1fr}}

/* Ways out: option cards with an effort meter */
.options{list-style:none;padding:0;display:grid;gap:var(--s-3);max-width:var(--measure)}
.option{margin:0;padding:var(--s-3) var(--s-4);border:1px solid var(--line);border-radius:var(--r-3);background:var(--surface)}
.option-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--s-1) var(--s-3);align-items:center}
.option p{margin:var(--s-1) 0 0;color:var(--muted);font-size:var(--text-sm)}
.effort{display:inline-flex;align-items:center;gap:var(--s-2);font-size:var(--text-xs);color:var(--subtle);white-space:nowrap}
.effort .bars{display:inline-flex;gap:2px;align-items:flex-end}
.effort .bars span{width:4px;border-radius:1px;background:var(--line-strong)}
.effort .bars span:nth-child(1){height:6px}.effort .bars span:nth-child(2){height:9px}.effort .bars span:nth-child(3){height:12px}
.effort .bars span.on{background:var(--fg)}

/* Plan cards */
.plan{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-3);padding:var(--s-5);box-shadow:var(--shadow-1)}
.plan.featured{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent),var(--shadow-1)}
.plan-head{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center;justify-content:space-between;margin-bottom:var(--s-3)}
.plan-head h2{margin:0;font-size:var(--text-md)}
.plan-price{display:flex;align-items:baseline;gap:var(--s-2);margin:0}
.plan-price .amount{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:2.25rem;line-height:1.1;font-weight:600;letter-spacing:-.02em}
.plan-price .period{color:var(--muted);font-size:var(--text-sm)}
.plan-note{color:var(--subtle);font-size:var(--text-sm);margin:var(--s-1) 0 0}
.plan-features{list-style:none;padding:0;margin:var(--s-5) 0;display:grid;gap:var(--s-2);flex:1;align-content:start}
.plan-features li{display:flex;gap:var(--s-2);align-items:flex-start;margin:0}
.plan-features svg{color:var(--ok);margin-top:.25em}
.plan-action{margin-top:auto}
.plan-action .btn{width:100%}
.plan-buttons{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-2);margin:0}
@media (max-width:22rem){.plan-buttons{grid-template-columns:1fr}}

/* Error pages */
.error-page{padding:var(--s-7) 0 var(--s-6);max-width:var(--measure)}
.error-code{display:inline-flex;gap:var(--s-2);align-items:center;font-size:var(--text-sm);color:var(--subtle);margin:0 0 var(--s-3)}
.error-code svg{color:var(--accent)}
.error-page h1{font-size:var(--text-xl);margin-bottom:var(--s-3)}
.error-body{color:var(--muted)}
.error-page .actions{display:flex;flex-wrap:wrap;gap:var(--s-2);margin-top:var(--s-5)}

/* Chips: links to catalog entries */
.chips{display:flex;flex-wrap:wrap;gap:var(--s-2);margin:0}
.chip{display:inline-flex;align-items:center;min-height:2rem;padding:0 var(--s-3);border:1px solid var(--line-strong);border-radius:var(--r-2);font-size:var(--text-sm);color:var(--fg);text-decoration:none;background:var(--surface)}
a.chip:hover{border-color:var(--control);background:var(--sunken)}
`;
