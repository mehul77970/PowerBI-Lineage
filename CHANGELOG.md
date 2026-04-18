# Changelog

All notable changes to **PowerBI-Lineage** are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the project is still pre-1.0, the convention is:

- `0.x.0` — new user-visible features or refactors with behaviour change
- `0.x.y` (`y > 0`) — patches, infrastructure, or hardening that doesn't change the user-visible UI

Sections in each release follow the Keep-a-Changelog vocabulary: **Added**, **Changed**, **Fixed**, **Security**, **Removed**, **Deprecated**.

---

## [0.6.0] — 2026-04-18 · Generated-MD pass (branch `feat/md-improvements`)

User-visible MD output quality release. The six companion documents (`model.md`, `measures.md`, `functions.md`, `calc-groups.md`, `quality.md`, `data-dictionary.md`) now correctly surface composite-model metadata and stop drowning Quality signals in Power-BI-generated auto-date infrastructure noise. Minor-version bump because the content of what users export has changed meaningfully.

### Added
- **Composite-model surfacing in `measures.md`** — new "External proxy measures" summary section grouped by remote Analysis Services model (cluster URL, type, local↔remote name mapping). Front-matter card gains an "External proxies" row. Each proxy measure's collapsible details block carries an "External source" table. Status tag reads "external proxy" not "_unused_"; Status meta shows the `External proxy` badge. 23 new proxy mentions on H&S (was 0).
- **`quality.md` proxy-protection section** — §2 "Removal candidates" split into four subsections:
  - 2.1 Unused measures (real removal candidates — proxies excluded)
  - 2.2 Unused columns (auto-date columns excluded)
  - 2.3 **External proxy measures — DO NOT REMOVE** — listed with a warning so nobody deletes the composite-model contract
  - 2.4 Auto-date infrastructure columns (collapsed `<details>`)
- **`data-dictionary.md` auto-date appendix** — a collapsed section at the bottom listing every `LocalDateTable_<guid>` / `DateTableTemplate_<guid>` table for completeness. Main doc body covers user tables only.
- **`model.md` auto-date appendix** — collapsed `<details>` right below Tables-by-role; infrastructure visible-on-demand.
- **Structured AS-Database parsing in `model.md` §3.2** — `AnalysisServices.Database(cluster, db)` expressions now render as `**AnalysisServices.Database** · cluster \`…\` · database \`…\`` instead of a generic 80-char truncated M body. Cluster URL + database name are preserved (previously eaten by the truncation).

### Changed
- **`model.md` headline counts** are now user-only. "53 tables" on H&S becomes "43 tables (+10 auto-date infrastructure, excluded)". §2.1 Schema summary role counts exclude auto-date (PB wires every `LocalDateTable` as a Dimension via relationship — they used to inflate that bucket).
- **`quality.md` §5 Documentation coverage denominators** now exclude auto-date infrastructure. Auto-date tables/columns can't be documented (they're auto-generated), so counting them against doc coverage was unfair arithmetic.
- **`quality.md` §6.1 Numeric columns without format string** drops auto-date. H&S: 41 rows → 1 actionable row (`Date Period NEW Comparison[Rolling Date]`) — previously hidden inside 40 rows of PB-generated noise.
- **`data-dictionary.md` Jump-to nav** trimmed from ~2600 chars to ~1850 (53 → 43 entries). Default `Summarize by: none` and `Category: Uncategorized` values in column tables replaced with em-dashes (~95% of rows on typical models carried defaults).
- **`model.md` §8 Report Pages** — display names whitespace-normalised, duplicate page names (same `displayName`) tagged with `_(duplicate name)_` so copy-paste accidents stand out.
- **`quality.md` "Inactive relationships: 0" → "none"** — unambiguous that we checked and found zero.

### Implementation
- New `TableRole` value `"Auto-date"` so the role classifier explicitly short-circuits infrastructure before the topology heuristics run.
- New shared helpers at the top of `src/md-generator.ts`: `isAutoDate`, `userTables`, `proxyTag`, `BADGE_PROXY`.
- Zero new data dependencies — `externalProxy` and `origin` were already plumbed through `data-builder.ts` by Stops 6.3 / 6.4. This release is the MD generator finally reading them.

### Test results
56 / 56 green (unchanged — this is a content-quality release, not a feature change to the data layer). Typecheck + build clean.

### Zero impact on non-composite models
All four changes are data-driven feature flags. If `data.expressions` has no EXTERNALMEASURE matches, there's no "External proxy" summary section. If no table carries `origin: "auto-date"`, the appendix / collapsed blocks don't emit. Models without these features produce byte-identical output to v0.5.2 modulo the whitespace-trim on page names and the "Inactive relationships" wording.

---

## [0.5.2] — 2026-04-18 · Post-/sc:analyze follow-ups (branch `polish/analyze-followups`)

Five commits closing every item from the previous analysis's "not addressed" list. No UX impact — all internal hardening + infrastructure.

### Security
- **Vendor integrity check.** `src/html-generator.ts` now pins SHA-256 hashes of every `vendor/` file in a `VENDOR_SHA256` map and verifies at module load. Mismatch throws loud — a tampered `vendor/` directory can't silently inline malicious JS into the generated dashboard. A paired test pins the known-good hash in a second place so desync between the two manifests fails in review. `vendor/dax-highlight/README.md` now covers the upgrade protocol (recompute hashes, update both manifests, run tests).
- **EXTERNALMEASURE regex handles DAX-style doubled quotes.** `"foo""bar"` is DAX for the string `foo"bar`; the previous `[^"]*` pattern silently truncated after the first quote. Switched to `(?:[^"]|"")*` with a post-match `undoubleDaxQuotes()` helper. Rare edge case but "silently truncate" is an uglier failure mode than "no match", and the fix is mechanical. Regression test covers three cases (vanilla, doubled-quote remote name, doubled-quote external model).

### Added
- **GitHub Actions CI** (`.github/workflows/ci.yml`) running `npm ci && npm run typecheck && npm test && npm run build` across Node 18 / 20 / 22 on every push and PR. `concurrency` block cancels stale runs on the same PR. Plus a sanity step that asserts `dist/app.js`, `dist/client/main.js`, and `dist/client/render/md.js` all got emitted — catches tsconfig regressions that would silently drop modules the generator inlines. **Zero new deps.** ESLint deliberately deferred (adding it means 3-4 new devDeps; `tsc --noEmit` already catches the big class of errors that matter).
- **`src/client/render/escape.ts`** — second type-safe module carved from `main.ts`. 60 lines covering `escHtml`, `escAttr`, `sc`, `uc` with proper `unknown`/`string`/`number` signatures and no `@ts-nocheck`. Added to the `readCompiledClient()` manifest in load-order (`escape.js` → `md.js` → `main.js`).

### Changed
- **`inferSource()` fast path.** Each of the ~45 connector patterns now carries a lowercase keyword (e.g. `"analysisservices.database"`); `inferSource()` lowercases the M body once per call and checks `indexOf(keyword)` before running the regex. Non-matching patterns skip their regex entirely. On the H&S composite model (48+ partitions) that's ~2,000 regex scans avoided per `generate()`. Same behaviour — every H&S integration test still passes.
- **`readCompiledClient()` manifest now 3 entries** (`render/escape.js`, `render/md.js`, `main.js`). Order documented inline.

### Test results
56 / 56 green (was 54, +2 — EXTERNALMEASURE doubled-quote + vendor integrity pin).

### Deliberately not in this release
- Further module carves (`components/badge.ts`, `components/chip.ts`, `panels/lineage.ts`, panel-per-tab). Pattern is now clearly established by `render/md.ts` + `render/escape.ts`; each remaining carve is a cheap follow-up PR.
- ESLint setup. See CI commit for rationale (devDep cost vs. `tsc --noEmit` already covering the big class of errors).

---

## [0.5.1] — 2026-04-18 · Post-Stop-6 cleanup: inline handlers, CSS extraction, first module carve (branch `stop-6/composite-model-fixes`)

Three housekeeping PRs from the `/sc:analyze` top-3 list, landed as one release.

### Security
- **Migrated the last two inline `oninput=` handlers** (Measures / Columns tab search inputs) to `data-action="filter" data-entity="measures|columns"`. Not a live XSS vector — both splices were static — but the inline form violated the "zero inline handlers in dashboard output" invariant that Stop 4 established, and the fuzz test only checked `onclick=` so they slipped past.
- **Tightened `tests/render-xss-fuzz.test.ts`** from `\sonclick\s*=` to `\son[a-z]+\s*=\s*['"]` — catches any inline on-handler (oninput, onchange, onsubmit, onmouseover, onerror, …). Quote requirement excludes harmless HTML-escaped text where `onerror=` is followed by `&quot;`.

### Added
- **`document.addEventListener('input', …)`** — parallel delegator to the existing click handler. Switch-case form so the "every emitted data-action verb has a matching case" test covers both.
- **`src/styles/dashboard.css`** — the full ~450-line `<style>` block that used to live inline in the template literal. A `/*__DAX_HIGHLIGHT_CSS__*/` marker token reserves the slot where the vendored DAX highlighter theme splices in at module load.
- **`src/client/render/md.ts`** — first module carved out of the monolithic client. 270 lines of type-safe TypeScript (no `@ts-nocheck`), handling every markdown block type the dashboard needs. Compiled as a script (no imports/exports), concatenated into the inline `<script>` before `main.js` by the generator.

### Changed
- **`src/html-generator.ts`: 667 → 246 lines (−63%).** The inline `<style>` block is now one line: `<style>${DASHBOARD_CSS}</style>`. Below the workflow's ≤ 250 target for the generator shell.
- **`readCompiledClient()`** generalised to a manifest of client modules. Current manifest:
  1. `render/md.js` — markdown renderer (this release)
  2. `main.js` — everything else (still ~970 lines, `@ts-nocheck`; future passes will carve more out)
  The manifest grows as more carves land.

### Test results
54 / 54 green (same count; the new md module doesn't need unit tests yet — its behaviour is exercised by the existing docs-tab integration and the render-xss-fuzz suite). Build, typecheck, live smoke against `test/Health_and_Safety.Report` all clean. Every md function (`mdEscapeHtml`, `mdInline`, `mdParseTable`, `mdRender`) appears exactly once in the concatenated output.

---

## [0.5.0] — 2026-04-18 · Stop 6 — composite-model fixes (branch `stop-6/composite-model-fixes`)

Closes every known gap the Health_and_Safety composite-model fixture exposed. Four discrete fixes, each with its own regression test, plus a new auto-date toggle in the Tables tab.

### Fixed
- **Task 6.1 — Multi-line TMDL expressions with quoted names parse correctly.** The `expression 'NAME'` regex used `\S+` for the name, which stopped at the first space inside quoted identifiers like `'DirectQuery to AS - Health_and_Safety_Gold'`. Every composite model silently parsed **zero** expressions, cascading into every DQ partition collapsing to "Unknown / M". Switched to `'[^']+'|"[^"]+"|[\w.-]+` so quoted names are captured.
- **Task 6.2 — Entity-partition source resolution via shared expressions.** TMDL composite partitions use `source` + nested `entityName: …` + `expressionSource: 'NAME'`, not inline M. The previous extractor only handled the `source = <inline M>` form. `extractTmdlPartitions` now accepts an expression table, follows `expressionSource` references, and runs `inferSource` against the resolved body. Result on H&S: 48 DQ partitions previously "Unknown / M" now resolve to **Analysis Services** with the real cluster URL (`powerbi://api.powerbi.com/…`). The partition-name regex was also fixed to handle quoted names with spaces (`partition 'Date NEW' = entity`).

### Added
- **Task 6.3 — Structured `externalProxy` field on `ModelMeasure`.** EXTERNALMEASURE proxy detection moved from render-time regex into `buildFullData`, populating `{ remoteName, type, externalModel, cluster }`. `cluster` resolves from the corresponding shared expression's `AnalysisServices.Database(...)` first argument. Downstream consumers (dashboard lineage card, measures MD export, future Quality rules) now read a structured field instead of each re-implementing the regex. Client keeps the render-time regex as a back-compat fallback for older `DATA` payloads.
- **Task 6.4 — `origin: "user" | "auto-date"` on `TableData`.** Tables matching `LocalDateTable_*` or `DateTableTemplate_*` are tagged as auto-date infrastructure. The client hides them from default counts on the Tables tab, Sources tab, and tab-count badges. A **toggle button** in the Tables-tab footer ("Show auto-date (N)" / "Hide auto-date (N)") opts them in. Default tab-count footer notes `+N auto-date hidden` so the count difference is discoverable.
- **`tests/composite-model.test.ts`** — 5 integration tests against the real H&S fixture covering every task above:
  1. expressions with quoted names parse
  2. every DQ partition resolves to Analysis Services
  3. EXTERNALMEASURE proxies get structured `externalProxy`
  4. proxy `cluster` URL resolves from the shared expression
  5. auto-date classification matches the naming convention exactly
  Tests gracefully skip if the fixture isn't checked out.

### Test results
54 / 54 green (was 49, +5). Typecheck and build clean. Live smoke against `test/Health_and_Safety.Report`:
- 53 tables total → 43 user + 10 auto-date
- 48 DQ partitions resolve to Analysis Services (was 0 before)
- 4 "Unknown / M" remaining are user-authored import `switch_*` dimension tables whose M doesn't match any built-in pattern and isn't expression-referenced (correctly out-of-scope)
- 19 EXTERNALMEASURE proxies tagged with full `externalProxy` incl. cluster URL
- Toggle button present in Tables-tab footer

---

## [0.4.0] — 2026-04-18 · Stop 5 pass 1 — client code extracted to `src/client/` (branch `stop-5/client-split`)

Architectural refactor. Client runtime is no longer embedded inside a template literal inside `src/html-generator.ts`; it now lives as a real TypeScript file that's compiled alongside the server and inlined at generation time. No user-visible behaviour change.

This is **pass 1** of the workflow's Stop 5 — a mechanical extraction that moves the whole ~1,100-line embedded script out in one go. Pass 2+ will carve `main.ts` into smaller `panels/`, `components/`, `render/`, and `state/` modules without needing another bulk-extraction turn.

### Added
- **`src/client/main.ts`** (1,134 lines) — every function, state variable, and bootstrap call that used to live inside the generator's embedded `<script>`. Written intentionally as a *script* (no imports, no exports) so tsc emits a plain browser-ready `.js` runs top-to-bottom.
- **`src/client/globals.d.ts`** — ambient declarations for the server-injected globals (`DATA`, `MARKDOWN*`, `REPORT_NAME`, `APP_VERSION`, `GENERATED_AT`, `DaxHighlight`) so the extracted code type-checks without pulling server-only types into the client tree.
- **`readCompiledClient()`** helper in `html-generator.ts` — reads `dist/client/main.js` at generation time (same three-candidate-path pattern as the DAX vendor files), strips the tsc-inserted `export {};` so the inline lands cleanly inside a classic `<script>`.

### Changed
- **`src/html-generator.ts`: 1,740 → 667 lines (−62%).** The generator now contains the HTML shell, the inline CSS, the data-injection block (`const DATA = …; const MARKDOWN = …;` etc.), and a single `${CLIENT_JS}` inline for the compiled client bundle. Remaining weight is mostly CSS — a follow-up PR can extract it to `src/styles/` and get us to the workflow's ≤ 250-line target.
- **No build-pipeline changes.** The existing root `tsconfig.json` already compiles `src/client/main.ts` → `dist/client/main.js` because `rootDir` is `./src`. Zero new scripts, zero new config files.

### Not included in this PR (deliberate)
- Carving `main.ts` into 16 smaller modules (panels, components, render, state). That's mechanically independent of the extraction itself and reviews more cleanly as a sequence of smaller PRs. The file has a `// @ts-nocheck` header so TypeScript doesn't flag the untyped client code — each future carve turns that off for the slice being extracted.
- CSS extraction (would drop `html-generator.ts` to ~250 lines).
- A dedicated `src/client/tsconfig.json` — not needed because the root config already handles it.

### Test results
49 / 49 green (unchanged; the existing suite already covered what this refactor could break). Build and typecheck clean. Live smoke against `test/Health_and_Safety.Report`: HTTP 200, dashboard size 752 KB, all 6 key functions (`renderMeasures`, `addCopyButtons`, `navigateLineage`, `highlightDaxBlocks`, `switchTab`, bootstrap) present exactly once, no stray `export {};` in the output.

### Regex regression during development
- `tests/render-dax-highlight.test.ts` test 21 (`addCopyButtons does not call highlightDaxBlocks first`) broke because tsc's emitted formatting adds whitespace between `)` and `{` that the inline version didn't have. Relaxed the regex to tolerate whitespace.

---

## [0.3.1] — 2026-04-18 · DAX syntax highlighting (branch `feat/dax-syntax-highlighting`)

User-visible polish release. Every DAX block in the dashboard now renders with syntax highlighting — keywords, functions, variables, `[measure]` / `'table'[column]` references, strings, numbers and comments each get their own colour from the design-token palette.

### Added
- **`vendor/dax-highlight/`** — vendored copy of the tiny dependency-free DAX highlighter (MIT, upstream in `jonathan-pap.github.io`). Kept out of `src/` so it can be upgraded by dropping in new files; zero-runtime-dep policy preserved.
- **Highlighter wiring in `src/html-generator.ts`** — reads `vendor/dax-highlight/dax-highlight.js` and `dax-highlight.css` at generation time (walks three candidate paths so it works in prod, tests, and any alternate `outDir`), inlines both into the generated HTML.
- **New `--clr-variable` design token** — orange (`#F97316` dark / `#C2410C` light) dedicated to DAX named variables (`VAR _rows = …` + anything starting with `_`). Previously mapped onto `--clr-measure` amber, which made `_rows` indistinguishable from `[Measure Name]`; the regression test `named variables and measure refs use DISTINCT tokens` guards the split.
- **Theme bridge** — `.code-dax` CSS custom properties (`--dax-keyword`, `--dax-function`, `--dax-variable`, `--dax-measure`, `--dax-ref`, `--dax-string`, `--dax-number`) mapped onto our existing semantic tokens (`--clr-upstream`, `--clr-function`, `--clr-variable`, `--clr-measure`, `--clr-source`, `--clr-success`, `--clr-calc`). Highlighting follows the dark/light theme toggle automatically.
- **`highlightDaxBlocks()`** client helper called at every render that produces a `.lineage-dax` block (Lineage view, Functions tab, Calc Groups tab, Docs tab's markdown-fenced `dax` blocks). Runs *before* `addCopyButtons` so the innerHTML replacement doesn't wipe copy buttons.
- **`tests/render-dax-highlight.test.ts`** — 5 smoke tests for the vendor-file injection, CSS token presence, theme-bridge wiring, client-helper call order, and the variable-vs-measure token distinction.

### Changed
- **`switchTab` for Functions / Calc Groups / Lineage** now calls `addCopyButtons` which in turn triggers `highlightDaxBlocks`, so switching to those tabs colourises any newly-rendered DAX.

### Test results
49 / 49 green (was 44, +5 DAX smoke tests). Build and typecheck clean. Live smoke against `test/Health_and_Safety.Report` confirms `DaxHighlight` is present, all 8 token CSS classes emit, and `highlightDaxBlocks` is wired.

---

## [0.3.0] — 2026-04-18 · Stop 4 (branch `stop-4/event-delegation`)

Structural XSS fix — the last of the three Criticals from `/sc:analyze`. Minor-version bump because the event-handling model in the dashboard changes even though the UI behaviour is identical.

### Security
- **Event delegation instead of inline `onclick=`.** Every `onclick="…${field}…"` site in the dashboard and landing page has been replaced with `data-action="<verb>"` + `data-<prop>="<escAttr(value)>"`. A single document-level `click` listener dispatches based on `[data-action]` via `closest()`. Model-controlled names (measures, columns, tables, pages, paths) never reach a JS parser — they live in HTML attributes, which the browser HTML-decodes before exposing via `element.dataset.<prop>`. Removes the XSS class structurally, not just by escaping harder.
- **Server-side `reportName` splices escaped.** The `<title>`, header sub-title, and footer branding splices for the report name now go through `escHtml` on the server. A report folder named `Foo<img src=x onerror=…>.Report` no longer reflects as raw HTML.
- **Defense-in-depth escapes on every field-name HTML-text splice** inside the embedded client script — measure / column / table / format-string / dataType / visualTitle / visualType / bindingRole / pageName all now route through `escHtml`. Previously many were raw `${m.name}` splices; if the browser ever stopped normalising them via intermediate DOM APIs, the output would have rendered attacker markup.

### Changed
- **`openLineage` → `navigateLineage`.** Every internal call site was being edited for the delegation refactor — took the opportunity to rename the function to match its actual behaviour (it navigates, it doesn't *open* anything).
- **`stopPropagation` calls removed.** With a single delegated handler using `closest('[data-action]')`, bubbling is no longer a concern — a click on a chip inside a `.page-header` matches the chip's innermost `[data-action]`, not the header's.

### Added
- **Delegated click listener** (~45 lines) at the top of the embedded client script. Handles 16 action verbs: `lineage`, `tab`, `md-tab`, `md-mode`, `sort`, `unused-filter`, `theme`, `reload`, `md-expand-all`, `md-collapse-all`, `md-copy`, `md-download`, `page-toggle`, `table-toggle`, `orphan-toggle`, `card-toggle` — plus `open-recent` and `browse` on the landing page.
- **`tests/render-xss-fuzz.test.ts`** — 6 regression tests covering:
  - no `onclick=` HTML attribute in any rendered output
  - data-* attribute values contain no raw `'`, `"`, `<`, `>` for adversarial input
  - `</script>` payload doesn't inflate the legitimate embed-block count
  - `<img onerror=…>` payload doesn't render as a real tag
  - delegator's `[data-action]` contract is wired (canary against future refactors removing it)
  - every emitted `data-action="<verb>"` has a matching `case` in the delegator's switch

### Fixed (caught by the fuzz tests during development)
- Server-side `${reportName}` was being spliced raw into the `<title>`, header, and footer at three sites — escaped now.
- Commentary inside the delegator docblock used literal `onclick=` and `data-action="<verb>"` strings, which tripped the structural-invariant tests. Rephrased so the tests are sensitive only to real code.

### Test results
44 / 44 green (was 38, +6 fuzz tests). Runtime ~100 ms. Zero new deps.

---

> **Note on "unreleased" versions:** the v0.2 track was merged to `main` on 2026-04-18. v0.3.0 (this entry) is currently on its own branch awaiting merge.

---

## [0.2.1] — 2026-04-18 · Stop 3 (PR #6, branch `stop-3/data-embed-safety`)

Security patch. No user-visible change.

### Security
- Route the embedded `<script>const DATA=…;</script>` payload and all six markdown literals through the new `safeJSON` helper. A measure / column / table description containing `</script>`, `-->`, or a raw `U+2028` / `U+2029` line terminator can no longer break out of its surrounding `<script>` block.
- Apply the same escape to `REPORT_NAME`, `APP_VERSION`, and `GENERATED_AT` embeds — smaller attack surface but same class of bug.

### Added
- `tests/render-data-embed.test.ts` — 6 regression tests asserting that adversarial payloads (`</script><script>alert(1)</script>`, `<!--inner-->`, `U+2028` / `U+2029`, nested quotes / backslashes) round-trip through `generateHTML` without inflating the `</script>` count above the legitimate baseline.

---

## [0.2.0] — 2026-04-18 · Stop 2 (PR #5, branch `stop-2/server-boundary`)

Security-relevant feature release. The landing-page footer has always promised *"no data leaves your machine"*; before this release the server was actually reachable from every device on the LAN. Now it isn't.

### Security
- **Server binds to `127.0.0.1` only** (`src/app.ts`). Default Node behaviour (`listen(port)` → `::`, reachable over LAN) has been replaced with explicit loopback binding. Verified via `netstat`: our port now appears only under `127.0.0.1:<port>`, never `0.0.0.0` or `[::]`.
- **Startup self-check** — if `server.address()` reports a non-loopback address post-listen, the process aborts with an error rather than quietly violating the promise.
- **Path hardening** — new `src/path-guard.ts` with `validateReportPath(raw)`. Rejects non-string input, empty/whitespace, `NUL` bytes, Windows UNC paths (`\\server\share`), POSIX `//server/share`, UNC-shaped output after `path.resolve()` (mapped drives that point to a share), and non-existent paths.
- **Error-banner XSS** — `${error}` in `landingHTML` now routed through `escHtml`. A crafted path like `C:\foo<img src=x onerror=…>.Report` no longer reflects as raw HTML.

### Changed
- Port-retry capped at 20 (`5679..5698`). Beyond that, exit 1 with a clear stderr message instead of walking the entire port space.
- Non-`EADDRINUSE` server errors now exit 1 instead of being silently swallowed.
- Console prints `http://127.0.0.1:<port>` (was `http://localhost:<port>`) — no ambiguity about what's reachable.

### Added
- `tests/path-guard.test.ts` — 10 unit tests covering every rejection class and the happy-path resolve.

### Deliberate omission
- No server-binding integration test in this release. A clean one requires `app.ts` to expose `startServer()` (Stop 5's refactor). The runtime self-check is the stopgap.

---

## [0.1.1] — 2026-04-18 · Stop 1 (PR #4, branch `stop-1/safe-helpers-and-tests`)

Infrastructure patch. Foundation for the v0.2 security track. No user-visible change.

### Added
- `src/render/safe.ts` — single source of truth for every HTML/JS/JSON splice. Four helpers, one per context:
  - `escHtml(s)` — HTML text content
  - `escAttr(s)` — HTML attribute value (delegates to `escHtml` for now)
  - `jsStr(s)` — JS string-literal context, safe inside `onclick='…'`
  - `safeJSON(v)` — JSON embedding in `<script>`, escapes `<`, `>`, `&`, `U+2028`, `U+2029`
- `tests/safe.test.ts` — 22 tests for null/undefined collapse, character escapes, script-tag breakout, line-terminator handling, and a cross-helper invariant (no adversarial payload leaks a raw `</script>`).
- `tsconfig.test.json` + `dist-test/` — isolated test compilation so the stdlib `node:test` runner can execute compiled test files.
- `package.json` scripts: `typecheck` (`tsc --noEmit`), `test` (compile tests then run `node --test dist-test/tests/`).
- README "Developing" section with the new script invocations.

### Fixed
- `jsStr` — `JSON.stringify` leaves `U+2028` / `U+2029` raw, but the JS parser treats them as line terminators inside string literals, silently breaking the string. Added explicit `\u2028` / `\u2029` escapes. Caught by test 15 on the harness's first run.

### Notes
- Zero new runtime dependencies. Zero new dev-dependencies — the test harness uses Node 18's built-in `node:test` module.

---

## [0.1.0] — 2026-04-18 · Stop 0 (PR #3, branch `stop-0/composite-model-and-chips`)

First release to properly support Power BI **composite models** (mixed-storage with DirectQuery-to-AS). Bundles two sessions of dashboard / MD-output polish.

### Added
- **EXTERNALMEASURE lineage card.** When a measure is a `EXTERNALMEASURE("name", TYPE, "DirectQuery to AS - <ModelName>")` proxy, the Lineage → Upstream column now renders a teal "External semantic model" card above the Source-table card.
- **All-pages coverage.** `report-scanner` exposes `allPages: PageMeta[]`; `data-builder` seeds the `pages` array from it so text/shape/image-only pages and empty scaffolds get a stub entry instead of being silently dropped. Fixes the "−16 visible" negative count on the Health_and_Safety composite model (which had 10 data-bound pages and 26 hidden-but-empty tooltip pages).
- **Design-token layer.** Full `--clr-*`, `--fs-*`, `--space-*`, `--radius-*` tokens with `-soft` (~12 % alpha) and `-mid` (~30 % alpha) semantic variants. Aurora-mesh background, blueprint grid overlay, frosted-glass cards, sticky pill-style active tab.
- **Shared `.badge` and `.chip` components** with BEM modifiers: `pk`, `pk-inf`, `fk`, `calc`, `hidden`, `hid-col`, `slicer`, `unused`, `indirect`, `success`, `calc-grp`, `direction-out`, `direction-in` for badges; `measure`, `column`, `function`, `neutral` for chips. Used across the dashboard and in markdown exports.
- **Six companion markdown docs** split out from the original monolithic spec: Model, Data Dictionary, Measures, Functions, Calc Groups, Quality.
- **Functions markdown** gets a params table, used-by chip list, and fenced `dax` bodies instead of the old alphabetical-anchor wall.
- **Measures markdown** gets chip-based Depends-on / Used-by lists matching the dashboard Functions-tab style.
- **Landing page refresh** — aurora/grid background, frosted-glass card, gradient hero title, JetBrains Mono labels, native Windows folder picker (PowerShell `FolderBrowserDialog`), left-accent hover on recent-reports, `prefers-reduced-motion` + narrow-screen media queries.
- **Model metadata capture** — culture, source query culture, implicit measures, value-filter behaviour, compat level, datasource version are now parsed and surfaced in the Model panel.
- **Table partitions + hierarchies** — surfaced in the Sources tab with source/mode classification.
- **`isSlicerField` propagation** — flows from `report-scanner` → `data-builder` → badges in Tables and MD data-dictionary.
- **`claudedocs/workflow_v0.2.md`** — 7-stop migration plan produced by `/sc:design` + `/sc:workflow`, anchoring the subsequent v0.2.x releases.

### Changed
- **Downstream column colour** from purple (`#8B5CF6`) to sky (`#38BDF8`, dark / `#0284C7`, light). Visually distinct from upstream purple (`#A78BFA`).
- **Pages tab** — client-side `pageData` simplified to `(DATA.pages || []).slice()`. Server is the single source of truth; previously the client rebuilt `pageData` from `measure.usedIn` + `column.usedIn` which silently dropped data-less pages.
- **"No dependencies · Base measure"** empty state in Lineage is suppressed for EXTERNALMEASURE proxy measures (they do have a dependency — the external model).
- **`mdInline`** now passes through styled `<span class="…">` and `</span>` so badges and chips render as pills in MD view instead of showing as escaped text.

### Fixed
- Backtick-in-CSS-comment silently parsed as a nested template literal and broke the whole embedded script. Switched the ASCII-art `| | |` example to a double-quoted form.
- `var tables = DATA.tables || []` inside `renderTables` shadowed the outer `const tables`, aborting the embedded script at parse time (symptom: empty dashboard).
- Tab-badge CSS class collision with the new `.badge` component — counter pills renamed to `.tab-count`.

---

## [0.0.4] — 2026-04-17 · examples commit (`0a20279`)

### Added
- Example fixture + sample snippets checked into the repo for demo / onboarding purposes.

---

## [0.0.3] — 2026-04-17 · PR #2 (`dafe7e8`)

### Changed
- **Markdown output restructured as a technical spec** — split a single monolithic `model.md` into multiple companion documents. Establishes the section layout that v0.1.0's six-doc split builds on.

---

## [0.0.2] — 2026-04-16 · PR #1 (`91d8727`)

### Added
- **First full dashboard + lineage implementation.** PBIR reader, TMDL + BIM model parser, report-binding scanner, data-builder cross-referencing, HTML dashboard generator with tabbed panels (Sources, Tables, Columns, Relationships, Measures, Calc Groups, Functions, Pages, Unused, Lineage, Docs).
- Basic DAX dependency parsing, used-in / usage-count tracking, direct / indirect / unused status classification, downstream visual binding discovery.
- Zero-runtime-dependency HTTP server + landing page + recent-reports list.

---

## [0.0.1] — 2026-04-16 · Initial commit (`e2884e6`)

### Added
- Project scaffolding — TypeScript, `tsconfig.json` (`strict`, `Node16` modules, `ES2022` target), `package.json` declaring zero runtime deps, `launch.bat`, initial README.
- First cut of `app.ts`, `html-generator.ts`, `model-parser.ts`, `pbir-reader.ts`.

---

## Release / branch status at the time of writing

| Version | Location | Notes |
|---|---|---|
| 0.0.1 – 0.0.4 | `main` (merged) | — |
| 0.1.0 – 0.2.1 | `main` (merged) | v0.2 security track |
| 0.3.0 | `stop-4/event-delegation` (open) | Structural XSS fix |
| 0.3.1 | `feat/dax-syntax-highlighting` (open) | DAX syntax highlighting |
| 0.4.0 | `stop-5/client-split` (open) | Client code extracted to `src/client/main.ts` |
| 0.5.0 | `stop-6/composite-model-fixes` (open) | Composite-model fixes (TMDL, entity partitions, EXTERNALMEASURE, auto-date) |
| 0.5.1 | `stop-6/composite-model-fixes` (open) | Post-/sc:analyze cleanup — inline-handler migration, CSS extraction, md.ts carve |
| 0.5.2 | `polish/analyze-followups` (open) | Follow-ups — EXTERNALMEASURE quotes, vendor SHA-256, inferSource fast path, CI, escape.ts carve |

The v0.2 track was merged to `main` via cherry-pick on 2026-04-18 after the stacked PRs #4–#6 each landed on their feature-branch base rather than main. See the Stop-3 commit message for the reconciliation detail. v0.3.0 is on its own branch awaiting merge.
