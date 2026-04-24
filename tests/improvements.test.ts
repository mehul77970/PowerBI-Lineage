/**
 * Improvements (Areas of Improvement) — check pipeline + MD renderer.
 *
 * Two layers:
 *   1. Unit — hand-crafted FullData fragments exercise each check
 *      in isolation so a change to any single rule can't silently
 *      break another.
 *   2. Integration — H&S fixture (composite model) produces a
 *      stable, reasonable set of items including the ones the
 *      fixture actually exhibits (Auto-Date on, composite proxies).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runImprovementChecks, generateImprovementsMd,
  circularMeasures, deadChainMeasures, longDaxMeasures,
  duplicateDaxMeasures, deadInactiveRelationships,
} from "../src/improvements.js";
import type { FullData } from "../src/data-builder.js";
import { buildFullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

// ─────────────────────────────────────────────────────────────────────
// Minimal FullData factory
// ─────────────────────────────────────────────────────────────────────

function mk(over: Partial<FullData> = {}): FullData {
  // Description is non-empty by default so the "model has no top-level
  // description" low-priority check doesn't fire on every test.
  return {
    measures: [], columns: [], relationships: [], functions: [],
    calcGroups: [], tables: [], pages: [], hiddenPages: [],
    allPages: [], expressions: [], compatibilityLevel: null,
    modelProperties: {
      name: "m", description: "Test model.", culture: "", sourceQueryCulture: "",
      discourageImplicitMeasures: false, valueFilterBehavior: "",
      cultures: [], defaultPowerBIDataSourceVersion: "",
    },
    totals: {
      measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
      columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
      relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
    },
    ...over,
  } as FullData;
}

function mkMeasure(over: Partial<FullData["measures"][0]> = {}): FullData["measures"][0] {
  return {
    name: "M", table: "T", daxExpression: "1", formatString: "", description: "",
    displayFolder: "", daxDependencies: [], dependedOnBy: [], usedIn: [],
    usageCount: 0, pageCount: 0, status: "unused", externalProxy: null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Individual check functions
// ─────────────────────────────────────────────────────────────────────

test("circularMeasures — returns empty on a DAG", () => {
  const data = mk({
    measures: [
      mkMeasure({ name: "A", daxDependencies: ["B"] }),
      mkMeasure({ name: "B", daxDependencies: ["C"] }),
      mkMeasure({ name: "C", daxDependencies: [] }),
    ],
  });
  assert.deepEqual(circularMeasures(data), []);
});

test("circularMeasures — detects a two-measure cycle", () => {
  const data = mk({
    measures: [
      mkMeasure({ name: "A", daxDependencies: ["B"] }),
      mkMeasure({ name: "B", daxDependencies: ["A"] }),
    ],
  });
  const cycles = circularMeasures(data);
  assert.equal(cycles.length, 1);
  // Loop should contain both names
  const loop = cycles[0];
  assert.ok(loop.includes("A") && loop.includes("B"),
    `loop should contain both A and B, got ${loop.join("→")}`);
});

test("circularMeasures — detects a three-measure cycle", () => {
  const data = mk({
    measures: [
      mkMeasure({ name: "A", daxDependencies: ["B"] }),
      mkMeasure({ name: "B", daxDependencies: ["C"] }),
      mkMeasure({ name: "C", daxDependencies: ["A"] }),
    ],
  });
  const cycles = circularMeasures(data);
  assert.ok(cycles.length >= 1, "should detect at least one cycle");
});

test("deadChainMeasures — leaf measures only referenced by unused are flagged", () => {
  const data = mk({
    measures: [
      // "Live" is directly consumed, references "Helper"
      mkMeasure({ name: "Live", status: "direct", daxDependencies: ["Helper"] }),
      mkMeasure({ name: "Helper", status: "indirect", daxDependencies: ["Leaf"] }),
      mkMeasure({ name: "Leaf", status: "indirect" }),
      // "Dead" is unused and only references the Dead-Helper
      mkMeasure({ name: "Dead", status: "unused", daxDependencies: ["Dead-Helper"] }),
      mkMeasure({ name: "Dead-Helper", status: "indirect" }),
    ],
  });
  const dead = deadChainMeasures(data);
  assert.ok(dead.includes("Dead-Helper"),
    "Dead-Helper is only reachable from an unused measure — should be dead-chain");
  assert.ok(!dead.includes("Helper") && !dead.includes("Leaf"),
    "Helper and Leaf are reachable from a direct measure — should NOT be dead-chain");
});

test("longDaxMeasures — flags measures at/above the threshold", () => {
  const shortDax = "SUM(T[C])";
  const longDax = Array.from({ length: 35 }, (_, i) => `VAR x${i} = 1`).join("\n") + "\nRETURN x0";
  const data = mk({
    measures: [
      mkMeasure({ name: "Short", daxExpression: shortDax }),
      mkMeasure({ name: "Long", daxExpression: longDax }),
    ],
  });
  const long = longDaxMeasures(data, 30);
  assert.equal(long.length, 1);
  assert.equal(long[0].name, "Long");
});

test("duplicateDaxMeasures — groups identical bodies, ignores trivially short ones", () => {
  const data = mk({
    measures: [
      mkMeasure({ name: "A", table: "T", daxExpression: "CALCULATE(SUM(T[Val]), T[Year] = 2024)" }),
      mkMeasure({ name: "B", table: "T", daxExpression: "CALCULATE(SUM(T[Val]), T[Year] = 2024)" }),
      mkMeasure({ name: "C", table: "T", daxExpression: "CALCULATE(SUM(T[Val]),  T[Year]  =  2024)" }),  // whitespace-different
      mkMeasure({ name: "D", table: "T", daxExpression: "0" }),  // trivial, ignored
      mkMeasure({ name: "E", table: "T", daxExpression: "0" }),  // trivial, ignored
      mkMeasure({ name: "F", table: "T", daxExpression: "SUM(U[X])" }),
    ],
  });
  const dups = duplicateDaxMeasures(data);
  assert.equal(dups.length, 1, "one duplicate group (A/B/C)");
  assert.equal(dups[0].names.length, 3);
});

test("deadInactiveRelationships — an inactive rel with no USERELATIONSHIP call is flagged", () => {
  const data = mk({
    relationships: [
      { fromTable: "F", fromColumn: "k", toTable: "D", toColumn: "k", isActive: false, fromCardinality: "many", toCardinality: "one", crossFilteringBehavior: "oneDirection" },
    ],
  });
  const dead = deadInactiveRelationships(data);
  assert.equal(dead.length, 1);
});

test("deadInactiveRelationships — an inactive rel referenced by USERELATIONSHIP is kept alive", () => {
  const data = mk({
    relationships: [
      { fromTable: "F", fromColumn: "k", toTable: "D", toColumn: "k", isActive: false, fromCardinality: "many", toCardinality: "one", crossFilteringBehavior: "oneDirection" },
    ],
    measures: [
      mkMeasure({
        name: "M",
        daxExpression: "CALCULATE(SUM(F[v]), USERELATIONSHIP(F[k], D[k]))",
      }),
    ],
  });
  assert.equal(deadInactiveRelationships(data).length, 0);
});

// ─────────────────────────────────────────────────────────────────────
// Pipeline + renderer
// ─────────────────────────────────────────────────────────────────────

test("runImprovementChecks — empty model produces no high/medium/low items", () => {
  const items = runImprovementChecks(mk());
  const bad = items.filter(i => i.severity === "high" || i.severity === "medium" || i.severity === "low");
  assert.equal(bad.length, 0);
});

test("generateImprovementsMd — emits ADO Wiki suggestion comment + tier headers", () => {
  const md = generateImprovementsMd(mk(), "t");
  assert.ok(md.includes("<!-- Suggested ADO Wiki page name: t/Improvements -->"));
  assert.ok(md.includes("# Areas of Improvement"));
  assert.ok(md.includes("## Summary"));
  // With no items, should carry the "nothing flagged" note
  assert.ok(md.includes("No improvement items flagged"));
});

test("generateImprovementsMd — auto-date entry appears when auto-date tables exist", () => {
  const data = mk({
    tables: [
      { name: "LocalDateTable_abc", description: "", isCalcGroup: false, origin: "auto-date" as const,
        isCalculatedTable: false, parameterKind: null, columnCount: 1, measureCount: 0, keyCount: 0,
        fkCount: 0, hiddenColumnCount: 0, columns: [], measures: [], relationships: [],
        partitions: [], hierarchies: [] } as any,
    ],
  });
  const md = generateImprovementsMd(data, "t");
  assert.ok(md.includes("🔴 High priority"));
  assert.ok(md.includes("Auto-Date/Time is enabled"));
});

// ─────────────────────────────────────────────────────────────────────
// Fixture integration — H&S
// ─────────────────────────────────────────────────────────────────────

if (FIXTURE_EXISTS) {
  test("H&S fixture — Auto-Date flag fires (H&S has 10 LocalDateTable_*)", () => {
    const data = buildFullData(path.resolve(FIXTURE));
    const items = runImprovementChecks(data);
    const autoDate = items.find(i => i.title.includes("Auto-Date"));
    assert.ok(autoDate, "H&S has auto-date infrastructure — the rule should fire");
    assert.equal(autoDate!.severity, "high");
  });

  test("H&S fixture — composite-proxy info entry fires", () => {
    const data = buildFullData(path.resolve(FIXTURE));
    const items = runImprovementChecks(data);
    const proxy = items.find(i => i.title.includes("composite-model proxy"));
    assert.ok(proxy, "H&S has 11 composite-model proxies — the info entry should fire");
    assert.equal(proxy!.severity, "info");
  });

  test("H&S fixture — 'no circular deps' strength fires (H&S has no cycles)", () => {
    const data = buildFullData(path.resolve(FIXTURE));
    const items = runImprovementChecks(data);
    const good = items.find(i => i.title === "No circular measure dependencies");
    assert.ok(good, "H&S has no cyclic measures — strength should fire");
    assert.equal(good!.severity, "good");
  });

  test("H&S fixture — MD output has non-zero size, no runtime errors", () => {
    const data = buildFullData(path.resolve(FIXTURE));
    const md = generateImprovementsMd(data, "Health_and_Safety");
    assert.ok(md.length > 1000, "H&S improvements doc should be substantive (>1KB)");
    assert.ok(md.includes("🔴 High priority"));
    assert.ok(md.includes("🟡 Medium priority"));
    assert.ok(md.includes("ℹ️  Info") || md.includes("ℹ️ Info"));
  });
}
