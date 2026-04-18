# Power BI Lineage

Standalone, zero-dependency Node.js app that analyses a Power BI report's usage and model lineage.

Point it at a `.Report` folder that sits next to its `.SemanticModel` sibling and get an interactive dashboard showing:

- **Measures** — DAX, dependencies, which visuals and pages use each one, direct/indirect/unused status
- **Columns** — data types, slicer usage, usage counts, status
- **Tables** — columns with PK/FK/calc/hidden badges, relationships, measures
- **Relationships** — active + inactive, from/to mapping
- **Functions** — user-defined DAX functions, parameters, measures that call them
- **Calc Groups** — items, precedence, format-string expressions
- **Pages** — visuals per page, visual-type breakdown, coverage per page
- **Unused** — pure orphan measures, dead-chain measures, orphan columns, indirect-use measures/columns
- **Lineage** — click any measure/column to see upstream dependencies, source table, and downstream visuals

Dark/light themes, DAX copy buttons, client-side search and sort.

## Requirements

- Node.js 18+
- A `.Report` folder (PBIP format) with a sibling `.SemanticModel` folder

## Running

### Double-click (Windows)

```
launch.bat
```

First run does `npm install` + `npm run build`, then starts the app and opens your browser.

### From the terminal

```
npm install
npm run build
node dist/app.js
```

The app listens on `http://localhost:5679` (or the next free port). Paste the path to your `.Report` folder, or use the Browse button to pick it. Recent reports are remembered.

## Project layout

```
src/
  pbir-reader.ts     Read-only access to PBIR report/page/visual JSON
  model-parser.ts    findSemanticModelPath + TMDL + BIM parsers
  report-scanner.ts  Walks visuals/filters/objects to extract field bindings
  data-builder.ts    Cross-references model + report into FullData
  html-generator.ts  Dashboard HTML template
  render/safe.ts     HTML/JS/JSON escape helpers (single source of truth)
  app.ts             HTTP server + landing page + folder picker

tests/               Unit tests (compiled via tsconfig.test.json -> dist-test/)
```

## Zero runtime dependencies

Runtime deps: none. Only Node builtins (`fs`, `path`, `http`, `crypto`, `child_process`). The `typescript` and `@types/node` dev-deps are only needed to build.

## Developing

```
npm run typecheck    # tsc --noEmit
npm test             # compile tests + run Node's built-in test runner
npm run build        # compile to dist/
```

Tests use the stdlib `node:test` module (Node 18+). No framework deps — the test tsconfig emits to `dist-test/` and `node --test dist-test/tests/` runs everything.

## Screenshot

_(placeholder — add once you run it against a real report)_
