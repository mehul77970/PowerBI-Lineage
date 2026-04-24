#!/usr/bin/env node
/**
 * build-browser.mjs — assemble `docs/` for the static browser build.
 *
 * Steps:
 *   1. Render a dashboard shell by calling the existing `generateHTML`
 *      with an empty `FullData`. That gives us all the panel divs,
 *      inlined CSS, the vendored DAX highlighter, and the compiled
 *      client main.js the renderer expects — exactly what the server
 *      mode produces.
 *   2. Post-process the HTML: inject an import-map (redirecting `fs`
 *      and `path` bare-imports to our shims), the browser entry
 *      module, and the "Open folder" overlay.
 *   3. Write to `docs/index.html`.
 *
 * The browser-compiled TS modules (data-builder, model-parser, etc.)
 * were already emitted to `docs/` by `tsc -p tsconfig.browser.json` —
 * this script runs AFTER that step and just wires the shell.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFullData } from "../dist/data-builder.js";
import { generateHTML } from "../dist/html-generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const docsDir = resolve(repoRoot, "docs");

// ─────────────────────────────────────────────────────────────────────
// 1. Empty FullData — minimal shape that survives every renderer.
//    We deliberately DON'T pass a real report; the shell is meant to
//    render with zero data and populate at runtime.
// ─────────────────────────────────────────────────────────────────────

const emptyData = {
  measures: [], columns: [], relationships: [], functions: [],
  calcGroups: [], tables: [], pages: [], hiddenPages: [], allPages: [],
  expressions: [], compatibilityLevel: null,
  modelProperties: {
    name: "(no model loaded)",
    description: "",
    culture: "",
    sourceQueryCulture: "",
    discourageImplicitMeasures: false,
    valueFilterBehavior: "",
    cultures: [],
    defaultPowerBIDataSourceVersion: "",
  },
  totals: {
    measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
    columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
    relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
  },
};

const html = generateHTML(emptyData, "(browser)", "", "", "", "", "", "", "0");

// ─────────────────────────────────────────────────────────────────────
// 2. Inject browser wiring.
//
// - Import map: every bare `import "fs"` / `import "path"` inside the
//   compiled modules gets redirected to our shims. ES modules need an
//   absolute-or-relative URL here, so we use document-relative paths
//   (`./browser/...`) which also work under a sub-path deploy like
//   `gh-pages/PowerBI-Lineage/`.
//
// - Landing overlay: sits on top of the dashboard; hidden once the
//   user picks a folder and the render chain re-runs with real data.
//
// - Entry module: loads LAST so the dashboard's render globals are
//   defined before the entry wires up click handlers.
// ─────────────────────────────────────────────────────────────────────

const importMap = `
<script type="importmap">
{
  "imports": {
    "fs": "./browser/fs-shim.js",
    "path": "./browser/path-shim.js"
  }
}
</script>
`.trim();

const overlayStyles = `
<style>
  #br-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(11, 13, 17, 0.92);
    -webkit-backdrop-filter: blur(12px);
            backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Sans', system-ui, -apple-system, Segoe UI, sans-serif;
    color: #F9FAFB;
    transition: opacity .18s ease;
  }
  #br-overlay.br-overlay--hidden { opacity: 0; pointer-events: none; }

  .br-card {
    max-width: 600px;
    padding: 44px 44px 36px;
    background: rgba(17, 24, 39, 0.78);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    text-align: center;
    transition: max-width .18s ease;
  }
  /* Expanded state for the pair picker — wider card stops long
     folder names from wrapping across the two radio columns.
     Capped so the card doesn't span a 4K monitor; word-break in
     .br-radio stays as the belt-and-braces fallback for truly
     extreme names. */
  .br-card.br-card--wide {
    max-width: min(960px, 95vw);
  }
  .br-card h1 {
    margin: 0 0 4px;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(180deg, #F9FAFB 0%, #9CA3AF 100%);
    -webkit-background-clip: text;
            background-clip: text;
    color: transparent;
  }
  .br-tagline {
    margin: 0 0 20px;
    font-size: 13px;
    color: #F59E0B;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .br-lede { margin: 0 0 22px; color: #D1D5DB; font-size: 14.5px; line-height: 1.55; }
  .br-features {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px 16px;
    margin: 0 0 24px;
    padding: 16px 18px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    text-align: left;
    font-size: 12.5px;
    color: #CBD5E1;
  }
  .br-features span { display: flex; align-items: baseline; gap: 8px; }
  .br-features .br-dot {
    display: inline-block;
    width: 4px; height: 4px;
    background: #F59E0B;
    border-radius: 50%;
    flex-shrink: 0;
    transform: translateY(-2px);
  }

  .br-ctas {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
    margin: 0 0 14px;
  }
  .br-btn {
    display: inline-block;
    padding: 12px 22px;
    border: 0;
    border-radius: 8px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: transform .1s, box-shadow .1s, background .15s, border-color .15s;
  }
  #br-pick { background: #F59E0B; color: #0B0D11; }
  #br-pick:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(245,158,11,0.4); }
  #br-pick:disabled { background: #4B5563; color: #9CA3AF; cursor: not-allowed; transform: none; box-shadow: none; }
  #br-sample {
    background: transparent;
    color: #CBD5E1;
    border: 1px solid rgba(255,255,255,0.18);
  }
  #br-sample:hover:not(:disabled) { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.03); }
  #br-sample:disabled { color: #6B7280; cursor: not-allowed; border-color: rgba(255,255,255,0.08); }

  /* ── Pair picker (parent-pick flow) ─────────────────────────── */
  .br-pair-picker {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 14px 0 18px;
    text-align: left;
  }
  .br-pair-col {
    padding: 14px 14px 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
  }
  .br-pair-col h3 {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94A3B8;
  }
  .br-radio {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 2px;
    font-size: 13px;
    color: #E2E8F0;
    cursor: pointer;
    line-height: 1.35;
    word-break: break-word;
  }
  .br-radio:hover { color: #F9FAFB; }
  .br-radio input[type="radio"] { margin-top: 3px; accent-color: #F59E0B; flex-shrink: 0; }
  .br-radio--none { color: #94A3B8; font-style: italic; }
  .br-empty { color: #F87171; font-size: 12px; margin: 6px 2px; }

  .br-pair-verdict {
    min-height: 22px;
    margin: 6px 0 14px;
    font-size: 12.5px;
    line-height: 1.4;
    text-align: left;
  }
  .br-v-ok    { color: #22C55E; }
  .br-v-info  { color: #94A3B8; }
  .br-v-error { color: #F87171; }

  .br-trust {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: #94A3B8;
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .br-trust span { white-space: nowrap; }
  .br-trust .br-lock { color: #10B981; }

  .br-status {
    margin-top: 18px;
    font-size: 12px;
    min-height: 18px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    color: #94A3B8;
  }
  .br-status--error { color: #F87171; }
  .br-hint { margin-top: 20px; font-size: 11px; color: #6B7280; line-height: 1.5; }
  .br-hint a { color: #9CA3AF; }
  .br-hint a:hover { color: #F9FAFB; }
</style>
`.trim();

// Landing overlay — "Documenter" framing.
//
// Changes from the original "Lineage" shell:
//   • Outcome-first: the tagline + lede say what the user GETS, not
//     what they DO. Competitor research (pbip-documenter) shows
//     outcome-first framing lifts first-click conversion.
//   • Feature grid summarises the 9 MD docs + dashboard in ~60 chars
//     each, so a first-time visitor sees the scope before deciding.
//   • Secondary CTA: "Try a sample" placeholder. The button is
//     disabled with a "Coming soon" chip — we'll wire in a bundled
//     sample report in a follow-up.
//   • Trust chips: privacy promise (already) + test-suite signal +
//     zero-deps + CLI escape-hatch for Firefox/Safari users.
//
// Repo name stays `PowerBI-Lineage`; only the UI-facing framing
// shifts to "Documenter". Lineage is still a feature — the
// per-measure Mermaid DAGs in measures.md, the star fragments in
// data-dictionary.md — but it's one capability, not the whole tool.
const overlayHtml = `
<div id="br-overlay">
  <div class="br-card">
    <h1>Power BI Documenter</h1>
    <p class="br-tagline">Lineage · Audit · Wiki-ready Markdown</p>
    <p class="br-lede">Open a PBIP project folder — get a searchable dashboard plus nine Markdown docs ready for ADO Wiki or GitHub.</p>

    <div class="br-features">
      <span><span class="br-dot"></span>Measures, columns, tables, UDFs</span>
      <span><span class="br-dot"></span>Relationships + star fragments</span>
      <span><span class="br-dot"></span>Pages, visuals, bindings</span>
      <span><span class="br-dot"></span>Sources + composite-model proxies</span>
      <span><span class="br-dot"></span>Model glossary (A–Z index)</span>
      <span><span class="br-dot"></span>15-check health audit</span>
    </div>

    <div id="br-ctas" class="br-ctas">
      <button id="br-pick" class="br-btn" type="button" title="Pick either a PBIP project parent folder OR the .Report folder directly — a two-step prompt will ask for the matching .SemanticModel when needed">Open folder</button>
      <button id="br-sample" class="br-btn" type="button" title="Load the bundled sample PBIP — runs entirely in-browser">Try a sample</button>
    </div>

    <div class="br-trust">
      <span class="br-lock">🔒 Files stay on your machine</span>
      <span>·</span>
      <span>157 tests</span>
      <span>·</span>
      <span>Zero runtime deps</span>
    </div>

    <div id="br-status" class="br-status" aria-live="polite"></div>

    <div class="br-hint">
      Requires Chrome, Edge, or Opera (File System Access API).<br>
      Firefox / Safari users: <a href="https://github.com/jonathan-pap/PowerBI-Lineage#running" target="_blank" rel="noopener">run the local CLI</a>.
    </div>
  </div>
</div>
<script type="module" src="./browser/entry.js"></script>
`.trim();

// Splice everything in right before </body>. The import map has to
// appear BEFORE the entry <script type="module"> or the browser won't
// apply it to the entry's transitive imports.
const injection = `${importMap}\n${overlayStyles}\n${overlayHtml}\n`;

let patched = html.replace(/<\/body>/i, injection + "</body>");

if (patched === html) {
  console.error("build-browser: couldn't find </body> marker to inject overlay + entry. Shell generator output changed?");
  process.exit(1);
}

// Rewrite the page <title> to match the landing-overlay framing.
// The CLI-side `generateHTML()` composes it from the reportName
// we passed (`"(browser)"`) as `Model Usage - (browser)`; for the
// browser-mode bundle the landing overlay is the first thing users
// see, so the tab title should match its tagline.
const titleBefore = patched.match(/<title>[^<]*<\/title>/i)?.[0];
patched = patched.replace(/<title>[^<]*<\/title>/i, "<title>Power BI Documenter</title>");
if (titleBefore === undefined) {
  console.error("build-browser: couldn't find <title> tag to rewrite. Shell generator output changed?");
  process.exit(1);
}

writeFileSync(resolve(docsDir, "index.html"), patched, "utf8");

// A .nojekyll marker tells GitHub Pages not to run Jekyll (which
// ignores files/folders starting with `_`). We do have an `_measures`
// reference inside generated content that could theoretically confuse
// Jekyll, so flag it off to be safe.
writeFileSync(resolve(docsDir, ".nojekyll"), "", "utf8");

// eslint-disable-next-line no-console
console.log(`build-browser: wrote ${patched.length} bytes to docs/index.html`);
