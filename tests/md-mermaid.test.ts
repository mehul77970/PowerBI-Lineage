/**
 * Mermaid emission tests — currently asserting NO blocks emitted.
 *
 * v0.7.0 introduced Mermaid `graph LR` lineage blocks per measure +
 * per-fact-table star fragments, plus an `erDiagram` in Model.md §2.4.
 * v0.11.0 gated all three behind `EMIT_MERMAID = false` in
 * md-generator.ts because render-quality across our three target
 * surfaces (GitHub, ADO Wiki, dashboard MD viewer) was unreliable
 * enough to ship plain-code-block fallback noise.
 *
 * These tests pin the current state — no Mermaid blocks anywhere in
 * the generated MDs. When the gate flips back on (Mermaid revival
 * is parked in ROADMAP.md), the assertions invert: replace the
 * `assert.ok(!hasBlocks)` with the original `assert.ok(blocks.length >= N)`
 * structural checks. The helper functions
 * (mermaidMeasureLineage / mermaidTableRelationships /
 * mermaidFullModelErDiagram) are retained in md-generator.ts so the
 * revival is a one-line flag flip rather than a re-implementation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateMarkdown,
  generateMeasuresMd,
  generateDataDictionaryMd,
} from "../src/md-generator.js";
import { buildFullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

if (!FIXTURE_EXISTS) {
  test("mermaid — fixture missing, skipping", { skip: true }, () => {});
} else {
  const data = buildFullData(path.resolve(FIXTURE));

  test("EMIT_MERMAID gate — Model.md emits no erDiagram block", () => {
    const md = generateMarkdown(data, "Health_and_Safety");
    assert.ok(!md.includes("```mermaid"),
      "Model.md must not emit any Mermaid block while EMIT_MERMAID is false");
    assert.ok(!md.includes("erDiagram"),
      "Model.md must not include erDiagram syntax while EMIT_MERMAID is false");
  });

  test("EMIT_MERMAID gate — Measures.md emits no per-measure lineage blocks", () => {
    const md = generateMeasuresMd(data, "Health_and_Safety");
    const blocks = (md.match(/```mermaid\n[\s\S]+?\n```/g) || []);
    assert.equal(blocks.length, 0,
      `Measures.md must not emit Mermaid blocks while EMIT_MERMAID is false (found ${blocks.length})`);
  });

  test("EMIT_MERMAID gate — Data Dictionary emits no star-fragment blocks", () => {
    const md = generateDataDictionaryMd(data, "Health_and_Safety");
    assert.ok(!md.includes("```mermaid"),
      "Data Dictionary must not emit any Mermaid block while EMIT_MERMAID is false");
    assert.ok(!md.includes("#### Star fragment"),
      "Data Dictionary must not emit Star fragment headings while EMIT_MERMAID is false");
  });
}
