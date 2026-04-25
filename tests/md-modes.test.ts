/**
 * Lite / Detailed MD output modes.
 *
 * Each generator accepts a third arg `mode: "lite" | "detailed"` (default
 * "detailed" for back-compat). These tests verify:
 *   - Lite skips Data Dictionary + Index entirely (returns "")
 *   - Lite skips Functions / Calc Groups when empty (F5)
 *   - Lite emits a smaller doc than Detailed for shared docs
 *   - Lite preserves the Measures front-matter + summary table
 *   - Detailed preserves the per-measure entries + Mermaid blocks
 *   - Both modes accept fixture data without crashing
 *
 * Mostly fixture-based; pure unit tests where the assertion is
 * mode-shape rather than content-specific.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateMarkdown, generateMeasuresMd, generateDataDictionaryMd,
  generateSourcesMd, generatePagesMd, generateIndexMd,
  generateFunctionsMd, generateCalcGroupsMd,
} from "../src/md-generator.js";
import { generateImprovementsMd } from "../src/improvements.js";
import { buildFullData } from "../src/data-builder.js";
import type { FullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

test("Lite mode — Data Dictionary returns empty (always skipped)", () => {
  const fakeData = { tables: [], columns: [], measures: [], relationships: [] } as unknown as FullData;
  assert.equal(generateDataDictionaryMd(fakeData, "t", "lite"), "");
});

test("Lite mode — Index returns empty (always skipped)", () => {
  const fakeData = { tables: [], columns: [], measures: [], functions: [], calcGroups: [] } as unknown as FullData;
  assert.equal(generateIndexMd(fakeData, "t", "lite"), "");
});

test("Both modes — Functions returns empty when no UDFs (F5)", () => {
  const fakeData = { functions: [] } as unknown as FullData;
  assert.equal(generateFunctionsMd(fakeData, "t", "lite"), "");
  assert.equal(generateFunctionsMd(fakeData, "t", "detailed"), "");
});

test("Both modes — Calc Groups returns empty when no calc groups (F5)", () => {
  const fakeData = { calcGroups: [] } as unknown as FullData;
  assert.equal(generateCalcGroupsMd(fakeData, "t", "lite"), "");
  assert.equal(generateCalcGroupsMd(fakeData, "t", "detailed"), "");
});

if (FIXTURE_EXISTS) {
  const data = buildFullData(path.resolve(FIXTURE));

  test("H&S fixture — Lite Model.md is smaller than Detailed", () => {
    const det = generateMarkdown(data, "H", "detailed");
    const lit = generateMarkdown(data, "H", "lite");
    assert.ok(lit.length < det.length, "lite should be smaller");
    // Lite must still carry the front matter and ER diagram
    assert.ok(lit.includes("# Semantic Model Technical Specification"));
    assert.ok(lit.includes("erDiagram"));
    // Lite must drop §1.2 Conventions, §3.2 Parameters, Appendix A
    assert.ok(!lit.includes("### 1.2 Conventions"), "lite should drop §1.2");
    assert.ok(!lit.includes("### 3.2 Parameters and expressions"), "lite should drop §3.2");
    assert.ok(!lit.includes("Appendix A — Generation metadata"), "lite should drop Appendix A");
  });

  test("H&S fixture — Lite Sources.md drops Native queries / M-step / Raw M sections", () => {
    const lit = generateSourcesMd(data, "H", "lite");
    const det = generateSourcesMd(data, "H", "detailed");
    assert.ok(lit.length < det.length);
    assert.ok(!lit.includes("## Native queries"));
    assert.ok(!lit.includes("## M-step breakdown"));
    assert.ok(!lit.includes("## Raw M expressions"));
    // Lite must still carry the Physical-source index
    assert.ok(lit.includes("## Physical-source index"));
  });

  test("H&S fixture — Lite Measures.md is a flat summary table only (no per-measure blocks)", () => {
    const lit = generateMeasuresMd(data, "H", "lite");
    const det = generateMeasuresMd(data, "H", "detailed");
    assert.ok(lit.length < det.length / 4, "lite should be much smaller");
    // Lite has the summary table
    assert.ok(/\| Name \| Table \| Status \| Format \| Description \|/.test(lit));
    // Lite drops the per-measure <details> blocks (a hallmark of Detailed)
    assert.ok(!/<details>/.test(lit), "lite should not have <details> blocks");
    // Detailed has the per-measure blocks
    assert.ok(/<details>/.test(det), "detailed should have <details> blocks");
  });

  test("H&S fixture — Lite Pages.md drops per-page sections (just keeps index)", () => {
    const lit = generatePagesMd(data, "H", "lite");
    const det = generatePagesMd(data, "H", "detailed");
    assert.ok(lit.length < det.length / 3);
    // Lite still has the visible-page index
    assert.ok(lit.includes("### Visible page index"));
    // Lite drops the per-visual binding tables (a Detailed-only artefact)
    assert.ok(!/Visuals \(\d+\)<\/b>/.test(lit), "lite should not have per-page visual tables");
  });

  test("H&S fixture — Improvements.md identical in both modes", () => {
    const lit = generateImprovementsMd(data, "H", "lite");
    const det = generateImprovementsMd(data, "H", "detailed");
    assert.equal(lit, det);
  });

  test("Default mode is detailed — generateMarkdown(data, name) == generateMarkdown(data, name, 'detailed')", () => {
    assert.equal(
      generateMarkdown(data, "H"),
      generateMarkdown(data, "H", "detailed"),
    );
  });

  test("F7 — Detailed Measures.md no longer has the front-matter External-proxy table", () => {
    const det = generateMeasuresMd(data, "H", "detailed");
    // The OLD doc had a "## External proxy measures" front-matter
    // section. F7 removes it; proxies are still marked inline in
    // each A–Z entry via the EXTERNAL badge.
    assert.ok(!/^## External proxy measures$/m.test(det),
      "F7: front-matter External-proxy table must not appear");
  });

  test("F9 — Detailed Model.md replaces §3.3 with a 1-line pointer", () => {
    const det = generateMarkdown(data, "H", "detailed");
    // The §3.3 heading still exists (preserves anchor) but the body
    // is now a single pointer line, not the full per-table table.
    const idx = det.indexOf("### 3.3 Per-table sources");
    assert.ok(idx >= 0);
    const next = det.indexOf("---", idx);
    const sliceTxt = det.substring(idx, next);
    // Old version had ~50 rows. New version has the heading + 1 pointer
    // sentence. Aggressive line-count check.
    assert.ok(sliceTxt.split("\n").length < 8, "§3.3 body should be a 1-line pointer, not a 50-row table");
    assert.ok(/Sources\*?\*? companion document/i.test(sliceTxt), "§3.3 should point at Sources.md");
  });

  test("F10 — Detailed Index.md wraps each letter's contents in <details>", () => {
    const det = generateIndexMd(data, "H", "detailed");
    // The letter heading stays as a plain `## A` (anchors must work)
    assert.ok(/^## [A-Z]$/m.test(det), "letter headings must remain visible");
    // Each letter section's contents go into a <details> block
    assert.ok(/<details><summary>/.test(det), "letter contents should be wrapped in <details>");
  });

  // ────────────────────────────────────────────────────────────────────
  // F13 — cross-doc xref linking
  // ────────────────────────────────────────────────────────────────────

  test("F13 — Detailed Sources.md physical-source index links Model tables to DataDictionary", () => {
    const det = generateSourcesMd(data, "H", "detailed");
    // At least one of the index rows should carry a DataDictionary.md
    // markdown link in the Model tables column.
    assert.ok(/\]\(DataDictionary\.md#[^)]+\)/.test(det),
      "Detailed Sources.md should link Model tables to DataDictionary anchors");
  });

  test("F13 — Lite Sources.md physical-source index does NOT link (no DataDict in Lite)", () => {
    const lit = generateSourcesMd(data, "H", "lite");
    // Lite has no DataDictionary doc, so cross-links would 404.
    assert.ok(!/\]\(DataDictionary\.md/.test(lit),
      "Lite Sources.md must not link to DataDictionary (it's skipped in Lite)");
  });

  test("F13 — Detailed Measures.md table cells link Home Table to DataDictionary", () => {
    const det = generateMeasuresMd(data, "H", "detailed");
    assert.ok(/\]\(DataDictionary\.md#[^)]+\)/.test(det),
      "Detailed Measures.md should link Home Table cells to DataDictionary anchors");
  });

  test("F13 — Detailed Pages.md visual bindings link to Measures.md / DataDictionary.md", () => {
    const det = generatePagesMd(data, "H", "detailed");
    // At least one binding row should carry a Measures.md link
    assert.ok(/\]\(Measures\.md#[^)]+\)/.test(det),
      "Detailed Pages.md should link measure bindings to Measures.md");
  });

  test("F13 — Detailed DataDictionary FK chips link to target table within same doc", () => {
    const det = generateDataDictionaryMd(data, "H", "detailed");
    // FK chips emit `→ [Table](#anchor)[Col]` — same-doc link form.
    assert.ok(/→ \[[^\]]+\]\(#[^)]+\)\[/.test(det),
      "Detailed DataDictionary FK chips should link to target table sections");
  });

  test("F13 — DataDictionary FK pointing at auto-date table falls back to plain text (no broken anchor)", () => {
    // The H&S fixture has FKs from various tables to LocalDateTable_*
    // auto-date tables. Those tables have no per-table sections in
    // DataDict (collapsed appendix), so we must NOT emit links to
    // their (non-existent) anchors.
    const det = generateDataDictionaryMd(data, "H", "detailed");
    assert.ok(!/\]\(#localdatetable_/i.test(det),
      "no link should point at LocalDateTable_* anchors (no headings exist)");
  });

  // ────────────────────────────────────────────────────────────────────
  // erDiagram entity-name compliance + Measures.md deps linking
  // ────────────────────────────────────────────────────────────────────

  test("erDiagram entity names start with a letter (Mermaid grammar requires this)", () => {
    // Power BI's `_measures` / `_Rollup_measures` underscore-prefix
    // convention used to produce `_measures { ... }` in our erDiagram
    // output. Mermaid rejects underscore-leading entity idents (and
    // GitHub falls back to rendering the block as plain code when
    // parsing fails). We now prefix `E` to non-letter leaders so the
    // diagram renders.
    const det = generateMarkdown(data, "H", "detailed");
    const erMatch = det.match(/```mermaid\nerDiagram[\s\S]+?```/);
    if (!erMatch) return; // model has no rels — no erDiagram emitted
    // Every entity name (line ending with " {") must start with a letter.
    const entityHeaders = erMatch[0].match(/^\s+(\S+)\s*\{/gm) || [];
    for (const h of entityHeaders) {
      const name = h.trim().replace(/\s*\{$/, "");
      assert.ok(/^[A-Za-z]/.test(name),
        `erDiagram entity "${name}" must start with a letter`);
    }
  });

  test("Measures.md Depends-on chips link to the dependency's A-Z entry (same-doc)", () => {
    const det = generateMeasuresMd(data, "H", "detailed");
    // Each chip should wrap a markdown link `[Name](#anchor-slug)`
    // inside the chip span. Detailed mode emits `chip chip--measure`
    // wrappers; we assert at least one carries an inner link.
    assert.ok(/<span class="chip chip--measure">\[[^\]]+\]\(#[^)]+\)<\/span>/.test(det),
      "Detailed Measures.md Depends-on / Used-by chips should wrap a same-doc anchor link");
  });
}
