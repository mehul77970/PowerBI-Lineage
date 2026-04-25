# Screenshots

Referenced by the root [`readme.md`](../../readme.md) for the feature tour and by the hosted Pages site.

## Current shot set (v0.9.x)

PNG, ~1280–1400 px wide. Optimise to keep each file under ~200 KB before commit (e.g. [tinypng.com](https://tinypng.com) or `pngquant`).

| Filename | What it shows | Used in README |
|---|---|---|
| `01-landing.png` | Power BI Documenter overlay before any folder is picked — CTAs, theme picker, trust chips, About / View on GitHub | **Hero** |
| `02-sources.png` | Sources tab — connection buckets, **physical-source index**, native queries / M-step breakdown / raw M cards | Relationships, sources & lineage |
| `03-tables.png` | Tables tab — role-grouped overview | Inspect the model |
| `03-tablesB.png` | Tables tab — one card expanded, per-relationship cardinality chips visible | Inspect the model |
| `04-columns.png` | Columns tab with usage counts and CSV export | Inspect the model |
| `05-relationships.png` | Relationships tab — cardinality + cross-filter direction columns | Relationships, sources & lineage |
| `06-measures.png` | Measures tab — DAX deps + where-used + CSV export | Inspect the model |
| `07-functions.png` | Functions tab — UDF parameters, body, fan-in to measures | Pages, functions, calc groups |
| `09-pages.png` | Pages tab — overview list of every page with binding counts | Pages, functions, calc groups |
| `09-pagesB.png` | Pages tab — SVG wireframe (visuals at true canvas positions) | Pages, functions, calc groups |
| `09-pagesC.png` | Pages tab — per-visual field-well bindings table | Pages, functions, calc groups |
| `10-Unused.png` | Unused tab — orphan + dead-chain measures, indirect-use detection | Relationships, sources & lineage |
| `11-lineage.png` | Lineage view — upstream deps + source tables + downstream visuals | Relationships, sources & lineage |
| `12-modeldocuments.png` | Docs tab → Model.md rendered, ER diagram visible | Wiki-ready Markdown |
| `13-calcgroups.png` | Calc Groups tab — items, precedence, format-string expressions | Pages, functions, calc groups |

## How to capture

1. Open the hosted site: https://jonathan-pap.github.io/PowerBI-Lineage/
2. Click **Try a sample** (or load your own folder)
3. For each shot, navigate to the tab and resize the browser window to around 1400 px wide
4. Use the browser's built-in screenshot tool — Chrome: DevTools → three-dot menu → Run command → "Capture full size screenshot" — for clean shots without OS chrome

## Social preview

For the GitHub social-preview image (Settings → Social preview), a cropped `01-landing.png` resized to **1280 × 640** works well — the overlay centres naturally.

## Notes on numbering

Filenames carry their two-digit prefix purely for sort order — no semantic meaning. Some numbers (`08`) are intentionally unused; the sequence reflects how the README presents the tour, not internal IDs. New screenshots should pick the next free number rather than reusing.
