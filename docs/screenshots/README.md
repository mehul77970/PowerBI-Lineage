# Screenshots

Referenced by the root [`readme.md`](../../readme.md) for the feature tour and by the hosted Pages site.

## Expected files

Save each screenshot with the filename listed below. PNG format, width around 1400 px, optimised (keep each file under ~200 KB with a tool like [tinypng.com](https://tinypng.com) or `pngquant`).

| Filename | What to capture | Used as |
|---|---|---|
| `01-landing.png` | The "Power BI Documenter" overlay before any folder is picked — feature grid, CTAs, trust chips | **Hero** |
| `02-measures.png` | Measures tab with 128 measures sorted, dependencies column visible, Used-In page chips | Feature tour — "What you can explore" |
| `03-tables.png` | Tables tab showing data tables grouped with per-table stats (cols/measures/keys/FKs) | Feature tour — "Model structure" |
| `04-lineage.png` | Lineage tab for one measure (e.g. Revenue Delta) showing upstream + downstream panes | Feature tour — "Click-to-trace lineage" |
| `05-docs-model.png` | Docs tab → Model view with the technical-spec front matter visible | Feature tour — "Wiki-ready output" |
| `06-functions.png` | Functions tab with a UDF expanded, showing its body + the measures that use it | Feature tour — "UDF fan-in" |
| `07-pages-layout.png` | Pages tab with one page expanded, Layout section open, SVG wireframe visible | Feature tour — "Page layout wireframe" |
| `08-pages-bindings.png` | Same page section below the wireframe — Visual types chips + Measures chips + Visuals binding table | Feature tour — "Field-well bindings" |

## How to capture

1. Open the hosted site: https://jonathan-pap.github.io/PowerBI-Lineage/
2. Click **Try a sample** (or load your own folder)
3. For each shot, navigate to the tab and resize the browser window to around 1400 px wide
4. Use the browser's built-in screenshot tool (Chrome: DevTools → three-dot menu → Run command → "Capture full size screenshot") to get a clean shot without the OS chrome

## Social preview

For the GitHub social-preview image (Settings → Social preview), a cropped `01-landing.png` resized to **1280 × 640** works well — the overlay centres naturally.
