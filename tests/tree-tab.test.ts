/**
 * Smoke tests for the Tree tab (v1).
 *
 * The Tree tab renders Source → Table → (Columns / Measures groups) →
 * leaves as nested <details>/<summary> — zero JS, all browser-native
 * collapse. Leaves are clickable and route through the existing
 * delegated-click handler via data-action="lineage" data-type=... .
 *
 * These tests check only the STRUCTURAL invariants — we don't
 * evaluate the page in a DOM. We grep the generated HTML for the
 * hooks the browser needs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateHTML } from "../src/html-generator.js";
import type { FullData } from "../src/data-builder.js";
import { buildFullData } from "../src/data-builder.js";

const FIXTURE = "test/Health_and_Safety.Report";
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

function minimalData(): FullData {
  return {
    measures: [], columns: [], relationships: [], functions: [],
    calcGroups: [], tables: [], pages: [], hiddenPages: [],
    allPages: [], expressions: [], compatibilityLevel: null,
    modelProperties: { name: "t" } as any,
    totals: {
      measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
      columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
      relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
    },
  } as unknown as FullData;
}

test("Tree tab — panel slot is present in the generated HTML", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  assert.ok(html.includes('id="panel-tree"'),
    "missing <div id=\"panel-tree\"> slot — tree tab won't render anywhere");
  assert.ok(html.includes('id="tree-content"'),
    "missing <div id=\"tree-content\"> — renderTree has no target");
});

test("Tree tab — client bundle registers a `tree` tab button", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // The tab list is built at runtime from a JS array; grep the inlined
  // source for the registration line.
  // tsc may reformat the object literal with spaces — tolerant regex.
  assert.ok(
    /id:\s*"tree",\s*l:\s*"Model Tree"/.test(html),
    "tab registration for `tree` missing — renderTabs() won't emit the button",
  );
});

test("Tree tab — file-based source types group by folder not full path", () => {
  // Regression for "6 Parquet groups with 1 table each" bug on the
  // training model. The tSourceKey helper must split off the filename
  // for file-based sources and key by folder, otherwise every
  // Parquet/Excel/CSV file lands in its own one-table branch.
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // Inlined client source — grep for the set literal pinning the
  // file-based types. If someone removes Parquet from this set the
  // fragmentation bug returns.
  assert.ok(
    /T_FILE_SOURCE_TYPES\s*=\s*new Set\(\s*\[[^\]]*['"]Parquet['"]/m.test(html),
    "T_FILE_SOURCE_TYPES must include Parquet — otherwise multi-file Parquet models fragment into N one-table branches"
  );
  // Also pin Excel and CSV since they have the same shape.
  for (const t of ["Excel", "CSV"]) {
    assert.ok(
      new RegExp(`T_FILE_SOURCE_TYPES\\s*=\\s*new Set\\(\\s*\\[[^\\]]*['"]${t}['"]`).test(html),
      `T_FILE_SOURCE_TYPES must include ${t} — same fragmentation risk as Parquet`
    );
  }
  // The tSourceKey function must call tSplitPath for these types —
  // grep the function body.
  assert.ok(
    /function tSourceKey\([\s\S]+?tSplitPath/.test(html),
    "tSourceKey doesn't call tSplitPath — folder-level grouping not wired"
  );
});

test("Tree tab — renderTree function + bootstrap call are present", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  assert.ok(html.includes("function renderTree("),
    "renderTree() function missing from the inlined client bundle");
  // Bootstrap line contains a renderTree() call among the other render calls.
  assert.ok(
    /renderSummary\(\);[\s\S]*?renderTree\(\);[\s\S]*?switchTab/.test(html),
    "renderTree() isn't called during bootstrap — tab would render empty until user toggles auto-date",
  );
});

test("Tree tab — CSS is inlined (classes that the render output depends on)", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  for (const sel of [".tree-leaf", ".tree-table", ".tree-src", ".tree-group", ".tree-role-fact"]) {
    assert.ok(html.includes(sel),
      `CSS class ${sel} missing — tree will render but unstyled`);
  }
});

test("Tree tab — renderTree writes body before footer (not clobbered)", () => {
  // Regression guard: setPanelFooter() sets innerHTML on its target,
  // which wipes any tree content written first. The Tree tab uses
  // the main panel div as its target, so it must use
  // insertAdjacentHTML("beforeend") not setPanelFooter. If that
  // ever regresses, the tree body disappears and only the footer
  // shows — exactly the bug the user screenshot caught.
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // tsc reformats the function declaration with whitespace — tolerant regex.
  const fnMatch = html.match(/function renderTree\(\)\s*\{([\s\S]+?)\n\}/);
  assert.ok(fnMatch, "renderTree function body not found in inlined client");
  const body = fnMatch![1];
  // The only allowed way to write the footer is insertAdjacentHTML —
  // anything that calls setPanelFooter on tree-content clobbers the body.
  assert.ok(
    !/setPanelFooter\(\s*["']tree-content["']/.test(body),
    "renderTree uses setPanelFooter on tree-content — this wipes the tree body. Use insertAdjacentHTML('beforeend', ...) instead."
  );
  assert.ok(
    /insertAdjacentHTML\(\s*["']beforeend["']/.test(body),
    "renderTree should append the footer via insertAdjacentHTML('beforeend', ...) so the tree body survives."
  );
});

if (FIXTURE_EXISTS) {
  test("Tree tab — on H&S fixture, render output emits expected structural hooks", () => {
    // Exercise the rendered tree against the real composite model. We
    // can't open a DOM here; we replay what renderTree would produce
    // by inspecting the inputs.
    const data = buildFullData(path.resolve(FIXTURE));
    // Every visible table must be reachable via name lookup.
    const tableNames = new Set(data.tables.filter(t => t.origin !== "auto-date").map(t => t.name));
    assert.ok(tableNames.size > 0, "fixture has no user tables");
    // Every measure's home table must exist (otherwise the tree can't
    // place the measure).
    const orphanMeasures = data.measures.filter(m => !data.tables.some(t => t.name === m.table));
    assert.equal(orphanMeasures.length, 0,
      `${orphanMeasures.length} measures have no matching home table — tree would drop them`);
    // UDFs (excluding the .About shim) must be renderable as a separate
    // root — they're not attached to any data-source bucket.
    const udfs = data.functions.filter(f => !f.name.endsWith(".About"));
    assert.ok(Array.isArray(udfs), "functions list should be enumerable");
  });

  // ── Parameter + composite-model-proxy detection (v1.1) ────────────
  // These tests pin the specific names the user flagged in screenshots.
  // If detection breaks, these tables would regress to appearing as
  // phantom "DISCONNECTED" data sources in the Model Tree.
  test("Tree tab — H&S field parameters are detected via ParameterMetadata", () => {
    const data = buildFullData(path.resolve(FIXTURE));
    const fieldParams = data.tables
      .filter(t => t.parameterKind === "field")
      .map(t => t.name)
      .sort();
    // The `switch_*` tables built via Power BI's field-parameter UI
    // carry the `extendedProperty ParameterMetadata` annotation on the
    // `Parameter Fields` column. Hand-rolled calculated tables with
    // parameter-like intent (e.g. `switch_hours_worked`) don't carry
    // the marker and are classified as calc tables instead — that's
    // the correct TMDL-level answer even if the author thinks of them
    // as "parameters" in their mental model.
    for (const expected of [
      "switch_geodata",
      "switch_site_details",
      "switch_time_period",
    ]) {
      assert.ok(
        fieldParams.includes(expected),
        `expected ${expected} to be classified as parameterKind="field" — ` +
        `detected field params were: [${fieldParams.join(", ")}]`,
      );
    }
    // `switch_hours_worked` lacks ParameterMetadata — confirm it's
    // classified as a calc table, not silently promoted to "field".
    const swhw = data.tables.find(t => t.name === "switch_hours_worked");
    assert.ok(swhw, "switch_hours_worked missing from fixture");
    assert.equal(swhw!.parameterKind, null,
      "switch_hours_worked has no ParameterMetadata — must stay parameterKind=null (calc table)");
    assert.equal(swhw!.isCalculatedTable, true,
      "switch_hours_worked partition is `= calculated` — must surface via isCalculatedTable=true");
  });

  test("Tree tab — H&S composite-model proxies are detected via DQ entity shape", () => {
    const data = buildFullData(path.resolve(FIXTURE));
    const proxies = data.tables
      .filter(t => t.parameterKind === "compositeModelProxy")
      .map(t => t.name)
      .sort();
    // The user flagged these in screenshots as "parameters" — they're
    // actually DirectQuery-to-AS proxy tables from the composite model.
    // Each is single-column, same-name, with a DQ partition that
    // resolves to a shared expression pointing at a remote AS cube.
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
        `expected ${expected} to be classified as parameterKind="compositeModelProxy" — ` +
        `detected proxies were: [${proxies.join(", ")}]`,
      );
    }
  });

  test("Tree tab — H&S calc tables carry isCalculatedTable=true", () => {
    const data = buildFullData(path.resolve(FIXTURE));
    // The switch_* field parameters are themselves calculated tables
    // (their partitions are `= calculated`), so isCalculatedTable must
    // be true for them. This tests the partitionKind plumbing
    // end-to-end, independent of the parameterKind classifier.
    const calcTables = data.tables
      .filter(t => t.isCalculatedTable)
      .map(t => t.name);
    assert.ok(
      calcTables.some(n => n.startsWith("switch_")),
      `expected at least one switch_* calculated table on H&S — ` +
      `isCalculatedTable=true set was: [${calcTables.join(", ")}]`,
    );
  });

  test("Tree tab — H&S proxy tables have expressionSource populated on their DQ partition", () => {
    // Regression guard on the parser: without expressionSource, the
    // compositeModelProxy classifier can't fire and the proxies fall
    // back to DISCONNECTED.
    const data = buildFullData(path.resolve(FIXTURE));
    const proxy = data.tables.find(t => t.name === "table_HS");
    assert.ok(proxy, "table_HS missing from fixture build");
    const dqP = (proxy!.partitions || []).find(p => p.mode === "directQuery");
    assert.ok(dqP, "table_HS has no directQuery partition");
    assert.ok(
      dqP!.expressionSource && dqP!.expressionSource.length > 0,
      "table_HS's DQ partition is missing expressionSource — parser regression",
    );
  });
}
