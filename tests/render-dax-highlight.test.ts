/**
 * Smoke test for the vendored dax-highlight integration.
 *
 * These tests don't assert *how* highlighting looks — that's the
 * library's responsibility — they just verify that the wiring in
 * html-generator.ts loads the vendor files, injects them into the
 * generated HTML, and exposes the expected client API. If the
 * vendor source is ever renamed, relocated, or its public surface
 * changes, these tests fail loudly instead of silently breaking
 * the Lineage / Functions / Calc Groups tabs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { generateHTML } from "../src/html-generator.js";
import type { FullData } from "../src/data-builder.js";

function minimalData(): FullData {
  return {
    measures: [], columns: [], relationships: [], functions: [],
    calcGroups: [], tables: [], pages: [], hiddenPages: [],
    allPages: [], expressions: [], compatibilityLevel: null,
    modelProperties: { name: "Test" } as any,
    totals: {
      measuresInModel: 0, measuresDirect: 0, measuresIndirect: 0, measuresUnused: 0,
      columnsInModel: 0, columnsDirect: 0, columnsIndirect: 0, columnsUnused: 0,
      relationships: 0, functions: 0, calcGroups: 0, tables: 0, pages: 0, visuals: 0,
    },
  } as unknown as FullData;
}

test("DAX highlighter — vendor JS is inlined into the generated HTML", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // The UMD wrapper of dax-highlight.js starts with this exact
  // function signature. If we ever re-vendor and the signature
  // changes, this test fails and we update it intentionally.
  assert.ok(
    html.includes("function (root, factory)"),
    "dax-highlight UMD wrapper not found in generated HTML"
  );
  // And it exposes window.DaxHighlight.
  assert.ok(
    html.includes("root.DaxHighlight = api"),
    "DaxHighlight global exposure not found in generated HTML"
  );
});

test("DAX highlighter — vendor CSS tokens are inlined", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // Sample a handful of token classes to confirm the CSS came in.
  for (const token of [".code-dax", ".dax-k", ".dax-f", ".dax-m", ".dax-r", ".dax-s", ".dax-n", ".dax-c"]) {
    assert.ok(html.includes(token), "expected CSS token class not present: " + token);
  }
});

test("DAX highlighter — theme bridge maps --dax-* onto our --clr-* palette", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // The theme-bridge block in html-generator.ts wires the highlighter's
  // token colours to the dashboard's semantic design tokens, so both
  // our dark and light themes follow the rest of the UI.
  assert.ok(
    /--dax-keyword:\s*var\(--clr-upstream\)/.test(html),
    "theme bridge missing — DAX keyword colour not wired to --clr-upstream"
  );
  assert.ok(
    /--dax-function:\s*var\(--clr-function\)/.test(html),
    "theme bridge missing — DAX function colour not wired to --clr-function"
  );
});

test("DAX highlighter — vendor integrity hash matches the shipped file", () => {
  // Re-compute the hash of the vendor file and assert it matches what
  // VENDOR_SHA256 in html-generator.ts claims. generateHTML's module
  // load ALREADY verified this at import time (if it were wrong,
  // every test in this file would fail); we re-check here so the
  // known-good hash is pinned in a second place and desync between
  // the two manifests is caught during review.
  const p = path.resolve(process.cwd(), "vendor/dax-highlight/dax-highlight.js");
  assert.ok(fs.existsSync(p), "vendor dax-highlight.js not at expected path: " + p);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  assert.equal(
    actual,
    "07bb1b1e6fa859def53e69d6410841cc758fcb7aa0c168cc2abdf5341a5fa58c",
    "vendor dax-highlight.js hash drift — update VENDOR_SHA256 in src/html-generator.ts",
  );
});

test("DAX highlighter — named variables and measure refs use DISTINCT tokens", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // VAR _rows = … RETURN _rows should render in a different colour
  // from [Measure Name]. Collapsing them back onto the same --clr-*
  // slot makes DAX harder to read. The design system has a dedicated
  // --clr-variable token (orange) specifically for this.
  assert.ok(
    /--dax-variable:\s*var\(--clr-variable\)/.test(html),
    "--dax-variable is not wired to --clr-variable"
  );
  assert.ok(
    /--dax-measure:\s*var\(--clr-measure\)/.test(html),
    "--dax-measure is not wired to --clr-measure"
  );
  // And the underlying --clr-* tokens must themselves be different.
  const varMatch = html.match(/--clr-variable:\s*(#[0-9A-Fa-f]+)/);
  const measureMatch = html.match(/--clr-measure:\s*(#[0-9A-Fa-f]+)/);
  assert.ok(varMatch, "--clr-variable not declared");
  assert.ok(measureMatch, "--clr-measure not declared");
  assert.notEqual(
    varMatch![1].toLowerCase(),
    measureMatch![1].toLowerCase(),
    "--clr-variable and --clr-measure resolved to the same colour"
  );
});

test("DAX highlighter — client wiring calls highlightDaxBlocks at the right moments", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // addCopyButtons() should delegate to highlightDaxBlocks so the
  // order is: render -> highlight -> copy-button. If this ever gets
  // reordered, copy buttons get wiped by the innerHTML replacement.
  assert.ok(
    html.includes("function highlightDaxBlocks()"),
    "highlightDaxBlocks client helper missing"
  );
  assert.ok(
    /function addCopyButtons\(\)\s*\{[\s\S]{0,200}highlightDaxBlocks\(\)/m.test(html),
    "addCopyButtons does not call highlightDaxBlocks first"
  );
  // renderDocs should highlight after mdRender to pick up ```dax fences.
  assert.ok(
    /rendered\.innerHTML\s*=[\s\S]*?highlightDaxBlocks\(\);/m.test(html),
    "renderDocs does not highlight after markdown render"
  );
});
