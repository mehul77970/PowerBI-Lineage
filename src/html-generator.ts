import type { FullData } from "./data-builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// HTML Dashboard Generation
// ═══════════════════════════════════════════════════════════════════════════════

export function generateHTML(data: FullData, reportName: string, markdown: string = ""): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  // JSON.stringify safely escapes the markdown for embedding in the JS const.
  const markdownLiteral = JSON.stringify(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Model Usage - ${reportName}</title>
<script>(function(){try{var t=localStorage.getItem('usage-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{
    --bg:#0B0D11;--surface:#1A1D27;--surface-alt:#12141A;--surface-deep:#12141C;--surface-center:#14161C;
    --border:#2A2D3A;--border-soft:#1E2028;--border-row:#1A1D27;
    --text:#F8FAFC;--text-body:#E2E8F0;--text-muted:#94A3B8;--text-dim:#7A8595;--text-faint:#5E6A7B;--text-fainter:#4A5566;
    --row-hover:#1A1D27;--hover-border:#475569;
    --chip-dep-bg:rgba(139,92,246,.1);--chip-dep-bd:rgba(139,92,246,.2);--chip-dep-tx:#A78BFA;--chip-dep-hover:rgba(139,92,246,.2);
    --chip-used-bg:rgba(59,130,246,.1);--chip-used-bd:rgba(59,130,246,.15);--chip-used-tx:#93C5FD;
    --code-name:#93C5FD;--code-type:#A78BFA;--code-punct:#475569;
    --accent:#3B82F6;
  }
  [data-theme="light"]{
    --bg:#F8FAFC;--surface:#FFFFFF;--surface-alt:#F1F5F9;--surface-deep:#FFFFFF;--surface-center:#FFFBEB;
    --border:#E2E8F0;--border-soft:#F1F5F9;--border-row:#F1F5F9;
    --text:#0F172A;--text-body:#1E293B;--text-muted:#475569;--text-dim:#64748B;--text-faint:#94A3B8;--text-fainter:#CBD5E1;
    --row-hover:#F1F5F9;--hover-border:#94A3B8;
    --chip-dep-bg:rgba(139,92,246,.08);--chip-dep-bd:rgba(139,92,246,.3);--chip-dep-tx:#6D28D9;--chip-dep-hover:rgba(139,92,246,.15);
    --chip-used-bg:rgba(59,130,246,.08);--chip-used-bd:rgba(59,130,246,.25);--chip-used-tx:#1D4ED8;
    --code-name:#1D4ED8;--code-type:#6D28D9;--code-punct:#94A3B8;
    --accent:#2563EB;
  }
  body{font-family:'DM Sans',system-ui,sans-serif;background:var(--bg);color:var(--text-body);min-height:100vh;transition:background .2s,color .2s}
  .mono{font-family:'JetBrains Mono',monospace}
  .container{max-width:1400px;margin:0 auto;padding:20px 24px}
  .tab{white-space:nowrap}
  .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
  .header-left .top{display:flex;align-items:center;gap:8px}
  .header-label{font-size:13px;color:var(--accent);font-weight:700;font-family:'JetBrains Mono',monospace}
  .header-sep{font-size:13px;color:var(--text-fainter)}
  .header-sub{font-size:13px;color:var(--text-dim)}
  .timestamp{font-size:10px;color:var(--text-fainter);font-family:'JetBrains Mono',monospace;margin-top:4px}
  .header-actions{display:flex;gap:6px;align-items:center}
  .theme-btn{padding:6px 10px;font-size:13px;line-height:1;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:var(--surface);color:var(--text-dim);transition:all .15s}
  .theme-btn:hover{background:var(--border);color:var(--text);border-color:var(--accent)}
  .refresh-btn{padding:6px 14px;font-size:11px;font-family:'JetBrains Mono',monospace;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:var(--surface);color:var(--text-dim);transition:all .15s}
  .refresh-btn:hover{background:var(--border);color:var(--text);border-color:var(--accent)}
  .summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px}
  .stat-detail{font-size:10px;color:var(--text-faint);margin-top:2px;font-family:'JetBrains Mono',monospace}
  .stat{background:var(--surface);border-radius:8px;border:1px solid var(--border);padding:12px 14px;text-align:center}
  .stat-value{font-size:22px;font-weight:700;color:var(--text)}
  .stat-value.good{color:#22C55E}.stat-value.warn{color:#F59E0B}.stat-value.danger{color:#EF4444}
  .stat-label{font-size:10px;color:var(--text-dim);margin-top:2px;text-transform:uppercase;letter-spacing:.06em}
  .tabs{display:flex;gap:2px;margin-bottom:16px;border-bottom:1px solid var(--border-soft)}
  .tab{padding:8px 16px;font-size:13px;border:none;border-bottom:2px solid transparent;cursor:pointer;background:none;color:var(--text-dim);font-family:inherit;font-weight:500;transition:all .15s}
  .tab.active{color:var(--text);border-bottom-color:var(--accent)}
  .tab:hover:not(.active){color:var(--text-muted)}
  .tab .badge{font-size:10px;background:var(--border);color:var(--text-muted);padding:1px 6px;border-radius:10px;margin-left:6px;font-family:'JetBrains Mono',monospace}
  .tab .badge.warn{background:rgba(245,158,11,.15);color:#F59E0B}
  .panel{display:none}.panel.active{display:block}
  .search-row{display:flex;gap:10px;margin-bottom:14px;align-items:center}
  .search-input{flex:1;padding:7px 12px;font-size:13px;font-family:inherit;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text-body);outline:none;transition:border-color .15s}
  .search-input:focus{border-color:var(--accent)}
  .search-input::placeholder{color:var(--text-faint)}
  .filter-btn{padding:6px 12px;font-size:11px;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:var(--surface);color:var(--text-dim);font-family:inherit;transition:all .15s}
  .filter-btn:hover,.filter-btn.active{background:var(--border);color:var(--text)}
  .filter-btn.active{border-color:var(--accent);color:var(--accent)}
  .data-table{width:100%;border-collapse:collapse}
  .data-table th{text-align:left;padding:8px 12px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--border);font-weight:600;cursor:pointer;user-select:none;white-space:nowrap}
  .data-table th:hover{color:var(--text-muted)}
  .data-table td{padding:8px 12px;font-size:13px;border-bottom:1px solid var(--border-row);vertical-align:top}
  .data-table tr{transition:background .1s}
  .data-table tr:hover{background:var(--row-hover)}
  .data-table tr.unused{opacity:.5}
  .data-table tr.unused td:first-child{border-left:3px solid #EF4444;padding-left:9px}
  .data-table tr.indirect{opacity:.7}
  .data-table tr.indirect td:first-child{border-left:3px solid #F59E0B;padding-left:9px}
  .field-name{font-weight:600;color:var(--text);cursor:pointer;transition:color .15s;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px}
  .field-name:hover{color:var(--accent);text-decoration-color:var(--accent)}
  .field-table{font-size:11px;color:var(--text-dim);font-family:'JetBrains Mono',monospace}
  .usage-count{font-family:'JetBrains Mono',monospace;font-weight:600}
  .usage-count.zero{color:#EF4444}.usage-count.low{color:#F59E0B}.usage-count.good{color:#22C55E}
  .dep-chip{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;margin:1px 2px;font-family:'JetBrains Mono',monospace;background:var(--chip-dep-bg);color:var(--chip-dep-tx);border:1px solid var(--chip-dep-bd);cursor:pointer;transition:all .15s}
  .dep-chip:hover{background:var(--chip-dep-hover);border-color:var(--chip-dep-tx)}
  .used-chip{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;margin:1px 2px;background:var(--chip-used-bg);color:var(--chip-used-tx);border:1px solid var(--chip-used-bd)}
  .slicer-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(236,72,153,.12);color:#EC4899;font-weight:600;margin-left:4px}
  .hidden-badge{font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(139,92,246,.15);color:#A78BFA;border:1px solid rgba(139,92,246,.3);font-weight:600;letter-spacing:.05em;margin-left:8px;vertical-align:middle;cursor:help}
  [data-theme="light"] .hidden-badge{background:rgba(139,92,246,.1);color:#6D28D9;border-color:rgba(139,92,246,.35)}
  .pk-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,.15);color:#F59E0B;border:1px solid rgba(245,158,11,.3);font-weight:700;letter-spacing:.05em;margin-left:6px;vertical-align:middle;font-family:'JetBrains Mono',monospace}
  .fk-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(59,130,246,.12);color:#3B82F6;border:1px solid rgba(59,130,246,.28);font-weight:700;letter-spacing:.05em;margin-left:6px;vertical-align:middle;font-family:'JetBrains Mono',monospace}
  .hid-col-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(100,116,139,.12);color:var(--text-dim);border:1px solid rgba(100,116,139,.25);font-weight:600;margin-left:6px;vertical-align:middle;font-family:'JetBrains Mono',monospace}
  .calc-col-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(168,85,247,.12);color:#A855F7;border:1px solid rgba(168,85,247,.28);font-weight:600;margin-left:6px;vertical-align:middle;font-family:'JetBrains Mono',monospace}
  [data-theme="light"] .pk-badge{background:rgba(245,158,11,.1);color:#B45309;border-color:rgba(245,158,11,.35)}
  [data-theme="light"] .fk-badge{background:rgba(59,130,246,.08);color:#1D4ED8;border-color:rgba(59,130,246,.3)}
  [data-theme="light"] .calc-col-badge{background:rgba(168,85,247,.08);color:#7E22CE;border-color:rgba(168,85,247,.3)}

  .tcol-row{display:grid;grid-template-columns:1fr 140px 220px;gap:12px;padding:6px 10px;border-radius:6px;align-items:center;font-size:12px;border-bottom:1px solid var(--border-row)}
  .tcol-row:last-child{border-bottom:none}
  .tcol-row:hover{background:var(--surface-alt)}
  .tcol-name{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-body);font-weight:500;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tcol-name:hover{color:var(--accent)}
  .tcol-type{font-size:11px;color:var(--text-dim);font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tcol-fk{font-size:11px;font-family:'JetBrains Mono',monospace;line-height:1.6;white-space:normal;overflow:hidden}
  .tcol-fk .arrow{color:var(--text-faint);margin:0 4px}
  .tcol-fk .rel-out{color:#22C55E}
  .tcol-fk .rel-in{color:var(--chip-used-tx)}
  .tcol-fk .rel-inactive{opacity:.55;font-style:italic}
  [data-theme="light"] .tcol-fk .rel-out{color:#15803D}
  .pk-badge.inferred{background:transparent;color:#F59E0B;border:1px dashed rgba(245,158,11,.5)}
  [data-theme="light"] .pk-badge.inferred{color:#B45309;border-color:rgba(245,158,11,.55)}
  .trel-row{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--text-body)}
  .trel-row:hover{background:var(--surface-alt)}
  .trel-dir{font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
  .trel-dir.out{background:rgba(34,197,94,.12);color:#22C55E;border:1px solid rgba(34,197,94,.3)}
  .trel-dir.in{background:rgba(59,130,246,.12);color:#3B82F6;border:1px solid rgba(59,130,246,.3)}
  .trel-inactive{opacity:.55;font-style:italic}
  .calc-group-pill{font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(236,72,153,.12);color:#EC4899;border:1px solid rgba(236,72,153,.3);font-weight:600;letter-spacing:.05em;margin-left:8px;vertical-align:middle}
  .format-str{font-size:11px;color:var(--text-faint);font-family:'JetBrains Mono',monospace}

  .lineage-back{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);cursor:pointer;margin-bottom:16px;transition:color .15s}
  .lineage-back:hover{color:var(--accent)}
  .lineage-hero{background:var(--surface);border-radius:10px;border:1px solid var(--border);padding:20px;margin-bottom:16px}
  .lineage-hero-title{font-size:20px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:10px}
  .lineage-hero-title .dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
  .lineage-hero-meta{font-size:12px;color:var(--text-dim);margin-top:6px;font-family:'JetBrains Mono',monospace}
  .lineage-dax{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-muted);background:var(--surface-alt);padding:10px 12px;border-radius:6px;border:1px solid var(--border);margin-top:12px;white-space:pre-wrap;word-break:break-all;line-height:1.6}

  .lineage-flow-row{display:flex;gap:0;align-items:flex-start}
  .lineage-flow-col{flex:1;display:flex;flex-direction:column;gap:6px;padding:0 8px}
  .lineage-flow-col-label{font-size:10px;color:var(--text-fainter);text-transform:uppercase;letter-spacing:.08em;text-align:center;margin-bottom:6px;font-weight:600}
  .lineage-arrow-col{display:flex;align-items:flex-start;justify-content:center;color:var(--text-fainter);font-size:18px;flex-shrink:0;width:32px;padding-top:36px}

  .lc{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;transition:all .15s}
  .lc:hover{border-color:var(--hover-border)}
  .lc.clickable{cursor:pointer}
  .lc.clickable:hover{border-color:var(--accent)}
  .lc .lc-name{font-size:13px;font-weight:600;color:var(--text)}
  .lc .lc-sub{font-size:10px;color:var(--text-dim);font-family:'JetBrains Mono',monospace;margin-top:2px}
  .lc .lc-role{font-size:10px;color:var(--text-faint);margin-top:3px}
  .lc.upstream{border-left:3px solid #A78BFA}
  .lc.source{border-left:3px solid #10B981}
  .lc.center{border-left:3px solid #F59E0B;background:var(--surface-center)}
  .lc.center.col-type{border-left-color:var(--accent)}
  .lc.downstream{border-left:3px solid #8B5CF6}
  .lc.empty{border-style:dashed;opacity:.4}
  .lc.udf{border-left:3px solid #14B8A6}
  .lc.feeds{border-left:3px solid #F59E0B;background:rgba(245,158,11,.04)}

  .feeds-label{font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-top:10px;margin-bottom:4px;font-weight:600}

  .page-card{background:var(--surface);border-radius:10px;border:1px solid var(--border);margin-bottom:12px;overflow:hidden;transition:border-color .15s}
  .page-card:hover{border-color:var(--hover-border)}
  .page-header{padding:14px 18px;cursor:pointer;display:flex;align-items:center;gap:14px;user-select:none}
  .page-name{font-size:16px;font-weight:700;color:var(--text);flex:1}
  .page-stats{display:flex;gap:12px;align-items:center}
  .page-stat{text-align:center}
  .page-stat-val{font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace}
  .page-stat-label{font-size:9px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em}
  .page-expand{color:var(--text-faint);font-size:12px;transition:transform .2s;flex-shrink:0}
  .page-card.open .page-expand{transform:rotate(180deg)}
  .page-body{max-height:0;overflow:hidden;transition:max-height .3s ease}
  .page-card.open .page-body{max-height:2000px}
  .page-body-inner{padding:0 18px 16px}
  .page-section{margin-bottom:12px}
  .page-section-title{font-size:10px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px}
  .page-section-title .line{flex:1;height:1px;background:var(--border-soft)}
  .page-visual-row{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:6px;transition:background .1s;margin-bottom:2px}
  .page-visual-row:hover{background:var(--surface-alt)}
  .page-visual-type{font-size:11px;color:var(--text-dim);font-family:'JetBrains Mono',monospace;width:150px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .page-visual-title{font-size:13px;font-weight:600;color:var(--text-body);flex:0 0 220px;min-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .page-visual-bindings{display:flex;flex-wrap:wrap;gap:3px}
  .page-type-summary{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .page-type-chip{font-size:10px;padding:3px 8px;border-radius:4px;background:var(--surface-alt);color:var(--text-muted);border:1px solid var(--border);font-family:'JetBrains Mono',monospace}

  .ci-card{padding:10px 12px;border-radius:6px;background:var(--surface-alt);border:1px solid var(--border);margin-bottom:6px}
  .ci-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .ci-ord{font-size:11px;color:var(--text-faint);font-weight:600;min-width:20px}
  .ci-name{font-size:13px;font-weight:600;color:var(--text-body)}

  .desc-line{font-size:11px;color:var(--text-dim);font-style:italic;margin-top:3px;line-height:1.4}
  .desc-muted{font-size:11px;color:var(--text-faint);line-height:1.4}
  .field-name[data-desc]{cursor:help}

  .has-tip{position:relative;cursor:help}
  .has-tip::after{content:attr(data-tooltip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--surface);color:var(--text);border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:11px;font-weight:400;white-space:normal;width:max-content;max-width:240px;text-align:left;pointer-events:none;opacity:0;transition:opacity .15s;z-index:1000;box-shadow:0 8px 24px rgba(0,0,0,.4);line-height:1.5;text-transform:none;letter-spacing:0}
  .has-tip::before{content:"";position:absolute;bottom:calc(100% + 2px);left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:var(--border);pointer-events:none;opacity:0;transition:opacity .15s;z-index:1000}
  .has-tip:hover::after,.has-tip:hover::before{opacity:1}
  .summary .stat.has-tip:first-child::after{left:0;transform:none}
  .summary .stat.has-tip:first-child::before{left:24px}
  .summary .stat.has-tip:last-child::after{left:auto;right:0;transform:none}
  .summary .stat.has-tip:last-child::before{left:auto;right:24px;transform:none}

  .lineage-dax{position:relative}
  .copy-btn{position:absolute;top:6px;right:6px;width:24px;height:24px;padding:0;font-size:12px;line-height:1;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:var(--surface);color:var(--text-dim);opacity:0;transition:all .15s;font-family:'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center}
  .lineage-dax:hover .copy-btn{opacity:1}
  .copy-btn:hover{color:var(--text);background:var(--border);border-color:var(--accent)}
  .copy-btn.copied{color:#22C55E;border-color:#22C55E;opacity:1}

  .refresh-bar{position:fixed;bottom:0;left:0;right:0;height:28px;background:var(--surface-deep);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:12px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--text-dim);z-index:999}
  .refresh-bar .timer{color:var(--text-muted)}
  .refresh-bar .dot{width:6px;height:6px;border-radius:50%;background:var(--text-fainter);display:inline-block}
  .refresh-bar .dot.stale{background:#F59E0B}
  .refresh-bar button{padding:2px 10px;font-size:10px;font-family:'JetBrains Mono',monospace;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:var(--surface);color:var(--text-dim);transition:all .15s}
  .refresh-bar button:hover{background:var(--border);color:var(--text);border-color:var(--accent)}

  .md-source{font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.55;color:var(--text-body);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 18px;white-space:pre-wrap;word-break:break-word;max-height:72vh;overflow:auto;tab-size:2}
  .md-source::-webkit-scrollbar{width:10px;height:10px}
  .md-source::-webkit-scrollbar-thumb{background:var(--border);border-radius:5px}

  @media(max-width:768px){.summary{grid-template-columns:repeat(3,1fr)}.lineage-flow-row{flex-direction:column}.lineage-arrow-col{transform:rotate(90deg);padding:8px 0;width:100%}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="header-left">
      <div class="top"><span class="header-label">MODEL USAGE</span><span class="header-sep">|</span><span class="header-sub">${reportName}</span></div>
      <div class="timestamp">Generated: ${ts}</div>
    </div>
    <div class="header-actions">
      <button class="theme-btn" id="theme-btn" onclick="toggleTheme()" title="Toggle light/dark theme" aria-label="Toggle theme">☾</button>
      <button class="refresh-btn" onclick="location.reload()">↻ Refresh</button>
    </div>
  </div>
  <div class="summary" id="summary"></div>
  <div class="tabs" id="tabs"></div>

  <div class="panel" id="panel-measures">
    <div class="search-row">
      <input class="search-input" placeholder="Search measures..." oninput="filterTable('measures',this.value)">
      <button class="filter-btn" id="btn-unused-m" onclick="toggleUnused('measures')">Not on visual</button>
    </div>
    <table class="data-table"><thead><tr>
      <th onclick="sortTable('measures','name')">Measure ↕</th><th onclick="sortTable('measures','table')">Table ↕</th>
      <th onclick="sortTable('measures','usageCount')">Used ↕</th><th onclick="sortTable('measures','pageCount')">Pages ↕</th>
      <th>Dependencies</th><th>Used In</th><th>Format</th>
    </tr></thead><tbody id="tbody-measures"></tbody></table>
  </div>

  <div class="panel" id="panel-columns">
    <div class="search-row">
      <input class="search-input" placeholder="Search columns..." oninput="filterTable('columns',this.value)">
      <button class="filter-btn" id="btn-unused-c" onclick="toggleUnused('columns')">Not on visual</button>
    </div>
    <table class="data-table"><thead><tr>
      <th onclick="sortTable('columns','name')">Column ↕</th><th onclick="sortTable('columns','table')">Table ↕</th>
      <th onclick="sortTable('columns','dataType')">Type ↕</th><th onclick="sortTable('columns','usageCount')">Used ↕</th>
      <th onclick="sortTable('columns','pageCount')">Pages ↕</th><th>Used In</th>
    </tr></thead><tbody id="tbody-columns"></tbody></table>
  </div>

  <div class="panel" id="panel-tables"><div id="tables-content"></div></div>
  <div class="panel" id="panel-relationships"><div id="relationships-content"></div></div>
  <div class="panel" id="panel-functions"><div id="functions-content"></div></div>
  <div class="panel" id="panel-calcgroups"><div id="calcgroups-content"></div></div>
  <div class="panel" id="panel-pages"><div id="pages-content"></div></div>
  <div class="panel" id="panel-lineage"><div id="lineage-content"></div></div>
  <div class="panel" id="panel-unused"><div id="unused-content"></div></div>
  <div class="panel" id="panel-docs">
    <div class="search-row">
      <div style="flex:1;color:var(--text-dim);font-size:12px">Semantic-model documentation · Markdown source (no DAX)</div>
      <button class="filter-btn" id="md-copy-btn" onclick="copyMarkdown()">⎘ Copy</button>
      <button class="filter-btn" onclick="downloadMarkdown()">⤓ Download</button>
    </div>
    <pre id="md-source" class="md-source"></pre>
  </div>
</div>

<script>
const DATA=${JSON.stringify(data)};
const MARKDOWN=${markdownLiteral};
const REPORT_NAME=${JSON.stringify(reportName)};

function escHtml(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function escAttr(s){return escHtml(s);}

function toggleTheme(){
  var cur=document.documentElement.getAttribute('data-theme')||'dark';
  var next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  try{localStorage.setItem('usage-theme',next);}catch(e){}
  var btn=document.getElementById('theme-btn');
  if(btn)btn.textContent=next==='dark'?'☾':'☀';
}

function addCopyButtons(){
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

const pageData=(()=>{
  const map=new Map();
  const addToPage=(pageName,visualType,visualTitle,fieldName,fieldTable,fieldType)=>{
    if(!map.has(pageName))map.set(pageName,{name:pageName,visuals:new Map(),measures:new Set(),columns:new Set()});
    const p=map.get(pageName);
    const vKey=visualTitle;
    if(!p.visuals.has(vKey))p.visuals.set(vKey,{type:visualType,title:visualTitle,bindings:[]});
    const vb=p.visuals.get(vKey).bindings;
    if(!vb.some(b=>b.fieldName===fieldName&&b.fieldTable===fieldTable))vb.push({fieldName,fieldTable,fieldType});
    if(fieldType==="measure")p.measures.add(fieldName);
    else p.columns.add(fieldName);
  };
  DATA.measures.forEach(m=>m.usedIn.forEach(u=>addToPage(u.pageName,u.visualType,u.visualTitle,m.name,m.table,"measure")));
  DATA.columns.forEach(c=>c.usedIn.forEach(u=>addToPage(u.pageName,u.visualType,u.visualTitle,c.name,c.table,"column")));
  return [...map.values()].map(p=>{
    const visuals=[...p.visuals.values()];
    const typeCounts={};
    visuals.forEach(v=>{typeCounts[v.type]=(typeCounts[v.type]||0)+1;});
    const slicerCount=typeCounts["slicer"]||0;
    const coverage=DATA.totals.measuresInModel>0?Math.round(p.measures.size/DATA.totals.measuresInModel*100):0;
    return{
      name:p.name,visualCount:visuals.length,
      measures:[...p.measures],columns:[...p.columns],
      measureCount:p.measures.size,columnCount:p.columns.size,
      slicerCount,typeCounts,coverage,visuals
    };
  });
})();

function uc(n){return n===0?"zero":n<=1?"low":"good"}

function renderSummary(){
  const t=DATA.totals;
  const totalOrphan=t.measuresUnused+t.columnsUnused;
  const hiddenCount=(DATA.hiddenPages||[]).length;
  const visibleCount=t.pages-hiddenCount;
  const tipDirect=\`Fields bound to at least one visual (data well, filter, or conditional formatting). \${t.measuresDirect} measures · \${t.columnsDirect} columns.\`;
  const tipIndirect=\`Not on any visual, but referenced by direct measures via DAX or used in a relationship — keep these. \${t.measuresIndirect} measures · \${t.columnsIndirect} columns.\`;
  const tipUnused=\`Not referenced anywhere in the report — safe to remove. \${t.measuresUnused} measures · \${t.columnsUnused} columns.\`;
  const tipPages=\`Total pages in the report. \${visibleCount} visible · \${hiddenCount} hidden (tooltip / drillthrough / nav-suppressed).\`;
  const tipVisuals=\`Total visuals across all pages.\`;
  document.getElementById("summary").innerHTML=\`
    <div class="stat has-tip" data-tooltip="\${tipDirect}"><div class="stat-value good">\${t.measuresDirect+t.columnsDirect}</div><div class="stat-label">Direct</div><div class="stat-detail">\${t.measuresDirect}M · \${t.columnsDirect}C</div></div>
    <div class="stat has-tip" data-tooltip="\${tipIndirect}"><div class="stat-value \${t.measuresIndirect+t.columnsIndirect>0?'warn':''}">\${t.measuresIndirect+t.columnsIndirect}</div><div class="stat-label">Indirect</div><div class="stat-detail">\${t.measuresIndirect}M · \${t.columnsIndirect}C</div></div>
    <div class="stat has-tip" data-tooltip="\${tipUnused}"><div class="stat-value \${totalOrphan>0?'danger':''}">\${totalOrphan}</div><div class="stat-label">Unused</div><div class="stat-detail">\${t.measuresUnused}M · \${t.columnsUnused}C</div></div>
    <div class="stat has-tip" data-tooltip="\${tipPages}"><div class="stat-value">\${t.pages}</div><div class="stat-label">Pages</div><div class="stat-detail">\${visibleCount}V · \${hiddenCount}H</div></div>
    <div class="stat has-tip" data-tooltip="\${tipVisuals}"><div class="stat-value">\${t.visuals}</div><div class="stat-label">Visuals</div></div>
  \`;
}

function renderTabs(){
  const um=DATA.totals.measuresUnused+DATA.totals.columnsUnused;
  document.getElementById("tabs").innerHTML=[
    {id:"measures",l:"Measures",b:DATA.measures.length},{id:"columns",l:"Columns",b:DATA.columns.length},{id:"tables",l:"Tables",b:DATA.tables.length},
    {id:"relationships",l:"Relationships",b:DATA.relationships.length},{id:"functions",l:"Functions",b:DATA.functions.filter(f=>!f.name.endsWith('.About')).length},{id:"calcgroups",l:"Calc Groups",b:DATA.calcGroups.length},{id:"pages",l:"Pages",b:pageData.length},{id:"unused",l:"Unused",b:um,w:um>0},{id:"lineage",l:"Lineage",b:null},{id:"docs",l:"Docs",b:null}
  ].map(t=>\`<button class="tab \${activeTab===t.id?'active':''}" onclick="switchTab('\${t.id}')">\${t.l}\${t.b!==null?\`<span class="badge \${t.w?'warn':''}">\${t.b}</span>\`:''}</button>\`).join("");
}

function switchTab(id){
  if(id!=="lineage")lastTab=id;
  activeTab=id;renderTabs();
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("panel-"+id).classList.add("active");
  if(id==="lineage"&&!document.getElementById("lineage-content").innerHTML.trim())
    document.getElementById("lineage-content").innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--text-faint)"><div style="font-size:16px;margin-bottom:8px">Click a measure or column name to view its lineage</div><div style="font-size:12px">Go to the Measures or Columns tab and click any field name</div></div>';
}

function sc(s){return s==='unused'?'unused':s==='indirect'?'indirect':''}
function renderMeasures(){
  let items=[...DATA.measures];const s=sortState.measures;
  items.sort((a,b)=>{let av=a[s.key],bv=b[s.key];if(typeof av==='string')return s.desc?bv.localeCompare(av):av.localeCompare(bv);return s.desc?bv-av:av-bv;});
  if(showUnusedOnly.measures)items=items.filter(m=>m.status!=='direct');
  if(searchTerms.measures){const q=searchTerms.measures.toLowerCase();items=items.filter(m=>m.name.toLowerCase().includes(q)||m.table.toLowerCase().includes(q));}
  document.getElementById("tbody-measures").innerHTML=items.map(m=>{
    const deps=m.daxDependencies.map(d=>\`<span class="dep-chip" onclick="openLineage('measure','\${d}')">\${d}</span>\`).join("")||'<span style="color:var(--text-faint)">—</span>';
    const pages=[...new Set(m.usedIn.map(u=>u.pageName))];
    const used=pages.map(p=>\`<span class="used-chip">\${p}</span>\`).join("")||'<span style="color:var(--text-faint)">—</span>';
    const statusBadge=m.status==='indirect'?'<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,.12);color:#F59E0B;font-weight:600;margin-left:4px">INDIRECT</span>':m.status==='unused'?'<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,.12);color:#EF4444;font-weight:600;margin-left:4px">UNUSED</span>':'';
    const nameAttr=m.description?' title="'+escAttr(m.description)+'" data-desc="1"':'';
    const descRow=m.description?'<div class="desc-muted" style="margin-top:2px;font-size:11px">'+escHtml(m.description)+'</div>':'';
    return \`<tr class="\${sc(m.status)}"><td><span class="field-name"\${nameAttr} onclick="openLineage('measure','\${m.name}')">\${m.name}</span>\${statusBadge}\${descRow}</td><td><span class="field-table">\${m.table}</span></td><td><span class="usage-count \${uc(m.usageCount)}">\${m.usageCount}</span></td><td><span class="usage-count \${uc(m.pageCount)}">\${m.pageCount}</span></td><td>\${deps}</td><td>\${used}</td><td><span class="format-str">\${m.formatString||'—'}</span></td></tr>\`;
  }).join("");
}

function renderColumns(){
  let items=[...DATA.columns];const s=sortState.columns;
  items.sort((a,b)=>{let av=a[s.key],bv=b[s.key];if(typeof av==='string')return s.desc?bv.localeCompare(av):av.localeCompare(bv);return s.desc?bv-av:av-bv;});
  if(showUnusedOnly.columns)items=items.filter(c=>c.status!=='direct');
  if(searchTerms.columns){const q=searchTerms.columns.toLowerCase();items=items.filter(c=>c.name.toLowerCase().includes(q)||c.table.toLowerCase().includes(q));}
  document.getElementById("tbody-columns").innerHTML=items.map(c=>{
    const pages=[...new Set(c.usedIn.map(u=>u.pageName))];
    const used=pages.map(p=>\`<span class="used-chip">\${p}</span>\`).join("")||'<span style="color:var(--text-faint)">—</span>';
    const sb=c.isSlicerField?'<span class="slicer-badge">SLICER</span>':'';
    const statusBadge=c.status==='indirect'?'<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,.12);color:#F59E0B;font-weight:600;margin-left:4px">INDIRECT</span>':c.status==='unused'?'<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,.12);color:#EF4444;font-weight:600;margin-left:4px">UNUSED</span>':'';
    const cNameAttr=c.description?' title="'+escAttr(c.description)+'" data-desc="1"':'';
    const cDescRow=c.description?'<div class="desc-muted" style="margin-top:2px;font-size:11px">'+escHtml(c.description)+'</div>':'';
    return \`<tr class="\${sc(c.status)}"><td><span class="field-name"\${cNameAttr} onclick="openLineage('column','\${c.name}')">\${c.name}</span>\${sb}\${statusBadge}\${cDescRow}</td><td><span class="field-table">\${c.table}</span></td><td><span class="mono" style="font-size:11px;color:#64748B">\${c.dataType}</span></td><td><span class="usage-count \${uc(c.usageCount)}">\${c.usageCount}</span></td><td><span class="usage-count \${uc(c.pageCount)}">\${c.pageCount}</span></td><td>\${used}</td></tr>\`;
  }).join("");
}

function openLineage(type,name){
  lastTab=activeTab!=="lineage"?activeTab:lastTab;
  activeTab="lineage";renderTabs();
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  document.getElementById("panel-lineage").classList.add("active");

  const el=document.getElementById("lineage-content");
  const backTab=type==="column"?"columns":"measures";

  if(type==="measure"){
    const m=DATA.measures.find(x=>x.name===name);
    if(!m){el.innerHTML='<div style="color:#EF4444;padding:20px">Measure not found</div>';return;}

    const upstream=m.daxDependencies.map(d=>{
      const dep=DATA.measures.find(x=>x.name===d);
      return dep||{name:d,table:"?",formatString:""};
    });
    const usedFuncs=DATA.functions.filter(f=>!f.name.endsWith('.About')&&(m.daxExpression.includes("'"+f.name+"'")||m.daxExpression.includes(f.name+'(')));
    const feedsInto=DATA.measures.filter(x=>x.daxDependencies.includes(m.name));

    el.innerHTML=\`
      <div class="lineage-back" onclick="switchTab('\${backTab}')">← Back to \${backTab==='measures'?'Measures':'Columns'}</div>
      <div class="lineage-hero">
        <div class="lineage-hero-title"><span class="dot" style="background:#F59E0B"></span>\${m.name}</div>
        <div class="lineage-hero-meta">\${m.table} · \${m.formatString||'—'} · \${m.usageCount} visual\${m.usageCount!==1?'s':''} · \${m.pageCount} page\${m.pageCount!==1?'s':''}</div>
        \${m.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(m.description)+'</div>':''}
        <div class="lineage-dax">\${m.daxExpression}</div>
      </div>
      <div class="lineage-flow-row">
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:#A78BFA">↑ Upstream</div>
          \${usedFuncs.map(f=>\`
            <div class="lc udf clickable" style="margin-bottom:4px" onclick="switchTab('functions')">
              <div class="lc-name" style="color:#14B8A6">ƒ \${f.name}</div>
              <div class="lc-sub">Function · \${f.parameters?f.parameters.split(',').length+' param'+(f.parameters.split(',').length!==1?'s':''):'no params'}</div>
            </div>\`).join("")}
          <div class="lc source" style="margin-bottom:4px">
            <div class="lc-name" style="color:#10B981">⬡ \${m.table}</div>
            <div class="lc-sub">Source table</div>
          </div>
          \${upstream.length?upstream.map(u=>\`
            <div class="lc upstream clickable" onclick="openLineage('measure','\${u.name}')">
              <div class="lc-name">\${u.name}</div>
              <div class="lc-sub">\${u.table} · \${u.formatString||''}</div>
            </div>\`).join(""):\`\${usedFuncs.length?'':\`<div class="lc upstream empty"><div class="lc-name">No dependencies</div><div class="lc-sub">Base measure</div></div>\`}\`}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:#F59E0B">● This Measure</div>
          <div class="lc center">
            <div class="lc-name">\${m.name}</div>
            <div class="lc-sub">\${m.daxExpression.length>50?m.daxExpression.substring(0,50)+'…':m.daxExpression}</div>
          </div>
          \${feedsInto.length?\`
            <div class="feeds-label">Feeds into</div>
            \${feedsInto.map(f=>\`
              <div class="lc feeds clickable" onclick="openLineage('measure','\${f.name}')">
                <div class="lc-name">\${f.name}</div>
                <div class="lc-sub">\${f.formatString||''} · \${f.usageCount} visual\${f.usageCount!==1?'s':''}</div>
              </div>\`).join("")}
          \`:''}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:#8B5CF6">↓ Downstream</div>
          \${m.usedIn.length?m.usedIn.map(d=>\`
            <div class="lc downstream">
              <div class="lc-name">\${d.visualTitle}</div>
              <div class="lc-sub">\${d.visualType} · \${d.bindingRole}</div>
              <div class="lc-role">\${d.pageName}</div>
            </div>\`).join(""):\`<div class="lc downstream empty"><div class="lc-name" style="color:#EF4444">Not used</div><div class="lc-sub">Orphaned measure</div></div>\`}
        </div>
      </div>\`;
    addCopyButtons();
  }
  else if(type==="column"){
    const c=DATA.columns.find(x=>x.name===name);
    if(!c){el.innerHTML='<div style="color:#EF4444;padding:20px">Column not found</div>';return;}
    const colRef=c.table+'['+c.name+']';
    const related=DATA.measures.filter(m=>m.daxExpression.includes(colRef)||m.daxExpression.includes('['+c.name+']'));

    el.innerHTML=\`
      <div class="lineage-back" onclick="switchTab('columns')">← Back to Columns</div>
      <div class="lineage-hero">
        <div class="lineage-hero-title"><span class="dot" style="background:#3B82F6"></span>\${c.name}\${c.isSlicerField?'<span class="slicer-badge">SLICER</span>':''}</div>
        <div class="lineage-hero-meta">\${c.table} · \${c.dataType} · \${c.usageCount} visual\${c.usageCount!==1?'s':''} · \${c.pageCount} page\${c.pageCount!==1?'s':''}</div>
        \${c.description?'<div class="desc-line" style="margin-top:8px;font-size:13px">'+escHtml(c.description)+'</div>':''}
      </div>
      <div class="lineage-flow-row">
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:#10B981">↑ Source</div>
          <div class="lc source">
            <div class="lc-name" style="color:#10B981">⬡ \${c.table}</div>
            <div class="lc-sub">\${c.dataType}</div>
          </div>
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:#3B82F6">● This Column</div>
          <div class="lc center col-type">
            <div class="lc-name">\${c.name}</div>
            <div class="lc-sub">\${c.table}[\${c.name}]</div>
          </div>
          \${related.length?\`
            <div class="feeds-label">Measures referencing \${c.name}</div>
            \${related.map(m=>\`
              <div class="lc feeds clickable" onclick="openLineage('measure','\${m.name}')">
                <div class="lc-name">\${m.name}</div>
                <div class="lc-sub">\${m.formatString||''} · \${m.usageCount} visual\${m.usageCount!==1?'s':''}</div>
              </div>\`).join("")}
          \`:''}
        </div>
        <div class="lineage-arrow-col">→</div>
        <div class="lineage-flow-col">
          <div class="lineage-flow-col-label" style="color:#8B5CF6">↓ Downstream</div>
          \${c.usedIn.length?c.usedIn.map(d=>\`
            <div class="lc downstream">
              <div class="lc-name">\${d.visualTitle}</div>
              <div class="lc-sub">\${d.visualType} · \${d.bindingRole}</div>
              <div class="lc-role">\${d.pageName}</div>
            </div>\`).join(""):\`<div class="lc downstream empty"><div class="lc-name" style="color:#EF4444">Not used</div><div class="lc-sub">Orphaned column</div></div>\`}
        </div>
      </div>\`;
  }
}

function renderPages(){
  const FC={measure:"#F59E0B",column:"#3B82F6"};
  const hiddenSet=new Set(DATA.hiddenPages||[]);
  document.getElementById("pages-content").innerHTML=pageData.map(p=>{
    const isOpen=openPages.has(p.name);
    const hiddenBadge=hiddenSet.has(p.name)?'<span class="hidden-badge" title="This page is marked HiddenInViewMode — typically a tooltip, drillthrough, or nav-suppressed page">HIDDEN</span>':'';

    const typeChips=Object.entries(p.typeCounts).map(([t,c])=>\`<span class="page-type-chip">\${c}× \${t}</span>\`).join("");

    const visualRows=p.visuals.map(v=>{
      const bindingChips=v.bindings.map(b=>{
        const color=b.fieldType==="measure"?FC.measure:FC.column;
        return \`<span class="dep-chip" style="background:\${color}15;color:\${color};border-color:\${color}30;cursor:pointer" onclick="event.stopPropagation();openLineage('\${b.fieldType}','\${b.fieldName}')">\${b.fieldName}</span>\`;
      }).join("");
      return \`<div class="page-visual-row">
        <span class="page-visual-type">\${v.type}</span>
        <span class="page-visual-title">\${v.title}</span>
        <div class="page-visual-bindings">\${bindingChips}</div>
      </div>\`;
    }).join("");

    const measureChips=p.measures.map(m=>\`<span class="dep-chip" style="background:rgba(245,158,11,.1);color:#F59E0B;border-color:rgba(245,158,11,.2);cursor:pointer" onclick="event.stopPropagation();openLineage('measure','\${m}')">\${m}</span>\`).join("");
    const columnChips=p.columns.map(c=>\`<span class="dep-chip" style="background:rgba(59,130,246,.1);color:#3B82F6;border-color:rgba(59,130,246,.2);cursor:pointer" onclick="event.stopPropagation();openLineage('column','\${c}')">\${c}</span>\`).join("");

    return \`<div class="page-card \${isOpen?'open':''}">
      <div class="page-header" onclick="togglePage('\${p.name}')">
        <div class="page-name">\${p.name}\${hiddenBadge}</div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:#8B5CF6">\${p.visualCount}</div><div class="page-stat-label">Visuals</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#F59E0B">\${p.measureCount}</div><div class="page-stat-label">Measures</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#3B82F6">\${p.columnCount}</div><div class="page-stat-label">Columns</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#EC4899">\${p.slicerCount}</div><div class="page-stat-label">Slicers</div></div>
        </div>
        <span class="page-expand">▼</span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        <div class="page-section">
          <div class="page-section-title">Visual types<span class="line"></span></div>
          <div class="page-type-summary">\${typeChips}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Measures (\${p.measureCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">\${measureChips||'<span style="color:#475569;font-size:12px">None</span>'}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Columns (\${p.columnCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">\${columnChips||'<span style="color:#475569;font-size:12px">None</span>'}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Visuals (\${p.visualCount})<span class="line"></span></div>
          \${visualRows}
        </div>
      </div></div>
    </div>\`;
  }).join("");
}

function togglePage(name){
  if(openPages.has(name))openPages.delete(name);else openPages.add(name);
  renderPages();
}

function toggleTableCard(name){
  if(openTables.has(name))openTables.delete(name);else openTables.add(name);
  renderTables();
}

function renderTables(){
  const tables=DATA.tables||[];
  document.getElementById("tables-content").innerHTML=tables.map(t=>{
    const isOpen=openTables.has(t.name);
    const calcGroupPill=t.isCalcGroup?'<span class="calc-group-pill" title="This table is a calculation group">CALC GROUP</span>':'';

    const colRows=t.columns.map(c=>{
      const badges=[];
      if(c.isKey)badges.push('<span class="pk-badge" title="Primary key — isKey:true set in the model">PK</span>');
      else if(c.isInferredPK)badges.push('<span class="pk-badge inferred" title="Inferred primary key — this column is on the one-side of at least one relationship">PK</span>');
      if(c.isFK)badges.push('<span class="fk-badge" title="Foreign key — used as fromColumn in a relationship">FK</span>');
      if(c.isCalculated)badges.push('<span class="calc-col-badge" title="Calculated column">CALC</span>');
      if(c.isHidden)badges.push('<span class="hid-col-badge" title="isHidden:true">HIDDEN</span>');
      const statusClass=c.status==='unused'?'zero':c.status==='indirect'?'low':'good';
      // Relationship column: FK target (outgoing) or incoming PK refs, or both if the column is a bridge
      const parts=[];
      if(c.isFK&&c.fkTarget)parts.push(\`<span class="rel-out">→ \${c.fkTarget.table}[\${c.fkTarget.column}]</span>\`);
      if(c.incomingRefs&&c.incomingRefs.length>0){
        const refs=c.incomingRefs.map(r=>\`<span class="rel-in\${r.isActive?'':' rel-inactive'}">← \${r.table}[\${r.column}]\${r.isActive?'':' <span style="font-size:9px;opacity:.7">(inactive)</span>'}</span>\`).join('<span style="color:var(--text-fainter);margin:0 4px">·</span>');
        parts.push(refs);
      }
      const relText=parts.length?parts.join('<br>'):'<span style="color:var(--text-fainter)">—</span>';
      const colDesc=c.description?'<div class="desc-muted" style="margin-top:3px">'+escHtml(c.description)+'</div>':'';
      return \`<div class="tcol-row">
        <div>
          <span class="tcol-name" onclick="openLineage('column','\${c.name.replace(/'/g,"\\\\'")}')">\${c.name}</span>\${badges.join('')}
          <span class="usage-count \${statusClass}" style="margin-left:8px;font-size:10px">\${c.usageCount}</span>
          \${colDesc}
        </div>
        <div class="tcol-type">\${c.dataType}</div>
        <div class="tcol-fk">\${relText}</div>
      </div>\`;
    }).join("")||'<div style="padding:8px 10px;color:var(--text-faint);font-size:12px">No columns</div>';

    const measureList=t.measures.map(m=>{
      const cls=m.status==='unused'?'zero':m.status==='indirect'?'low':'good';
      return \`<span class="dep-chip" style="background:rgba(245,158,11,.1);color:#F59E0B;border-color:rgba(245,158,11,.2);cursor:pointer" onclick="event.stopPropagation();openLineage('measure','\${m.name.replace(/'/g,"\\\\'")}')">\${m.name} <span class="usage-count \${cls}" style="margin-left:4px;font-size:9px">\${m.usageCount}</span></span>\`;
    }).join("")||'<span style="color:var(--text-faint);font-size:12px">None</span>';

    const relRows=t.relationships.map(r=>{
      const dirClass=r.direction==='outgoing'?'out':'in';
      const dirLabel=r.direction==='outgoing'?'FK →':'← PK';
      const inactive=r.isActive?'':' trel-inactive';
      const arrow=r.direction==='outgoing'?'→':'←';
      const other=r.direction==='outgoing'?\`\${r.toTable}[\${r.toColumn}]\`:\`\${r.fromTable}[\${r.fromColumn}]\`;
      const self=r.direction==='outgoing'?\`[\${r.fromColumn}]\`:\`[\${r.toColumn}]\`;
      return \`<div class="trel-row\${inactive}">
        <span class="trel-dir \${dirClass}">\${dirLabel}</span>
        <span>\${self} <span style="color:var(--text-faint)">\${arrow}</span> \${other}</span>
        \${r.isActive?'':'<span style="font-size:9px;color:var(--text-dim);margin-left:4px">(inactive)</span>'}
      </div>\`;
    }).join("")||'<div style="padding:8px 10px;color:var(--text-faint);font-size:12px">No relationships</div>';

    const tableDesc=t.description?'<div class="desc-line">'+escHtml(t.description)+'</div>':'';
    return \`<div class="page-card \${isOpen?'open':''}">
      <div class="page-header" onclick="toggleTableCard('\${t.name.replace(/'/g,"\\\\'")}')">
        <div style="flex:1;min-width:0">
          <div class="page-name">\${t.name}\${calcGroupPill}</div>
          \${tableDesc}
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:#3B82F6">\${t.columnCount}</div><div class="page-stat-label">Columns</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#F59E0B">\${t.measureCount}</div><div class="page-stat-label">Measures</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#F59E0B">\${t.keyCount}</div><div class="page-stat-label">Keys</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#3B82F6">\${t.fkCount}</div><div class="page-stat-label">FKs</div></div>
        </div>
        <span class="page-expand">▼</span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        <div class="page-section">
          <div class="page-section-title">Columns (\${t.columnCount})<span class="line"></span></div>
          <div class="tcol-row" style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);font-weight:600;border-bottom:1px solid var(--border);padding-bottom:4px">
            <div>Name</div><div>Type</div><div>Relationship</div>
          </div>
          \${colRows}
        </div>
        <div class="page-section">
          <div class="page-section-title">Measures (\${t.measureCount})<span class="line"></span></div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">\${measureList}</div>
        </div>
        <div class="page-section">
          <div class="page-section-title">Relationships (\${t.relationships.length})<span class="line"></span></div>
          \${relRows}
        </div>
      </div></div>
    </div>\`;
  }).join("")||'<div style="text-align:center;padding:60px 20px;color:var(--text-faint);font-size:13px">No tables found</div>';
}

var openOrphanSections=new Set();
function toggleOrphanSection(id){if(openOrphanSections.has(id))openOrphanSections.delete(id);else openOrphanSections.add(id);renderUnused();}

function orphanSection(id,title,subtitle,color,count,countLabel,items){
  const isOpen=openOrphanSections.has(id);
  return \`<div class="page-card \${isOpen?'open':''}" style="border-left:3px solid \${color}">
    <div class="page-header" onclick="toggleOrphanSection('\${id}')">
      <div style="flex:1">
        <div class="page-name" style="font-size:14px">\${title}</div>
        <div style="font-size:11px;color:#64748B;margin-top:2px">\${subtitle}</div>
      </div>
      <div class="page-stats">
        <div class="page-stat"><div class="page-stat-val" style="color:\${color}">\${count}</div><div class="page-stat-label">\${countLabel}</div></div>
      </div>
      <span class="page-expand">▼</span>
    </div>
    <div class="page-body"><div class="page-body-inner">
      <div style="display:flex;flex-wrap:wrap;gap:8px">\${items}</div>
    </div></div>
  </div>\`;
}

function renderUnused(){
  const unusedM=DATA.measures.filter(m=>m.status==='unused'),indirectM=DATA.measures.filter(m=>m.status==='indirect');
  const unusedC=DATA.columns.filter(c=>c.status==='unused'),indirectC=DATA.columns.filter(c=>c.status==='indirect');
  const pureOrphanM=unusedM.filter(m=>!m.dependedOnBy.length);
  const chainOrphanM=unusedM.filter(m=>m.dependedOnBy.length>0);
  let h='';

  if(pureOrphanM.length) h+=orphanSection('pure-m','Unused Measures — Not Referenced Anywhere','No visual uses them and no other measure references them — safe to remove','#EF4444',pureOrphanM.length,'Measures',
    pureOrphanM.map(m=>\`<div class="lc clickable" style="border-left:3px solid #EF4444;flex:0 0 auto" onclick="event.stopPropagation();openLineage('measure','\${m.name}')"><div class="lc-name">\${m.name}</div><div class="lc-sub">\${m.table} · \${m.formatString||''}</div></div>\`).join(""));

  if(chainOrphanM.length) h+=orphanSection('chain-m','Unused Measures — Dead Chain','Other measures depend on them, but the full chain never reaches any visual','#EF4444',chainOrphanM.length,'Measures',
    chainOrphanM.map(m=>\`<div class="lc clickable" style="border-left:3px solid #EF4444;flex:0 0 auto" onclick="event.stopPropagation();openLineage('measure','\${m.name}')"><div class="lc-name">\${m.name}</div><div class="lc-sub">\${m.table} · \${m.formatString||''} · depended on by \${m.dependedOnBy.length}</div></div>\`).join(""));

  if(unusedC.length) h+=orphanSection('orphan-c','Unused Columns','No visual, measure, or relationship uses them — safe to hide or remove','#EF4444',unusedC.length,'Columns',
    unusedC.map(c=>\`<div class="lc clickable" style="border-left:3px solid #EF4444;flex:0 0 auto" onclick="event.stopPropagation();openLineage('column','\${c.name}')"><div class="lc-name">\${c.name}</div><div class="lc-sub">\${c.table} · \${c.dataType}</div></div>\`).join(""));

  if(indirectM.length) h+=orphanSection('indirect-m','Indirect Measures','Not on any visual, but used inside other measures that are — keep these','#F59E0B',indirectM.length,'Measures',
    indirectM.map(m=>\`<div class="lc clickable" style="border-left:3px solid #F59E0B;flex:0 0 auto" onclick="event.stopPropagation();openLineage('measure','\${m.name}')"><div class="lc-name">\${m.name}</div><div class="lc-sub">\${m.table} · \${m.formatString||''}</div></div>\`).join(""));

  if(indirectC.length) h+=orphanSection('indirect-c','Indirect Columns','Not on any visual, but used in a relationship or measure DAX — keep these','#F59E0B',indirectC.length,'Columns',
    indirectC.map(c=>\`<div class="lc clickable" style="border-left:3px solid #F59E0B;flex:0 0 auto" onclick="event.stopPropagation();openLineage('column','\${c.name}')"><div class="lc-name">\${c.name}</div><div class="lc-sub">\${c.table} · \${c.dataType}</div></div>\`).join(""));

  if(!unusedM.length&&!unusedC.length&&!indirectM.length&&!indirectC.length)h='<div style="text-align:center;padding:40px;color:#22C55E;font-weight:600">All fields are in use ✓</div>';
  document.getElementById("unused-content").innerHTML=h;
}

function renderRelationships(){
  const rels=DATA.relationships;
  if(!rels.length){document.getElementById("relationships-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No relationships found in the model</div>';return;}
  let h='<table class="data-table"><thead><tr><th>From Table</th><th>From Column</th><th></th><th>To Table</th><th>To Column</th><th>Status</th></tr></thead><tbody>';
  for(const r of rels){
    const statusColor=r.isActive?'#10B981':'#6B7280';
    const statusLabel=r.isActive?'Active':'Inactive';
    h+=\`<tr>
      <td style="font-weight:600">\${r.fromTable}</td>
      <td>\${r.fromColumn}</td>
      <td style="text-align:center;color:#6B7280;font-size:18px">→</td>
      <td style="font-weight:600">\${r.toTable}</td>
      <td>\${r.toColumn}</td>
      <td><span style="color:\${statusColor};font-size:12px;font-weight:500">\${statusLabel}</span></td>
    </tr>\`;
  }
  h+='</tbody></table>';
  document.getElementById("relationships-content").innerHTML=h;
}

function renderFunctions(){
  const fns=DATA.functions.filter(f=>!f.name.endsWith('.About'));
  if(!fns.length){document.getElementById("functions-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No user-defined functions found in the model</div>';return;}
  let h='<div style="display:flex;flex-direction:column;gap:12px">';
  for(const f of fns){
    const refMeasures=DATA.measures.filter(m=>m.daxExpression.includes("'"+f.name+"'")||m.daxExpression.includes(f.name+'('));
    const params=f.parameters?f.parameters.split(',').map(p=>{
      const parts=p.trim().split(/\\s*:\\s*/);
      return parts.length>=2?'<span style="color:var(--code-name)">'+parts[0].trim()+'</span> <span style="color:var(--code-punct)">:</span> <span style="color:var(--code-type)">'+parts.slice(1).join(':').trim()+'</span>':'<span style="color:var(--code-name)">'+p.trim()+'</span>';
    }).join('<span style="color:var(--code-punct)">, </span>'):'<span style="color:var(--code-punct);font-style:italic">none</span>';
    const desc=f.description?'<div style="font-size:11px;color:#64748B;margin-top:6px;line-height:1.4">'+f.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
    const expr=f.expression.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const measureChips=refMeasures.map(m=>\`<span class="dep-chip" style="background:rgba(245,158,11,.1);color:#F59E0B;border-color:rgba(245,158,11,.2);cursor:pointer" onclick="event.stopPropagation();openLineage('measure','\${m.name}')">\${m.name}</span>\`).join('');
    h+=\`<div class="page-card">
      <div class="page-header" onclick="this.parentElement.classList.toggle('open')">
        <div style="flex:1">
          <div class="page-name" style="font-size:14px">\${f.name}</div>
          <div style="font-size:11px;color:#64748B;margin-top:2px;font-family:'JetBrains Mono',monospace">( \${params} )</div>
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:#F59E0B">\${refMeasures.length}</div><div class="page-stat-label">Measures</div></div>
        </div>
        <span class="page-expand">▼</span>
      </div>
      <div class="page-body"><div class="page-body-inner">
        \${desc}
        \${refMeasures.length?\`<div style="margin-top:8px"><div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px">Measures using this function</div><div style="display:flex;flex-wrap:wrap;gap:4px">\${measureChips}</div></div>\`:''}
        <div class="lineage-dax" style="margin-top:8px;max-height:300px;overflow-y:auto">\${expr}</div>
      </div></div>
    </div>\`;
  }
  h+='</div>';
  document.getElementById("functions-content").innerHTML=h;
}

function renderCalcGroups(){
  const cgs=DATA.calcGroups;
  if(!cgs.length){document.getElementById("calcgroups-content").innerHTML='<div style="text-align:center;padding:40px;color:#6B7280">No calculation groups found in the model</div>';return;}
  let h='<div style="display:flex;flex-direction:column;gap:12px">';
  for(const cg of cgs){
    const desc=cg.description?'<div style="font-size:11px;color:var(--text-dim);margin-top:4px">'+cg.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
    let items='';
    for(const item of cg.items){
      const expr=item.expression.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const fmtBadge=item.formatStringExpression?'<span class="mono" style="margin-left:8px;font-size:10px;color:var(--text-dim)">fmt: '+item.formatStringExpression.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>':'';
      const itemDesc=item.description?'<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">'+item.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'';
      items+=\`<div class="ci-card">
        <div class="ci-head">
          <span class="ci-ord">\${item.ordinal}</span>
          <span class="ci-name">\${item.name}</span>\${fmtBadge}
        </div>\${itemDesc}
        <div class="lineage-dax" style="font-size:12px">\${expr}</div>
      </div>\`;
    }
    h+=\`<div class="page-card">
      <div class="page-header" onclick="this.parentElement.classList.toggle('open')">
        <div style="flex:1">
          <div class="page-name" style="font-size:14px">\${cg.name}</div>
          \${desc}
        </div>
        <div class="page-stats">
          <div class="page-stat"><div class="page-stat-val" style="color:#A78BFA">\${cg.items.length}</div><div class="page-stat-label">Items</div></div>
          <div class="page-stat"><div class="page-stat-val" style="color:#64748B">\${cg.precedence}</div><div class="page-stat-label">Precedence</div></div>
        </div>
        <span class="page-expand">▼</span>
      </div>
      <div class="page-body"><div class="page-body-inner">\${items}</div></div>
    </div>\`;
  }
  h+='</div>';
  document.getElementById("calcgroups-content").innerHTML=h;
}

function sortTable(t,k){const s=sortState[t];if(s.key===k)s.desc=!s.desc;else{s.key=k;s.desc=true;}t==="measures"?renderMeasures():renderColumns();}
function filterTable(t,v){searchTerms[t]=v;t==="measures"?renderMeasures():renderColumns();}
function toggleUnused(t){showUnusedOnly[t]=!showUnusedOnly[t];document.getElementById("btn-unused-"+(t==="measures"?"m":"c")).classList.toggle("active");t==="measures"?renderMeasures():renderColumns();}

function renderDocs(){
  var el=document.getElementById("md-source");
  if(el)el.textContent=MARKDOWN;
}

function copyMarkdown(){
  var btn=document.getElementById("md-copy-btn");
  function ok(){if(btn){btn.textContent="✓ Copied";setTimeout(function(){btn.textContent="⎘ Copy";},1500);}}
  function fallback(){
    var ta=document.createElement("textarea");ta.value=MARKDOWN;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();
    var ok2=false;try{ok2=document.execCommand("copy");}catch(e){}
    document.body.removeChild(ta);
    if(ok2)ok();else if(btn){btn.textContent="✗ Failed";setTimeout(function(){btn.textContent="⎘ Copy";},1500);}
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(MARKDOWN).then(ok).catch(fallback);
  }else{fallback();}
}

function downloadMarkdown(){
  var blob=new Blob([MARKDOWN],{type:"text/markdown;charset=utf-8"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url;a.download=REPORT_NAME+"-semantic-model.md";
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

renderSummary();renderTabs();renderMeasures();renderColumns();renderTables();renderRelationships();renderFunctions();renderCalcGroups();renderPages();renderUnused();renderDocs();switchTab("measures");addCopyButtons();
</script>
</body>
</html>`;
}
