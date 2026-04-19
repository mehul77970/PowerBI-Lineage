/**
 * ERD tab smoke tests.
 *
 * The ERD is a UI-heavy feature (SVG rendering, force-directed layout,
 * drag/pan/zoom) that can't meaningfully be unit-tested without a DOM.
 * What we *can* test:
 *   - The tab is registered and the panel slot exists in the generated HTML
 *   - `renderErd` is defined and is called during bootstrap
 *   - ERD CSS classes the render output depends on are inlined
 *   - Click-action strings match the delegator's case labels
 *
 * These pin the wiring so a silent regression can't hide the ERD tab
 * from the build, even on a dev machine without a browser handy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHTML } from "../src/html-generator.js";
import type { FullData } from "../src/data-builder.js";

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

test("ERD tab — panel slot is present in the generated HTML", () => {
  const html = generateHTML(minimalData(), "t");
  assert.ok(html.includes('id="panel-erd"'),
    "missing <div id=\"panel-erd\"> slot — erd tab won't render anywhere");
  assert.ok(html.includes('id="erd-content"'),
    "missing <div id=\"erd-content\"> — renderErd has no target");
});

test("ERD tab — tab button is registered in the inline client bundle", () => {
  const html = generateHTML(minimalData(), "t");
  // tsc may rewrite whitespace inside the object literal; tolerant regex.
  assert.ok(
    /id:\s*"erd",\s*l:\s*"ERD"/.test(html),
    "tab registration for `erd` missing — renderTabs() won't emit the button",
  );
});

test("ERD tab — renderErd function + bootstrap call are present", () => {
  const html = generateHTML(minimalData(), "t");
  assert.ok(html.includes("function renderErd("),
    "renderErd() function missing from the inlined client bundle");
  // Bootstrap line calls renderErd between renderSources and renderFunctions.
  assert.ok(
    /renderSources\(\);\s*renderErd\(\);\s*renderFunctions\(\)/.test(html),
    "renderErd() not wired into the bootstrap chain — tab would render empty",
  );
});

test("ERD tab — delegated click actions are wired for toggle/reset/fit", () => {
  const html = generateHTML(minimalData(), "t");
  for (const action of ["erd-toggle", "erd-reset", "erd-fit"]) {
    assert.ok(
      new RegExp(`case\\s+['"]${action}['"]\\s*:`).test(html),
      `click-action '${action}' isn't handled in the delegator — the button would be inert`,
    );
  }
});

test("ERD tab — force-directed layout + node-role styling are inlined", () => {
  const html = generateHTML(minimalData(), "t");
  // Layout function
  assert.ok(html.includes("function erdLayout"),
    "erdLayout() force-directed routine missing from the bundle");
  // All role classes the legend + nodes reference
  for (const cls of [
    ".erd-role-fact", ".erd-role-dimension", ".erd-role-bridge",
    ".erd-role-disconnected", ".erd-role-calc-group",
    ".erd-role-parameter", ".erd-role-proxy", ".erd-role-auto-date",
  ]) {
    assert.ok(html.includes(cls),
      `CSS class ${cls} not inlined — legend + nodes would be un-styled`);
  }
  // Arrow-marker defs (cardinality direction)
  assert.ok(html.includes("erd-arrow-active") && html.includes("erd-arrow-inactive"),
    "SVG arrow markers missing — edges would lack direction glyphs");
});

test("ERD tab — pan/zoom/drag interaction wiring is present", () => {
  const html = generateHTML(minimalData(), "t");
  assert.ok(html.includes("function erdAttachInteractions"),
    "interaction-binding function missing");
  // Wheel listener (zoom)
  assert.ok(/addEventListener\(\s*['"]wheel['"]/.test(html),
    "wheel listener missing — zoom won't work");
  // Mousedown listener on the SVG (pan + drag)
  assert.ok(/svg\.addEventListener\(\s*['"]mousedown['"]/.test(html),
    "mousedown listener on SVG missing — pan/drag won't work");
});
