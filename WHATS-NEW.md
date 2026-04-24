# 👋 Welcome to Power BI Documenter

Drop in a PBIP folder — get a **searchable dashboard** plus **nine Markdown docs** ready for ADO Wiki or GitHub.

## What this dashboard shows

### Model
- **Sources** — data connections, partition modes, composite-model proxies (switch between Cards + Flat-map views) · hand-written SQL from `Value.NativeQuery` surfaced as `sql` code blocks · per-partition **M-step breakdown** classifying every ETL step (source / filter / join / typeChange / …)
- **Tables** — grouped by role (Fact / Dimension / Bridge / Calc Group) with columns, measures, and relationships at a glance
- **Columns** — types, usage counts, direct / indirect / unused status
- **Relationships** — active + inactive, cardinality (`1:*`, `1:1`, etc.), cross-filter direction (single ↔ both)
- **Measures** — A–Z reference with DAX, dependencies, where-used per visual + page
- **Calc Groups** — items, precedence, format-string expressions
- **Functions** — UDFs with parameters + every measure that calls each one

### Report
- **Pages** — each page's layout wireframe (scaled SVG showing real visual positions) + per-visual field bindings
- **Lineage** — click any measure or column → upstream dependencies + source tables + downstream visuals in one view

### Analysis
- **Unused** — orphan measures, dead-chain measures, indirect-use detection
- **Improvements** — 16-check model-health audit, severity-tiered (high · medium · low · info · strengths) — includes **broken-reference detection**: flags any DAX referencing a table / column / measure that doesn't exist

### Output
- **Docs tab** — nine Markdown files ready to paste into ADO Wiki or GitHub:
  *Model · Data Dictionary · Sources · Measures · Functions · Calc Groups · Pages · Improvements · Index*

## Under the hood

- Runs **entirely in your browser** (File System Access API — nothing uploads) *or* as a **local CLI**
- **Zero runtime dependencies**, MIT-licensed, 237 tests
- Three themes: dark · light · BluPulse — pick from the bottom of this overlay

## Running locally (CLI mode)

Firefox / Safari users, or anyone who prefers a local app:

- **Windows:** double-click `launch.bat` — it auto-pulls the latest revision, builds if needed, and opens `http://127.0.0.1:5679`
- **Any OS:** `npm install && npm run build && node dist/app.js`

Loopback only — nothing leaves your machine. Requires Node.js 18+.

---

Looking for per-release technical details? See [`changelog/`](https://github.com/jonathan-pap/PowerBI-Lineage/tree/main/changelog). Planned work lives in [`ROADMAP.md`](https://github.com/jonathan-pap/PowerBI-Lineage/blob/main/ROADMAP.md).
