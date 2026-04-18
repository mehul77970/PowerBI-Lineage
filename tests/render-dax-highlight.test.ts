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

test("DAX highlighter — uses Power BI Desktop's native palette on both themes", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // Dark theme (default .code-dax block) uses VS-Code-ish colours
  // tuned for AA contrast on our #0B0D11 canvas; light theme
  // ([data-theme="light"] .code-dax) mirrors Power BI Desktop's
  // exact DAX formula-bar palette (blue keywords, red functions,
  // green numbers). Both blocks must be present.
  assert.ok(
    /\.code-dax\s*\{[^}]*--dax-keyword:\s*#569CD6/.test(html),
    "dark-theme DAX keyword (blue) missing — theme bridge regressed"
  );
  assert.ok(
    /\[data-theme="light"\]\s+\.code-dax\s*\{[^}]*--dax-keyword:\s*#035AC2/.test(html),
    "light-theme DAX keyword (PB Desktop blue #035AC2) missing"
  );
  assert.ok(
    /\[data-theme="light"\]\s+\.code-dax\s*\{[^}]*--dax-function:\s*#C41E3A/.test(html),
    "light-theme DAX function (PB Desktop crimson #C41E3A) missing"
  );
  assert.ok(
    /\[data-theme="light"\]\s+\.code-dax\s*\{[^}]*--dax-number:\s*#098658/.test(html),
    "light-theme DAX number (PB Desktop green #098658) missing"
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
  // Hash LF-normalised content — stable across Windows (CRLF) and Linux (LF) checkouts.
  const text = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const actual = crypto.createHash("sha256").update(text).digest("hex");
  assert.equal(
    actual,
    "841edee157392b89c7465592916627025d06bb94646bc98f27f7371bc8e37c54",
    "vendor dax-highlight.js hash drift — update VENDOR_SHA256 in src/html-generator.ts",
  );
});

test("DAX highlighter — named variables and measure refs use DISTINCT tokens", () => {
  const html = generateHTML(minimalData(), "t", "", "", "", "", "", "", "0");
  // VAR _rows = … RETURN _rows should render in a different colour
  // from [Measure Name]. Variable stays on our semantic orange
  // (--clr-variable) so it reads as "local data", while measure
  // picks up the PB Desktop blue. The two MUST resolve differently
  // on each theme — otherwise long VAR/RETURN blocks blur together.
  //
  // Extract the dark-theme and light-theme palettes separately and
  // assert variable vs. measure are distinct on both.
  function extract(block: RegExp, token: string): string | null {
    const blockMatch = html.match(block);
    if (!blockMatch) return null;
    const valueMatch = blockMatch[0].match(new RegExp(`--dax-${token}:\\s*([^;]+);`));
    return valueMatch ? valueMatch[1].trim().toLowerCase() : null;
  }
  const DARK = /\.code-dax\s*\{[^}]+\}/;
  const LIGHT = /\[data-theme="light"\]\s+\.code-dax\s*\{[^}]+\}/;
  const darkVar = extract(DARK, "variable");
  const darkMeasure = extract(DARK, "measure");
  const lightVar = extract(LIGHT, "variable");
  const lightMeasure = extract(LIGHT, "measure");
  assert.ok(darkVar, "dark-theme --dax-variable not declared");
  assert.ok(darkMeasure, "dark-theme --dax-measure not declared");
  assert.ok(lightVar, "light-theme --dax-variable not declared");
  assert.ok(lightMeasure, "light-theme --dax-measure not declared");
  assert.notEqual(darkVar, darkMeasure,
    `dark-theme variable and measure resolved identically: ${darkVar}`);
  assert.notEqual(lightVar, lightMeasure,
    `light-theme variable and measure resolved identically: ${lightVar}`);
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
