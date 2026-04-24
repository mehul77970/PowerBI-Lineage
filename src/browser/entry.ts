/**
 * Browser-mode entry shell.
 *
 * Runtime flow:
 *   1. Detect File System Access API support (Chrome / Edge / Opera).
 *   2. On "Open folder" click, prompt the user to pick the PBIP
 *      project folder (the parent of `.Report` + `.SemanticModel`).
 *   3. Walk the handle, collect every text file into a Map.
 *   4. Install the map as the fs-shim VFS.
 *   5. Locate the `.Report` folder inside the picked folder and run
 *      the existing parser + data-builder against the VFS path.
 *   6. Also run every md-generator so the Docs tab is populated.
 *   7. Populate the dashboard's globals (`DATA`, `pageData`, …) and
 *      call the same bootstrap sequence the server mode emits.
 *   8. Hide the landing overlay.
 *
 * No parser code is touched — `fs` and `path` imports are redirected
 * to our shims via the import-map in index.html.
 */

import { __setVFS } from "./fs-shim.js";
import { walkDirectoryHandle, walkIntoMap, isFsaSupported } from "./fsa-walk.js";
import { buildFullData } from "../data-builder.js";
import {
  generateMarkdown,
  generateMeasuresMd,
  generateFunctionsMd,
  generateCalcGroupsMd,
  generateDataDictionaryMd,
  generateSourcesMd,
  generatePagesMd,
  generateIndexMd,
} from "../md-generator.js";
import { generateImprovementsMd } from "../improvements.js";

// ─────────────────────────────────────────────────────────────────────
// Types — we intentionally don't import the global `window` augmentation
// because the server-mode main.js doesn't declare types. Everything
// here is cast through `as unknown as ...` at call sites.
// ─────────────────────────────────────────────────────────────────────

type BrowserWindow = Window & {
  DATA?: unknown;
  pageData?: unknown;
  // Render functions the inline main.js exposes on the global scope.
  renderSummary?: () => void;
  renderTabs?: () => void;
  renderMeasures?: () => void;
  renderColumns?: () => void;
  renderTables?: () => void;
  renderRelationships?: () => void;
  renderSources?: () => void;
  renderFunctions?: () => void;
  renderCalcGroups?: () => void;
  renderPages?: () => void;
  renderUnused?: () => void;
  renderDocs?: () => void;
  switchTab?: (id: string) => void;
  addCopyButtons?: () => void;
  // Markdown bodies the Docs tab reads.
  MARKDOWN?: string;
  MEASURES_MD?: string;
  FUNCTIONS_MD?: string;
  CALCGROUPS_MD?: string;
  DATA_DICTIONARY_MD?: string;
  APP_VERSION?: string;
  REPORT_PATH?: string;
  REPORT_NAME?: string;
};

// ─────────────────────────────────────────────────────────────────────
// DOM helpers — the landing overlay is simple: one div the main
// dashboard sits behind, with a "Open folder" button and status line.
// ─────────────────────────────────────────────────────────────────────

const overlay = () => document.getElementById("br-overlay");
const status = () => document.getElementById("br-status");
const pickButton = () => document.getElementById("br-pick") as HTMLButtonElement | null;
const sampleButton = () => document.getElementById("br-sample") as HTMLButtonElement | null;

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  const el = status();
  if (!el) return;
  el.textContent = message;
  el.className = "br-status br-status--" + kind;
}

function showOverlay(): void {
  const el = overlay();
  if (el) el.classList.remove("br-overlay--hidden");
}

function hideOverlay(): void {
  const el = overlay();
  if (el) el.classList.add("br-overlay--hidden");
}

// ─────────────────────────────────────────────────────────────────────
// Main flow
// ─────────────────────────────────────────────────────────────────────

type DirHandle = { name: string; entries(): AsyncIterable<[string, unknown]> };

/**
 * Open a native folder picker. Throws AbortError if the user
 * cancels; throws a plain Error for any other failure. Returns
 * the raw handle so callers can inspect `name` before walking.
 */
async function openDirectoryPicker(): Promise<DirHandle> {
  const w = globalThis as unknown as {
    showDirectoryPicker: (opts?: unknown) => Promise<DirHandle>;
  };
  return await w.showDirectoryPicker({ mode: "read" });
}

/**
 * Strip the trailing ".Report" or ".SemanticModel" suffix (case-
 * insensitive) to derive a project prefix the user can recognise
 * (e.g., "training.Report" → "training", so we can say "now pick
 * training.SemanticModel").
 */
function reportPrefix(name: string): string {
  return name.replace(/\.(Report|SemanticModel)$/i, "");
}

async function pickAndLoad(): Promise<void> {
  if (!isFsaSupported()) {
    setStatus(
      "Browser mode needs the File System Access API. Open this page in Chrome, Edge, or Opera.",
      "error",
    );
    return;
  }

  let handle: DirHandle;
  try {
    handle = await openDirectoryPicker();
  } catch (e) {
    const err = e as DOMException;
    if (err.name === "AbortError") {
      setStatus("Cancelled. Click 'Open folder' to try again.");
      return;
    }
    setStatus(`Couldn't open folder: ${err.message}`, "error");
    return;
  }

  const pickedName = handle.name;
  // eslint-disable-next-line no-console
  console.log(`[entry] Picked folder: "${pickedName}"`);

  // ── Two-step path: user picked a `.Report` (or `.SemanticModel`)
  // directly. The File System Access API doesn't grant sibling
  // access, so we walk this handle now and then prompt the user to
  // pick the matching companion folder. Both get merged into a
  // synthetic `/virt/__pbip/…` parent so the parser's sibling-scan
  // finds them as peers.
  if (/\.report$/i.test(pickedName) || /\.semanticmodel$/i.test(pickedName)) {
    await beginTwoStepPick(handle);
    return;
  }

  // ── Parent-pick path: walker reads everything, then we scan for
  // .Report + .SemanticModel candidates.
  setStatus(`Reading ${pickedName}…`);
  let files: Map<string, string>;
  try {
    files = await walkDirectoryHandle(handle, pickedName);
  } catch (e) {
    setStatus(`Couldn't read folder: ${(e as Error).message}`, "error");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[entry] Walker read ${files.size} text files under /virt/${pickedName}`);

  const candidates = scanPairCandidates(files, pickedName);
  // eslint-disable-next-line no-console
  console.log(`[entry] Pair scan: ${candidates.reports.length} report(s), ${candidates.semanticModels.length} model(s)`);

  // Fast path: exactly one Report + one SemanticModel AND the pair
  // validates. No selection UI, no extra click — just auto-load.
  if (candidates.reports.length === 1 && candidates.semanticModels.length === 1) {
    const verdict = validatePair(files, candidates.reports[0], candidates.semanticModels[0]);
    if (verdict.kind === "paired") {
      await processFiles(files, pickedName, /*fromSample=*/ false);
      return;
    }
  }

  // Anything else → pair-picker UI. Zero candidates = error message.
  // Multiple candidates or mismatch = user picks explicitly.
  if (candidates.reports.length === 0 && candidates.semanticModels.length === 0) {
    setStatus(
      `No PBIP content found in "${pickedName}". Pick a folder that contains a .Report folder, a .SemanticModel folder, or both.`,
      "error",
    );
    return;
  }
  showPairPicker(files, pickedName, candidates);
}

// ─────────────────────────────────────────────────────────────────────
// Two-step picker — handles the "pick .Report directly" flow
// ─────────────────────────────────────────────────────────────────────

/**
 * Called after the user picks a `.Report` or `.SemanticModel` folder
 * directly. Walks the first handle and swaps the overlay to prompt
 * for the matching companion.
 */
async function beginTwoStepPick(firstHandle: DirHandle): Promise<void> {
  const firstName = firstHandle.name;
  const firstIsReport = /\.report$/i.test(firstName);
  const prefix = reportPrefix(firstName);
  const needKind = firstIsReport ? "SemanticModel" : "Report";
  const needLabel = prefix ? `${prefix}.${needKind}` : `.${needKind}`;

  setStatus(`Reading ${firstName}…`);
  const firstFiles = new Map<string, string>();
  try {
    // Mount under the synthetic parent so the final VFS layout has
    // .Report and .SemanticModel as siblings of a shared root.
    await walkIntoMap(firstHandle, `/virt/__pbip/${firstName}`, firstFiles);
  } catch (e) {
    setStatus(`Couldn't read ${firstName}: ${(e as Error).message}`, "error");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[entry] Step 1: walked ${firstFiles.size} text files under /virt/__pbip/${firstName}`);

  showStep2Prompt(needLabel, firstName, firstFiles, firstIsReport);
}

/**
 * Swap the overlay's CTA row to a single "Select <X>" button that
 * drives step 2 of the two-step pick. Once the user picks the
 * companion, we walk it, merge into the first map, and run
 * processFiles against the synthetic `__pbip` root.
 */
function showStep2Prompt(
  needLabel: string,
  firstName: string,
  firstFiles: Map<string, string>,
  firstIsReport: boolean,
): void {
  const ctas = document.getElementById("br-ctas") as HTMLDivElement | null;
  if (!ctas) {
    setStatus("Internal error: CTA row missing. Reload the page.", "error");
    return;
  }

  // Remember the original CTA row so we can restore it if the user
  // cancels step 2.
  const originalCtas = ctas.innerHTML;
  // HTML-escape the user-controlled folder name so a cleverly-named
  // directory can't inject markup into the overlay. `needLabel`
  // derives from handle.name — trusted in practice (OS picker) but
  // belt-and-braces.
  const safeLabel = needLabel.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
  ctas.innerHTML = `
    <button id="br-step2" class="br-btn" type="button"
            style="background:#F59E0B;color:#0B0D11;"
            title="Pick the matching ${safeLabel} folder">
      Select ${safeLabel}
    </button>
    <button id="br-cancel-step2" class="br-btn" type="button"
            style="background:transparent;color:#CBD5E1;border:1px solid rgba(255,255,255,0.18);">
      Cancel
    </button>
  `;
  setStatus(
    `Got ${firstName}. Now pick ${needLabel} (must be a sibling of ${firstName}).`,
  );

  const step2Btn = document.getElementById("br-step2");
  const cancelBtn = document.getElementById("br-cancel-step2");

  const restore = (): void => {
    ctas.innerHTML = originalCtas;
    // Re-wire original buttons (they were destroyed when we replaced innerHTML)
    const newPick = pickButton();
    if (newPick) newPick.addEventListener("click", () => { void pickAndLoad(); });
    const newSample = sampleButton();
    if (newSample) newSample.addEventListener("click", () => { void loadSample(); });
  };

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      setStatus("Cancelled. Pick a different folder.");
      restore();
    });
  }

  if (step2Btn) {
    step2Btn.addEventListener("click", async () => {
      let second: DirHandle;
      try {
        second = await openDirectoryPicker();
      } catch (e) {
        const err = e as DOMException;
        if (err.name === "AbortError") {
          setStatus(`Cancelled. Click 'Select ${needLabel}' to try again.`);
          return;
        }
        setStatus(`Couldn't open folder: ${err.message}`, "error");
        return;
      }

      // Validate kind: must end with the opposite suffix from step 1
      const wantSuffix = firstIsReport ? /\.semanticmodel$/i : /\.report$/i;
      if (!wantSuffix.test(second.name)) {
        setStatus(
          `"${second.name}" isn't a ${needLabel} folder — pick a folder ending in .${firstIsReport ? "SemanticModel" : "Report"}.`,
          "error",
        );
        return;
      }

      setStatus(`Reading ${second.name}…`);
      try {
        await walkIntoMap(second, `/virt/__pbip/${second.name}`, firstFiles);
      } catch (e) {
        setStatus(`Couldn't read ${second.name}: ${(e as Error).message}`, "error");
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[entry] Step 2: merged, ${firstFiles.size} total files under /virt/__pbip`);

      // Hand off. The shared processFiles pipeline takes care of
      // finding the .Report, parsing, and rendering.
      await processFiles(firstFiles, "__pbip", /*fromSample=*/ false);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Parent-pick pair-picker — user picks a parent folder; we enumerate
// all `.Report` + `.SemanticModel` subfolders, let them choose which
// pair to load (or model-only), and validate the selection before
// enabling Load.
// ─────────────────────────────────────────────────────────────────────

interface PairCandidates {
  /** Top-level .Report dirs as virtual paths under /virt/<pickedName>/ */
  reports: string[];
  /** Top-level .SemanticModel dirs, same shape */
  semanticModels: string[];
}

/**
 * Scan the VFS map for every `*.Report` and `*.SemanticModel`
 * directory and return them as full virtual paths. We look at all
 * depths (some users nest projects under a workspace folder), then
 * dedupe — each unique dir appears once.
 */
function scanPairCandidates(
  files: Map<string, string>,
  pickedName: string,
): PairCandidates {
  const rootPrefix = `/virt/${pickedName}/`;
  const reports = new Set<string>();
  const models = new Set<string>();
  for (const key of files.keys()) {
    if (!key.startsWith(rootPrefix)) continue;
    const parts = key.slice(rootPrefix.length).split("/");
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const fullPath = rootPrefix + parts.slice(0, i + 1).join("/");
      if (/\.Report$/i.test(seg)) reports.add(fullPath);
      else if (/\.SemanticModel$/i.test(seg)) models.add(fullPath);
    }
  }
  // Sort by name so the picker renders alphabetically.
  const byBasename = (a: string, b: string): number =>
    (a.split("/").pop() || "").localeCompare(b.split("/").pop() || "");
  return {
    reports: [...reports].sort(byBasename),
    semanticModels: [...models].sort(byBasename),
  };
}

type PairVerdict =
  | { kind: "paired"; reason: "pbir" | "prefix"; message: string }
  | { kind: "mismatch"; expected: string; message: string };

/**
 * Decide whether a given .Report / .SemanticModel pair belongs
 * together. Three-tier:
 *   1. pbir pointer in <report>/definition.pbir resolves to the
 *      selected .SemanticModel → authoritative match
 *   2. Filename prefixes match (training.Report ↔ training.SemanticModel)
 *      → heuristic match
 *   3. Neither → hard mismatch; caller disables Load.
 */
function validatePair(
  files: Map<string, string>,
  reportPath: string,
  semanticPath: string,
): PairVerdict {
  const reportName = reportPath.split("/").pop() || "";
  const modelName = semanticPath.split("/").pop() || "";
  const reportPrefix_ = reportName.replace(/\.Report$/i, "");
  const modelPrefix = modelName.replace(/\.SemanticModel$/i, "");

  // Tier 1: pbir authoritative pointer
  const pbirKey = reportPath + "/definition.pbir";
  const pbirContent = files.get(pbirKey);
  if (pbirContent) {
    try {
      const parsed = JSON.parse(pbirContent) as {
        datasetReference?: { byPath?: { path?: string } };
      };
      const rawPath = parsed.datasetReference?.byPath?.path;
      if (rawPath) {
        // The pbir path is relative; extract just the final segment
        // (basename) since the selected .SemanticModel is known by
        // name, not by a cross-picker path.
        const expectedModel = rawPath.split(/[/\\]/).pop() || "";
        if (expectedModel.toLowerCase() === modelName.toLowerCase()) {
          return {
            kind: "paired",
            reason: "pbir",
            message: `Report paired with this model (via pbir)`,
          };
        }
        return {
          kind: "mismatch",
          expected: expectedModel,
          message: `Report's pbir points to "${expectedModel}", not "${modelName}".`,
        };
      }
    } catch {
      /* malformed pbir — fall through to prefix match */
    }
  }

  // Tier 2: prefix heuristic
  if (reportPrefix_ && modelPrefix &&
      reportPrefix_.toLowerCase() === modelPrefix.toLowerCase()) {
    return {
      kind: "paired",
      reason: "prefix",
      message: `Prefix match — assumed paired`,
    };
  }

  // Tier 3: mismatch
  return {
    kind: "mismatch",
    expected: reportPrefix_ ? `${reportPrefix_}.SemanticModel` : "",
    message: reportPrefix_
      ? `"${reportName}" doesn't match "${modelName}" — expected "${reportPrefix_}.SemanticModel".`
      : `"${reportName}" and "${modelName}" don't appear to be paired.`,
  };
}

const NONE_VALUE = "__none";
const escForAttr = (s: string): string => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]!));

/**
 * Render the pair-picker overlay. Radio groups for .Report and
 * .SemanticModel; live validation below the lists drives the
 * Load button's enabled state.
 */
function showPairPicker(
  files: Map<string, string>,
  pickedName: string,
  candidates: PairCandidates,
): void {
  const card = document.querySelector(".br-card");
  if (!card) {
    setStatus("Internal error: overlay card missing.", "error");
    return;
  }
  const originalHtml = card.innerHTML;

  const nameOnly = (p: string): string => p.split("/").pop() || "";

  // Pre-select the default pair: first report + matching model (or
  // first model if no match), or "(none)" for the report when there
  // are no reports at all.
  let defaultReport: string = candidates.reports[0] || NONE_VALUE;
  let defaultModel: string = candidates.semanticModels[0] || "";
  if (defaultReport !== NONE_VALUE && candidates.semanticModels.length > 1) {
    // Try to find a prefix-matching model
    const rName = nameOnly(defaultReport);
    const rPrefix = rName.replace(/\.Report$/i, "");
    const match = candidates.semanticModels.find(m => {
      const mName = nameOnly(m);
      return mName.replace(/\.SemanticModel$/i, "").toLowerCase() === rPrefix.toLowerCase();
    });
    if (match) defaultModel = match;
  }

  const reportRadios = [
    ...candidates.reports.map(p => {
      const n = nameOnly(p);
      return `<label class="br-radio"><input type="radio" name="br-pair-report" value="${escForAttr(p)}"${p === defaultReport ? " checked" : ""}>${escForAttr(n)}</label>`;
    }),
    `<label class="br-radio br-radio--none"><input type="radio" name="br-pair-report" value="${NONE_VALUE}"${defaultReport === NONE_VALUE ? " checked" : ""}>(none — semantic model only)</label>`,
  ].join("");

  const modelRadios = candidates.semanticModels.map(p => {
    const n = nameOnly(p);
    return `<label class="br-radio"><input type="radio" name="br-pair-model" value="${escForAttr(p)}"${p === defaultModel ? " checked" : ""}>${escForAttr(n)}</label>`;
  }).join("") || `<p class="br-empty">No .SemanticModel folder found under "${escForAttr(pickedName)}".</p>`;

  card.innerHTML = `
    <h1>Power BI Documenter</h1>
    <p class="br-lede" style="margin:8px 0 20px">Choose what to document from <code>${escForAttr(pickedName)}</code>.</p>

    <div class="br-pair-picker">
      <div class="br-pair-col">
        <h3>Report</h3>
        ${reportRadios}
      </div>
      <div class="br-pair-col">
        <h3>Semantic Model</h3>
        ${modelRadios}
      </div>
    </div>

    <div id="br-pair-verdict" class="br-pair-verdict" aria-live="polite"></div>

    <div class="br-ctas">
      <button id="br-pair-cancel" class="br-btn" type="button"
              style="background:transparent;color:#CBD5E1;border:1px solid rgba(255,255,255,0.18);">
        Cancel
      </button>
      <button id="br-pair-load" class="br-btn" type="button"
              style="background:#F59E0B;color:#0B0D11;">
        Load
      </button>
    </div>
  `;

  const verdictEl = document.getElementById("br-pair-verdict");
  const loadBtn = document.getElementById("br-pair-load") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("br-pair-cancel");

  const getSelected = (): { reportPath: string | null; modelPath: string } => {
    const r = document.querySelector<HTMLInputElement>('input[name="br-pair-report"]:checked');
    const m = document.querySelector<HTMLInputElement>('input[name="br-pair-model"]:checked');
    const rVal = r?.value || NONE_VALUE;
    return {
      reportPath: rVal === NONE_VALUE ? null : rVal,
      modelPath: m?.value || "",
    };
  };

  const updateVerdict = (): void => {
    if (!verdictEl || !loadBtn) return;
    const sel = getSelected();

    // Must have a model selected
    if (!sel.modelPath) {
      verdictEl.innerHTML = `<span class="br-v-error">Select a semantic model to continue.</span>`;
      loadBtn.disabled = true;
      return;
    }

    // Model-only mode: no report selected
    if (sel.reportPath === null) {
      verdictEl.innerHTML = `<span class="br-v-info">Model-only mode — pages and usage stats will be empty.</span>`;
      loadBtn.disabled = false;
      return;
    }

    // Full mode: validate pair
    const verdict = validatePair(files, sel.reportPath, sel.modelPath);
    if (verdict.kind === "paired") {
      verdictEl.innerHTML = `<span class="br-v-ok">✓ ${escForAttr(verdict.message)}</span>`;
      loadBtn.disabled = false;
    } else {
      verdictEl.innerHTML = `<span class="br-v-error">✗ ${escForAttr(verdict.message)} Pick a matching pair, or set Report to "(none)" for model-only.</span>`;
      loadBtn.disabled = true;
    }
  };

  // Wire radio change events
  document.querySelectorAll<HTMLInputElement>('input[name="br-pair-report"], input[name="br-pair-model"]')
    .forEach(r => r.addEventListener("change", updateVerdict));

  updateVerdict();

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      card.innerHTML = originalHtml;
      rewireLandingButtons();
      setStatus("Cancelled. Pick a different folder.");
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      const sel = getSelected();
      if (!sel.modelPath || loadBtn.disabled) return;

      setStatus("Loading selection…");
      // eslint-disable-next-line no-console
      console.log(`[entry] Pair picker: report="${sel.reportPath || "(none)"}", model="${sel.modelPath}"`);

      // Filter the VFS to only the selected pair's files, remount
      // under a synthetic `/virt/__pbip/` parent so processFiles'
      // pickedName is stable regardless of the original parent name.
      const filtered = filterAndRemount(files, sel.reportPath, sel.modelPath);

      if (sel.reportPath === null) {
        // Model-only: synthesize an empty .Report shell so the parser
        // can still run. data-builder calls findSemanticModelPath then
        // scanReportBindings — without a .Report folder the second
        // call explodes, so we manufacture a stub report with no
        // pages/visuals. Done here (browser) so CLI stays untouched.
        installModelOnlyShim(filtered, sel.modelPath);
      }

      await processFiles(filtered, "__pbip", /*fromSample=*/ false);
    });
  }
}

/**
 * Keep only files under the selected Report + SemanticModel paths,
 * and remap them under `/virt/__pbip/<basename>/…` so the parser's
 * sibling scan finds them as peers regardless of the parent name.
 */
function filterAndRemount(
  files: Map<string, string>,
  reportPath: string | null,
  modelPath: string,
): Map<string, string> {
  const reportPrefix = reportPath ? reportPath + "/" : null;
  const modelPrefix = modelPath + "/";
  const reportBase = reportPath ? reportPath.split("/").pop() || "" : "";
  const modelBase = modelPath.split("/").pop() || "";
  const out = new Map<string, string>();

  for (const [key, val] of files) {
    if (reportPrefix && key.startsWith(reportPrefix)) {
      const rest = key.slice(reportPrefix.length);
      out.set(`/virt/__pbip/${reportBase}/${rest}`, val);
    } else if (key.startsWith(modelPrefix)) {
      const rest = key.slice(modelPrefix.length);
      out.set(`/virt/__pbip/${modelBase}/${rest}`, val);
    }
  }
  return out;
}

/**
 * Model-only mode shim: the parser's `buildFullData()` calls both
 * `findSemanticModelPath` AND `scanReportBindings`. Without a
 * .Report the latter would throw. We fabricate a minimal .Report
 * folder with an empty pages directory so everything resolves, and
 * the resulting FullData has zero pages/visuals — exactly what
 * "model-only" means.
 *
 * The synthesised .Report is named after the model's prefix so
 * findSemanticModelPath's prefix-matching still resolves cleanly.
 */
function installModelOnlyShim(
  files: Map<string, string>,
  modelPath: string,
): void {
  const modelBase = modelPath.split("/").pop() || "";
  const prefix = modelBase.replace(/\.SemanticModel$/i, "") || "model-only";
  const reportBase = `${prefix}.Report`;

  files.set(`/virt/__pbip/${reportBase}/definition.pbir`, JSON.stringify({
    version: "1.0",
    datasetReference: { byPath: { path: `../${modelBase}` } },
  }));
  // Empty pages list — scanReportBindings yields zero pages/visuals.
  files.set(`/virt/__pbip/${reportBase}/definition/pages/pages.json`, JSON.stringify({
    pageOrder: [],
    activePageName: "",
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json",
  }));
  files.set(`/virt/__pbip/${reportBase}/report.json`, JSON.stringify({
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.2.0/schema.json",
    resourcePackages: [],
  }));
}

/**
 * Re-attach click handlers after the overlay card's innerHTML has
 * been rebuilt (either by Cancel-out of the pair picker or by the
 * "Load another" header button). Idempotent — if buttons aren't
 * present yet, we silently do nothing.
 */
function rewireLandingButtons(): void {
  const p = pickButton();
  if (p && isFsaSupported()) p.addEventListener("click", () => { void pickAndLoad(); });
  else if (p) p.disabled = true;
  const s = sampleButton();
  if (s) s.addEventListener("click", () => { void loadSample(); });
}

/**
 * Shared back-half of the load flow — detect the `.Report` folder,
 * install the VFS, parse, render. Used by both the folder picker
 * and the "Try a sample" button.
 */
async function processFiles(
  files: Map<string, string>,
  pickedName: string,
  fromSample: boolean,
): Promise<void> {
  if (files.size === 0) {
    // The two-step picker handles the ".Report / .SemanticModel
    // picked directly" case upstream, so if we arrive here with zero
    // files it's because the user picked an unrelated folder.
    setStatus(
      `No PBIP files found in "${pickedName}". Pick a PBIP project parent folder, or the .Report folder directly (the picker will then ask for the matching .SemanticModel).`,
      "error",
    );
    return;
  }

  setStatus(`Read ${files.size} files. Parsing model…`);

  // Install the VFS so the synchronous parser can read from it.
  __setVFS({ files });

  // Find the `.Report` folder inside the picked folder. The walker
  // seeds paths under `/virt/<pickedName>/…`; scan for `.Report` as
  // a direct or nested child.
  const reportPath = findReportRoot(files, pickedName);
  // eslint-disable-next-line no-console
  console.log(`[entry] findReportRoot("${pickedName}") →`, reportPath || "(null — no .Report folder found)");
  if (!reportPath) {
    setStatus(
      `No .Report folder found under "${pickedName}". Pick a PBIP project parent folder, or the .Report folder directly (the picker will then ask for the matching .SemanticModel).`,
      "error",
    );
    return;
  }

  // Yield once so the status message paints before parse kicks off.
  await new Promise(r => setTimeout(r, 10));

  let fullData;
  try {
    fullData = buildFullData(reportPath);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[entry] Parser threw while processing "${reportPath}" (fromSample=${fromSample}):`, e);
    setStatus(`Parser error: ${(e as Error).message}`, "error");
    return;
  }

  const reportName = reportPath
    .split("/").pop()!
    .replace(/\.Report$/i, "");

  // eslint-disable-next-line no-console
  console.log(`[entry] Parsed "${reportName}": ${fullData.tables.length} tables, ${fullData.measures.length} measures, ${fullData.pages.length} pages`);
  setStatus(`Parsed ${fullData.tables.length} tables. Rendering docs…`);
  await new Promise(r => setTimeout(r, 10));

  // Generate all 9 MD exports the Docs tab reads.
  let md = "", measuresMd = "", functionsMd = "", calcGroupsMd = "",
      dataDictionaryMd = "", sourcesMd = "", pagesMd = "", indexMd = "",
      improvementsMd = "";
  try {
    md = generateMarkdown(fullData, reportName);
    measuresMd = generateMeasuresMd(fullData, reportName);
    functionsMd = generateFunctionsMd(fullData, reportName);
    calcGroupsMd = generateCalcGroupsMd(fullData, reportName);
    dataDictionaryMd = generateDataDictionaryMd(fullData, reportName);
    sourcesMd = generateSourcesMd(fullData, reportName);
    pagesMd = generatePagesMd(fullData, reportName);
    indexMd = generateIndexMd(fullData, reportName);
    improvementsMd = generateImprovementsMd(fullData, reportName);
  } catch (e) {
    // MD generation is secondary — log but don't block the dashboard.
    // eslint-disable-next-line no-console
    console.warn("[entry] MD generation partial-failure:", e);
  }

  // Hand off to the dashboard renderer already loaded in this page.
  applyToDashboard(fullData, reportName, reportPath, {
    md, measuresMd, functionsMd, calcGroupsMd, dataDictionaryMd,
    sourcesMd, pagesMd, indexMd, improvementsMd,
  });

  hideOverlay();
  setStatus("");
}

/**
 * Fetches docs/sample-data.json (baked at build time from sample/),
 * populates the VFS, and runs the shared processFiles pipeline. No
 * folder picker, no permission prompt — the data is same-origin.
 *
 * Payload shape:
 *   { version: 1, pickedName: "sample", files: { "/virt/sample/…": "text" } }
 */
async function loadSample(): Promise<void> {
  setStatus("Fetching sample…");
  // eslint-disable-next-line no-console
  console.log("[entry] Fetching ./sample-data.json");

  let payload: { version: number; pickedName: string; files: Record<string, string> };
  try {
    const res = await fetch("./sample-data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    setStatus(
      `Couldn't load sample: ${(e as Error).message}. Try again or use "Open folder".`,
      "error",
    );
    return;
  }

  if (!payload || !payload.files || payload.version !== 1) {
    setStatus(
      "Sample file is malformed. Rebuild the site or use 'Open folder'.",
      "error",
    );
    return;
  }

  const files = new Map<string, string>(Object.entries(payload.files));
  // eslint-disable-next-line no-console
  console.log(`[entry] Sample loaded: ${files.size} files, pickedName="${payload.pickedName}"`);

  await processFiles(files, payload.pickedName, /*fromSample=*/ true);
}

/**
 * Scan the VFS keys to find a `.Report` directory. Most PBIP projects
 * have it as a direct child of the picked folder; we support nested
 * layouts too by taking the shortest match.
 */
function findReportRoot(files: Map<string, string>, pickedName: string): string | null {
  const rootPrefix = `/virt/${pickedName}/`;
  const seen = new Set<string>();
  for (const key of files.keys()) {
    if (!key.startsWith(rootPrefix)) continue;
    // walk segments to find any *.Report directory
    const rest = key.slice(rootPrefix.length);
    const parts = rest.split("/");
    for (let i = 0; i < parts.length; i++) {
      if (/\.Report$/i.test(parts[i])) {
        const candidate = rootPrefix + parts.slice(0, i + 1).join("/");
        seen.add(candidate);
      }
    }
  }
  if (seen.size === 0) return null;
  // Prefer the shallowest candidate (usually the one the user intended)
  return [...seen].sort((a, b) => a.length - b.length)[0];
}

interface MarkdownBundle {
  md: string;
  measuresMd: string;
  functionsMd: string;
  calcGroupsMd: string;
  dataDictionaryMd: string;
  sourcesMd: string;
  pagesMd: string;
  indexMd: string;
  improvementsMd: string;
}

/**
 * Hand the parsed data + rendered MDs off to the dashboard runtime.
 *
 * Why this is delegated: the renderers in src/client/main.ts close
 * over the top-level `let DATA` + `let MARKDOWN_*` bindings declared
 * in src/html-generator.ts. Those `let`s live in the inline script's
 * Script scope, which is invisible to this (module) code. Setting
 * `window.DATA = …` from here creates a separate variable the
 * renderers ignore — we'd render the empty build-time shell forever.
 *
 * The fix: main.ts installs `window.__loadBrowserData(opts)` inside
 * the same Script scope, so the hook has reach to mutate DATA in
 * place, reassign the primitive `let`s, refill `pageData`, and
 * re-run every renderer. Here we just shape the opts payload.
 */
function applyToDashboard(
  data: unknown,
  reportName: string,
  reportPath: string,
  md: MarkdownBundle,
): void {
  const w = window as BrowserWindow & {
    __loadBrowserData?: (opts: unknown) => void;
    REPORT_PATH?: string;
  };

  // REPORT_PATH is informational (shown in some tooltips) and lives
  // outside the Script-scoped lets — a plain window property is fine.
  w.REPORT_PATH = reportPath;

  if (typeof w.__loadBrowserData !== "function") {
    // eslint-disable-next-line no-console
    console.error(
      "[entry] window.__loadBrowserData missing — dashboard script didn't install its bootstrap hook. Check the html-generator + main.ts build.",
    );
    return;
  }

  const nowTs = new Date().toISOString().replace("T", " ").substring(0, 16);
  w.__loadBrowserData({
    data,
    reportName,
    generatedAt: nowTs,
    appVersion: "browser",
    markdown: {
      md: md.md,
      measuresMd: md.measuresMd,
      functionsMd: md.functionsMd,
      calcGroupsMd: md.calcGroupsMd,
      dataDictionaryMd: md.dataDictionaryMd,
      sourcesMd: md.sourcesMd,
      pagesMd: md.pagesMd,
      indexMd: md.indexMd,
      improvementsMd: md.improvementsMd,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Wire up on DOM ready
// ─────────────────────────────────────────────────────────────────────

function init(): void {
  // The sample button ships enabled — the sample-data.json is
  // committed alongside this script, so it always deploys as a
  // unit. If fetch fails at click-time (edge case: GitHub Pages
  // CDN hiccup) loadSample() surfaces a clear error.
  //
  // Earlier versions of this code used a HEAD probe to conditionally
  // enable the button. That introduced a race where a quick
  // first-click happened before the probe finished, felt like
  // "nothing happened". Always-enabled is simpler and more robust.
  const sBtn = sampleButton();
  if (sBtn) {
    sBtn.addEventListener("click", () => { void loadSample(); });
  }

  // Repurpose the header "Re-scan" button for browser mode. The CLI
  // version does `location.reload()` (which re-runs the server-side
  // parser); in browser mode that would just dump the loaded
  // dashboard and force another file pick. Instead: re-open the
  // overlay, restore default CTAs, let the user switch report
  // without a hard refresh.
  const reloadBtn = document.querySelector<HTMLButtonElement>(
    'button[data-action="reload"]',
  );
  if (reloadBtn) {
    reloadBtn.textContent = "Load another";
    reloadBtn.title = "Pick a different PBIP — keeps the current tab alive";
    // Swap the data-action so main.ts's delegator no longer fires
    // location.reload, and attach our own handler.
    reloadBtn.setAttribute("data-action", "browser-switch-report");
    reloadBtn.addEventListener("click", reopenPicker);
  }

  if (!isFsaSupported()) {
    setStatus(
      "Folder picker needs the File System Access API — open this page in Chrome, Edge, or Opera. You can still click 'Try a sample' above.",
      "error",
    );
    const btn = pickButton();
    if (btn) btn.disabled = true;
    // Leave the overlay visible so the sample button stays clickable.
    showOverlay();
    return;
  }
  showOverlay();
  const btn = pickButton();
  if (btn) btn.addEventListener("click", () => { void pickAndLoad(); });
}

/**
 * Bring the landing overlay back up so the user can pick a new
 * report. Restores default CTA buttons (in case the two-step flow
 * had swapped them mid-pick) and clears any lingering status text.
 */
function reopenPicker(): void {
  // Restore the default CTA row — step-2 might have replaced it.
  const ctas = document.getElementById("br-ctas");
  if (ctas) {
    ctas.innerHTML = `
      <button id="br-pick" class="br-btn" type="button">Open folder</button>
      <button id="br-sample" class="br-btn" type="button" title="Load the bundled sample PBIP — runs entirely in-browser">Try a sample</button>
    `;
    const newPick = pickButton();
    if (newPick) {
      if (!isFsaSupported()) newPick.disabled = true;
      else newPick.addEventListener("click", () => { void pickAndLoad(); });
    }
    const newSample = sampleButton();
    if (newSample) newSample.addEventListener("click", () => { void loadSample(); });
  }
  setStatus("");
  showOverlay();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
