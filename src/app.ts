#!/usr/bin/env node
/**
 * Standalone Power BI lineage dashboard app.
 * Double-click launch.bat → opens browser → pick report → see dashboard.
 */
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { buildFullData } from "./data-builder.js";
import { generateHTML } from "./html-generator.js";
import { generateMarkdown, generateMeasuresMd, generateFunctionsMd, generateCalcGroupsMd, generateQualityMd, generateDataDictionaryMd, generateSourcesMd, generatePagesMd, generateIndexMd } from "./md-generator.js";
import { findSemanticModelPath } from "./model-parser.js";
import { escHtml } from "./render/safe.js";
import { validateReportPath } from "./path-guard.js";

// Resolve the package version once at module load (falls back if unavailable).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.1.0";
  } catch { return "0.1.0"; }
})();

// ---------------------------------------------------------------------------
// Recent paths storage
// ---------------------------------------------------------------------------

const RECENTS_FILE = path.join(
  process.env.LOCALAPPDATA || process.env.HOME || ".",
  "powerbi-lineage",
  "recent-reports.json"
);

function loadRecents(): string[] {
  try {
    return JSON.parse(fs.readFileSync(RECENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveRecent(reportPath: string): void {
  const recents = loadRecents().filter(p => p !== reportPath);
  recents.unshift(reportPath);
  if (recents.length > 10) recents.length = 10;
  const dir = path.dirname(RECENTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RECENTS_FILE, JSON.stringify(recents, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Landing page HTML
// ---------------------------------------------------------------------------

function landingHTML(recents: string[], error?: string): string {
  const recentItems = recents.map(p => {
    const name = path.basename(p).replace(/\.Report$/, "");
    const parent = path.basename(path.dirname(p));
    // data-action="open-recent" + data-path=... — the delegated listener
    // reads dataset.path (browser-decoded), so a path containing quotes
    // or HTML-special characters can't break out of the attribute or
    // inject into a JS-string context. escAttr keeps the attribute safe.
    return `<button class="recent" data-action="open-recent" data-path="${escHtml(p)}">
      <span class="recent-name">${escHtml(name)}</span>
      <span class="recent-path">${escHtml(parent)}/${escHtml(path.basename(p))}</span>
    </button>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Power BI Lineage — Model Inspector</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body { min-height: 100vh; }
  body {
    font-family: 'DM Sans', system-ui, -apple-system, Segoe UI, sans-serif;
    color: #F9FAFB;
    background: #0B0D11;
    position: relative;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
  }

  /* ── Aurora mesh background (three drifting blobs) ─────────────────────── */
  .aurora {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .blob {
    position: absolute;
    width: 800px;
    height: 800px;
    border-radius: 50%;
    filter: blur(120px);
    will-change: transform;
  }
  .blob-amber  {
    background: radial-gradient(circle at center, #F59E0B 0%, transparent 60%);
    top: -20%;
    left: -15%;
    opacity: 0.14;
    animation: drift1 20s ease-in-out infinite alternate;
  }
  .blob-blue   {
    background: radial-gradient(circle at center, #3B82F6 0%, transparent 60%);
    top: 20%;
    right: -20%;
    opacity: 0.12;
    animation: drift2 22s ease-in-out infinite alternate;
  }
  .blob-purple {
    background: radial-gradient(circle at center, #8B5CF6 0%, transparent 60%);
    bottom: -25%;
    left: 25%;
    opacity: 0.10;
    animation: drift3 24s ease-in-out infinite alternate;
  }
  @keyframes drift1 { from { transform: translate(0, 0); }     to { transform: translate(4%, -3%); } }
  @keyframes drift2 { from { transform: translate(0, 0); }     to { transform: translate(-3%, 4%); } }
  @keyframes drift3 { from { transform: translate(0, 0); }     to { transform: translate(3%, 3%); } }

  /* ── Blueprint grid (CSS-only, fades at the edges) ─────────────────────── */
  .grid {
    position: fixed;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 40px 40px;
    -webkit-mask-image: radial-gradient(ellipse at center, black 20%, transparent 75%);
            mask-image: radial-gradient(ellipse at center, black 20%, transparent 75%);
  }

  /* ── Content stacking above background layers ─────────────────────────── */
  .stage {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  /* ── Frosted-glass card ───────────────────────────────────────────────── */
  .container {
    width: 560px;
    max-width: calc(100vw - 32px);
    padding: 56px 48px;
    background: rgba(17, 24, 39, 0.65);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
            backdrop-filter: blur(20px) saturate(140%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow:
      0 20px 60px rgba(0, 0, 0, 0.5),
      0 1px 0 rgba(255, 255, 255, 0.05) inset;
  }

  /* ── Hero badge ───────────────────────────────────────────────────────── */
  /* Shared "Usage Map" pill — see matching rule in html-generator.ts. */
  .usage-map-badge {
    display: inline-block;
    font: 10px/1 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #F59E0B;
    background: rgba(245, 158, 11, 0.05);
    border: 1px solid rgba(245, 158, 11, 0.18);
    -webkit-backdrop-filter: blur(6px);
            backdrop-filter: blur(6px);
    padding: 4px 10px;
    border-radius: 999px;
    margin-bottom: 18px;
  }

  /* ── Title + subtitle ─────────────────────────────────────────────────── */
  h1 {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin-bottom: 12px;
    background: linear-gradient(180deg, #F9FAFB 0%, #9CA3AF 100%);
    -webkit-background-clip: text;
            background-clip: text;
    color: transparent;
  }
  .subtitle {
    color: #D1D5DB;
    font-size: 14px;
    line-height: 1.6;
    max-width: 460px;
    margin-bottom: 34px;
  }

  /* ── Form ─────────────────────────────────────────────────────────────── */
  label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #D1D5DB;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .input-row {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  input[type="text"] {
    flex: 1;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 14px 16px;
    font-size: 15px;
    color: #F9FAFB;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    outline: none;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
    transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
  }
  input[type="text"]::placeholder { color: #6B7280; }
  input[type="text"]:focus {
    border-color: rgba(245, 158, 11, 0.5);
    background: rgba(0, 0, 0, 0.35);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4),
                0 0 0 3px rgba(245, 158, 11, 0.15);
  }

  button.go {
    background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
    color: #111827;
    border: none;
    border-radius: 10px;
    padding: 14px 24px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    letter-spacing: 0.02em;
    cursor: pointer;
    white-space: nowrap;
    box-shadow:
      0 8px 24px rgba(245, 158, 11, 0.25),
      0 1px 0 rgba(255, 255, 255, 0.2) inset;
    transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
  }
  button.go:hover {
    transform: translateY(-1px);
    box-shadow:
      0 12px 32px rgba(245, 158, 11, 0.35),
      0 1px 0 rgba(255, 255, 255, 0.25) inset;
    filter: brightness(1.05);
  }
  button.go:active { transform: translateY(0); }
  button.go:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.15);
  }

  .browse-btn {
    background: rgba(255, 255, 255, 0.04);
    color: #D1D5DB;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 14px 18px;
    font-size: 14px;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .browse-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.16);
    color: #F9FAFB;
  }
  .browse-btn:disabled { opacity: 0.6; cursor: wait; }

  .hint {
    font-size: 11px;
    color: #6B7280;
    margin-top: 4px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    letter-spacing: 0.02em;
  }

  /* ── Error banner (glass + red accent) ────────────────────────────────── */
  .error {
    background: rgba(127, 29, 29, 0.35);
    -webkit-backdrop-filter: blur(10px);
            backdrop-filter: blur(10px);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-left: 3px solid #EF4444;
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 13px;
    line-height: 1.5;
    color: #FCA5A5;
    margin-bottom: 20px;
  }

  /* ── Divider + recents list ───────────────────────────────────────────── */
  .divider {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin: 36px 0 22px;
  }
  h2 {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: #9CA3AF;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 14px;
  }
  .recents {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .recent {
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 12px 14px 12px 18px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    width: 100%;
    font-family: inherit;
    transition: transform 0.15s, border-color 0.15s, background 0.15s;
  }
  .recent::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: #F59E0B;
    transform: scaleY(0);
    transform-origin: center;
    transition: transform 0.2s;
  }
  .recent:hover {
    transform: translateX(2px);
    border-color: rgba(245, 158, 11, 0.4);
    background: rgba(255, 255, 255, 0.05);
  }
  .recent:hover::before { transform: scaleY(1); }
  .recent-name { font-size: 14px; font-weight: 600; color: #F9FAFB; }
  .recent-path { font-size: 11px; color: #6B7280; margin-top: 3px; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.02em; }

  /* ── Spinner ──────────────────────────────────────────────────────────── */
  .spinner {
    display: none;
    margin: 24px auto 0;
    width: 34px;
    height: 34px;
    border: 3px solid rgba(255, 255, 255, 0.08);
    border-top-color: #F59E0B;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    box-shadow: 0 0 24px rgba(245, 158, 11, 0.2);
  }
  .spinner.active { display: block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Footer ───────────────────────────────────────────────────────────── */
  .footer-line {
    margin-top: 22px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    color: #4B5563;
    letter-spacing: 0.03em;
    text-align: center;
  }
  .footer-line .dot { color: #374151; margin: 0 6px; }

  /* ── Reduced-motion: kill background drift + button lift + spinner ─── */
  @media (prefers-reduced-motion: reduce) {
    .blob,
    .spinner { animation: none !important; }
    button.go:hover,
    .recent:hover { transform: none; }
  }

  /* ── Narrow screens: soften padding ───────────────────────────────────── */
  @media (max-width: 560px) {
    .container { padding: 40px 28px; }
    h1 { font-size: 26px; }
    .input-row { flex-direction: column; }
  }
</style>
</head>
<body>

<!-- Aurora mesh: three drifting coloured blobs (hidden from assistive tech) -->
<div class="aurora" aria-hidden="true">
  <div class="blob blob-amber"></div>
  <div class="blob blob-blue"></div>
  <div class="blob blob-purple"></div>
</div>

<!-- Blueprint grid overlay, masked so it fades towards the edges -->
<div class="grid" aria-hidden="true"></div>

<div class="stage">
  <div class="container">
    <span class="usage-map-badge">Usage Map</span>
    <h1>Power BI Lineage</h1>
    <p class="subtitle">Point it at a <code style="font-family:'JetBrains Mono',ui-monospace,monospace;color:#E5E7EB;background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:4px;font-size:12px">.Report</code> folder and get a live map of every measure, column, table, relationship, and page &mdash; plus exportable documentation.</p>

    ${error ? `<div class="error">${escHtml(error)}</div>` : ""}

    <label for="rpath">Report path</label>
    <form id="form" action="/generate" method="GET">
      <div class="input-row">
        <input type="text" id="rpath" name="path" placeholder="C:\\Projects\\Sales.Report" value="" autocomplete="off" spellcheck="false"/>
        <button type="button" class="browse-btn" id="browse-btn" data-action="browse">Browse</button>
        <button type="submit" class="go" id="btn">Analyse</button>
      </div>
    </form>
    <p class="hint">Paste the full path or browse to your .Report folder</p>

    <div class="spinner" id="spinner"></div>

    ${recents.length > 0 ? `
    <div class="divider"></div>
    <h2>Recent reports</h2>
    <div class="recents">${recentItems}</div>
    ` : ""}
  </div>

  <div class="footer-line">v${APP_VERSION} <span class="dot">·</span> local <span class="dot">·</span> no data leaves your machine</div>
</div>

<script>
function openRecent(p) {
  document.getElementById('rpath').value = p;
  document.getElementById('form').submit();
  document.getElementById('spinner').classList.add('active');
  document.getElementById('btn').disabled = true;
}
document.getElementById('form').addEventListener('submit', function() {
  document.getElementById('spinner').classList.add('active');
  document.getElementById('btn').disabled = true;
});
window.addEventListener('pageshow', function() {
  document.getElementById('spinner').classList.remove('active');
  document.getElementById('btn').disabled = false;
});

// Native Windows folder-browser dialog via /pick-folder → PowerShell.
function pickFolder() {
  var btn = document.getElementById('browse-btn');
  btn.disabled = true;
  btn.textContent = 'Opening...';
  fetch('/pick-folder')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.path) document.getElementById('rpath').value = data.path;
    })
    .catch(function() {})
    .finally(function() { btn.disabled = false; btn.textContent = 'Browse'; });
}

// Event delegation — the recents list splices user-controlled paths
// into HTML attributes (data-path). Reading via dataset.path is
// structurally safe because the browser HTML-decodes the attribute
// before exposing it, so no path character can ever enter a JS parser.
document.addEventListener('click', function(e) {
  var el = e.target.closest && e.target.closest('[data-action]');
  if (!el) return;
  switch (el.getAttribute('data-action')) {
    case 'open-recent': openRecent(el.dataset.path); break;
    case 'browse':      pickFolder(); break;
  }
});
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function parseQuery(url: string): Record<string, string> {
  const q: Record<string, string> = {};
  const idx = url.indexOf("?");
  if (idx < 0) return q;
  url.slice(idx + 1).split("&").forEach(p => {
    const [k, v] = p.split("=");
    if (k) q[decodeURIComponent(k.replace(/\+/g, " "))] = decodeURIComponent((v || "").replace(/\+/g, " "));
  });
  return q;
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const pathname = url.split("?")[0];

  if (pathname === "/" || pathname === "/index.html") {
    const recents = loadRecents();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(landingHTML(recents));
    return;
  }

  if (pathname === "/pick-folder") {
    // Open native Windows folder picker dialog
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });

    if (process.platform === "win32") {
      // PowerShell folder browser dialog
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select your .Report folder'; $f.ShowNewFolderButton = $false; if($f.ShowDialog() -eq 'OK'){ $f.SelectedPath } else { '' }`;
      exec(`powershell -NoProfile -Command "${ps}"`, { timeout: 120000 }, (err: Error | null, stdout: string) => {
        const picked = (stdout || "").trim();
        res.end(JSON.stringify({ path: picked }));
      });
    } else {
      // macOS/Linux: fall back to empty (paste path instead)
      res.end(JSON.stringify({ path: "" }));
    }
    return;
  }

  if (pathname === "/generate") {
    const query = parseQuery(url);
    const validation = validateReportPath(query.path);

    if (!validation.ok) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(landingHTML(loadRecents(), validation.reason));
      return;
    }

    const resolved = validation.resolved;

    try {
      findSemanticModelPath(resolved);
    } catch (e) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(landingHTML(loadRecents(), (e as Error).message));
      return;
    }

    try {
      const data = buildFullData(resolved);
      const reportName = path.basename(resolved).replace(/\.Report$/, "");
      const modelMd = generateMarkdown(data, reportName);
      const measuresMd = generateMeasuresMd(data, reportName);
      const functionsMd = generateFunctionsMd(data, reportName);
      const calcGroupsMd = generateCalcGroupsMd(data, reportName);
      const qualityMd = generateQualityMd(data, reportName);
      const dataDictionaryMd = generateDataDictionaryMd(data, reportName);
      const sourcesMd = generateSourcesMd(data, reportName);
      const pagesMd = generatePagesMd(data, reportName);
      const indexMd = generateIndexMd(data, reportName);
      const html = generateHTML(data, reportName, modelMd, measuresMd, functionsMd, calcGroupsMd, qualityMd, dataDictionaryMd, APP_VERSION, sourcesMd, pagesMd, indexMd);
      saveRecent(resolved);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(landingHTML(loadRecents(), `Error generating dashboard: ${(e as Error).message}`));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Bind strictly to loopback. The landing page promises "no data leaves
// your machine" — binding to 0.0.0.0 / :: (Node's default) exposes the
// model + report to every device on the LAN. If someone later needs
// LAN access (NAS / VM / multi-machine workflow), it's five lines of
// opt-in code; for now the safe default wins.
const BIND_HOST = "127.0.0.1";

// Cap port retries at 20. Without a cap a misconfigured environment
// (or a fork bomb upstairs) would walk the entire port space silently.
// 5679..5698 is plenty for "another instance is already running".
const BIND_PORT_START = 5679;
const BIND_PORT_MAX = BIND_PORT_START + 20;

let port = BIND_PORT_START;
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    port++;
    if (port >= BIND_PORT_MAX) {
      console.error(`\n  Power BI Lineage`);
      console.error(`  All ports ${BIND_PORT_START}..${BIND_PORT_MAX - 1} are in use on 127.0.0.1.`);
      console.error(`  Close the other instance, or free a port, then try again.\n`);
      process.exit(1);
    }
    server.listen(port, BIND_HOST);
    return;
  }
  // Any other error is fatal — don't silently keep going.
  console.error(`\n  Power BI Lineage — startup error`);
  console.error(`  ${e.message}\n`);
  process.exit(1);
});

server.listen(port, BIND_HOST, () => {
  // Startup self-check: confirm we're actually bound to loopback.
  // If something goes wrong (weird OS, LD_PRELOAD, etc.) and we end up
  // on a public interface, we'd rather refuse to serve than quietly
  // violate the "no data leaves your machine" promise.
  const addr = server.address();
  const boundAddress =
    addr && typeof addr === "object" ? addr.address : null;

  const isLoopback =
    boundAddress === "127.0.0.1" ||
    boundAddress === "::1" ||
    boundAddress === "::ffff:127.0.0.1";

  if (!isLoopback) {
    console.error(`\n  Power BI Lineage — refusing to serve`);
    console.error(`  Server bound to non-loopback address: ${boundAddress ?? "unknown"}`);
    console.error(`  Expected 127.0.0.1. Aborting.\n`);
    server.close();
    process.exit(1);
  }

  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  Power BI Lineage`);
  console.log(`  ${url}\n`);

  // Open in browser
  const cmd = process.platform === "win32"
    ? `start "" "${url}"`
    : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd);
});
