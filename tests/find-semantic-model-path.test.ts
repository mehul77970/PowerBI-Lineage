/**
 * Regression tests for findSemanticModelPath() — the function that
 * locates a Power BI SemanticModel folder given its sibling Report.
 *
 * Real-world bug: composite-model reports like `training.Report` pair
 * with a same-named SemanticModel via a relative path declared in
 * `definition.pbir`:
 *
 *   { "datasetReference": { "byPath": { "path": "../training.SemanticModel" } } }
 *
 * Two subtle failure modes were possible before the fix:
 *
 *   1. Path-resolution direction: `path.resolve(projectDir, rel)`
 *      resolved "../Foo.SemanticModel" against the parent of
 *      `.Report`, producing a non-existent location. Correct is to
 *      resolve against the `.Report` folder itself.
 *
 *   2. Ambiguous sibling scan: when both `Foo.SemanticModel` and
 *      `Foo_Gold.SemanticModel` sit side-by-side, the old code took
 *      whichever came first alphabetically regardless of which
 *      Report was opened.
 *
 * Each test builds a throw-away directory tree under `os.tmpdir()`
 * so there's no pollution of the real fixture set.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findSemanticModelPath } from "../src/model-parser.js";

function mkTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pbip-${label}-`));
  return dir;
}

function makeReport(projectDir: string, reportName: string, pbirContent: object | null, smName: string | null): string {
  const reportDir = path.join(projectDir, reportName);
  fs.mkdirSync(reportDir, { recursive: true });
  if (pbirContent !== null) {
    fs.writeFileSync(path.join(reportDir, "definition.pbir"), JSON.stringify(pbirContent, null, 2), "utf8");
  }
  if (smName) {
    fs.mkdirSync(path.join(projectDir, smName), { recursive: true });
    // Empty definition folder so it looks like a real SemanticModel
    fs.mkdirSync(path.join(projectDir, smName, "definition"), { recursive: true });
  }
  return reportDir;
}

test("pbir with relative '../' path resolves against the Report folder", () => {
  // Layout:
  //   <tmp>/
  //     training.Report/
  //       definition.pbir → "../training.SemanticModel"
  //     training.SemanticModel/
  const tmp = mkTempDir("rel-up");
  const report = makeReport(tmp, "training.Report", {
    version: "1.0",
    datasetReference: { byPath: { path: "../training.SemanticModel" } },
  }, "training.SemanticModel");
  const found = findSemanticModelPath(report);
  assert.equal(
    path.resolve(found),
    path.resolve(tmp, "training.SemanticModel"),
    "should resolve '../training.SemanticModel' against the Report folder",
  );
});

test("pbir with top-level 'path' field (no datasetReference wrapper) still works", () => {
  // Simulates older / tooling-rolled pbir files that didn't nest.
  const tmp = mkTempDir("flat-path");
  const report = makeReport(tmp, "flat.Report", {
    path: "../flat.SemanticModel",
  }, "flat.SemanticModel");
  const found = findSemanticModelPath(report);
  assert.equal(path.resolve(found), path.resolve(tmp, "flat.SemanticModel"));
});

test("pbir with byPath.path (missing outer datasetReference) also works", () => {
  const tmp = mkTempDir("byPath-flat");
  const report = makeReport(tmp, "bp.Report", {
    byPath: { path: "../bp.SemanticModel" },
  }, "bp.SemanticModel");
  const found = findSemanticModelPath(report);
  assert.equal(path.resolve(found), path.resolve(tmp, "bp.SemanticModel"));
});

test("sibling scan prefers an exact prefix match over alphabetical first", () => {
  // The bug the user hit on their machine. Both models live together
  // in the same parent dir; opening `training.Report` must find
  // `training.SemanticModel`, NOT `training_Gold.SemanticModel` even
  // though the Gold one might sort differently.
  const tmp = mkTempDir("exact-prefix");
  // Both SMs exist
  fs.mkdirSync(path.join(tmp, "training.SemanticModel", "definition"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "training_Gold.SemanticModel", "definition"), { recursive: true });
  // Report has NO pbir, forcing sibling scan
  const report = makeReport(tmp, "training.Report", null, null);
  const found = findSemanticModelPath(report);
  assert.equal(
    path.resolve(found),
    path.resolve(tmp, "training.SemanticModel"),
    "prefix match should beat alphabetical order",
  );

  // The reverse: opening the Gold report must find Gold.
  const goldReport = makeReport(tmp, "training_Gold.Report", null, null);
  const foundGold = findSemanticModelPath(goldReport);
  assert.equal(
    path.resolve(foundGold),
    path.resolve(tmp, "training_Gold.SemanticModel"),
    "Gold report should pair with Gold SemanticModel",
  );
});

test("unreadable / broken pbir falls back to sibling scan without throwing", () => {
  const tmp = mkTempDir("broken-pbir");
  const report = makeReport(tmp, "broken.Report", null, "broken.SemanticModel");
  // Write garbage to the pbir so JSON.parse throws
  fs.writeFileSync(path.join(report, "definition.pbir"), "{ not valid json", "utf8");
  const found = findSemanticModelPath(report);
  assert.equal(path.resolve(found), path.resolve(tmp, "broken.SemanticModel"));
});

test("pbir path that points nowhere still falls back to sibling scan", () => {
  // Regression: pbir declares a path that doesn't exist (maybe tooling
  // moved the SM folder after the pbir was written). Should fall
  // through to sibling scan rather than throwing.
  const tmp = mkTempDir("pbir-stale");
  const report = makeReport(tmp, "stale.Report", {
    datasetReference: { byPath: { path: "../missing.SemanticModel" } },
  }, "stale.SemanticModel");
  const found = findSemanticModelPath(report);
  assert.equal(path.resolve(found), path.resolve(tmp, "stale.SemanticModel"));
});

test("no SemanticModel anywhere produces a clear error (not a silent wrong folder)", () => {
  const tmp = mkTempDir("no-sm");
  const report = makeReport(tmp, "only.Report", null, null);
  assert.throws(
    () => findSemanticModelPath(report),
    /No \.SemanticModel folder found/,
  );
});
