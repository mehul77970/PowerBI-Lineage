/**
 * Power BI Lineage — client-side dashboard runtime.
 *
 * Moved out of the embedded <script> block in src/html-generator.ts
 * during the Stop-5 client split. Still a single file for now; the
 * follow-up PRs will carve this into panels/ components/ render/
 * state/ modules without another mechanical-extraction turn.
 *
 * Globals (DATA, MARKDOWN*, REPORT_NAME, APP_VERSION, GENERATED_AT,
 * DaxHighlight) are declared ambiently in ./globals.d.ts — the server
 * injects them into the same <script> block just before this file's
 * compiled output is inlined.
 *
 * This file is written intentionally as a *script* (no imports, no
 * exports), so TypeScript emits it as a plain browser-ready .js that
 * runs top-to-bottom. The bootstrap call at the very bottom kicks
 * everything off once the DOM is ready.
 */

// @ts-nocheck -- Client is untyped JS by origin; the Stop-5 follow-up
// will tighten this panel by panel. Leaving errors off for the initial
// carve keeps the diff review-able.

let activeMd="model";
let mdViewMode="rendered";

// escHtml, escAttr, sc, uc live in src/client/render/escape.ts now
// (Stop 5 pass 2). They're compiled as a separate script file and
// concatenated into the same inline <script> before this one, so
// the top-level function declarations are already in scope.

function toggleTheme(){
  var cur=document.documentElement.getAttribute('data-theme')||'dark';
  var next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  try{localStorage.setItem('usage-theme',next);}catch(e){}
  var btn=document.getElementById('theme-btn');
  if(btn)btn.textContent=next==='dark'?'☾':'☀';
}

// Colourise every .lineage-dax block that hasn't been highlighted
// yet. Safe to call repeatedly — DaxHighlight.highlightElement is
// idempotent via a __daxHighlighted flag, and we filter on the
// .code-dax class the highlighter adds on first pass.
//
// MUST run BEFORE addCopyButtons — the highlighter replaces innerHTML,
// which would wipe any already-appended copy button. Current order:
//   1. renderX() sets innerHTML with raw DAX
//   2. highlightDaxBlocks() replaces innerHTML with coloured spans
//   3. addCopyButtons() appends the ⎘ button to the highlighted block
function highlightDaxBlocks(){
  if (typeof DaxHighlight === 'undefined') return;       // vendor script not loaded
  DaxHighlight.highlightAll(document, '.lineage-dax:not(.code-dax)');
  // Markdown-rendered code blocks also get highlighted (the Docs tab
  // renders ```dax fences into <pre><code class="language-dax">).
  DaxHighlight.highlightAll(document, 'pre code.language-dax:not(.code-dax)');
}

function addCopyButtons(){
  highlightDaxBlocks();
  document.querySelectorAll('.lineage-dax:not([data-copy-wired])').forEach(function(el){
    el.setAttribute('data-copy-wired','1');
    var dax=el.textContent;
    el.setAttribute('data-dax',dax);
    var btn=document.createElement('button');
    btn.className='copy-btn';
    btn.textContent='⎘';
    btn.title='Copy DAX';
    btn.onclick=function(e){
      e.stopPropagation();
      var text=el.getAttribute('data-dax')||'';
      function ok(){btn.textContent='✓';btn.classList.add('copied');setTimeout(function(){btn.textContent='⎘';btn.classList.remove('copied');},1500);}
      function fallback(){
        var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
        var success=false;try{success=document.execCommand('copy');}catch(err){}
        document.body.removeChild(ta);
        if(success)ok();else{btn.textContent='✗';setTimeout(function(){btn.textContent='⎘';},1500);}
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(ok).catch(fallback);
      }else{fallback();}
    };
    el.appendChild(btn);
  });
}
(function(){var t=document.documentElement.getAttribute('data-theme')||'dark';var btn=document.getElementById('theme-btn');if(btn)btn.textContent=t==='dark'?'☾':'☀';})();

let activeTab="measures",lastTab="measures";
let sortState={measures:{key:"usageCount",desc:true},columns:{key:"usageCount",desc:true}};
let showUnusedOnly={measures:false,columns:false};
let searchTerms={measures:"",columns:""};
let openPages=new Set();
let openTables=new Set();

// Page data is built server-side now (data-builder.ts) so we get the
// full page list — including text-only / empty pages that have no
// data-field bindings. Previously this was recomputed in the client
// from measure/column usedIn lists, which silently dropped any page
// whose visuals didn't touch the model (producing -ve "visible" counts
// when hiddenPages > bound pages).
const pageData=(DATA.pages||[]).slice();

// ─────────────────────────────────────────────────────────────────────
// Event delegation — one document-level click listener dispatches to
// action handlers based on [data-action] markers.
//
// WHY: every inline click handler used to splice a field name
// directly into a JS string literal. A measure named
//   foo'),alert(1),('bar
// would break out and execute. We now put the name in [data-name]
// (HTML-attribute encoded, safe) and read it via element.dataset.name
// — the browser decodes it back to a plain string with no parsing of
// user content as JS.
//
// Adding a new action:
//   1. Add a case below with the handler call.
//   2. Render the target element with a data-action attribute set to
//      the verb plus any data-* attributes the case reads.
//   3. Use escAttr(userValue) when the value comes from the model.
//
// .closest() walks from e.target upwards and returns the innermost
// [data-action] element, so a chip inside a page-header fires the
// chip's action without bubbling to the parent's toggle — no need
// for event.stopPropagation() at each site.
// ─────────────────────────────────────────────────────────────────────
// In-document anchor clicks inside the Docs tab (.md-rendered)
// — intercept so they scroll to the heading within the Docs
// container instead of appending #anchor to the URL (which makes the
// browser feel like it navigated externally). A delegated handler
// upstream of the data-action dispatch below so it catches the click
// regardless of what else is wired up.
document.addEventListener('click', function(e){
  var target = e.target as HTMLElement | null;
  if (!target) return;
  var link = target.closest && target.closest('a[href^="#"]') as HTMLAnchorElement | null;
  if (!link) return;
  // Only handle links inside the rendered Docs pane — elsewhere
  // (e.g. the landing page's recent-report buttons) the default
  // browser behaviour is correct.
  if (!link.closest('.md-rendered')) return;
  var href = link.getAttribute('href') || '';
  if (href === '#' || href.length < 2) {
    // Placeholder links — do nothing instead of scrolling to top.
    e.preventDefault();
    return;
  }
  var id = href.slice(1);
  // Only match within the Docs pane so an anchor doesn't accidentally
  // jump to a like-named element elsewhere on the page.
  var pane = link.closest('.md-rendered') as HTMLElement | null;
  if (!pane) return;
  // Prefer an id= match; fall back to name= for legacy anchors.
  var dst = pane.querySelector('#' + CSS.escape(id)) as HTMLElement | null
         || pane.querySelector('[name="' + id + '"]') as HTMLElement | null;
  if (!dst) return;   // unknown anchor — let browser default fire
  e.preventDefault();
  dst.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.addEventListener('click', function(e){
  var el = e.target.closest && e.target.closest('[data-action]');
  if (!el) return;
  var a = el.getAttribute('data-action');
  var d = el.dataset;
  switch(a){
    case 'lineage':         navigateLineage(d.type, d.name); break;
    case 'tab':             switchTab(d.tab); break;
    case 'md-tab':          switchMd(d.md); break;
    case 'md-mode':         switchMdMode(d.mode); break;
    case 'sort':            sortTable(d.table, d.key); break;
    case 'unused-filter':   toggleUnused(d.entity); break;
    case 'theme':           toggleTheme(); break;
    case 'reload':          location.reload(); break;
    case 'md-expand-all':   expandAllDetails(); break;
    case 'md-collapse-all': collapseAllDetails(); break;
    case 'md-copy':         copyMarkdown(); break;
    case 'md-download':     downloadMarkdown(); break;
    case 'page-toggle':     togglePage(d.name); break;
    case 'table-toggle':    toggleTableCard(d.name); break;
    case 'table-group-toggle': toggleTableGroup(d.group); break;
    case 'orphan-toggle':   toggleOrphanSection(d.section); break;
    case 'toggle-auto-date': toggleAutoDate(); break;
    case 'card-toggle':     el.parentElement.classList.toggle('open'); break;
    // Source Map tab
    case 'sm-sort':         sourceMapSortBy(d.key); break;
    case 'sm-filter-type':  sourceMapSetFilterType(d.type); break;
    case 'sm-export-csv':   sourceMapExportCsv(); break;
  }
});

// Parallel delegator for input events — the Measures and Columns tab
// search boxes used to carry inline `oninput="filterTable(...)"`
// attributes. Stop 4 migrated every click handler to data-action but
// missed the oninput ones; this closes the "no inline handlers"
// invariant. Same structural guarantee: user text reaches
// filterTable via HTMLInputElement.value (browser-decoded, safe).
document.addEventListener('input', function(e){
  var el = e.target.closest && e.target.closest('[data-action]');
  if (!el) return;
  var a = el.getAttribute('data-action');
  var d = el.dataset;
  switch (a) {
    case 'filter': filterTable(d.entity, el.value); break;
  }
});

// uc — see src/client/render/escape.ts

function renderSummary(){
  const t=DATA.totals;
  const totalOrphan=t.measuresUnused+t.columnsUnused;
  const hiddenCount=(DATA.hiddenPages||[]).length;
  const visibleCount=t.pages-hiddenCount;
  const tipDirect=`Fields bound to at least one visual (data well, filter, or conditional formatting). ${t.measuresDirect} measures · ${t.columnsDirect} columns.`;
  const tipIndirect=`Not on any visual, but referenced by direct measures via DAX or used in a relationship — keep these. ${t.measuresIndirect} measures · ${t.columnsIndirect} columns.`;
  const tipUnused=`Not referenced anywhere in the report — safe to remove. ${t.measuresUnused} measures · ${t.columnsUnused} columns.`;
  const tipPages=`Total pages in the report. ${visibleCount} visible · ${hiddenCount} hidden (tooltip / drillthrough / nav-suppressed).`;
  const tipVisuals=`Total visuals across all pages.`;
  document.getElementById("summary").innerHTML=`
    <div class="stat has-tip" data-tooltip="${tipDirect}"><div class="stat-value good">${t.measuresDirect+t.columnsDirect}</div><div class="stat-label">Direct</div><div class="stat-detail">${t.measuresDirect}M · ${t.columnsDirect}C</div></div>
    <div class="stat has-tip" data-tooltip="${tipIndirect}"><div class="stat-value ${t.measuresIndirect+t.columnsIndirect>0?'warn':''}">${t.measuresIndirect+t.columnsIndirect}</div><div class="stat-label">Indirect</div><div class="stat-detail">${t.measuresIndirect}M · ${t.columnsIndirect}C</div></div>
    <div class="stat has-tip" data-tooltip="${tipUnused}"><div class="stat-value ${totalOrphan>0?'danger':''}">${totalOrphan}</div><div class="stat-label">Unused</div><div class="stat-detail">${t.measuresUnused}M · ${t.columnsUnused}C</div></div>
    <div class="stat has-tip" data-tooltip="${tipPages}"><div class="stat-value">${t.pages}</div><div class="stat-label">Pages</div><div class="stat-detail">${visibleCount}V · ${hiddenCount}H</div></div>
    <div class="stat has-tip" data-tooltip="${tipVisuals}"><div class="stat-value">${t.visuals}</div><div class="stat-label">Visuals</div></div>
  `;
}

// Auto-generated `LocalDateTable_<guid>` / `DateTableTemplate_<guid>`
// tables are infrastructure, not user content. We hide them from
// default counts and rendering; a toggle on the Tables / Sources tab
// lets users opt into seeing them. On the H&S composite model this
// cuts 10 noise entries out of the 53-table list.
let showAutoDate = false;
function visibleTables(){ return (DATA.tables||[]).filter(t=>showAutoDate||t.origin!=="auto-date"); }
function autoDateCount(){ return (DATA.tables||[]).filter(t=>t.origin==="auto-date").length; }
function toggleAutoDate(){ showAutoDate = !showAutoDate; renderTabs(); renderTables(); renderSources(); }

function renderTabs(){
  const um=DATA.totals.measuresUnused+DATA.totals.columnsUnused;
  const vt=visibleTables();
  const adc=autoDateCount();
  // Bottom-up build order: data foundations first, then calculation logic,
  // then consumption (pages), then analysis (unused/lineage), then docs.
  document.getElementById("tabs").innerHTML=[
    // Data layer
    {id:"sources",l:"Sources",b:vt.filter(function(t){return (t.partitions||[]).length>0;}).length},
    {id:"sourcemap",l:"Source Map",b:sourceMapRowCount()},
    {id:"tables",l:"Tables",b:vt.length},
    {id:"columns",l:"Columns",b:DATA.columns.length},
    {id:"relationships",l:"Relationships",b:DATA.relationships.length},
    // Calculation layer
    {id:"measures",l:"Measures",b:DATA.measures.length},
    {id:"calcgroups",l:"Calc Groups",b:DATA.calcGroups.length},
    {id:"functions",l:"Functions",b:DATA.functions.filter(f=>!f.name.endsWith('.About')).length},
    // Consumption
    {id:"pages",l:"Pages",b:pageData.length},
    // Analysis
    {id:"unused",l:"Unused",b:um,w:um>0},
    {id:"lineage",l:"Lineage",b:null},
    // Output
    {id:"docs",l:"Docs",b:null}
  ].map(t=>`<button class="tab ${activeTab===t.id?'active':''}" data-action="tab" data-tab="${t.id}">${t.l}${t.b!==null?`<span class="tab-count ${t.w?'warn':''}">${t.b}</span>`:''}</button>`).join("");
}

// Shared panel-footer writer. Each render* function calls this at the end
// with its own count string on the left and (optionally) a sort / meta on
// the right. Writes into a target element by id; silent if absent.
function setPanelFooter(id, leftHtml, rightHtml){
  var el=document.getElementById(id);
  if(!el)return;
  var left='<div class="left">'+leftHtml+'</div>';
  var right=rightHtml?'<div class="right">'+rightHtml+'</div>':'';
  el.innerHTML=left+right;
}
function sortIndicator(state){
  if(!state||!state.key)return "";
  return 'Sorted by '+state.key+' '+(state.desc?'↓':'↑');
}

function switchTab(id){
  if(id!=="lineage")lastTab=id;
  activeTab=id;renderTabs();
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("panel-"+id).classList.add("active");
  if(id==="lineage"&&!document.getElementById("lineage-content").innerHTML.trim())
    document.getElementById("lineage-content").innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--text-faint)"><div style="font-size:16px;margin-bottom:8px">Click a measure or column name to view its lineage</div><div style="font-size:12px">Go to the Measures or Columns tab and click any field name</div></div>';
  // Functions + Calc Groups tabs display DAX bodies. Running through
  // addCopyButtons() here (which also highlights) colourises any new
  // blocks that weren't highlighted at initial render.
  if(id==="functions"||id==="calcgroups"||id==="lineage")addCopyButtons();
}

// sc — see src/client/render/escape.ts
function renderMeasures(){
  let items=[...DATA.measures];const s=sortState.measures;
  items.sort((a,b)=>{let av=a[s.key],bv=b[s.key];if(typeof av==='string')return s.desc?bv.localeCompare(av):av.localeCompare(bv);return s.desc?bv-av:av-bv;});
  if(showUnusedOnly.measures)items=items.filter(m=>m.status!=='direct');
  if(searchTerms.measures){const q=searchTerms.measures.toLowerCase();items=items.filter(m=>m.name.toLowerCase().includes(q)||m.table.toLowerCase().includes(q));}
  document.getElementById("tbody-measures").innerHTML=items.map(m=>{
    const deps=m.daxDependencies.map(d=>`<span class="dep-chip" data-action="lineage" data-type="measure" data-name="${escAttr(d)}">${escHtml(d)}</span>`).join("")||'<span style="color:var(--text-faint)">—</span>';
    const pages=[...new Set(m.usedIn.map(u=>u.pageName))];
    const used=pages.map(p=>`<span class="used-chip">${escHtml(p)}</span>`).join("")||'<span style="color:var(--text-faint)">—</span>';
    const statusBadge=m.status==='indirect'?'<span class="badge badge--indirect">↻ INDIRECT</span>':m.status==='unused'?'<span class="badge badge--unused">⚠ UNUSED</span>':'';
    const nameAttr=m.description?' title="'+escAttr(m.description)+'" data-desc="1"':'';
    const descRow=m.description?'<div class="desc-muted" style="margin-top:2px;font-size:11px">'+escHtml(m.description)+'</div>':'';
    return `<tr class="${sc(m.status)}"><td><span class="field-name"${nameAttr} data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">${escHtml(m.name)}</span>${statusBadge}${descRow}</td><td><span class="field-table">${escHtml(m.table)}</span></td><td><span class="usage-count ${uc(m.usageCount)}">${m.usageCount}</span></td><td><span class="usage-count ${uc(m.pageCount)}">${m.pageCount}</span></td><td>${deps}</td><td>${used}</td><td><span class="format-str">${escHtml(m.formatString||'—')}</span></td></tr>`;
  }).join("");
  setPanelFooter("footer-measures",
    "Showing "+items.length+" of "+DATA.measures.length+" measures · "+DATA.totals.measuresUnused+" unused · "+DATA.totals.measuresIndirect+" indirect",
    sortIndicator(sortState.measures));
}

function renderColumns(){
  let items=[...DATA.columns];const s=sortState.columns;
  items.sort((a,b)=>{let av=a[s.key],bv=b[s.key];if(typeof av==='string')return s.desc?bv.localeCompare(av):av.localeCompare(bv);return s.desc?bv-av:av-bv;});
  if(showUnusedOnly.columns)items=items.filter(c=>c.status!=='direct');
  if(searchTerms.columns){const q=searchTerms.columns.toLowerCase();items=items.filter(c=>c.name.toLowerCase().includes(q)||c.table.toLowerCase().includes(q));}
  document.getElementById("tbody-columns").innerHTML=items.map(c=>{
    const pages=[...new Set(c.usedIn.map(u=>u.pageName))];
    const used=pages.map(p=>`<span class="used-chip">${escHtml(p)}</span>`).join("")||'<span style="color:var(--text-faint)">—</span>';
    // SLICER badge intentionally omitted here — it now lives on the per-column
    // row inside the Tables tab, next to PK/FK/CALC/HIDDEN, where it's more
    // useful in context.
    const statusBadge=c.status==='indirect'?'<span class="badge badge--indirect">↻ INDIRECT</span>':c.status==='unused'?'<span class="badge badge--unused">⚠ UNUSED</span>':'';
    const cNameAttr=c.description?' title="'+escAttr(c.description)+'" data-desc="1"':'';
    const cDescRow=c.description?'<div class="desc-muted" style="margin-top:2px;font-size:11px">'+escHtml(c.description)+'</div>':'';
    return `<tr class="${sc(c.status)}"><td><span class="field-name"${cNameAttr} data-action="lineage" data-type="column" data-name="${escAttr(c.name)}">${escHtml(c.name)}</span>${statusBadge}${cDescRow}</td><td><span class="field-table">${escHtml(c.table)}</span></td><td><span class="mono" style="font-size:11px;color:#64748B">${escHtml(c.dataType)}</span></td><td><span class="usage-count ${uc(c.usageCount)}">${c.usageCount}</span></td><td><span class="usage-count ${uc(c.pageCount)}">${c.pageCount}</span></td><td>${used}</td></tr>`;
  }).join("");
  setPanelFooter("footer-columns",
    "Showing "+items.length+" of "+DATA.columns.length+" columns · "+DATA.totals.columnsUnused+" unused",
    sortIndicator(sortState.columns));
}

function navigateLineage(type,name){
  lastTab=activeTab!=="lineage"?activeTab:lastTab;
  activeTab="lineage";renderTabs();
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("panel-lineage").classList.add("active");

  const el=document.getElementById("lineage-content");
  const backTab=type==="column"?"columns":"measures";

  if(type==="measure"){
    const m=DATA.measures.find(x=>x.name===name);
    if(!m){el.innerHTML='<div style="color:var(--clr-unused);padding:20px">Measure not found</div>';return;}

    const upstream=m.daxDependencies.map(d=>{
      const dep=DATA.measures.find(x=>x.name===d);
      return dep||{name:d,table:"?",formatString:""};
    });
    const usedFuncs=DATA.functions.filter(f=>!f.name.endsWith('.About')&&(m.daxExpression.includes("'"+f.name+"'")||m.daxExpression.includes(f.name+'(')));
    const feedsInto=DATA.measures.filter(x=>x.daxDependencies.includes(m.name));
    // EXTERNALMEASURE proxy is now detected server-side (data-builder.ts)
    // and attached to the measure as a structured `externalProxy` field.
    // The regex fallback stays for back-compat with older DATA payloads.
    let proxy = m.externalProxy;
    if (!proxy) {
      const extMatch = (m.daxExpression||'').match(/EXTERNALMEASURE\s*\(\s*"([^"]*)"\s*,\s*(\w+)\s*,\s*"DirectQuery to AS - ([^"]+)"\s*\)/i);
      if (extMatch) proxy = { remoteName: extMatch[1], type: extMatch[2], externalModel: extMatch[3], cluster: null };
    }
    const extModel = proxy ? proxy.externalModel : null;
    const extRemoteName = proxy ? proxy.remoteName : null;

    el.innerHTML=`
      <div class="lineage-back" data-action="tab" data-tab="${escAttr(backTab)}">← Back to ${backTab==='measures'?'Measures':'Columns'}</div>
      <div class="lineage-hero">
        <div class="lineage-hero-title"><span class="dot" style="background:var(--clr-measure)"></span>${escHtml(m.name)}</div>
        <div class="lineage-hero-meta">${escHtml(m.table)} · ${escHtml(m.formatString||'—')} · ${m.usageCount} visual${m.usageCount!==1?'s':''} · ${m.pageCount} page${m.pageCount!==1?'s':''}</div>
        ${m.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(m.description)+'</div>':''}
        <div class="lineage-dax">${escHtml(m.daxExpression)}</div>
      </div>
      <div class="lineage-flow-row">
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-upstream)">↑ Upstream</div>
          ${usedFuncs.map(f=>`
            <div class="lc udf clickable" style="margin-bottom:4px" data-action="tab" data-tab="functions">
              <div class="lc-name" style="color:var(--clr-function)">ƒ ${escHtml(f.name)}</div>
              <div class="lc-sub">Function · ${f.parameters?f.parameters.split(',').length+' param'+(f.parameters.split(',').length!==1?'s':''):'no params'}</div>
            </div>`).join("")}
          ${extModel?`
          <div class="lc" style="border-left:3px solid var(--clr-function);margin-bottom:4px;background:var(--clr-function-soft)">
            <div class="lc-name" style="color:var(--clr-function)">⊡ ${escHtml(extModel)}</div>
            <div class="lc-sub">External semantic model · EXTERNALMEASURE${extRemoteName&&extRemoteName!==m.name?' · remote name "'+escHtml(extRemoteName)+'"':''}</div>
          </div>`:''}
          <div class="lc source" style="margin-bottom:4px">
            <div class="lc-name" style="color:var(--clr-source)">⬡ ${escHtml(m.table)}</div>
            <div class="lc-sub">Source table</div>
          </div>
          ${upstream.length?upstream.map(u=>`
            <div class="lc upstream clickable" data-action="lineage" data-type="measure" data-name="${escAttr(u.name)}">
              <div class="lc-name">${escHtml(u.name)}</div>
              <div class="lc-sub">${escHtml(u.table)} · ${escHtml(u.formatString||'')}</div>
            </div>`).join(""):`${(usedFuncs.length||extModel)?'':`<div class="lc upstream empty"><div class="lc-name">No dependencies</div><div class="lc-sub">Base measure</div></div>`}`}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-measure)">● This Measure</div>
          <div class="lc center">
            <div class="lc-name">${escHtml(m.name)}</div>
            <div class="lc-sub">${escHtml(m.daxExpression.length>50?m.daxExpression.substring(0,50)+'…':m.daxExpression)}</div>
          </div>
          ${feedsInto.length?`
            <div class="feeds-label">Feeds into</div>
            ${feedsInto.map(f=>`
              <div class="lc feeds clickable" data-action="lineage" data-type="measure" data-name="${escAttr(f.name)}">
                <div class="lc-name">${escHtml(f.name)}</div>
                <div class="lc-sub">${escHtml(f.formatString||'')} · ${f.usageCount} visual${f.usageCount!==1?'s':''}</div>
              </div>`).join("")}
          `:''}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-downstream)">↓ Downstream</div>
          ${m.usedIn.length?m.usedIn.map(d=>`
            <div class="lc downstream">
              <div class="lc-name">${escHtml(d.visualTitle)}</div>
              <div class="lc-sub">${escHtml(d.visualType)} · ${escHtml(d.bindingRole)}</div>
              <div class="lc-role">${escHtml(d.pageName)}</div>
            </div>`).join(""):`<div class="lc downstream empty"><div class="lc-name" style="color:var(--clr-unused)">Not used</div><div class="lc-sub">Orphaned measure</div></div>`}
        </div>
      </div>`;
    addCopyButtons();
  }
  else if(type==="column"){
    const c=DATA.columns.find(x=>x.name===name);
    if(!c){el.innerHTML='<div style="color:var(--clr-unused);padding:20px">Column not found</div>';return;}
    const colRef=c.table+'['+c.name+']';
    const related=DATA.measures.filter(m=>m.daxExpression.includes(colRef)||m.daxExpression.includes('['+c.name+']'));

    el.innerHTML=`
      <div class="lineage-back" data-action="tab" data-tab="columns">← Back to Columns</div>
      <div class="lineage-hero">
        <div class="lineage-hero-title"><span class="dot" style="background:var(--clr-column)"></span>${escHtml(c.name)}</div>
        <div class="lineage-hero-meta">${escHtml(c.table)} · ${escHtml(c.dataType)} · ${c.usageCount} visual${c.usageCount!==1?'s':''} · ${c.pageCount} page${c.pageCount!==1?'s':''}</div>
        ${c.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(c.description)+'</div>':''}
      </div>
      <div class="lineage-flow-row">
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-source)">↑ Source</div>
          <div class="lc source">
            <div class="lc-name" style="color:var(--clr-source)">⬡ ${escHtml(c.table)}</div>
            <div class="lc-sub">${escHtml(c.dataType)}</div>
          </div>
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-column)">● This Column</div>
          <div class="lc center col-type">
            <div class="lc-name">${escHtml(c.name)}</div>
            <div class="lc-sub">${escHtml(c.table)}[${escHtml(c.name)}]</div>
          </div>
          ${related.length?`
            <div class="feeds-label">Measures referencing ${escHtml(c.name)}</div>
            ${related.map(m=>`
              <div class="lc feeds clickable" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">
                <div class="lc-name">${escHtml(m.name)}</div>
                <div class="lc-sub">${escHtml(m.formatString||'')} · ${m.usageCount} visual${m.usageCount!==1?'s':''}</div>
              </div>`).join("")}
          `:''}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:var(--clr-downstream)">↓ Downstream</div>
          ${c.usedIn.length?c.usedIn.map(d=>`
            <div class="lc downstream">
              <div class="lc-name">${escHtml(d.visualTitle)}</div>
              <div class="lc-sub">${escHtml(d.visualType)} · ${escHtml(d.bindingRole)}</div>
              <div class="lc-role">${escHtml(d.pageName)}</div>
            </div>`).join(""):`<div class="lc downstream empty"><div class="lc-name" style="color:var(--clr-unused)">Not used</div><div class="lc-sub">Orphaned column</div></div>`}
        </div>
      </div>`;
  }
}

function renderPages(){
  const FC={measure:"#F59E0B",column:"#3B82F6"};
  const hiddenSet=new Set(DATA.hiddenPages||[]);
  document.getElementById("pages-content").innerHTML=pageData.map(p=>{
    const isOpen=openPages.has(p.name);
    const hiddenBadge=hiddenSet.has(p.name)?'<span class="badge badge--hidden" title="This page is marked HiddenInViewMode — typically a tooltip, drillthrough, or nav-suppressed page">👁 HIDDEN</span>':'';

    const typeChips=Object.entries(p.typeCounts).map(([t,c])=>`<span class="page-type-chip">${c}× ${escHtml(t)}</span>`).join("");

    const visualRows=p.visuals.map(v=>{
      const bindingChips=v.bindings.map(b=>{
        const color=b.fieldType==="measure"?FC.measure:FC.column;
        return `<span class="dep-chip" style="background:${color}15;color:${color};border-color:${color}30;cursor:pointer" data-action="lineage" data-type="${escAttr(b.fieldType)}" data-name="${escAttr(b.fieldName)}">${escHtml(b.fieldName)}</span>`;
      }).join("");
      return `<div class="page-visual-row">
        <span class="page-visual-type">${escHtml(v.type)}</span>
        <span class="page-visual-title">${escHtml(v.title)}</span>
        <div class="page-visual-bindings">${bindingChips}</div>
      </div>`;
    }).join("");

    const measureChips=p.measures.map(m=>`<span class="dep-chip" style="background:rgba(245,158,11,.1);color:var(--clr-measure);border-color:rgba(245,158,11,.2);cursor:pointer" data-action="lineage" data-type="measure" data-name="${escAttr(m)}">${escHtml(m)}</span>`).join("");
    const columnChips=p.columns.map(c=>`<span class="dep-chip" style="background:rgba(59,130,246,.1);color:var(--clr-column);border-color:rgba(59,130,246,.2);cursor:pointer" data-action="lineage" data-type="column" data-name="${escAttr(c)}">${escHtml(c)}</span>`).join("");

    return `<div class="page-card ${isOpen?'open':''}">
      <div class="page-header" data-action="page-toggle" data-name="${escAttr(p.name)}">
        <div class="page-name">${escHtml(p.name)}${hiddenBadge}</div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-downstream)">${p.visualCount}</div><div class="page-stat-label">Visuals</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${p.measureCount}</div><div class="page-stat-label">Measures</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-column)">${p.columnCount}</div><div class="page-stat-label">Columns</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-slicer)">${p.slicerCount}</div><div class="page-stat-label">Slicers</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        <div class="page-section">
          <div class="page-section-title">Visual types<span class="line"></span></div>
          <div class="page-type-summary">${typeChips}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Measures (${p.measureCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${measureChips||'<span style="color:#475569;font-size:12px">None</span>'}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Columns (${p.columnCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${columnChips||'<span style="color:#475569;font-size:12px">None</span>'}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Visuals (${p.visualCount})<span class="line"></span></div>
          ${visualRows||(p.visualCount>0?'<span style="color:#475569;font-size:12px">No data-bound visuals on this page — text, shape, or image only.</span>':'<span style="color:#475569;font-size:12px">Empty page.</span>')}
        </div>
      </div></div>
    </div>`;
  }).join("");
  var hiddenCount=(DATA.hiddenPages||[]).length;
  var visibleCount=pageData.length-hiddenCount;
  var totalVisuals=pageData.reduce(function(a,p){return a+(p.visualCount||0);},0);
  var pf=document.getElementById("pages-content");
  if(pf)pf.insertAdjacentHTML("beforeend",
    '<div class="panel-footer"><div class="left">'+
      pageData.length+' pages · '+visibleCount+' visible · '+hiddenCount+' hidden · '+totalVisuals+' visuals'+
    '</div></div>');
}

function togglePage(name){
  if(openPages.has(name))openPages.delete(name);else openPages.add(name);
  renderPages();
}

function toggleTableCard(name){
  if(openTables.has(name))openTables.delete(name);else openTables.add(name);
  renderTables();
}

// Classify a table into one of five mutually exclusive groups for the
// Tables-tab sectioning. Order of checks matters because a calc-group
// table could also technically have a "measure" name etc. — we take
// the most-specific category first.
function tableGroupKey(t){
  if(t.parameterKind==='field')return 'field-param';
  if(t.parameterKind==='compositeModelProxy')return 'proxy';
  if(t.isCalcGroup)return 'calcgroup';
  // "Measure home" tables — host measures with (usually) one placeholder
  // column. Heuristic matches `_measures`, `_Rollup_measures`, etc.
  if((t.measureCount||0)>0 && (t.columnCount||0)<=1 && /measure/i.test(t.name))return 'measure';
  return 'data';
}
// Display metadata for each group. `defaultOpen:true` means the group
// body is visible on first load (the user can still collapse it).
const TABLE_GROUPS=[
  {key:'data',        label:'Data Tables',             defaultOpen:false, icon:'▦'},
  {key:'measure',     label:'Measure Tables',          defaultOpen:false, icon:'ƒ'},
  {key:'field-param', label:'Field Parameters',        defaultOpen:false, icon:'▣'},
  {key:'proxy',       label:'Composite Model Proxies', defaultOpen:false, icon:'◈'},
  {key:'calcgroup',   label:'Calculation Groups',      defaultOpen:false, icon:'🧮'},
];
// Track which groups the user has toggled away from their default.
// Default state is derived per-group; this set stores the flips.
var flippedTableGroups = new Set();
function isTableGroupOpen(key){
  const def = (TABLE_GROUPS.find(g=>g.key===key)||{}).defaultOpen;
  return flippedTableGroups.has(key) ? !def : def;
}
function toggleTableGroup(key){
  if(flippedTableGroups.has(key))flippedTableGroups.delete(key);
  else flippedTableGroups.add(key);
  renderTables();
}

function renderTables(){
  const tables=visibleTables();
  // Precompute slicer lookup once per render so the per-row badge stays cheap.
  // TableColumnData doesn't carry isSlicerField — it lives on the flat ModelColumn.
  const slicerSet=new Set((DATA.columns||[]).filter(c=>c.isSlicerField).map(c=>c.table+'|'+c.name));

  // Partition visible tables into the five groups.
  const byGroup = new Map(TABLE_GROUPS.map(g=>[g.key,[]]));
  for(const t of tables){
    const k = tableGroupKey(t);
    byGroup.get(k).push(t);
  }

  function cardHtml(t){
    const isOpen=openTables.has(t.name);

    const colRows=t.columns.map(c=>{
      const badges=[];
      if(c.isKey)badges.push('<span class="badge badge--pk" title="Primary key — isKey:true set in the model">🔑 PK</span>');
      else if(c.isInferredPK)badges.push('<span class="badge badge--pk-inf" title="Inferred primary key — this column is on the one-side of at least one relationship">🗝 PK</span>');
      if(c.isFK)badges.push('<span class="badge badge--fk" title="Foreign key — used as fromColumn in a relationship">🔗 FK</span>');
      if(c.isCalculated)badges.push('<span class="badge badge--calc" title="Calculated column">🧮 CALC</span>');
      if(c.isHidden)badges.push('<span class="badge badge--hid-col" title="isHidden:true">👁 HIDDEN</span>');
      if(slicerSet.has(t.name+'|'+c.name))badges.push('<span class="badge badge--slicer" title="Bound to at least one slicer visual">🎚 SLICER</span>');
      const statusClass=c.status==='unused'?'zero':c.status==='indirect'?'low':'good';
      // Relationship column: FK target (outgoing) or incoming PK refs, or both if the column is a bridge
      const parts=[];
      if(c.isFK&&c.fkTarget)parts.push(`<span class="rel-out">→ ${escHtml(c.fkTarget.table)}[${escHtml(c.fkTarget.column)}]</span>`);
      if(c.incomingRefs&&c.incomingRefs.length>0){
        const refs=c.incomingRefs.map(r=>`<span class="rel-in${r.isActive?'':' rel-inactive'}">← ${escHtml(r.table)}[${escHtml(r.column)}]${r.isActive?'':' <span style="font-size:9px;opacity:.7">(inactive)</span>'}</span>`).join('<span style="color:var(--text-fainter);margin:0 4px">·</span>');
        parts.push(refs);
      }
      const relText=parts.length?parts.join('<br>'):'<span style="color:var(--text-fainter)">—</span>';
      const colDesc=c.description?'<div class="desc-muted" style="margin-top:3px">'+escHtml(c.description)+'</div>':'';
      return `<div class="tcol-row">
        <div>
          <span class="tcol-name" data-action="lineage" data-type="column" data-name="${escAttr(c.name)}">${escHtml(c.name)}</span>${badges.join('')}
          <span class="usage-count ${statusClass}" style="margin-left:8px;font-size:10px">${c.usageCount}</span>
          ${colDesc}
        </div>
        <div class="tcol-type">${escHtml(c.dataType)}</div>
        <div class="tcol-fk">${relText}</div>
      </div>`;
    }).join("")||'<div style="padding:8px 10px;color:var(--text-faint);font-size:12px">No columns</div>';

    const measureList=t.measures.map(m=>{
      const cls=m.status==='unused'?'zero':m.status==='indirect'?'low':'good';
      return `<span class="dep-chip" style="background:rgba(245,158,11,.1);color:var(--clr-measure);border-color:rgba(245,158,11,.2);cursor:pointer" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">${escHtml(m.name)} <span class="usage-count ${cls}" style="margin-left:4px;font-size:9px">${m.usageCount}</span></span>`;
    }).join("")||'<span style="color:var(--text-faint);font-size:12px">None</span>';

    const relRows=t.relationships.map(r=>{
      const dirClass=r.direction==='outgoing'?'badge--direction-out':'badge--direction-in';
      const dirLabel=r.direction==='outgoing'?'FK →':'← PK';
      const inactive=r.isActive?'':' trel-inactive';
      const arrow=r.direction==='outgoing'?'→':'←';
      const other=r.direction==='outgoing'?`${escHtml(r.toTable)}[${escHtml(r.toColumn)}]`:`${escHtml(r.fromTable)}[${escHtml(r.fromColumn)}]`;
      const self=r.direction==='outgoing'?`[${escHtml(r.fromColumn)}]`:`[${escHtml(r.toColumn)}]`;
      return `<div class="trel-row${inactive}">
        <span class="badge ${dirClass}">${dirLabel}</span>
        <span>${self} <span style="color:var(--text-faint)">${arrow}</span> ${other}</span>
        ${r.isActive?'':'<span style="font-size:9px;color:var(--text-dim);margin-left:4px">(inactive)</span>'}
      </div>`;
    }).join("")||'<div style="padding:8px 10px;color:var(--text-faint);font-size:12px">No relationships</div>';

    const tableDesc=t.description?'<div class="desc-line">'+escHtml(t.description)+'</div>':'';
    return `<div class="page-card ${isOpen?'open':''}">
      <div class="page-header" data-action="table-toggle" data-name="${escAttr(t.name)}">
        <div style="flex:1;min-width:0">
          <div class="page-name">${escHtml(t.name)}</div>
          ${tableDesc}
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-column)">${t.columnCount}</div><div class="page-stat-label">Columns</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${t.measureCount}</div><div class="page-stat-label">Measures</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${t.keyCount}</div><div class="page-stat-label">Keys</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-column)">${t.fkCount}</div><div class="page-stat-label">FKs</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        <div class="page-section">
          <div class="page-section-title">Columns (${t.columnCount})<span class="line"></span></div>
          <div class="tcol-row" style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);font-weight:600;border-bottom:1px solid var(--border);padding-bottom:4px">
            <div>Name</div><div>Type</div><div>Relationship</div>
          </div>
          ${colRows}
        </div>
        <div class="page-section">
          <div class="page-section-title">Measures (${t.measureCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${measureList}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Relationships (${t.relationships.length})<span class="line"></span></div>
          ${relRows}
        </div>
      </div></div>
    </div>`;
  } // end cardHtml

  // Render the grouped sections. Sort tables alphabetically within
  // each group; the group order comes from TABLE_GROUPS. Empty
  // groups are omitted so the UI doesn't show empty "0 tables"
  // section headers for models that have no parameters / proxies.
  const sectionsHtml = TABLE_GROUPS.map(g=>{
    const groupTables = (byGroup.get(g.key)||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
    if(groupTables.length===0)return '';
    const open = isTableGroupOpen(g.key);
    const groupCols = groupTables.reduce((a,t)=>a+(t.columnCount||0),0);
    const groupMs  = groupTables.reduce((a,t)=>a+(t.measureCount||0),0);
    const metaParts = [groupTables.length+' table'+(groupTables.length===1?'':'s')];
    if(groupCols>0) metaParts.push(groupCols+' col'+(groupCols===1?'':'s'));
    if(groupMs>0)   metaParts.push(groupMs+' measure'+(groupMs===1?'':'s'));
    const bodyHtml = open ? groupTables.map(cardHtml).join("") : '';
    return `<div class="table-group ${open?'open':''}">
      <div class="table-group-header" data-action="table-group-toggle" data-group="${escAttr(g.key)}">
        <span class="table-group-chev" aria-hidden="true"></span>
        <span class="table-group-icon">${g.icon}</span>
        <span class="table-group-title">${escHtml(g.label)}</span>
        <span class="table-group-meta">${metaParts.join(' · ')}</span>
      </div>
      <div class="table-group-body">${bodyHtml}</div>
    </div>`;
  }).join("");
  document.getElementById("tables-content").innerHTML =
    sectionsHtml || '<div style="text-align:center;padding:60px 20px;color:var(--text-faint);font-size:13px">No tables found</div>';

  var totalCols=tables.reduce(function(a,t){return a+(t.columnCount||0);},0);
  var totalMs=tables.reduce(function(a,t){return a+(t.measureCount||0);},0);
  var adc=autoDateCount();
  var pf=document.getElementById("tables-content");
  if(pf){
    // Footer shows visible-table totals + a toggle for the auto-date
    // tables Power BI generates as calendar infrastructure. The toggle
    // is only rendered when the model actually has some to hide/show.
    var autoToggle = adc > 0
      ? '<button class="filter-btn'+(showAutoDate?' active':'')+'" data-action="toggle-auto-date" title="'+
          (showAutoDate?'Hide':'Show')+' LocalDateTable_* and DateTableTemplate_* auto-generated tables">'+
        (showAutoDate?'Hide':'Show')+' auto-date ('+adc+')</button>'
      : '';
    pf.insertAdjacentHTML("beforeend",
      '<div class="panel-footer"><div class="left">'+
        tables.length+' tables · '+totalCols+' columns · '+totalMs+' measures'+
        (adc>0 && !showAutoDate ? ' · <span style="color:var(--text-faint)">+'+adc+' auto-date hidden</span>' : '')+
      '</div><div class="right">'+autoToggle+'</div></div>');
  }
}

var openOrphanSections=new Set();
function toggleOrphanSection(id){if(openOrphanSections.has(id))openOrphanSections.delete(id);else openOrphanSections.add(id);renderUnused();}

function orphanSection(id,title,subtitle,color,count,countLabel,items){
  const isOpen=openOrphanSections.has(id);
  return `<div class="page-card ${isOpen?'open':''}" style="border-left:3px solid ${color}">
    <div class="page-header" data-action="orphan-toggle" data-section="${escAttr(id)}">
      <div style="flex:1">
        <div class="page-name" style="font-size:14px">${escHtml(title)}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">${escHtml(subtitle)}</div>
      </div>
      <div class="page-stats">
        <div class="page-stat"><div class="page-stat-val" style="color:${color}">${count}</div><div class="page-stat-label">${escHtml(countLabel)}</div></div>
      </div>
      <span class="page-expand" aria-hidden="true"></span>
    </div>
    <div class="page-body"><div class="page-body-inner">
      <div style="display:flex;flex-wrap:wrap;gap:8px">${items}</div>
    </div></div>
  </div>`;
}

function renderUnused(){
  const unusedM=DATA.measures.filter(m=>m.status==='unused'),indirectM=DATA.measures.filter(m=>m.status==='indirect');
  const unusedC=DATA.columns.filter(c=>c.status==='unused'),indirectC=DATA.columns.filter(c=>c.status==='indirect');
  const pureOrphanM=unusedM.filter(m=>!m.dependedOnBy.length);
  const chainOrphanM=unusedM.filter(m=>m.dependedOnBy.length>0);
  let h='';

  if(pureOrphanM.length) h+=orphanSection('pure-m','Unused Measures — Not Referenced Anywhere','No visual uses them and no other measure references them — safe to remove','var(--clr-unused)',pureOrphanM.length,'Measures',
    pureOrphanM.map(m=>`<div class="lc clickable" style="border-left:3px solid var(--clr-unused);flex:0 0 auto" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}"><div class="lc-name">${escHtml(m.name)}</div><div class="lc-sub">${escHtml(m.table)} · ${escHtml(m.formatString||'')}</div></div>`).join(""));

  if(chainOrphanM.length) h+=orphanSection('chain-m','Unused Measures — Dead Chain','Other measures depend on them, but the full chain never reaches any visual','var(--clr-unused)',chainOrphanM.length,'Measures',
    chainOrphanM.map(m=>`<div class="lc clickable" style="border-left:3px solid var(--clr-unused);flex:0 0 auto" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}"><div class="lc-name">${escHtml(m.name)}</div><div class="lc-sub">${escHtml(m.table)} · ${escHtml(m.formatString||'')} · depended on by ${m.dependedOnBy.length}</div></div>`).join(""));

  if(unusedC.length) h+=orphanSection('orphan-c','Unused Columns','No visual, measure, or relationship uses them — safe to hide or remove','var(--clr-unused)',unusedC.length,'Columns',
    unusedC.map(c=>`<div class="lc clickable" style="border-left:3px solid var(--clr-unused);flex:0 0 auto" data-action="lineage" data-type="column" data-name="${escAttr(c.name)}"><div class="lc-name">${escHtml(c.name)}</div><div class="lc-sub">${escHtml(c.table)} · ${escHtml(c.dataType)}</div></div>`).join(""));

  if(indirectM.length) h+=orphanSection('indirect-m','Indirect Measures','Not on any visual, but used inside other measures that are — keep these','var(--clr-indirect)',indirectM.length,'Measures',
    indirectM.map(m=>`<div class="lc clickable" style="border-left:3px solid var(--clr-indirect);flex:0 0 auto" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}"><div class="lc-name">${escHtml(m.name)}</div><div class="lc-sub">${escHtml(m.table)} · ${escHtml(m.formatString||'')}</div></div>`).join(""));

  if(indirectC.length) h+=orphanSection('indirect-c','Indirect Columns','Not on any visual, but used in a relationship or measure DAX — keep these','var(--clr-indirect)',indirectC.length,'Columns',
    indirectC.map(c=>`<div class="lc clickable" style="border-left:3px solid var(--clr-indirect);flex:0 0 auto" data-action="lineage" data-type="column" data-name="${escAttr(c.name)}"><div class="lc-name">${escHtml(c.name)}</div><div class="lc-sub">${escHtml(c.table)} · ${escHtml(c.dataType)}</div></div>`).join(""));

  if(!unusedM.length&&!unusedC.length&&!indirectM.length&&!indirectC.length)h='<div style="text-align:center;padding:40px;color:var(--clr-success);font-weight:600">All fields are in use ✓</div>';
  var totalUnused=unusedM.length+unusedC.length;
  h+='<div class="panel-footer"><div class="left">'+
    (totalUnused?totalUnused+' unused items · safe to review for removal':'No unused items to review')+
    '</div></div>';
  document.getElementById("unused-content").innerHTML=h;
}

function renderSources(){
  var host=document.getElementById("sources-content");
  if(!host)return;

  // ── Model properties card (top of the tab) ────────────────────────────────
  var mp=DATA.modelProperties||{};
  var culturesLabel=(mp.cultures&&mp.cultures.length>0)?mp.cultures.join(", "):(mp.culture||"\u2014");
  var implicitLabel=mp.discourageImplicitMeasures?"Discouraged":"Allowed";
  var valueFilterLabel=mp.valueFilterBehavior||"Automatic (default)";
  var compatLevel=DATA.compatibilityLevel!=null?DATA.compatibilityLevel:"\u2014";
  var modelDesc=mp.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(mp.description)+'</div>':'';
  var propsRows=
    '<tr><td><strong>Compatibility level</strong></td><td>'+escHtml(String(compatLevel))+'</td></tr>'+
    '<tr><td><strong>Cultures</strong></td><td>'+escHtml(culturesLabel)+'</td></tr>'+
    '<tr><td><strong>Implicit measures</strong></td><td>'+escHtml(implicitLabel)+'</td></tr>'+
    '<tr><td><strong>Value filter behavior</strong></td><td>'+escHtml(valueFilterLabel)+'</td></tr>';
  if(mp.sourceQueryCulture){
    propsRows+='<tr><td><strong>Source query culture</strong></td><td>'+escHtml(mp.sourceQueryCulture)+'</td></tr>';
  }
  if(mp.defaultPowerBIDataSourceVersion){
    propsRows+='<tr><td><strong>Datasource version</strong></td><td>'+escHtml(mp.defaultPowerBIDataSourceVersion)+'</td></tr>';
  }
  var modelPropsCard=
    '<div class="page-card" style="margin-bottom:14px">'+
      '<div class="page-header" style="cursor:default"><div style="flex:1">'+
        '<div class="page-name" style="font-size:14px">Model properties</div>'+
        '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Top-level metadata from <code>model.tmdl</code> / <code>database.tmdl</code> / <code>cultures/</code>. Server and Database name are runtime-only and not stored in the files.</div>'+
        modelDesc+
      '</div></div>'+
      '<div style="padding:0 18px 14px">'+
        '<table class="data-table"><tbody>'+propsRows+'</tbody></table>'+
      '</div>'+
    '</div>';

  var tablesWithSources=visibleTables().filter(function(t){return (t.partitions||[]).length>0;});
  var modeCounts={};
  var totalParts=0;
  tablesWithSources.forEach(function(t){
    (t.partitions||[]).forEach(function(p){
      var m=(p.mode||"import").toLowerCase();
      modeCounts[m]=(modeCounts[m]||0)+1;
      totalParts++;
    });
  });

  var modeChips=Object.keys(modeCounts).sort(function(a,b){return modeCounts[b]-modeCounts[a];}).map(function(m){
    return '<span class="dep-chip" style="background:rgba(59,130,246,.1);color:var(--clr-column);border-color:rgba(59,130,246,.2)">'+modeCounts[m]+'\u00d7 '+escHtml(m)+'</span>';
  }).join('');

  var compatLine=DATA.compatibilityLevel
    ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px">Compatibility level: <strong style="color:var(--text)">'+DATA.compatibilityLevel+'</strong></div>'
    : '';

  var summary=
    '<div class="page-card" style="margin-bottom:14px">'+
      '<div class="page-header" style="cursor:default">'+
        '<div style="flex:1">'+
          '<div class="page-name" style="font-size:14px">Storage modes</div>'+
          '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">'+tablesWithSources.length+' table'+(tablesWithSources.length===1?'':'s')+' with sources · '+totalParts+' partition'+(totalParts===1?'':'s')+'</div>'+
          '<div style="margin-top:8px">'+(modeChips||'<span style="color:var(--text-faint)">None</span>')+'</div>'+
          compatLine+
        '</div>'+
      '</div>'+
    '</div>';

  // Parameters / expressions block
  var exprBlock="";
  if((DATA.expressions||[]).length>0){
    var rows=DATA.expressions.map(function(e){
      var kind=e.kind==="parameter"?"Parameter":"M expression";
      var val=String(e.value||"");
      if(val.length>120)val=val.substring(0,117)+"\u2026";
      var desc=e.description?'<div class="desc-muted" style="margin-top:3px;font-size:11px">'+escHtml(e.description)+'</div>':'';
      return '<tr><td><strong>'+escHtml(e.name)+'</strong>'+desc+'</td><td><span class="field-table">'+kind+'</span></td><td><code style="font-size:11px;color:var(--code-name)">'+escHtml(val)+'</code></td></tr>';
    }).join('');
    exprBlock=
      '<div class="page-card" style="margin-bottom:14px">'+
        '<div class="page-header" style="cursor:default"><div style="flex:1">'+
          '<div class="page-name" style="font-size:14px">Parameters &amp; expressions</div>'+
          '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Top-level M expressions defined in <code>expressions.tmdl</code></div>'+
        '</div></div>'+
        '<div style="padding:0 18px 14px">'+
          '<table class="data-table"><thead><tr><th>Name</th><th>Kind</th><th>Value</th></tr></thead><tbody>'+rows+'</tbody></table>'+
        '</div>'+
      '</div>';
  }

  // Per-table sources
  var perTableBlock="";
  if(tablesWithSources.length>0){
    var sourceRows="";
    tablesWithSources.forEach(function(t){
      (t.partitions||[]).forEach(function(p){
        var loc=p.sourceLocation?'<code style="font-size:11px;color:var(--text-muted);word-break:break-all">'+escHtml(p.sourceLocation)+'</code>':'<span style="color:var(--text-faint)">\u2014</span>';
        sourceRows+=
          '<tr>'+
            '<td><strong>'+escHtml(t.name)+'</strong></td>'+
            '<td><span class="dep-chip" style="background:rgba(34,197,94,.1);color:var(--clr-success);border-color:rgba(34,197,94,.2)">'+escHtml(p.mode||'import')+'</span></td>'+
            '<td><span class="dep-chip" style="background:rgba(168,85,247,.1);color:var(--clr-calc);border-color:rgba(168,85,247,.2)">'+escHtml(p.sourceType||'Unknown')+'</span></td>'+
            '<td>'+loc+'</td>'+
          '</tr>';
      });
    });
    perTableBlock=
      '<div class="page-card">'+
        '<div class="page-header" style="cursor:default"><div style="flex:1">'+
          '<div class="page-name" style="font-size:14px">Per-table sources</div>'+
          '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Source type is inferred from the M code; location is the first string literal in the partition source.</div>'+
        '</div></div>'+
        '<div style="padding:0 18px 14px">'+
          '<table class="data-table"><thead><tr><th>Table</th><th>Mode</th><th>Source type</th><th>Location</th></tr></thead><tbody>'+sourceRows+'</tbody></table>'+
        '</div>'+
      '</div>';
  }

  var sourcesFooter='<div class="panel-footer"><div class="left">'+
    tablesWithSources.length+' source tables'+
    '</div></div>';
  if(tablesWithSources.length===0&&(DATA.expressions||[]).length===0){
    // Even when there's no partition info, show the model properties card.
    host.innerHTML=modelPropsCard+'<div style="text-align:center;padding:40px 20px;color:var(--text-faint);font-size:13px">No partition or expression information found in this model.</div>'+sourcesFooter;
    return;
  }
  host.innerHTML=modelPropsCard+summary+exprBlock+perTableBlock+sourcesFooter;
}

function renderRelationships(){
  const rels=DATA.relationships;
  var activeCount=rels.filter(function(r){return r.isActive;}).length;
  var inactiveCount=rels.length-activeCount;
  var relFooter='<div class="panel-footer"><div class="left">'+
    rels.length+' relationships · '+activeCount+' active · '+inactiveCount+' inactive'+
    '</div></div>';
  if(!rels.length){document.getElementById("relationships-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No relationships found in the model</div>'+relFooter;return;}
  let h='<div class="table-wrap"><table class="data-table"><thead><tr><th>From Table</th><th>From Column</th><th></th><th>To Table</th><th>To Column</th><th>Status</th></tr></thead><tbody>';
  for(const r of rels){
    const statusColor=r.isActive?'var(--clr-success)':'var(--text-faint)';
    const statusLabel=r.isActive?'Active':'Inactive';
    h+=`<tr>
      <td style="font-weight:600">${r.fromTable}</td>
      <td>${r.fromColumn}</td>
      <td style="text-align:center;color:#6B7280;font-size:18px">→</td>
      <td style="font-weight:600">${r.toTable}</td>
      <td>${r.toColumn}</td>
      <td><span style="color:${statusColor};font-size:12px;font-weight:500">${statusLabel}</span></td>
    </tr>`;
  }
  h+='</tbody></table></div>'+relFooter;
  document.getElementById("relationships-content").innerHTML=h;
}

// ─────────────────────────────────────────────────────────────────────
// Source Map — flat row-per-column table mapping PBI columns back to
// their physical source (database / server / source-table). Answers
// the data-engineer question "what breaks if I drop this source
// column?" that the Sources tab (partition-mode-grouped) doesn't
// surface directly. Sortable, searchable, CSV-exportable.
//
// Scope: every user-facing column excluded from Docs (auto-date
// tables + calc-group `Name` columns). Source info is derived from
// the column's table's FIRST partition — typical case for
// single-partition tables. Multi-partition incremental-refresh
// tables show their first partition here; the Sources tab covers
// the full per-partition detail.
// ─────────────────────────────────────────────────────────────────────

let sourceMapSort={key:"table",desc:false};
let sourceMapSearch="";
let sourceMapFilterType="";   // empty = all source types

function sourceMapRows(){
  const tableByName=new Map(DATA.tables.map(t=>[t.name,t]));
  const calcGroupTables=new Set(DATA.calcGroups.map(cg=>cg.name));
  const rows=[];
  for(const c of DATA.columns){
    const tbl=tableByName.get(c.table);
    if(!tbl)continue;
    if(!showAutoDate && tbl.origin==="auto-date")continue;
    if(calcGroupTables.has(tbl.name) && c.name==="Name")continue;  // calc-group internal
    const p=(tbl.partitions||[])[0]||null;
    const mode=p?(p.mode||"import"):(tbl.isCalculatedTable?"calculated":"—");
    const sourceType=p?(p.sourceType||"Unknown / M"):(tbl.isCalculatedTable?"Calculated (DAX)":"—");
    const sourceLocation=p?(p.sourceLocation||""):"";
    rows.push({
      column:c.name,
      table:c.table,
      dataType:c.dataType||"",
      mode:mode,
      sourceType:sourceType,
      sourceLocation:sourceLocation,
      isCalculated:!!c.isCalculated,
      isHidden:!!c.isHidden,
    });
  }
  return rows;
}

function sourceMapRowCount(){
  try{return sourceMapRows().length;}catch(e){return 0;}
}

function renderSourceMap(){
  const host=document.getElementById("sourcemap-content");
  if(!host)return;
  let rows=sourceMapRows();

  // ── Toolbar: filter chips by source type + search + CSV export
  const typeCounts={};
  for(const r of rows){typeCounts[r.sourceType]=(typeCounts[r.sourceType]||0)+1;}
  const typeKeys=Object.keys(typeCounts).sort((a,b)=>typeCounts[b]-typeCounts[a]);
  // Template literals (backticks) are deliberate — string concat of
  // attribute strings would leave quoted pseudo-attribute fragments
  // in the compiled JS script body, which the XSS fuzz test reads as
  // if they were rendered HTML attributes containing raw quotes.
  // Template literals leave no such pseudo-attributes in source.
  const chipAll = `<button data-action="sm-filter-type" data-type="" class="dep-chip${sourceMapFilterType===""?" active":""}" style="cursor:pointer;background:rgba(148,163,184,.1);color:var(--text-body);border-color:rgba(148,163,184,.2)">All ${rows.length}</button>`;
  const chipsTyped = typeKeys.map(t => `<button data-action="sm-filter-type" data-type="${escAttr(t)}" class="dep-chip${sourceMapFilterType===t?" active":""}" style="cursor:pointer;background:rgba(16,185,129,.1);color:var(--clr-source);border-color:rgba(16,185,129,.2)">${escHtml(t)} ${typeCounts[t]}</button>`).join(" ");
  const chips = chipAll + " " + chipsTyped;

  const toolbar =
    `<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">` +
      `<input type="text" id="sm-search" placeholder="Search columns, tables, sources\u2026" value="${escAttr(sourceMapSearch)}" ` +
        `style="flex:1;min-width:220px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:13px">` +
      `<button data-action="sm-export-csv" class="dep-chip" style="cursor:pointer;background:rgba(245,158,11,.1);color:var(--accent);border-color:rgba(245,158,11,.25);padding:8px 14px">\u25bc Export CSV</button>` +
    `</div>` +
    `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>`;

  // ── Apply filter + search + sort
  if(sourceMapFilterType)rows=rows.filter(r=>r.sourceType===sourceMapFilterType);
  if(sourceMapSearch){
    const q=sourceMapSearch.toLowerCase();
    rows=rows.filter(r=>
      r.column.toLowerCase().includes(q)||
      r.table.toLowerCase().includes(q)||
      r.sourceType.toLowerCase().includes(q)||
      r.sourceLocation.toLowerCase().includes(q)||
      r.dataType.toLowerCase().includes(q)
    );
  }
  const s=sourceMapSort;
  rows.sort((a,b)=>{
    const av=(a[s.key]||"").toString().toLowerCase();
    const bv=(b[s.key]||"").toString().toLowerCase();
    if(av<bv)return s.desc?1:-1;
    if(av>bv)return s.desc?-1:1;
    return 0;
  });

  // ── Table
  const arrow=k=>s.key===k?(s.desc?" \u2193":" \u2191"):"";
  const headers=[
    {k:"column",l:"PBI Column"},
    {k:"table",l:"Table"},
    {k:"dataType",l:"Type"},
    {k:"mode",l:"Mode"},
    {k:"sourceType",l:"Source Type"},
    {k:"sourceLocation",l:"Source Location"},
  ];
  const ths = headers.map(h => `<th data-action="sm-sort" data-key="${escAttr(h.k)}" style="cursor:pointer;user-select:none">${h.l}${arrow(h.k)}</th>`).join("");
  let body="";
  if(rows.length===0){
    body='<tr><td colspan="'+headers.length+'" style="text-align:center;padding:24px;color:var(--text-faint)">No columns match the current filter.</td></tr>';
  }else{
    for(const r of rows){
      const flags=[];
      if(r.isHidden)flags.push('<span class="dep-chip" style="background:rgba(100,116,139,.1);color:var(--text-dim);border-color:rgba(100,116,139,.2);padding:1px 7px;font-size:10px">hidden</span>');
      if(r.isCalculated)flags.push('<span class="dep-chip" style="background:rgba(167,139,250,.1);color:var(--clr-upstream);border-color:rgba(167,139,250,.2);padding:1px 7px;font-size:10px">calc</span>');
      body+='<tr>'+
        '<td><code style="color:var(--code-name)">'+escHtml(r.column)+'</code>'+(flags.length?' '+flags.join(" "):'')+'</td>'+
        '<td>'+escHtml(r.table)+'</td>'+
        '<td style="color:var(--text-dim);font-size:12px">'+escHtml(r.dataType)+'</td>'+
        '<td>'+escHtml(r.mode)+'</td>'+
        '<td style="color:var(--clr-source)">'+escHtml(r.sourceType)+'</td>'+
        '<td style="color:var(--text-dim);font-size:12px;word-break:break-all">'+escHtml(r.sourceLocation||"\u2014")+'</td>'+
      '</tr>';
    }
  }

  host.innerHTML=
    toolbar+
    '<div style="overflow-x:auto"><table class="data-table"><thead><tr>'+ths+'</tr></thead><tbody>'+body+'</tbody></table></div>'+
    '<div class="panel-footer"><div class="left">'+rows.length+' of '+sourceMapRowCount()+' rows'+
      (sourceMapFilterType?' \u00b7 filtered by '+escHtml(sourceMapFilterType):'')+
      (sourceMapSearch?' \u00b7 matching "'+escHtml(sourceMapSearch)+'"':'')+
    '</div><div class="right">Sorted by '+s.key+' '+(s.desc?"\u2193":"\u2191")+'</div></div>';

  // Wire search input — done here because renderSourceMap rebuilds innerHTML each call
  const searchEl=document.getElementById("sm-search");
  if(searchEl){
    searchEl.addEventListener("input",function(e){
      sourceMapSearch=e.target.value;
      // Debounce-ish: rerender immediately but preserve cursor
      renderSourceMap();
      const again=document.getElementById("sm-search");
      if(again){again.focus();again.setSelectionRange(sourceMapSearch.length,sourceMapSearch.length);}
    });
  }
}

function sourceMapSortBy(key){
  if(sourceMapSort.key===key)sourceMapSort.desc=!sourceMapSort.desc;
  else{sourceMapSort.key=key;sourceMapSort.desc=false;}
  renderSourceMap();
}
function sourceMapSetFilterType(t){
  sourceMapFilterType=(sourceMapFilterType===t?"":t);
  renderSourceMap();
}
function sourceMapExportCsv(){
  const rows=sourceMapRows();
  // Apply same filter+search as the current view so users export what they see
  const visible=rows.filter(r=>{
    if(sourceMapFilterType && r.sourceType!==sourceMapFilterType)return false;
    if(sourceMapSearch){
      const q=sourceMapSearch.toLowerCase();
      if(!(r.column.toLowerCase().includes(q)||r.table.toLowerCase().includes(q)||
            r.sourceType.toLowerCase().includes(q)||r.sourceLocation.toLowerCase().includes(q)||
            r.dataType.toLowerCase().includes(q)))return false;
    }
    return true;
  });
  const headers=["PBI Column","Table","Data Type","Mode","Source Type","Source Location","Hidden","Calculated"];
  const csvEscape=v=>{
    const s=String(v==null?"":v);
    return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  const lines=[headers.join(",")];
  for(const r of visible){
    lines.push([r.column,r.table,r.dataType,r.mode,r.sourceType,r.sourceLocation,r.isHidden?"yes":"no",r.isCalculated?"yes":"no"].map(csvEscape).join(","));
  }
  const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=(REPORT_NAME||"report")+"-source-map.csv";
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

function renderFunctions(){
  const fns=DATA.functions.filter(f=>!f.name.endsWith('.About'));
  var fnsFooter='<div class="panel-footer"><div class="left">'+fns.length+' function'+(fns.length===1?'':'s')+'</div></div>';
  if(!fns.length){document.getElementById("functions-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No user-defined functions found in the model</div>'+fnsFooter;return;}
  let h='<div style="display:flex;flex-direction:column;gap:12px">';
  for(const f of fns){
    const refMeasures=DATA.measures.filter(m=>m.daxExpression.includes("'"+f.name+"'")||m.daxExpression.includes(f.name+'('));
    const params=f.parameters?f.parameters.split(',').map(p=>{
      const parts=p.trim().split(/\s*:\s*/);
      return parts.length>=2?'<span style="color:var(--code-name)">'+parts[0].trim()+'</span> <span style="color:var(--code-punct)">:</span> <span style="color:var(--code-type)">'+parts.slice(1).join(':').trim()+'</span>':'<span style="color:var(--code-name)">'+p.trim()+'</span>';
    }).join('<span style="color:var(--code-punct)">, </span>'):'<span style="color:var(--code-punct);font-style:italic">none</span>';
    const desc=f.description?'<div style="font-size:11px;color:#64748B;margin-top:6px;line-height:1.4">'+f.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
    const expr=f.expression.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const measureChips=refMeasures.map(m=>`<span class="dep-chip" style="background:rgba(245,158,11,.1);color:var(--clr-measure);border-color:rgba(245,158,11,.2);cursor:pointer" data-action="lineage" data-type="measure" data-name="${escAttr(m.name)}">${escHtml(m.name)}</span>`).join('');
    h+=`<div class="page-card">
      <div class="page-header" data-action="card-toggle">
        <div style="flex:1">
          <div class="page-name" style="font-size:14px">${escHtml(f.name)}</div>
          <div style="font-size:11px;color:#64748B;margin-top:2px;font-family:'JetBrains Mono',monospace">( ${params} )</div>
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-measure)">${refMeasures.length}</div><div class="page-stat-label">Measures</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        ${desc}
        ${refMeasures.length?`<div style="margin-top:8px"><div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px">Measures using this function</div><div style="display:flex;flex-wrap:wrap;gap:4px">${measureChips}</div></div>`:''}
        <div class="lineage-dax" style="margin-top:8px;max-height:300px;overflow-y:auto">${expr}</div>
      </div></div>
    </div>`;
  }
  h+='</div>'+fnsFooter;
  document.getElementById("functions-content").innerHTML=h;
}

function renderCalcGroups(){
  const cgs=DATA.calcGroups;
  var cgsFooter='<div class="panel-footer"><div class="left">'+cgs.length+' calc group'+(cgs.length===1?'':'s')+'</div></div>';
  if(!cgs.length){document.getElementById("calcgroups-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No calculation groups found in the model</div>'+cgsFooter;return;}
  let h='<div style="display:flex;flex-direction:column;gap:12px">';
  for(const cg of cgs){
    const desc=cg.description?'<div style="font-size:11px;color:var(--text-dim);margin-top:4px">'+cg.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
    let items='';
    for(const item of cg.items){
      const expr=item.expression.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const fmtBadge=item.formatStringExpression?'<span class="mono" style="margin-left:8px;font-size:10px;color:var(--text-dim)">fmt: '+item.formatStringExpression.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>':'';
      const itemDesc=item.description?'<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">'+item.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
      items+=`<div class="ci-card">
        <div class="ci-head">
          <span class="ci-ord">${item.ordinal}</span>
          <span class="ci-name">${item.name}</span>${fmtBadge}
        </div>${itemDesc}
        <div class="lineage-dax" style="font-size:12px">${expr}</div>
      </div>`;
    }
    h+=`<div class="page-card">
      <div class="page-header" data-action="card-toggle">
        <div style="flex:1">
          <div class="page-name" style="font-size:14px">${escHtml(cg.name)}</div>
          ${desc}
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:var(--clr-upstream)">${cg.items.length}</div><div class="page-stat-label">Items</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#64748B">${cg.precedence}</div><div class="page-stat-label">Precedence</div></div>
        </div>
        <span class="page-expand" aria-hidden="true"></span>
      </div>
      <div class="page-body"><div class="page-body-inner">${items}</div></div>
    </div>`;
  }
  h+='</div>'+cgsFooter;
  document.getElementById("calcgroups-content").innerHTML=h;
}

function sortTable(t,k){const s=sortState[t];if(s.key===k)s.desc=!s.desc;else{s.key=k;s.desc=true;}t==="measures"?renderMeasures():renderColumns();}
function filterTable(t,v){searchTerms[t]=v;t==="measures"?renderMeasures():renderColumns();}
function toggleUnused(t){showUnusedOnly[t]=!showUnusedOnly[t];document.getElementById("btn-unused-"+(t==="measures"?"m":"c")).classList.toggle("active");t==="measures"?renderMeasures():renderColumns();}

function currentMd(){
  switch(activeMd){
    case "datadict":     return MARKDOWN_DATADICT;
    case "measures":     return MARKDOWN_MEASURES;
    case "functions":    return MARKDOWN_FUNCTIONS;
    case "calcgroups":   return MARKDOWN_CALCGROUPS;
    case "sources":      return MARKDOWN_SOURCES;
    case "pages":        return MARKDOWN_PAGES;
    case "index":        return MARKDOWN_INDEX;
    case "improvements": return MARKDOWN_IMPROVEMENTS;
    default:             return MARKDOWN;
  }
}
function currentMdFilename(){
  var suffix="-semantic-model.md";
  if(activeMd==="datadict")          suffix="-data-dictionary.md";
  else if(activeMd==="measures")     suffix="-measures.md";
  else if(activeMd==="functions")    suffix="-functions.md";
  else if(activeMd==="calcgroups")   suffix="-calculation-groups.md";
  else if(activeMd==="sources")      suffix="-sources.md";
  else if(activeMd==="pages")        suffix="-pages.md";
  else if(activeMd==="index")        suffix="-index.md";
  else if(activeMd==="improvements") suffix="-improvements.md";
  return REPORT_NAME+suffix;
}

function switchMd(which){
  activeMd=which;
  var ids=["model","datadict","measures","functions","calcgroups","sources","pages","index","improvements"];
  ids.forEach(function(id){
    var el=document.getElementById("md-tab-"+id);
    if(el)el.classList.toggle("active",which===id);
  });
  var sub=document.getElementById("md-subtitle");
  if(sub){
    if(which==="datadict")          sub.textContent="Data dictionary reference \u00b7 per-table columns, constraints, hierarchies (no DAX expressions)";
    else if(which==="measures")     sub.textContent="Measures reference \u00b7 A\u2013Z alphabetical (no DAX expressions)";
    else if(which==="functions")    sub.textContent="Functions reference \u00b7 per-UDF parameters, descriptions and bodies";
    else if(which==="calcgroups")   sub.textContent="Calculation groups reference \u00b7 per-item descriptions and bodies";
    else if(which==="sources")      sub.textContent="Data sources catalog \u00b7 connections, partition modes, field parameters, composite-model proxies";
    else if(which==="pages")        sub.textContent="Report pages \u00b7 per-page visual catalog with type, title, and field bindings";
    else if(which==="index")        sub.textContent="Model glossary \u00b7 alphabetical index of every named entity";
    else if(which==="improvements") sub.textContent="Areas of improvement \u00b7 prioritized action items with rationale (not a score)";
    else                            sub.textContent="Semantic-model documentation (no DAX expressions)";
  }
  renderDocs();
}

function switchMdMode(mode){
  mdViewMode=mode;
  var rb=document.getElementById("md-mode-rendered");
  var wb=document.getElementById("md-mode-raw");
  if(rb)rb.classList.toggle("active",mode==="rendered");
  if(wb)wb.classList.toggle("active",mode==="raw");
  var rendered=document.getElementById("md-rendered");
  var source=document.getElementById("md-source");
  if(rendered)rendered.style.display=mode==="rendered"?"":"none";
  if(source)source.style.display=mode==="raw"?"":"none";
  renderDocs();
}

function expandAllDetails(){
  var host=document.getElementById("md-rendered");
  if(!host)return;
  host.querySelectorAll("details").forEach(function(d){d.open=true;});
}
function collapseAllDetails(){
  var host=document.getElementById("md-rendered");
  if(!host)return;
  host.querySelectorAll("details").forEach(function(d){d.open=false;});
}

// ─── Markdown renderer ────────────────────────────────────────────────────
// The mdEscapeHtml / mdInline / mdParseTable / mdRender quartet lives in
// src/client/render/md.ts now (Stop 5 pass 2). That file is a separate
// TypeScript SCRIPT (no imports, no exports) that gets compiled next to
// this one and concatenated into the same inline <script> block by the
// server-side generator. The symbols are therefore visible at runtime as
// top-level globals, same as if they were still inline here.

function renderDocs(){
  var src=document.getElementById("md-source");
  var rendered=document.getElementById("md-rendered");
  var md=currentMd();
  if(src)src.textContent=md;
  if(rendered){
    rendered.innerHTML=mdRender(md)+
      '<hr style="border:none;border-top:1px dashed var(--border-soft);margin:18px 0 10px">'+
      '<div style="font:11px/1.5 \'JetBrains Mono\',monospace;color:var(--text-faint);text-align:center">'+
        'Generated by Power BI Lineage v'+APP_VERSION+' · '+GENERATED_AT+' · '+escHtml(REPORT_NAME)+
      '</div>';
    // Colourise any ```dax fenced blocks that mdRender produced —
    // they land as <pre><code class="language-dax"> which the
    // highlighter targets by default.
    highlightDaxBlocks();
  }
  // Docs panel footer (outside .md-rendered) shows line / char totals.
  var lineCount=md?md.split(/\r?\n/).length:0;
  setPanelFooter("footer-docs",
    lineCount+' lines · generated '+GENERATED_AT,
    (md?md.length:0)+' chars');
}

function copyMarkdown(){
  var btn=document.getElementById("md-copy-btn");
  var text=currentMd();
  function ok(){if(btn){btn.textContent="✓ Copied";setTimeout(function(){btn.textContent="⎘ Copy";},1500);}}
  function fallback(){
    var ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();
    var ok2=false;try{ok2=document.execCommand("copy");}catch(e){}
    document.body.removeChild(ta);
    if(ok2)ok();else if(btn){btn.textContent="✗ Failed";setTimeout(function(){btn.textContent="⎘ Copy";},1500);}
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(ok).catch(fallback);
  }else{fallback();}
}

function downloadMarkdown(){
  var text=currentMd();
  var blob=new Blob([text],{type:"text/markdown;charset=utf-8"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url;a.download=currentMdFilename();
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

renderSummary();renderTabs();renderMeasures();renderColumns();renderTables();renderRelationships();renderSources();renderSourceMap();renderFunctions();renderCalcGroups();renderPages();renderUnused();renderDocs();switchTab("measures");addCopyButtons();

// ─────────────────────────────────────────────────────────────────────
// Browser-mode bootstrap hook
//
// The CLI inlines this script with a full DATA payload baked in and
// never calls this function. Browser mode ships an empty shell, lets
// the folder picker (or "Try a sample") produce a fresh FullData,
// then calls this hook to swap it in and re-render.
//
// Why this lives here: DATA / MARKDOWN_* / REPORT_NAME / GENERATED_AT
// are top-level `let` bindings in this script's Script scope. Module
// code (entry.ts) can't reach them, and `window.DATA = …` creates a
// different variable the renderers don't see. Declaring this helper
// in the same Script scope gives us reach; attaching it to `window`
// makes it callable from the entry module.
//
// DATA and pageData are mutated in place so the `const pageData` at
// line ~101 keeps its reference. Primitive lets (strings) are
// reassigned directly — the renderers read them fresh each call.
(window as unknown as { __loadBrowserData?: Function }).__loadBrowserData =
function __loadBrowserData(opts: {
  data: typeof DATA;
  reportName: string;
  generatedAt: string;
  appVersion: string;
  markdown?: {
    md?: string;
    measuresMd?: string;
    functionsMd?: string;
    calcGroupsMd?: string;
    dataDictionaryMd?: string;
    sourcesMd?: string;
    pagesMd?: string;
    indexMd?: string;
    improvementsMd?: string;
  };
}) {
  // Clear + repopulate DATA in place so closures (e.g., pageData
  // derived at module load) and all bare-DATA references pick up
  // the new fields.
  for (const k of Object.keys(DATA)) delete (DATA as Record<string, unknown>)[k];
  Object.assign(DATA, opts.data);

  // pageData is `const` inside this script — can't reassign, but can
  // mutate length + refill with the new pages.
  pageData.length = 0;
  const newPages = opts.data.pages || [];
  for (const p of newPages) pageData.push(p);

  // Reassign primitive lets so subsequent render calls see new values.
  REPORT_NAME = opts.reportName;
  GENERATED_AT = opts.generatedAt;
  APP_VERSION = opts.appVersion;
  if (opts.markdown) {
    if (typeof opts.markdown.md === "string") MARKDOWN = opts.markdown.md;
    if (typeof opts.markdown.measuresMd === "string") MARKDOWN_MEASURES = opts.markdown.measuresMd;
    if (typeof opts.markdown.functionsMd === "string") MARKDOWN_FUNCTIONS = opts.markdown.functionsMd;
    if (typeof opts.markdown.calcGroupsMd === "string") MARKDOWN_CALCGROUPS = opts.markdown.calcGroupsMd;
    if (typeof opts.markdown.dataDictionaryMd === "string") MARKDOWN_DATADICT = opts.markdown.dataDictionaryMd;
    if (typeof opts.markdown.sourcesMd === "string") MARKDOWN_SOURCES = opts.markdown.sourcesMd;
    if (typeof opts.markdown.pagesMd === "string") MARKDOWN_PAGES = opts.markdown.pagesMd;
    if (typeof opts.markdown.indexMd === "string") MARKDOWN_INDEX = opts.markdown.indexMd;
    if (typeof opts.markdown.improvementsMd === "string") MARKDOWN_IMPROVEMENTS = opts.markdown.improvementsMd;
  }

  // Refresh every piece of chrome baked at build time that shows the
  // report name or timestamp. Two distinct header layouts exist:
  //   • `.header-sub` — the big "Usage Map | <name>" heading at the
  //     top-left of the page (the one users actually see).
  //   • `.rb-report` — a secondary bar below it, present in some
  //     layouts, hidden in others. Updated too for resilience.
  // Silent-no-op if a selector isn't in the current layout.
  const headerSubEl = document.querySelector<HTMLElement>(".header-sub");
  if (headerSubEl) headerSubEl.textContent = opts.reportName;
  const reportEl = document.querySelector<HTMLElement>(".rb-report");
  if (reportEl) reportEl.textContent = opts.reportName;
  const tsEl = document.querySelector<HTMLElement>(".timestamp");
  if (tsEl) tsEl.textContent = "Generated: " + opts.generatedAt;
  const timerEl = document.querySelector<HTMLElement>(".rb-center .timer");
  if (timerEl) timerEl.textContent = "Last scan " + opts.generatedAt;
  document.title = opts.reportName + " — Power BI Documenter";

  // Re-run every renderer in the same order as the initial bootstrap.
  renderSummary(); renderTabs(); renderMeasures(); renderColumns();
  renderTables(); renderRelationships(); renderSources(); renderSourceMap();
  renderFunctions(); renderCalcGroups(); renderPages();
  renderUnused(); renderDocs();
  switchTab("measures");
  addCopyButtons();
};
