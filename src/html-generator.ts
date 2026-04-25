import type { FullData } from "./data-builder.js";
import { safeJSON, escHtml as serverEscHtml } from "./render/safe.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────
// Vendored DAX syntax highlighter (see vendor/dax-highlight/README.md)
//
// Loaded once at module-load from vendor/dax-highlight/ and inlined
// into the generated HTML. Zero runtime deps preserved — the vendor
// files are just read off disk, like package.json in app.ts.
//
// Path resolution tries three locations so the same code works when
// compiled to dist/ (production), dist-test/src/ (unit tests), or
// run via ts-node / any other out-dir layout.
// ─────────────────────────────────────────────────────────────────────
const __dirname_html = path.dirname(fileURLToPath(import.meta.url));

/**
 * Expected SHA-256 hashes of every file under vendor/. Computed once
 * when a vendor file is added or upgraded (see vendor/dax-highlight/README.md).
 * Verified on startup by readVendor(); mismatch is fatal so a tampered
 * vendor directory can't silently inline malicious JS into the
 * generated dashboard.
 *
 * When upgrading a vendor file:
 *   1. Drop in the new file.
 *   2. `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('vendor/...')).digest('hex'))"`
 *   3. Update the hash below.
 *   4. Run `npm test` — the integrity test re-verifies live.
 */
const VENDOR_SHA256: Record<string, string> = {
  // LF-normalised content hashes — stable across Windows/Linux checkouts.
  // Recompute via: node -e "const fs=require('fs'),c=require('crypto'); for (const f of ['...']) console.log(c.createHash('sha256').update(fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n')).digest('hex'))"
  "dax-highlight/dax-highlight.js":  "841edee157392b89c7465592916627025d06bb94646bc98f27f7371bc8e37c54",
  "dax-highlight/dax-highlight.css": "a8b9363397533cfcf2ac7b9010886ff8b4858defb8bbcfb0f1db5fdb3fa675d0",
};

function readVendor(relative: string): string {
  const candidates = [
    path.resolve(__dirname_html, "..", "vendor", relative),
    path.resolve(__dirname_html, "..", "..", "vendor", relative),
    path.resolve(process.cwd(), "vendor", relative),
  ];
  for (const p of candidates) {
    try {
      // Normalise line endings before hashing. Git's autocrlf setting
      // checks text files out as CRLF on Windows and LF on Linux; raw-
      // byte hashing would then mismatch between platforms — CI on
      // Ubuntu would disagree with a Windows dev's locally-computed
      // hash. Integrity is a content-identity check, and content
      // identity should be platform-independent.
      const text = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
      const expected = VENDOR_SHA256[relative];
      if (expected) {
        const actual = crypto.createHash("sha256").update(text).digest("hex");
        if (actual !== expected) {
          throw new Error(
            `vendor integrity check failed for ${relative}\n` +
            `  expected: ${expected}\n` +
            `  actual:   ${actual}\n` +
            `If you intentionally upgraded the vendor file, update VENDOR_SHA256 in src/html-generator.ts.`,
          );
        }
      }
      return text;
    } catch (e) {
      // Integrity failures bubble up — they're fatal. ENOENT just
      // means "try the next candidate".
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  throw new Error("vendor file not found: " + relative);
}
const DAX_HIGHLIGHT_JS  = readVendor("dax-highlight/dax-highlight.js");
const DAX_HIGHLIGHT_CSS = readVendor("dax-highlight/dax-highlight.css");

// ─────────────────────────────────────────────────────────────────────
// Dashboard stylesheet (src/styles/dashboard.css)
//
// The full <style> block used to live inline in the template literal
// below — ~450 lines making html-generator.ts the longest file in
// the repo. Extracted to its own file so (a) the generator reads as
// HTML shell + data embeds, (b) CSS edits don't touch TS, (c) future
// preprocessors / minifiers can target the file directly.
//
// The file contains a `/*__DAX_HIGHLIGHT_CSS__*/` marker where the
// vendored DAX theme slots in; we splice it once at module load.
// ─────────────────────────────────────────────────────────────────────
function readStyles(): string {
  // Styles live outside src/ (treated as resource), so paths walk up
  // the same way the dax-highlight vendor loader does. See also
  // src/client/main.js resolution in readCompiledClient().
  const candidates = [
    path.resolve(__dirname_html, "..", "src", "styles", "dashboard.css"),
    path.resolve(__dirname_html, "..", "..", "src", "styles", "dashboard.css"),
    path.resolve(process.cwd(), "src", "styles", "dashboard.css"),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf8").replace("/*__DAX_HIGHLIGHT_CSS__*/", DAX_HIGHLIGHT_CSS);
    } catch { /* try next */ }
  }
  throw new Error("src/styles/dashboard.css not found. Searched: " + candidates.join(", "));
}
const DASHBOARD_CSS = readStyles();

// ─────────────────────────────────────────────────────────────────────
// Compiled client bundle — src/client/main.ts → dist/client/main.js
//
// The embedded <script> block used to live inline inside generateHTML's
// template literal. Stop 5 moved it out: client code is now a real TS
// file, type-checked alongside the server, and inlined here at
// generation time.
//
// Path is relative to __dirname_html so it works under:
//   dist/html-generator.js        -> ./client/main.js
//   dist-test/src/html-generator.js -> ./client/main.js  (same layout)
// ─────────────────────────────────────────────────────────────────────
/**
 * Read one compiled client file (relative path under dist/client/)
 * and return its body with the tsc-inserted `export {};` stripped.
 *
 * TypeScript auto-adds the export when a .ts file references ambient
 * declarations (our src/client/globals.d.ts) or stdlib types — this
 * would be a syntax error inside a classic `<script>` block so we
 * strip it unconditionally.
 */
function readCompiledClientFile(rel: string): string {
  const candidates = [
    path.resolve(__dirname_html, "client", rel),
    path.resolve(__dirname_html, "..", "client", rel),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf8").replace(/\nexport\s*\{\s*\};?\s*$/s, "\n");
    } catch { /* try next */ }
  }
  throw new Error(
    `compiled client file not found: ${rel} — run \`npm run build\` first. ` +
    `Searched: ${candidates.join(", ")}`,
  );
}

/**
 * Concatenate every compiled client module into the single inline
 * <script> body. Order matters: leaf modules (no dependencies) come
 * first so their top-level function declarations are available when
 * main.js's code runs.
 *
 * Each entry here is a mini-module carved out of the monolithic
 * main.ts during Stop 5 pass 2+. The list grows as more carves land;
 * the list is the manifest.
 */
function readCompiledClient(): string {
  const modules = [
    "render/escape.js",  // Stop 5 pass 2 — escHtml, escAttr, sc, uc (no deps)
    "render/md.js",      // Stop 5 pass 2 — markdown renderer (uses escHtml)
    "main.js",           // still the big one; gets smaller every pass
  ];
  return modules.map(readCompiledClientFile).join("\n");
}
const CLIENT_JS = readCompiledClient();

// ═══════════════════════════════════════════════════════════════════════════════
// HTML Dashboard Generation
// ═══════════════════════════════════════════════════════════════════════════════

export function generateHTML(
  data: FullData,
  reportName: string,
  markdown: string = "",
  measuresMarkdown: string = "",
  functionsMarkdown: string = "",
  calcGroupsMarkdown: string = "",
  dataDictionaryMarkdown: string = "",
  version: string = "0.1.0",
  sourcesMarkdown: string = "",
  pagesMarkdown: string = "",
  indexMarkdown: string = "",
  improvementsMarkdown: string = "",
  /** Project CHANGELOG. Baked into every rendered dashboard so users
   *  can see what's new without leaving the tool. Same value for CLI
   *  and browser mode; browser-mode's __loadBrowserData hook leaves
   *  this slot alone when a new report loads (changelog doesn't
   *  depend on the report). */
  changelogMarkdown: string = "",
  /** Curated dashboard tour / welcome doc rendered in the "What's
   *  new" landing-overlay popup. Project-level, not per-report.
   *  Sourced from WHATS-NEW.md at repo root; empty string triggers
   *  a fallback to the latest CHANGELOG entry on the client side. */
  welcomeMarkdown: string = "",
  /** Lite-mode versions of each MD doc. Optional object — when
   *  provided, the dashboard's Docs-tab toggle can switch between
   *  Detailed (positional args above) and Lite (this object). Empty
   *  strings within the object signal "skip this doc in lite mode"
   *  (Data Dictionary + Index always skip, Functions / Calc Groups
   *  skip when empty in either mode). */
  liteMarkdowns: {
    markdown?: string;
    measuresMarkdown?: string;
    functionsMarkdown?: string;
    calcGroupsMarkdown?: string;
    dataDictionaryMarkdown?: string;
    sourcesMarkdown?: string;
    pagesMarkdown?: string;
    indexMarkdown?: string;
    improvementsMarkdown?: string;
  } = {},
): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  // safeJSON escapes <, >, &, U+2028, U+2029 on top of JSON.stringify
  // so a measure/column/description containing `</script>` or a bare
  // line-terminator can't break out of the <script> block it's
  // embedded in. Every payload below lands inside <script>const X=...;</script>.
  const markdownLiteral = safeJSON(markdown);
  const measuresMarkdownLiteral = safeJSON(measuresMarkdown);
  const functionsMarkdownLiteral = safeJSON(functionsMarkdown);
  const calcGroupsMarkdownLiteral = safeJSON(calcGroupsMarkdown);
  const dataDictionaryMarkdownLiteral = safeJSON(dataDictionaryMarkdown);
  const sourcesMarkdownLiteral = safeJSON(sourcesMarkdown);
  const pagesMarkdownLiteral = safeJSON(pagesMarkdown);
  const indexMarkdownLiteral = safeJSON(indexMarkdown);
  const improvementsMarkdownLiteral = safeJSON(improvementsMarkdown);
  const changelogMarkdownLiteral = safeJSON(changelogMarkdown);
  const welcomeMarkdownLiteral = safeJSON(welcomeMarkdown);
  // Lite-mode literals — same safeJSON treatment, default to "" so
  // dashboards built without a lite payload still parse (the toggle
  // hides Lite when the global is empty).
  const markdownLiteLiteral = safeJSON(liteMarkdowns.markdown || "");
  const measuresMarkdownLiteLiteral = safeJSON(liteMarkdowns.measuresMarkdown || "");
  const functionsMarkdownLiteLiteral = safeJSON(liteMarkdowns.functionsMarkdown || "");
  const calcGroupsMarkdownLiteLiteral = safeJSON(liteMarkdowns.calcGroupsMarkdown || "");
  const dataDictionaryMarkdownLiteLiteral = safeJSON(liteMarkdowns.dataDictionaryMarkdown || "");
  const sourcesMarkdownLiteLiteral = safeJSON(liteMarkdowns.sourcesMarkdown || "");
  const pagesMarkdownLiteLiteral = safeJSON(liteMarkdowns.pagesMarkdown || "");
  const indexMarkdownLiteLiteral = safeJSON(liteMarkdowns.indexMarkdown || "");
  const improvementsMarkdownLiteLiteral = safeJSON(liteMarkdowns.improvementsMarkdown || "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Model Usage - ${serverEscHtml(reportName)}</title>
<script>(function(){try{var t=localStorage.getItem('usage-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="header-left">
      <div class="top"><span class="usage-map-badge">Usage Map</span><span class="header-sep">|</span><span class="header-sub">${serverEscHtml(reportName)}</span><span class="load-mode-badge" hidden></span></div>
      <div class="timestamp">Generated: ${ts}</div>
    </div>
    <div class="header-actions">
      <button class="theme-btn" id="theme-btn" data-action="theme" title="Cycle theme: dark → light → BluPulse" aria-label="Cycle theme">☾</button>
      <button class="refresh-btn" data-action="reload">↻ Refresh</button>
    </div>
  </div>
  <div class="summary" id="summary"></div>
  <div class="tabs" id="tabs"></div>

  <div class="panel" id="panel-measures">
    <div class="search-row">
      <input class="search-input" placeholder="Search measures..." data-action="filter" data-entity="measures">
      <button class="filter-btn" id="btn-unused-m" data-action="unused-filter" data-entity="measures">Not on visual</button>
      <button class="filter-btn" data-action="export-measures-csv" title="Download the current (filtered) measure list as CSV">⤓ CSV</button>
    </div>
    <div class="table-wrap"><table class="data-table"><thead><tr>
      <th data-action="sort" data-table="measures" data-key="name">Measure ↕</th><th data-action="sort" data-table="measures" data-key="table">Table ↕</th>
      <th data-action="sort" data-table="measures" data-key="usageCount">Used ↕</th><th data-action="sort" data-table="measures" data-key="pageCount">Pages ↕</th>
      <th>Dependencies</th><th>Used In</th><th>Format</th>
    </tr></thead><tbody id="tbody-measures"></tbody></table></div>
    <div class="panel-footer" id="footer-measures"></div>
  </div>

  <div class="panel" id="panel-columns">
    <div class="search-row">
      <input class="search-input" placeholder="Search columns..." data-action="filter" data-entity="columns">
      <button class="filter-btn" id="btn-unused-c" data-action="unused-filter" data-entity="columns">Not on visual</button>
      <button class="filter-btn" data-action="export-columns-csv" title="Download the current (filtered) column list as CSV">⤓ CSV</button>
    </div>
    <div class="table-wrap"><table class="data-table"><thead><tr>
      <th data-action="sort" data-table="columns" data-key="name">Column ↕</th><th data-action="sort" data-table="columns" data-key="table">Table ↕</th>
      <th data-action="sort" data-table="columns" data-key="dataType">Type ↕</th><th data-action="sort" data-table="columns" data-key="usageCount">Used ↕</th>
      <th data-action="sort" data-table="columns" data-key="pageCount">Pages ↕</th><th>Used In</th>
    </tr></thead><tbody id="tbody-columns"></tbody></table></div>
    <div class="panel-footer" id="footer-columns"></div>
  </div>

  <div class="panel" id="panel-tables"><div id="tables-content"></div></div>
  <div class="panel" id="panel-relationships"><div id="relationships-content"></div></div>
  <div class="panel" id="panel-sources">
    <div id="sources-view-toggle"></div>
    <div id="sources-content" class="sources-view"></div>
    <div id="sourcemap-content" class="sources-view" hidden></div>
  </div>
  <div class="panel" id="panel-functions"><div id="functions-content"></div></div>
  <div class="panel" id="panel-calcgroups"><div id="calcgroups-content"></div></div>
  <div class="panel" id="panel-pages"><div id="pages-content"></div></div>
  <div class="panel" id="panel-lineage">
    <div id="lineage-search-row" class="search-row" style="position:relative">
      <input class="search-input" id="lineage-search-input" placeholder="Search any measure or column to trace its lineage…" data-action="lineage-search" autocomplete="off">
      <!-- Dropdown background uses --tooltip-bg (solid in every theme,
           explicitly set for BluPulse where --surface is rgba). z-index
           50 keeps it above stat-card tooltips. -->
      <div id="lineage-search-results" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;max-height:340px;overflow-y:auto;background:var(--tooltip-bg,var(--bg));border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-md) var(--radius-md);margin-top:-1px;box-shadow:0 4px 12px rgba(0,0,0,0.25)"></div>
    </div>
    <div id="lineage-content"></div>
  </div>
  <div class="panel" id="panel-unused"><div id="unused-content"></div></div>
  <div class="panel" id="panel-docs">
    <div class="search-row">
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="filter-btn active" id="md-tab-model" data-action="md-tab" data-md="model">Model</button>
        <button class="filter-btn" id="md-tab-datadict" data-action="md-tab" data-md="datadict">Data Dictionary</button>
        <button class="filter-btn" id="md-tab-sources" data-action="md-tab" data-md="sources">Sources</button>
        <button class="filter-btn" id="md-tab-measures" data-action="md-tab" data-md="measures">Measures</button>
        <button class="filter-btn" id="md-tab-functions" data-action="md-tab" data-md="functions">Functions</button>
        <button class="filter-btn" id="md-tab-calcgroups" data-action="md-tab" data-md="calcgroups">Calc Groups</button>
        <button class="filter-btn" id="md-tab-pages" data-action="md-tab" data-md="pages">Pages</button>
        <button class="filter-btn" id="md-tab-improvements" data-action="md-tab" data-md="improvements">Improvements</button>
        <button class="filter-btn" id="md-tab-index" data-action="md-tab" data-md="index">Index</button>
      </div>
      <div style="flex:1"></div>
      <div style="display:flex;gap:4px" title="Lite — paste-into-wiki summary. Detailed — full reference for engineers.">
        <button class="filter-btn" id="md-lite-lite" data-action="md-lite-mode" data-mode="lite">Lite</button>
        <button class="filter-btn active" id="md-lite-detailed" data-action="md-lite-mode" data-mode="detailed">Detailed</button>
      </div>
      <div style="display:flex;gap:4px">
        <button class="filter-btn active" id="md-mode-rendered" data-action="md-mode" data-mode="rendered">Rendered</button>
        <button class="filter-btn" id="md-mode-raw" data-action="md-mode" data-mode="raw">Raw</button>
      </div>
      <button class="filter-btn" data-action="md-expand-all" title="Expand all collapsed sections">⊕ All</button>
      <button class="filter-btn" data-action="md-collapse-all" title="Collapse all sections">⊖ All</button>
      <button class="filter-btn" id="md-copy-btn" data-action="md-copy">⎘ Copy</button>
      <button class="filter-btn" data-action="md-download">⤓ Download</button>
    </div>
    <div class="md-subtitle" id="md-subtitle">Semantic-model documentation (no DAX)</div>
    <div id="md-rendered" class="md-rendered"></div>
    <pre id="md-source" class="md-source" style="display:none"></pre>
    <div class="panel-footer" id="footer-docs"></div>
  </div>
</div>

<!-- Footer bar — branding · status · version (CSS hides right on ≤900, left on ≤700). -->
<div class="refresh-bar" id="refresh-bar">
  <div class="rb-left">
    <span class="usage-map-badge">Usage Map</span>
    <span class="rb-sep">|</span>
    <span class="rb-report">${serverEscHtml(reportName)}</span>
  </div>
  <div class="rb-center">
    <span class="dot"></span>
    <span class="timer">Last scan ${ts}</span>
    <button data-action="reload">Re-scan</button>
  </div>
  <div class="rb-right">v${version}<span class="rb-sep">·</span>local<span class="rb-sep">·</span>no data leaves your machine</div>
</div>

<!-- DAX syntax highlighter (vendor/dax-highlight) — exposes window.DaxHighlight -->
<script>${DAX_HIGHLIGHT_JS}</script>
<script>
// Top-level bindings use 'let' rather than 'const' so that
// browser-mode can swap them after an empty shell has rendered.
// The inline CLIENT_JS closes over these names via Script scope;
// a 'const' would make the dynamic-load flow unable to update
// what the renderers see. CLI mode evaluates these literals once
// and never reassigns, so the change is benign there.
let DATA=${safeJSON(data)};
let MARKDOWN=${markdownLiteral};
let MARKDOWN_MEASURES=${measuresMarkdownLiteral};
let MARKDOWN_FUNCTIONS=${functionsMarkdownLiteral};
let MARKDOWN_CALCGROUPS=${calcGroupsMarkdownLiteral};
let MARKDOWN_DATADICT=${dataDictionaryMarkdownLiteral};
let MARKDOWN_SOURCES=${sourcesMarkdownLiteral};
let MARKDOWN_PAGES=${pagesMarkdownLiteral};
let MARKDOWN_INDEX=${indexMarkdownLiteral};
let MARKDOWN_IMPROVEMENTS=${improvementsMarkdownLiteral};
let MARKDOWN_CHANGELOG=${changelogMarkdownLiteral};
let MARKDOWN_WELCOME=${welcomeMarkdownLiteral};
// Lite-mode globals — empty when not baked. Dashboard's Docs-tab
// Lite/Detailed toggle picks between MARKDOWN_* and MARKDOWN_*_LITE.
let MARKDOWN_LITE=${markdownLiteLiteral};
let MARKDOWN_MEASURES_LITE=${measuresMarkdownLiteLiteral};
let MARKDOWN_FUNCTIONS_LITE=${functionsMarkdownLiteLiteral};
let MARKDOWN_CALCGROUPS_LITE=${calcGroupsMarkdownLiteLiteral};
let MARKDOWN_DATADICT_LITE=${dataDictionaryMarkdownLiteLiteral};
let MARKDOWN_SOURCES_LITE=${sourcesMarkdownLiteLiteral};
let MARKDOWN_PAGES_LITE=${pagesMarkdownLiteLiteral};
let MARKDOWN_INDEX_LITE=${indexMarkdownLiteLiteral};
let MARKDOWN_IMPROVEMENTS_LITE=${improvementsMarkdownLiteLiteral};
let REPORT_NAME=${safeJSON(reportName)};
let APP_VERSION=${safeJSON(version)};
let GENERATED_AT=${safeJSON(ts)};

// Client runtime — extracted to src/client/main.ts in Stop 5, inlined here from dist/client/main.js.
${CLIENT_JS}
</script>
</body>
</html>`;
}
