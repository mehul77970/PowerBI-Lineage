/**
 * Tests for src/render/safe.ts — the four escape helpers.
 *
 * Zero test-framework deps: uses Node's built-in `node:test` module
 * (available since Node 18) and `node:assert`. Compile via
 * `tsconfig.test.json` → `dist-test/`, then run:
 *
 *   node --test dist-test/tests/safe.test.js
 *
 * The npm `test` script does both steps.
 *
 * Every helper is stress-tested with adversarial inputs that model
 * authors can realistically produce in Power BI — measure/column names
 * are only lightly constrained server-side.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { escHtml, escAttr, jsStr, safeJSON } from "../src/render/safe.js";

// ──────────────────────────────────────────────────────────────────────
// escHtml
// ──────────────────────────────────────────────────────────────────────

test("escHtml — null / undefined collapse to empty string", () => {
  assert.equal(escHtml(null), "");
  assert.equal(escHtml(undefined), "");
});

test("escHtml — non-string values coerce via String()", () => {
  assert.equal(escHtml(42), "42");
  assert.equal(escHtml(true), "true");
  assert.equal(escHtml(0), "0");
});

test("escHtml — escapes the five HTML-sensitive characters", () => {
  assert.equal(escHtml("&"), "&amp;");
  assert.equal(escHtml("<"), "&lt;");
  assert.equal(escHtml(">"), "&gt;");
  assert.equal(escHtml("\""), "&quot;");
  assert.equal(escHtml("'"), "&#39;");
});

test("escHtml — escapes in the correct order so & doesn't double-escape", () => {
  // If we replaced < before & we'd produce &amp;lt; from <; the spec
  // order is &-first. Invariant: round-trip through escHtml once gives
  // the same result as unescaping it — no entity-in-entity.
  assert.equal(escHtml("<&>"), "&lt;&amp;&gt;");
  assert.equal(escHtml("&amp;"), "&amp;amp;");
});

test("escHtml — neutralises </script> for HTML-text contexts", () => {
  assert.equal(escHtml("foo</script>bar"), "foo&lt;/script&gt;bar");
});

test("escHtml — adversarial: measure name with quotes + angle brackets", () => {
  const name = `foo'),alert(1),('bar<img src=x>`;
  const escaped = escHtml(name);
  assert.ok(!escaped.includes("'"), "single quote must not survive");
  assert.ok(!escaped.includes("<"), "angle bracket must not survive");
  assert.ok(!escaped.includes(">"), "close bracket must not survive");
});

// ──────────────────────────────────────────────────────────────────────
// escAttr
// ──────────────────────────────────────────────────────────────────────

test("escAttr — delegates to escHtml (same rules)", () => {
  // They must behave identically today; if they diverge later, update
  // this test to match the new divergence contract.
  const samples = ["", "plain", "<>&\"'", "foo</script>"];
  for (const s of samples) assert.equal(escAttr(s), escHtml(s));
});

// ──────────────────────────────────────────────────────────────────────
// jsStr
// ──────────────────────────────────────────────────────────────────────

test("jsStr — null / undefined collapse to empty string", () => {
  assert.equal(jsStr(null), "");
  assert.equal(jsStr(undefined), "");
});

test("jsStr — plain string round-trips", () => {
  // The output is meant to be spliced between quotes. Reconstructing
  // the original happens via `eval("'" + jsStr(x) + "'")` semantics —
  // or in a Function body. We avoid eval in tests and check key
  // escapes directly.
  const out = jsStr("hello world");
  assert.equal(out, "hello world");
});

test("jsStr — escapes single quotes (so `'` inside `'...'` is safe)", () => {
  const out = jsStr("it's");
  assert.ok(!/(^|[^\\])'/.test(out), "unescaped single quote present: " + out);
  // Reconstruct: wrap in single quotes and eval via Function
  const roundTrip = Function("return '" + out + "'")();
  assert.equal(roundTrip, "it's");
});

test("jsStr — escapes double quotes (so `\"` inside `\"...\"` is safe)", () => {
  const out = jsStr('say "hi"');
  const roundTrip = Function('return "' + out + '"')();
  assert.equal(roundTrip, 'say "hi"');
});

test("jsStr — escapes backslash correctly", () => {
  const out = jsStr("a\\b");
  const roundTrip = Function("return '" + out + "'")();
  assert.equal(roundTrip, "a\\b");
});

test("jsStr — escapes < and > so </script> can't break out of a <script>", () => {
  const out = jsStr("foo</script>bar");
  assert.ok(!out.includes("<"), "raw < survived: " + out);
  assert.ok(!out.includes(">"), "raw > survived: " + out);
  // Must still be a valid JS string literal
  const roundTrip = Function("return '" + out + "'")();
  assert.equal(roundTrip, "foo</script>bar");
});

test("jsStr — adversarial: quote-breakout payload reconstructs identically", () => {
  // This is the exact shape of a malicious measure name a model author
  // could set. The rendered onclick must still evaluate safely.
  const name = `foo'),alert(1),('bar`;
  const out = jsStr(name);
  // Inline into a JS string literal and reconstruct — must equal the
  // original, not interpret the payload.
  const reconstruction = Function("return '" + out + "'")();
  assert.equal(reconstruction, name);
});

test("jsStr — escapes line terminators U+2028 / U+2029", () => {
  // JSON.stringify leaves these raw, but the JS parser treats them as
  // line terminators inside string literals — which breaks the string.
  // Our jsStr must neutralise them via \u escape.
  const name = "line1\u2028line2\u2029end";
  const out = jsStr(name);
  assert.ok(!out.includes("\u2028"), "raw U+2028 survived");
  assert.ok(!out.includes("\u2029"), "raw U+2029 survived");
  const roundTrip = Function("return '" + out + "'")();
  assert.equal(roundTrip, name);
});

// ──────────────────────────────────────────────────────────────────────
// safeJSON
// ──────────────────────────────────────────────────────────────────────

test("safeJSON — round-trips via JSON.parse", () => {
  const v = { a: 1, b: "two", c: [true, null, 3.14] };
  const out = safeJSON(v);
  assert.deepEqual(JSON.parse(out), v);
});

test("safeJSON — escapes < so </script> cannot close an outer <script>", () => {
  const v = { description: "foo</script><script>alert(1)</script>bar" };
  const out = safeJSON(v);
  // Invariant: the raw string `</script>` must not appear in the output.
  assert.ok(!out.includes("</script>"), "raw </script> survived: " + out);
  // Must still parse back to the original object.
  assert.deepEqual(JSON.parse(out), v);
});

test("safeJSON — escapes --> so it can't close an outer HTML comment", () => {
  const v = { description: "start<!--inner-->end" };
  const out = safeJSON(v);
  assert.ok(!out.includes("-->"), "raw --> survived: " + out);
  assert.deepEqual(JSON.parse(out), v);
});

test("safeJSON — escapes U+2028 / U+2029 (JS line terminators)", () => {
  const v = { text: "line1\u2028line2\u2029end" };
  const out = safeJSON(v);
  assert.ok(!out.includes("\u2028"), "raw U+2028 survived");
  assert.ok(!out.includes("\u2029"), "raw U+2029 survived");
  assert.deepEqual(JSON.parse(out), v);
});

test("safeJSON — survives being embedded and re-evaluated via eval / Function", () => {
  // Simulates the real <script>const DATA = <here>;</script> path.
  const v = {
    measures: [
      { name: "Bad</script>", description: "trailing\u2028line" },
      { name: "foo'),alert(1),('bar", formatString: "" },
    ],
  };
  const out = safeJSON(v);
  const reconstructed = Function("return " + out + ";")();
  assert.deepEqual(reconstructed, v);
});

test("safeJSON — handles deeply nested + unicode without mangling payload", () => {
  const v = {
    a: { b: { c: [{ d: "emoji 🎉 and <tag> and \"quotes\" and \\ slashes" }] } },
  };
  const out = safeJSON(v);
  assert.deepEqual(JSON.parse(out), v);
});

// ──────────────────────────────────────────────────────────────────────
// Cross-helper invariants
// ──────────────────────────────────────────────────────────────────────

test("cross-helper — none of the four helpers produce raw </script> for adversarial input", () => {
  const payload = "foo</script><script>alert(1)</script>bar";
  for (const [name, fn] of [
    ["escHtml", escHtml],
    ["escAttr", escAttr],
    ["jsStr", jsStr],
    ["safeJSON", (v: unknown) => safeJSON(v)],
  ] as const) {
    const out = fn(payload);
    assert.ok(
      !out.includes("</script>"),
      `${name} leaked raw </script>: ${out}`
    );
  }
});
