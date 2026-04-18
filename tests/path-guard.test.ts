/**
 * Tests for src/path-guard.ts — validateReportPath.
 *
 * Covers the hardening rules applied to user-supplied paths on the
 * /generate endpoint: non-string inputs, empty/whitespace, NUL bytes,
 * UNC paths (Windows \\server\share and POSIX //server/share forms),
 * and non-existent paths.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { validateReportPath } from "../src/path-guard.js";

// ──────────────────────────────────────────────────────────────────────
// Input shape / basic reject
// ──────────────────────────────────────────────────────────────────────

test("validateReportPath — non-string returns ok:false", () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    const r = validateReportPath(bad);
    assert.equal(r.ok, false);
  }
});

test("validateReportPath — empty string returns ok:false", () => {
  const r = validateReportPath("");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /enter a report path/i);
});

test("validateReportPath — whitespace-only returns ok:false", () => {
  const r = validateReportPath("   \t  ");
  assert.equal(r.ok, false);
});

// ──────────────────────────────────────────────────────────────────────
// NUL byte
// ──────────────────────────────────────────────────────────────────────

test("validateReportPath — NUL byte rejected", () => {
  const r = validateReportPath("C:\\foo\0\\bar.Report");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /NUL byte/);
});

// ──────────────────────────────────────────────────────────────────────
// UNC / network paths
// ──────────────────────────────────────────────────────────────────────

test("validateReportPath — Windows UNC path rejected", () => {
  const r = validateReportPath("\\\\fileserver\\share\\Sales.Report");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /UNC|network/i);
});

test("validateReportPath — POSIX //server/share form rejected", () => {
  const r = validateReportPath("//fileserver/share/Sales.Report");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /UNC|network/i);
});

// ──────────────────────────────────────────────────────────────────────
// Existence
// ──────────────────────────────────────────────────────────────────────

test("validateReportPath — non-existent path rejected", () => {
  const bogus = path.join(os.tmpdir(), "definitely-does-not-exist-" + Date.now());
  const r = validateReportPath(bogus);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not found/i);
});

// ──────────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────────

test("validateReportPath — existing directory returns ok:true with resolved path", () => {
  // Create a temp directory, validate it, clean up.
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "powerbi-lineage-test-"));
  try {
    const r = validateReportPath(tmpBase);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resolved, path.resolve(tmpBase));
    }
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test("validateReportPath — resolves relative paths to absolute", () => {
  // cwd should exist; validate "." and assert it resolves to an absolute
  // path that matches process.cwd().
  const r = validateReportPath(".");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.resolved, path.resolve("."));
    assert.ok(path.isAbsolute(r.resolved));
  }
});

test("validateReportPath — trims surrounding whitespace", () => {
  const r = validateReportPath("   .   ");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.resolved, path.resolve("."));
  }
});
