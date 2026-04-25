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

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
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

// Bake the full changelog into the shell so browser users can see
// what's new via the Docs tab without leaving the app.
//
// 0.8.0+: the source of truth is `changelog/<x.y.z>.md` — one file
// per release. We concatenate them newest-first into a single MD
// body, prepended with the same Keep-a-Changelog intro the old
// monolithic CHANGELOG.md carried. The root `CHANGELOG.md` file is
// now a thin pointer (for GitHub display) and deliberately NOT used
// here.
const changelogMd = buildChangelog();

function buildChangelog() {
  const dir = resolve(repoRoot, "changelog");
  if (!existsSync(dir)) return "";

  // SemVer-aware descending sort (so 0.10.0 would sort above 0.9.0
  // even though "0.10.0" < "0.9.0" lexically). Files named with a
  // non-matching shape (README.md, sparks, drafts) are skipped.
  const files = readdirSync(dir)
    .filter(f => /^\d+\.\d+\.\d+\.md$/.test(f))
    .map(f => ({
      file: f,
      parts: f.replace(/\.md$/, "").split(".").map(Number),
    }))
    .sort((a, b) =>
      b.parts[0] - a.parts[0] ||
      b.parts[1] - a.parts[1] ||
      b.parts[2] - a.parts[2]);

  const intro =
    `# Changelog\n\n` +
    `All notable changes to **PowerBI-Lineage** are recorded here, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).\n\n` +
    `---\n\n`;

  const body = files
    .map(({ file }) => readFileSync(resolve(dir, file), "utf8").trim())
    .join("\n\n---\n\n");

  return intro + body + "\n";
}

// Curated welcome / dashboard-tour doc for the "What's new" popup.
// Same pattern as CHANGELOG — build-time read, bake into the shell,
// survives __loadBrowserData swaps (not report-specific).
const welcomePath = resolve(repoRoot, "WHATS-NEW.md");
const welcomeMd = existsSync(welcomePath) ? readFileSync(welcomePath, "utf8") : "";

const html = generateHTML(
  emptyData, "(browser)", "", "", "", "", "", "", "0",
  "", "", "", changelogMd, welcomeMd,
);

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

  /* Secondary actions under the trust chips. Understated text-link
     styling (no border, no background) so they sit as footnotes,
     not CTAs — the primary CTAs above stay the clear focal point.
     Single centred row with a · separator. */
  .br-links {
    margin-top: 12px;
    display: flex; justify-content: center; align-items: center;
    gap: 10px;
    font-size: 11.5px;
  }
  .br-linkish {
    background: transparent;
    border: 0;
    padding: 0;
    color: #94A3B8;
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    text-decoration: none;
    transition: color .12s;
  }
  .br-linkish:hover { color: #E2E8F0; text-decoration: underline; }
  .br-link-sep { color: #4A5566; user-select: none; }

  [data-theme="light"] .br-linkish { color: #475569; }
  [data-theme="light"] .br-linkish:hover { color: #0F172A; }
  [data-theme="light"] .br-link-sep { color: #CBD5E1; }
  [data-theme="blupulse"] .br-linkish:hover { color: #C4B5FD; }
  [data-theme="blupulse"] .br-link-sep { color: rgba(255,255,255,0.20); }

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

  /* Theme picker on the landing overlay — 3 small circular swatches.
     Dashboard header keeps its single cycle-button; this gives
     landing-page visitors a direct pick without having to learn the
     cycle. Active swatch gets a highlighted ring. */
  .br-theme-picker {
    margin-top: 18px; display: flex; align-items: center; justify-content: center;
    gap: 8px; font-size: 11px; color: #6B7280;
  }
  .br-theme-label { letter-spacing: 0.03em; }
  .br-theme-swatch {
    width: 28px; height: 28px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.04);
    color: #CBD5E1; font-size: 13px; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: transform .1s, border-color .12s, background .12s;
  }
  .br-theme-swatch:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.3); }
  .br-theme-swatch.active { border-color: #F59E0B; box-shadow: 0 0 0 2px rgba(245,158,11,0.18); }
  .br-theme-swatch--dark     { background: linear-gradient(135deg, #0B0D11, #1A1D27); }
  .br-theme-swatch--light    { background: linear-gradient(135deg, #F1F5F9, #FFFFFF); color: #0F172A; }
  .br-theme-swatch--blupulse { background: linear-gradient(135deg, #0B1030, #3B82F6 70%, #8B5CF6); color: rgba(255,255,255,0.92); }

  /* ── Theme-aware landing overlay ──────────────────────────────────
     Originally the overlay had hardcoded dark colours and ignored the
     data-theme attribute — swatch clicks updated the dashboard behind
     but left the landing card looking identical. These overrides fix
     that by repainting the overlay, card, lede, features box, trust
     chips, and picker swatches per theme. Active-swatch ring reuses
     each theme's accent for consistency with the dashboard.          */

  /* Light theme — near-white backdrop, navy text, amber-ring active */
  [data-theme="light"] #br-overlay {
    background: rgba(248, 250, 252, 0.92);
    color: #0F172A;
  }
  [data-theme="light"] .br-card {
    background: rgba(255, 255, 255, 0.90);
    border-color: rgba(15, 23, 42, 0.10);
    box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
  }
  [data-theme="light"] .br-card h1 {
    background: linear-gradient(180deg, #0F172A 0%, #475569 100%);
    -webkit-background-clip: text; background-clip: text;
  }
  [data-theme="light"] .br-tagline { color: #D97706; }
  [data-theme="light"] .br-lede { color: #1E293B; }
  [data-theme="light"] .br-features {
    background: rgba(15, 23, 42, 0.03);
    border-color: rgba(15, 23, 42, 0.08);
    color: #334155;
  }
  [data-theme="light"] .br-features .br-dot { background: #D97706; }
  [data-theme="light"] #br-pick { background: #D97706; color: #FFFFFF; }
  [data-theme="light"] #br-sample {
    background: transparent; color: #334155;
    border: 1px solid rgba(15, 23, 42, 0.18);
  }
  [data-theme="light"] #br-sample:hover:not(:disabled) {
    border-color: rgba(15, 23, 42, 0.3);
    background: rgba(15, 23, 42, 0.03);
  }
  [data-theme="light"] .br-trust { color: #64748B; }
  [data-theme="light"] .br-status { color: #64748B; }
  [data-theme="light"] .br-hint { color: #94A3B8; }
  [data-theme="light"] .br-hint a { color: #475569; }
  [data-theme="light"] .br-hint a:hover { color: #0F172A; }
  [data-theme="light"] .br-theme-picker { color: #94A3B8; }
  [data-theme="light"] .br-theme-swatch {
    border-color: rgba(15, 23, 42, 0.12);
    background: rgba(15, 23, 42, 0.03);
    color: #475569;
  }
  [data-theme="light"] .br-theme-swatch:hover { border-color: rgba(15, 23, 42, 0.3); }
  /* Light theme's active swatch keeps the amber ring — consistent
     with the dashboard's amber accent in light mode. */

  /* BluPulse theme — aurora-tinted overlay, purple accent */
  [data-theme="blupulse"] #br-overlay {
    background:
      radial-gradient(900px 520px at 18% 12%, rgba(59,130,246,0.22), transparent 60%),
      radial-gradient(860px 520px at 82% 18%, rgba(139,92,246,0.20), transparent 60%),
      rgba(7, 10, 26, 0.92);
  }
  [data-theme="blupulse"] .br-card {
    background: rgba(11, 16, 48, 0.78);
    border-color: rgba(255, 255, 255, 0.10);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
  }
  [data-theme="blupulse"] .br-tagline { color: #A78BFA; }
  [data-theme="blupulse"] .br-features { background: rgba(255, 255, 255, 0.04); }
  [data-theme="blupulse"] .br-features .br-dot { background: #8B5CF6; }
  [data-theme="blupulse"] #br-pick { background: #8B5CF6; color: #FFFFFF; }
  [data-theme="blupulse"] #br-pick:hover {
    box-shadow: 0 6px 18px rgba(139, 92, 246, 0.45);
  }
  /* Active-swatch ring picks up each theme's accent so the landing
     picker feels like it belongs in the chosen palette. */
  [data-theme="blupulse"] .br-theme-swatch.active {
    border-color: #8B5CF6;
    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.22);
  }
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
      <span>270 tests</span>
      <span>·</span>
      <span>Zero runtime deps</span>
    </div>

    <div class="br-links">
      <button type="button" class="br-linkish" data-action="show-whats-new" title="Tour the dashboard's panels + what each one shows">ℹ About</button>
      <span class="br-link-sep" aria-hidden="true">·</span>
      <a class="br-linkish" href="https://github.com/jonathan-pap/PowerBI-Lineage" target="_blank" rel="noopener">View on GitHub →</a>
    </div>

    <div id="br-status" class="br-status" aria-live="polite"></div>

    <div class="br-hint">
      Requires Chrome, Edge, or Opera (File System Access API).<br>
      Firefox / Safari users: <a href="https://github.com/jonathan-pap/PowerBI-Lineage#running" target="_blank" rel="noopener">run the local CLI</a>.
    </div>

    <div class="br-theme-picker" role="group" aria-label="Theme">
      <span class="br-theme-label">Theme:</span>
      <button type="button" class="br-theme-swatch br-theme-swatch--dark"
              data-action="theme-set" data-theme-name="dark" data-theme-swatch="dark"
              title="Dark (default)" aria-label="Dark theme">☾</button>
      <button type="button" class="br-theme-swatch br-theme-swatch--light"
              data-action="theme-set" data-theme-name="light" data-theme-swatch="light"
              title="Light" aria-label="Light theme">☀</button>
      <button type="button" class="br-theme-swatch br-theme-swatch--blupulse"
              data-action="theme-set" data-theme-name="blupulse" data-theme-swatch="blupulse"
              title="BluPulse — dark navy with blue-to-purple aurora" aria-label="BluPulse theme">✦</button>
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
