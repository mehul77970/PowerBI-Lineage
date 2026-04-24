/**
 * Relationship cardinality + cross-filter parsing.
 *
 * Competitor tools (pbip-documenter) surface cardinality and filter
 * direction — we previously dropped those fields on the floor. These
 * tests assert:
 *
 *   1. TMDL defaults are materialised (`many → one, oneDirection`)
 *      even when the file omits the fields.
 *   2. Explicit `fromCardinality: one` / `toCardinality: many` /
 *      `crossFilteringBehavior: bothDirections` are round-tripped.
 *   3. The Health_and_Safety fixture — which has multiple bidi rels
 *      and at least one `fromCardinality: one` — parses without
 *      dropping anything.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseModel, findSemanticModelPath } from "../src/model-parser.js";

function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pbilineage-${label}-`));
}

function writeTmdlModel(dir: string, relsContent: string): void {
  fs.mkdirSync(path.join(dir, "definition", "tables"), { recursive: true });
  fs.writeFileSync(path.join(dir, "definition", "model.tmdl"), "model Model\n\tculture: en-US\n");
  fs.writeFileSync(path.join(dir, "definition", "database.tmdl"), "database\n\tcompatibilityLevel: 1702\n");
  fs.writeFileSync(path.join(dir, "definition", "relationships.tmdl"), relsContent);
  // parseModel dispatches to the TMDL path when at least one table file
  // is present. Minimal stubs so both endpoints of the test relationship
  // exist as named tables.
  const tableStub = (name: string) => `table '${name}'\n\tcolumn 'k'\n\t\tdataType: string\n\t\tsourceColumn: k\n\n\tpartition ${name}-p = m\n\t\tmode: import\n\t\tsource = ""\n`;
  fs.writeFileSync(path.join(dir, "definition", "tables", "a.tmdl"), tableStub("a"));
  fs.writeFileSync(path.join(dir, "definition", "tables", "b.tmdl"), tableStub("b"));
}

test("TMDL defaults — omitted fields materialise as many → one, single-direction", () => {
  const dir = tempDir("rel-defaults");
  writeTmdlModel(dir, [
    "relationship abc",
    "\tfromColumn: fact.customer_id",
    "\ttoColumn: dim.customer_id",
    "",
  ].join("\n"));

  const model = parseModel(dir);
  assert.equal(model.relationships.length, 1);
  const r = model.relationships[0];
  assert.equal(r.fromTable, "fact");
  assert.equal(r.toTable, "dim");
  assert.equal(r.fromCardinality, "many");
  assert.equal(r.toCardinality, "one");
  assert.equal(r.crossFilteringBehavior, "oneDirection");
  assert.equal(r.isActive, true);
});

test("TMDL explicit — bidi filter + one-to-many cardinality round-trip", () => {
  const dir = tempDir("rel-explicit");
  writeTmdlModel(dir, [
    "relationship xyz",
    "\tcrossFilteringBehavior: bothDirections",
    "\tfromCardinality: one",
    "\ttoCardinality: many",
    "\tfromColumn: 'Date'.'Date'",
    "\ttoColumn: 'Fact Sales'.OrderDate",
    "\tisActive: false",
    "",
  ].join("\n"));

  const model = parseModel(dir);
  assert.equal(model.relationships.length, 1);
  const r = model.relationships[0];
  assert.equal(r.fromTable, "Date");
  assert.equal(r.toTable, "Fact Sales");
  assert.equal(r.fromCardinality, "one");
  assert.equal(r.toCardinality, "many");
  assert.equal(r.crossFilteringBehavior, "bothDirections");
  assert.equal(r.isActive, false);
});

test("TMDL — unknown cardinality value falls back to default rather than crashing", () => {
  const dir = tempDir("rel-junk");
  writeTmdlModel(dir, [
    "relationship junk",
    "\tfromCardinality: weirdValue",
    "\tcrossFilteringBehavior: invented",
    "\tfromColumn: a.b",
    "\ttoColumn: c.d",
    "",
  ].join("\n"));

  const model = parseModel(dir);
  const r = model.relationships[0];
  assert.equal(r.fromCardinality, "many");
  assert.equal(r.crossFilteringBehavior, "oneDirection");
});

test("Health_and_Safety fixture — cardinality fields are populated for every relationship", () => {
  // Tests compile to ESM under dist-test/, so __dirname isn't defined.
  // The fixture lives at <repoRoot>/test/Health_and_Safety.Report — we
  // trust the suite to be run from the repo root (which run-tests.mjs
  // guarantees) and resolve relative to cwd.
  const fixturePath = path.resolve(process.cwd(), "test", "Health_and_Safety.Report");
  const modelPath = findSemanticModelPath(fixturePath);
  if (!modelPath) return; // fixture optional
  const model = parseModel(modelPath);
  assert.ok(model.relationships.length > 0, "fixture should have relationships");

  for (const r of model.relationships) {
    assert.ok(r.fromCardinality === "one" || r.fromCardinality === "many", `fromCardinality for ${r.fromTable}→${r.toTable}`);
    assert.ok(r.toCardinality === "one" || r.toCardinality === "many");
    assert.ok(r.crossFilteringBehavior === "oneDirection" || r.crossFilteringBehavior === "bothDirections");
  }

  const bidiCount = model.relationships.filter(r => r.crossFilteringBehavior === "bothDirections").length;
  assert.ok(bidiCount > 0, "H&S fixture has documented bidi rels — parser must surface at least one");
});
