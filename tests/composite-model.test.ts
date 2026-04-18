/**
 * Stop-6 integration tests — composite-model support.
 *
 * The Health_and_Safety model at test/Health_and_Safety.Report is our
 * real-world fixture for a composite Power BI model (mixed-storage,
 * DirectQuery to Analysis Services via shared expressions, hand-rolled
 * EXTERNALMEASURE proxy measures, and ten auto-generated LocalDateTable
 * infrastructure tables).
 *
 * Previous builds failed this model in four distinct ways. These tests
 * guard each one against regression:
 *
 *   1. Multi-line TMDL expressions — quoted names containing spaces
 *      caused the expression parser to silently return 0 results,
 *      which cascaded into every DQ partition resolving to "Unknown".
 *
 *   2. Entity-partition source resolution — composite partitions
 *      reference a shared expression via `expressionSource: '…'`
 *      instead of carrying inline M. Previous code didn't follow the
 *      reference so all ~48 DQ partitions collapsed to "Unknown / M".
 *
 *   3. EXTERNALMEASURE proxy detection — regex-at-render-time meant
 *      the Measures MD export, Quality tab, and any future consumer
 *      had to re-implement the detection. Now structured on the
 *      ModelMeasure.externalProxy field.
 *
 *   4. Auto-date table classification — `LocalDateTable_*` and
 *      `DateTableTemplate_*` tables are Power BI infrastructure, not
 *      user content. Previously counted as real tables (10 out of 53
 *      noise on the H&S fixture). Now tagged origin: "auto-date".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildFullData } from "../src/data-builder.js";
import { parseModel, findSemanticModelPath } from "../src/model-parser.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

// ──────────────────────────────────────────────────────────────────────
// Task 1: parseTmdlExpressions handles quoted names with spaces
// ──────────────────────────────────────────────────────────────────────

test("Stop 6.1 — expressions with quoted names (spaces) parse correctly", { skip: !FIXTURE_EXISTS }, () => {
  const modelPath = findSemanticModelPath(FIXTURE);
  const raw = parseModel(modelPath);
  // Should find BOTH shared DirectQuery-to-AS expressions, not zero.
  assert.ok(raw.expressions.length >= 2,
    `expected >=2 expressions, got ${raw.expressions.length}`);
  const names = raw.expressions.map(e => e.name);
  assert.ok(
    names.some(n => n.includes("DirectQuery to AS -")),
    "no DirectQuery-to-AS expression found — quoted-name regex probably regressed: " + names.join(", ")
  );
  // And the value must capture the multi-line `let … in` body, not
  // just the first line.
  const dq = raw.expressions.find(e => /Health_and_Safety_Gold|Global_DatePeriod/.test(e.name));
  assert.ok(dq, "expected a resolvable DQ expression in the fixture");
  assert.ok(
    /AnalysisServices\.Database/.test(dq!.value),
    "expression value missing AS.Database call — multi-line body probably dropped"
  );
});

// ──────────────────────────────────────────────────────────────────────
// Task 2: entity-partition source resolution
// ──────────────────────────────────────────────────────────────────────

test("Stop 6.2 — DQ entity partitions resolve to Analysis Services", { skip: !FIXTURE_EXISTS }, () => {
  const modelPath = findSemanticModelPath(FIXTURE);
  const raw = parseModel(modelPath);
  // Gather every directQuery partition across every table.
  const dqPartitions = raw.tables.flatMap(t =>
    (t.partitions || []).filter(p => p.mode === "directQuery")
  );
  assert.ok(dqPartitions.length > 0, "fixture has no DQ partitions — test premise broken");
  // Every one of them should resolve to Analysis Services now, not
  // the old "Unknown / M" fallback.
  const unresolved = dqPartitions.filter(p => p.sourceType !== "Analysis Services");
  assert.equal(unresolved.length, 0,
    `${unresolved.length} DQ partitions still "Unknown" — entity-partition resolution regressed. Samples: ` +
    unresolved.slice(0, 3).map(p => p.name).join(", "));
});

// ──────────────────────────────────────────────────────────────────────
// Task 3: EXTERNALMEASURE structured detection
// ──────────────────────────────────────────────────────────────────────

test("Stop 6.3 — EXTERNALMEASURE proxies get structured externalProxy", { skip: !FIXTURE_EXISTS }, () => {
  const data = buildFullData(path.resolve(FIXTURE));
  const proxies = data.measures.filter(m => m.externalProxy !== null);
  assert.ok(proxies.length > 0, "no proxy measures detected — EXTERNALMEASURE regex regressed");
  const sample = proxies[0];
  const proxy = sample.externalProxy!;
  assert.ok(typeof proxy.remoteName === "string" && proxy.remoteName.length > 0);
  assert.ok(typeof proxy.type === "string" && proxy.type === proxy.type.toUpperCase(),
    "type should be upper-cased");
  assert.ok(typeof proxy.externalModel === "string" && proxy.externalModel.length > 0);
  // Non-proxy measures must have null.
  const nonProxies = data.measures.filter(m => m.externalProxy === null);
  assert.ok(nonProxies.length > 0, "expected at least one non-proxy measure");
});

test("Stop 6.3 — proxy cluster URL resolves from the shared expression body", { skip: !FIXTURE_EXISTS }, () => {
  const data = buildFullData(path.resolve(FIXTURE));
  const proxyWithCluster = data.measures.find(
    m => m.externalProxy && m.externalProxy.cluster && m.externalProxy.cluster.startsWith("powerbi://")
  );
  assert.ok(proxyWithCluster, "no proxy measure carries a resolved powerbi:// cluster — expression lookup regressed");
});

// ──────────────────────────────────────────────────────────────────────
// Task 4: auto-date table classification
// ──────────────────────────────────────────────────────────────────────

test("Stop 6.4 — LocalDateTable_* and DateTableTemplate_* get origin: auto-date", { skip: !FIXTURE_EXISTS }, () => {
  const data = buildFullData(path.resolve(FIXTURE));
  const autoDate = data.tables.filter(t => t.origin === "auto-date");
  const userTables = data.tables.filter(t => t.origin === "user");
  assert.ok(autoDate.length > 0, "expected at least one auto-date table on the H&S fixture");
  assert.ok(userTables.length > 0, "expected at least one user table");
  // Every auto-date table's name MUST match the infrastructure naming
  // convention. If the classifier fires on a user table, that's a bug.
  for (const t of autoDate) {
    assert.ok(
      /^LocalDateTable_/.test(t.name) || /^DateTableTemplate_/.test(t.name),
      "misclassified user table as auto-date: " + t.name
    );
  }
  // And no user-named table may be tagged auto-date.
  for (const t of userTables) {
    assert.ok(
      !/^LocalDateTable_/.test(t.name) && !/^DateTableTemplate_/.test(t.name),
      "user table with auto-date name: " + t.name
    );
  }
});
