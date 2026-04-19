# ERD tab — parked

Snapshot of the interactive SVG entity-relationship diagram that was
built on `feat/erd-view` (PR #21). Shipped to the branch in three
iterations:

1. Initial version — force-directed layout with pan/zoom/drag
2. Edges anchor to node borders (not centres) + seeded layout + gravity
3. Columnar layout — facts left, bridges middle, dimensions right

Parked because the dashboard already covers "what tables / what
relationships" through the Sources, Tables, and Relationships tabs;
the ERD was nice but redundant in practice. Kept here so the work
isn't lost.

## What it did

- New **ERD tab** (first position by default) with a full SVG schema diagram
- **Columnar layout** — facts on the left, bridges in the middle, dimensions on the right
- **Edges anchor to node borders** via ray-rectangle intersection; arrows sit exactly on each box's edge with a bullet at the many-side
- **Filter toggles** for calc groups / field params / composite proxies / auto-date (all off by default except calc groups)
- **Interactions**:
  - Drag background → pan
  - Mouse wheel → zoom, cursor-centred
  - Drag a node → reposition + edges update live
  - Click a node → jump to the Tables tab with that card expanded
- **Reset layout** / **Fit** action buttons
- **Role-coloured nodes** using the same `--clr-*` tokens as every other tab

## What's in here

| File | What it is |
|---|---|
| `erd.ts` | ~540 LOC extracted from `src/client/main.ts` — `renderErd()` + `erdLayout()` + `erdAttachInteractions()` + helpers, state vars, and filter toggles |
| `erd.css` | ~120 LOC extracted from `src/styles/dashboard.css` — all `.erd-*` selectors |
| `erd-tab.test.ts` | 6 structural smoke tests from `tests/erd-tab.test.ts` |

## How to revive

1. **Append `erd.ts` contents** to `src/client/main.ts` just before `function renderFunctions()`. The snippet starts with `// ─── ERD tab ──────` and is self-contained — no cross-cuts into the rest of main.ts.

2. **Append `erd.css` contents** to `src/styles/dashboard.css`. The snippet is a single block under `/* ── ERD tab ... */`.

3. **Add the tab registration** to `renderTabs()` in `src/client/main.ts` (right after the `document.getElementById("tabs").innerHTML=[` line):
   ```js
   {id:"erd",l:"ERD",b:null},
   ```

4. **Add the panel slot** to `src/html-generator.ts` (next to `panel-tables`):
   ```html
   <div class="panel" id="panel-erd"><div id="erd-content"></div></div>
   ```

5. **Wire `renderErd()` into the bootstrap chain** at the bottom of `src/client/main.ts`:
   ```js
   renderSources();renderErd();renderFunctions();...
   ```
   Optionally change the default `switchTab("measures")` to `switchTab("erd")` if you want ERD as the landing view.

6. **Add the delegator cases** in the document `click` listener near the top of `src/client/main.ts`:
   ```js
   case 'erd-toggle':  toggleErdFilter(d.filter); break;
   case 'erd-reset':   resetErdLayout(); break;
   case 'erd-fit':     fitErdView(); break;
   ```

7. **Restore the test file** as `tests/erd-tab.test.ts` (copy `erd-tab.test.ts` from here).

8. Run `npm run typecheck` then `npm test`. No cross-file refactors should be needed — everything the ERD touches is additive.

## Why it was parked

The ERD looked great on a screenshot but didn't add much signal once the other tabs were well-organised:

- The **Relationships tab** already shows every from/to/active row in a sortable table, which is what reviewers usually want
- The **Tables tab** (with kind-groups) gives a richer per-table view than a rectangle in a diagram
- The **Sources tab** shows source topology
- A dashboard user who wants a diagram typically wants to see it in a doc or a wiki page, not in an interactive tab — and the existing `mermaidTableRelationships` in `md-generator.ts` already produces one per table

If it comes back, worth considering:
- **A Mermaid full-model ERD** in `model.md` (Track 1 from the earlier design brief — ~120 LOC, renders in GitHub / ADO Wiki / the dashboard's MD renderer, ships as part of the MD catalog)
- **Export-only** — a "Download ERD as SVG" button on the Relationships tab that regenerates the diagram at click time, rather than always-rendering

Both of those avoid adding another always-on tab to the dashboard.
