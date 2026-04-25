# Roadmap — parked for design

> **Status:** This is a **parked backlog** — a collection of ideas captured so they aren't lost, not a committed release plan. Items here haven't been designed, scoped, or scheduled. Some will ship; some will be dropped after further thought; some will morph.
>
> Live releases + what actually shipped lives in [`changelog/`](changelog/). This file is the *future*.

## Themes

The direction splits into five rough themes. Priority within each theme is **rough order-of-thought**, not commitment.

## 1 · Platform expansion — XMLA endpoint

| Item | What | Why | Rough cost |
|---|---|---|---|
| **XMLA endpoint support** | Connect to a published Power BI / Fabric model over XMLA instead of reading a `.SemanticModel` folder. The parser reads the live deployed shape, not the source-controlled one. | TE and Measure Killer both support XMLA. Right now we only read PBIP files on disk — meaning a reviewer documenting a workspace model has to fetch the TMDL first. XMLA closes that gap. Also unlocks "compare deployed vs source" as a future capability. | 2-4 weeks. Auth (service principal / delegated), Tabular client bindings, delta-mapping between live model + our `ModelTable` shape, plus a UX for "paste endpoint URL" that's friendly on the web. |

**Positioning line (for README once XMLA ships):**

> TE and Measure Killer edit models. Power BI Documenter documents them — dashboard + wiki-ready output — from a PBIP folder, or (soon) from a live XMLA endpoint.

## 2 · Audit + lineage depth

| Item | What | Why | Rough cost |
|---|---|---|---|
| **Broken-DAX-reference audit** | 16th Improvements check. Parse every measure's DAX; for each `Table[Column]` / `'Table'[Measure]` reference, verify it resolves against the model. Flag unresolved references (renamed/deleted sources). | Catches a genuinely painful class of bug that circular-dep + dead-chain checks don't cover. Highest-ROI single-audit check we haven't shipped. | ~1 evening. We already tokenise DAX for dependency extraction; same walker, new resolve step. |
| **Column "where used" drill-down** | Click a row in the Columns tab → side drawer listing every measure that uses the column + every visual that binds it. | Data already in `column.usedIn` — the Columns tab just doesn't render it. Closes a clear capability gap vs the competitors. | ~2-3 hours. Pure UI work, no parser change. |
| **Impact panel** | Side drawer on any measure/column click showing upstream deps + downstream consumers, grouped by kind. | Similar shape to "where used" but lives as an in-page panel rather than a tab. Might subsume "where used" or live alongside. Worth designing together. | ~½ day. |

## 3 · Data-engineer experience

| Item | What | Why | Rough cost |
|---|---|---|---|
| **Physical-Source Index** | New section in `sources.md` (or a 10th MD) — inverted view: for each physical `schema.table`, list every model table that consumes it. | Answers "what breaks if we drop this source table?" — our current Sources tab groups by model table, not by physical source. Data-engineer-shaped question. | ~½ day. Derivation is straightforward; placement needs a design decision (section of existing doc vs new doc). |
| **M-query step breakdown** | Enumerate Power Query steps (Source → FilterRows → AddColumn → ...) per partition, with kind + preview. | Today we store `expressionSource` as an opaque blob. Step enumeration is real documentation value for Gold-layer transformation logic. | ~1 day. Niche; may want a minimal line-split heuristic before committing to a full M parser. |

## 4 · Export + sharing

| Item | What | Why | Rough cost |
|---|---|---|---|
| **CSV export on Measures + Columns tabs** | Same pattern as the Source Map tab's CSV export. Filter-aware. | Once somebody's filtered to "unused measures", getting that list into a spreadsheet is a real workflow. We have the pattern from Source Map — this just applies it twice. | ~2 hours. |
| **Per-release GitHub Release tags** (ongoing) | Continue the discipline started with v0.7.0 + v0.8.0 + v0.8.1 — every user-visible release gets a GitHub Release with the changelog-entry text as the body. | Visibility in the Releases sidebar; clean link target for social posts. | ~10 min per release when version bumps. |

## 5 · Differentiating capabilities (vs TE3 / Measure Killer)

These came out of a "what can we do that the editing-focused tools can't?" review. Filtered for unique-to-documentation work, leveraging our file-based + zero-dep + browser angle.

| Item | What | Why | Rough cost |
|---|---|---|---|
| **Model diff between two PBIP versions** | Take two `.Report` paths, build `FullData` for each, emit a stakeholder-friendly Markdown diff: added / removed / renamed measures, columns, relationships, calc groups; cardinality flips; description changes; status (direct/indirect/unused) shifts. CLI: `node dist/app.js --diff old/ new/`. Browser: paired folder picker. | Neither TE3 nor Measure Killer has a doc-form diff between model versions. Closest competitor is git-diffing the raw TMDL — unreadable for non-developers. We can ship a "what changed in v1.3" wiki page or PR comment that goes to stakeholders. **Boldest "documentation-not-editing" capability identified so far.** | ~2 days. We already have `FullData` + per-entity status; the diff is a side-by-side over the structure. |
| **PR-friendly compressed diff comment** | Specialised mode of the diff above — emit ≤200 lines suitable for posting as a GitHub PR comment when someone modifies a PBIP. | Tightens the dev loop for teams using PBIP in version control. Pairs naturally with the parent diff feature. | ~½ day on top of the diff feature. |
| **PII / sensitive-column detection** | Pattern-match column names + descriptions against sensitive-data taxonomies (`*_email`, `*_ssn`, `*_phone`, `iban`, `medical_*`, `gender`, `*_dob`, `*_salary`, etc). Flag in Improvements audit; surface a count summary. Configurable pattern catalogue. | Power BI's native sensitivity-label feature operates on the dataset, not the model definition. A pre-publish doc-time audit is a clean fit. Real governance value. | ~½ day. Adds 1-2 Improvements checks + a small pattern catalogue. |
| **DAX complexity / hotspot map** | Per-measure statistics: line count, dependency depth, fan-in. Distribution chart. "Top 10 most complex measures" ranked. Optional dedicated `Complexity.md` doc. | TE3 formats DAX, doesn't grade it. Measure Killer focuses on usage, not complexity. Identifies refactor candidates objectively. | ~½ day. |
| **Cross-report consolidation** | A workspace with N reports → one consolidated doc spanning all of them. Deduplicates shared measures, identifies canonical home, flags drift. | Useful for centers-of-excellence teams managing multiple reports per workspace. Niche but uniquely possible because we're file-based. | ~1 day. UX work mostly — parsing already aggregates per-report. |
| **"What breaks if I remove this?" — removal-impact panel** | New panel inside the existing Lineage view (NOT a new tab). Per-entity severity classification (`BLOCKER` / `CASCADING` / `SAFE`), cascade walk over the dep graph, one-line recommendation. Example output: *"Removing breaks 23 visuals across 6 pages and cascades to 4 dependent measures."* For orphans: *"Safe to remove — no measures or visuals reference this."* | TE3 lists dependencies, Measure Killer flags orphans — neither says "removing X breaks N things across the cascade." This is the cleanup-decision moment as a built-in. Lives in the Lineage view (where the user already lands when investigating) so it's not a fourth way to answer the same question. | ~½ day. Severity classifier + cascade walker + UI panel. Reuses existing `daxDependencies` / `dependedOnBy` / `usedIn` data. **Phase 2 (parked):** inline blast-radius badges on Measures / Columns tabs — risks clutter, gate on real demand. |

**Tier 3 (parked but lower priority):** Decision-log extraction (surface `///` doc-comments as a curated "design decisions" doc — depends on team discipline); naming-convention audit (low signal, mostly noise); voice / exec summary generation (content-design problem, not engineering).

## 6 · Mermaid revival

| Item | What | Why | Rough cost |
|---|---|---|---|
| **Re-enable Mermaid emission in MDs** | Flip `EMIT_MERMAID` back to `true` in `src/md-generator.ts`. The three call sites + helper functions (`mermaidMeasureLineage`, `mermaidTableRelationships`, `mermaidFullModelErDiagram`) are retained — gate is the only thing toggled. | Visual lineage + ER diagrams + per-fact star fragments are genuinely useful in the MDs when they render. Currently dropped (v0.11.0) because GitHub silently falls back to plain code blocks on Mermaid 8.13.x parsing edge-cases (one we hit: underscore-leading entity names; we fixed in 0.10.2 but the broader confidence wasn't there). ADO Wiki uses Mermaid 8.13.9 which is fussier still. | Day or so to validate output across all three target surfaces with the H&S + PRISMAv1 fixtures, fix any remaining grammar issues, then ship. The fixed quirks already documented: underscore-leader entity names, `color:` in classDef, `·` middle dots in labels, square brackets inside edge labels. |
| **Switch to interactive lineage in dashboard, drop from MDs entirely** | Alternative path: keep MDs textual + linked, invest the Mermaid surface in the existing dashboard Lineage tab (which is already interactive). | Static Mermaid in MDs is always going to be a render-environment lottery. Live interactive trees in the dashboard are the right tool for visual lineage. | Not really a cost — the dashboard Lineage tab already exists. Decision is whether to formally retire Mermaid-in-MD as the design direction or keep the option open. |

## 7 · Quality infrastructure

| Item | What | Why | Rough cost |
|---|---|---|---|
| **Progressive typing carve-outs** | Pair-picker.ts pattern applied to other panels: extract renderer logic from `main.ts` into typed modules with tests. Candidates: page-wireframe, source-map, lineage-view. | `main.ts` is now strict-typed but still 1,584 lines and relies heavily on `any` annotations. Per-panel carves narrow types + add DOM-free tests. | ~1 day per panel. |
| **XSS fuzz coverage for new surfaces** | Source Map CSV export, page-layout wireframe tooltip, What's-new popup. Currently they use `escAttr` correctly but have no regression test. | Belt-and-braces. | ~2 hours. |
| **Dual-theme a11y audit** | Contrast check on BluPulse theme across every panel. Current dim-tier refresh only targeted dark mode. | BluPulse is newest; edge-cases more likely. | ~half day. |

## 8 · Discovery + positioning (non-code)

These came out of the `/sc:business-panel` debate. Not shippable as PRs but worth parking:

| Item | What | Why |
|---|---|---|
| **Customer interviews** | Talk to 3 Power BI devs about how they currently document models. | Christensen's JTBD question. Until this is answered, the "Power BI shops vs Jonathan's readers" tribe question stays unresolved. |
| **Positioning line in README** | One sentence contrasting with TE / Measure Killer: "they edit, we document." | Low cost. Waits on confidence in the line. |
| **Activate BMC** (see [`.github/SPONSOR-DRAFT.md`](.github/SPONSOR-DRAFT.md)) | Flip the parked FUNDING.yml line to live once account is created. | One-line PR when ready. |

## Out of scope (actively decided against)

For completeness — things considered and dropped, so we don't re-litigate them:

- **D3 interactive lineage tree** — big lift, adds runtime dep, duplicates the Mermaid DAGs we ship in `measures.md`. Competitor's differentiator, not ours.
- **Persona selection** ("I am a Developer / DE / Product Owner") — competitor has it. Adds a decision before the primary action; skip.
- **GPL / AGPL licensing** — considered during the license choice. MIT better fits the corporate-adoption target audience.
- **Dedicated Changelog Docs tab** — shipped in 0.8.0, removed in PR #65 because project metadata doesn't belong next to report metadata. Current "✨ What's new" popup is the replacement.
- **Patreon** — wrong model for a dev tool (implies monthly content cadence). Buy Me a Coffee parked instead.

---

## How this file evolves

- When an item starts active design, it moves to a GitHub Issue (labelled `design`) or a `design_*.md` in `claudedocs/`.
- When it ships, it moves to `changelog/<version>.md` + a line here gets struck through or deleted.
- New ideas get added freely — this is the scratchpad, not a commitment.
- Quarterly-ish, rebalance: drop items that don't feel relevant any more.
