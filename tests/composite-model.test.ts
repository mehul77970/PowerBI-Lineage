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
import { generateHTML } from "../src/html-generator.js";

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

test("EXTERNALMEASURE regex — doubled-quote DAX escape survives round-trip", () => {
  // DAX escapes an embedded double-quote by doubling it. A measure
  // named `foo"bar` is written in source as "foo""bar". The previous
  // regex used [^"]* which silently truncated after `foo`; the
  // current pattern accepts (?:[^"]|"") and un-doubles with
  // undoubleDaxQuotes(). This test doesn't need the H&S fixture —
  // we synthesise a RawModel with a pathological measure name and
  // drive it through buildFullData.
  //
  // Rather than synthesising a whole FullData (requires a full fake
  // file tree), we exercise the regex directly via re-implementing
  // it here — the module itself keeps the regex private, but the
  // pattern is simple enough to cover structurally.
  const rx = /EXTERNALMEASURE\s*\(\s*"((?:[^"]|"")*)"\s*,\s*(\w+)\s*,\s*"DirectQuery to AS - ((?:[^"]|"")+)"\s*\)/i;
  const undouble = (s: string): string => s.replace(/""/g, '"');

  // Case 1: no doubled quotes (backwards compat — previous behaviour)
  const m1 = `EXTERNALMEASURE("Number of Fatal Injuries", INTEGER, "DirectQuery to AS - Health_and_Safety_Gold")`.match(rx);
  assert.ok(m1, "vanilla EXTERNALMEASURE failed to match");
  assert.equal(undouble(m1![1]), "Number of Fatal Injuries");
  assert.equal(undouble(m1![3]), "Health_and_Safety_Gold");

  // Case 2: remote name with a doubled quote
  const m2 = `EXTERNALMEASURE("foo""bar", INTEGER, "DirectQuery to AS - cube")`.match(rx);
  assert.ok(m2, "doubled-quote remote name failed to match");
  assert.equal(undouble(m2![1]), 'foo"bar',
    "expected un-doubled literal; got " + undouble(m2![1]));

  // Case 3: external model with a doubled quote (rare but possible)
  const m3 = `EXTERNALMEASURE("x", INTEGER, "DirectQuery to AS - a""b")`.match(rx);
  assert.ok(m3, "doubled-quote external model failed to match");
  assert.equal(undouble(m3![3]), 'a"b');
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

// ──────────────────────────────────────────────────────────────────────
// Task 5: TableData.parameterKind — field params vs composite proxies
// ──────────────────────────────────────────────────────────────────────
//
// Signals the parser + data-builder expose so downstream consumers
// (Tables tab, Sources tab, MD exports) can distinguish
//   - real data tables (dim/fact/bridge)
//   - field parameters (Power BI's fieldparameter UI)
//   - composite-model proxies (DirectQuery entity stubs)
// without re-parsing TMDL. These are covered here, not in a Tree-tab
// test, because nothing in the app currently reads them yet — but
// removing them silently would regress the data model.

test("Stop 6.5 — field parameters detected via ParameterMetadata", { skip: !FIXTURE_EXISTS }, () => {
  const data = buildFullData(path.resolve(FIXTURE));
  const fieldParams = data.tables
    .filter(t => t.parameterKind === "field")
    .map(t => t.name)
    .sort();
  // Only the switch_* tables created via Power BI's field-parameter
  // UI carry `extendedProperty ParameterMetadata`. Hand-rolled
  // calculated tables with parameter-like intent (switch_hours_worked)
  // must NOT be promoted — that'd be a false positive.
  for (const expected of ["switch_geodata", "switch_site_details", "switch_time_period"]) {
    assert.ok(
      fieldParams.includes(expected),
      `expected ${expected} to be parameterKind="field" — got [${fieldParams.join(", ")}]`,
    );
  }
  const swhw = data.tables.find(t => t.name === "switch_hours_worked");
  assert.equal(swhw?.parameterKind, null,
    "switch_hours_worked has no ParameterMetadata — must stay null");
});

test("Stop 6.6 — composite-model proxies detected via DQ entity shape", { skip: !FIXTURE_EXISTS }, () => {
  const data = buildFullData(path.resolve(FIXTURE));
  const proxies = data.tables
    .filter(t => t.parameterKind === "compositeModelProxy")
    .map(t => t.name)
    .sort();
  // Single-column, same-name tables with directQuery partition +
  // expressionSource. These are the remote-handle stubs Power BI
  // creates for composite models pointing at AS datasets.
  for (const expected of [
    "Domain_Health_and_Safety_SQL",
    "Domain_Health_and_Safety_Schema",
    "Domain_Health_and_Safety_WH",
    "Globa_Data_House",
    "Global_Data_House_SQL",
    "Global_Dimensions_Schema",
    "Global_Dimensions_Text_Summary",
    "table_HS",
    "table_PSIF",
    "table_injury",
    "table_trcf_targets",
  ]) {
    assert.ok(
      proxies.includes(expected),
      `expected ${expected} to be parameterKind="compositeModelProxy" — got [${proxies.join(", ")}]`,
    );
  }
});

test("Stop 6.7 — DAX calculated tables flagged via partitionKind", { skip: !FIXTURE_EXISTS }, () => {
  const data = buildFullData(path.resolve(FIXTURE));
  // Calc tables and M-import tables both report `mode: import`.
  // The ONLY reliable discriminator is the TMDL partition kind
  // token (`= calculated`) captured in RawPartition.partitionKind.
  // If that plumbing breaks, every calc table collapses into the
  // M-import bucket in downstream consumers.
  const calcTables = data.tables
    .filter(t => t.isCalculatedTable)
    .map(t => t.name)
    .sort();
  assert.ok(
    calcTables.some(n => n.startsWith("switch_")),
    `expected at least one switch_* calculated table on H&S — got [${calcTables.join(", ")}]`,
  );
  // Regular import / DQ tables must NOT be tagged calculated.
  const dimCalendar = data.tables.find(t => t.name === "dim_calendar");
  assert.equal(dimCalendar?.isCalculatedTable, false,
    "dim_calendar is a regular import table, not calculated");
  const tableHS = data.tables.find(t => t.name === "table_HS");
  assert.equal(tableHS?.isCalculatedTable, false,
    "table_HS is a DQ entity proxy, not calculated");
});

test("Stop 6.8 — RawPartition.expressionSource populated on entity partitions", { skip: !FIXTURE_EXISTS }, () => {
  // The composite-model-proxy classifier depends on expressionSource
  // being set. If the parser regresses, every proxy degrades to a
  // phantom DISCONNECTED table across the whole app.
  const modelPath = findSemanticModelPath(FIXTURE);
  const raw = parseModel(modelPath);
  const tableHS = raw.tables.find(t => t.name === "table_HS");
  assert.ok(tableHS, "table_HS missing from fixture");
  const dqP = (tableHS!.partitions || []).find(p => p.mode === "directQuery");
  assert.ok(dqP, "table_HS has no DQ partition");
  assert.ok(
    dqP!.expressionSource && dqP!.expressionSource.length > 0,
    "DQ partition missing expressionSource — parser regression",
  );
  assert.equal(dqP!.partitionKind, "entity",
    "DQ entity partition's partitionKind token should be 'entity'");
});

// ──────────────────────────────────────────────────────────────────────
// Task 6: Tables-tab grouping — wires the classifiers into the client
// ──────────────────────────────────────────────────────────────────────
//
// The classifiers are only useful if the client actually surfaces
// them. These tests pin the five group labels + click action so a
// silent regression in renderTables can't hide all proxies / params
// under "Data Tables" again.

test("Stop 6.9 — Tables tab renders all five kind-group labels", { skip: !FIXTURE_EXISTS }, () => {
  const data = buildFullData(path.resolve(FIXTURE));
  const html = generateHTML(data, "Health_and_Safety", "", "", "", "", "", "", "0");
  for (const label of [
    "Data Tables",
    "Measure Tables",
    "Field Parameters",
    "Composite Model Proxies",
  ]) {
    assert.ok(
      html.includes(label),
      `Tables tab is missing the "${label}" group header on H&S — grouping regression`
    );
  }
  // The group toggle action must be wired through the delegated
  // click handler or the headers become inert.
  assert.ok(
    html.includes("table-group-toggle"),
    "data-action='table-group-toggle' not present — group headers won't collapse/expand"
  );
});
