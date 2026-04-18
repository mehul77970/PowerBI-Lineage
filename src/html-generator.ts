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
  "dax-highlight/dax-highlight.js":  "07bb1b1e6fa859def53e69d6410841cc758fcb7aa0c168cc2abdf5341a5fa58c",
  "dax-highlight/dax-highlight.css": "fcbf17025b1da90d91055acf6407062da6687a8440b60da6aacfd2ea1ec09f1d",
};

function readVendor(relative: string): string {
  const candidates = [
    path.resolve(__dirname_html, "..", "vendor", relative),
    path.resolve(__dirname_html, "..", "..", "vendor", relative),
    path.resolve(process.cwd(), "vendor", relative),
  ];
  for (const p of candidates) {
    try {
      const bytes = fs.readFileSync(p);
      const expected = VENDOR_SHA256[relative];
      if (expected) {
        const actual = crypto.createHash("sha256").update(bytes).digest("hex");
        if (actual !== expected) {
          throw new Error(
            `vendor integrity check failed for ${relative}\n` +
            `  expected: ${expected}\n` +
            `  actual:   ${actual}\n` +
            `If you intentionally upgraded the vendor file, update VENDOR_SHA256 in src/html-generator.ts.`,
          );
        }
      }
      return bytes.toString("utf8");
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
    "render/md.js",   // Stop 5 pass 2 — markdown renderer
    "main.js",        // still the big one; gets smaller every pass
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
  qualityMarkdown: string = "",
  dataDictionaryMarkdown: string = "",
  version: string = "0.1.0"
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
  const qualityMarkdownLiteral = safeJSON(qualityMarkdown);
  const dataDictionaryMarkdownLiteral = safeJSON(dataDictionaryMarkdown);
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
      <div class="top"><span class="usage-map-badge">Usage Map</span><span class="header-sep">|</span><span class="header-sub">${serverEscHtml(reportName)}</span></div>
      <div class="timestamp">Generated: ${ts}</div>
    </div>
    <div class="header-actions">
      <button class="theme-btn" id="theme-btn" data-action="theme" title="Toggle light/dark theme" aria-label="Toggle theme">☾</button>
      <button class="refresh-btn" data-action="reload">↻ Refresh</button>
    </div>
  </div>
  <div class="summary" id="summary"></div>
  <div class="tabs" id="tabs"></div>

  <div class="panel" id="panel-measures">
    <div class="search-row">
      <input class="search-input" placeholder="Search measures..." data-action="filter" data-entity="measures">
      <button class="filter-btn" id="btn-unused-m" data-action="unused-filter" data-entity="measures">Not on visual</button>
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
  <div class="panel" id="panel-sources"><div id="sources-content"></div></div>
  <div class="panel" id="panel-functions"><div id="functions-content"></div></div>
  <div class="panel" id="panel-calcgroups"><div id="calcgroups-content"></div></div>
  <div class="panel" id="panel-pages"><div id="pages-content"></div></div>
  <div class="panel" id="panel-lineage"><div id="lineage-content"></div></div>
  <div class="panel" id="panel-unused"><div id="unused-content"></div></div>
  <div class="panel" id="panel-docs">
    <div class="search-row">
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="filter-btn active" id="md-tab-model" data-action="md-tab" data-md="model">Model</button>
        <button class="filter-btn" id="md-tab-datadict" data-action="md-tab" data-md="datadict">Data Dictionary</button>
        <button class="filter-btn" id="md-tab-measures" data-action="md-tab" data-md="measures">Measures</button>
        <button class="filter-btn" id="md-tab-functions" data-action="md-tab" data-md="functions">Functions</button>
        <button class="filter-btn" id="md-tab-calcgroups" data-action="md-tab" data-md="calcgroups">Calc Groups</button>
        <button class="filter-btn" id="md-tab-quality" data-action="md-tab" data-md="quality">Quality</button>
      </div>
      <div style="flex:1;color:var(--text-dim);font-size:12px;margin-left:8px" id="md-subtitle">Semantic-model documentation (no DAX)</div>
      <div style="display:flex;gap:4px">
        <button class="filter-btn active" id="md-mode-rendered" data-action="md-mode" data-mode="rendered">Rendered</button>
        <button class="filter-btn" id="md-mode-raw" data-action="md-mode" data-mode="raw">Raw</button>
      </div>
      <button class="filter-btn" data-action="md-expand-all" title="Expand all collapsed sections">⊕ All</button>
      <button class="filter-btn" data-action="md-collapse-all" title="Collapse all sections">⊖ All</button>
      <button class="filter-btn" id="md-copy-btn" data-action="md-copy">⎘ Copy</button>
      <button class="filter-btn" data-action="md-download">⤓ Download</button>
    </div>
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
const DATA=${safeJSON(data)};
const MARKDOWN=${markdownLiteral};
const MARKDOWN_MEASURES=${measuresMarkdownLiteral};
const MARKDOWN_FUNCTIONS=${functionsMarkdownLiteral};
const MARKDOWN_CALCGROUPS=${calcGroupsMarkdownLiteral};
const MARKDOWN_QUALITY=${qualityMarkdownLiteral};
const MARKDOWN_DATADICT=${dataDictionaryMarkdownLiteral};
const REPORT_NAME=${safeJSON(reportName)};
const APP_VERSION=${safeJSON(version)};
const GENERATED_AT=${safeJSON(ts)};

// Client runtime — extracted to src/client/main.ts in Stop 5, inlined here from dist/client/main.js.
${CLIENT_JS}
</script>
</body>
</html>`;
}
