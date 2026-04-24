/**
 * Value.NativeQuery extraction — surfacing hand-written SQL from M.
 *
 * pbip-documenter has this; we didn't. The parser must handle:
 *
 *   1. Simple `Value.NativeQuery(Source, "SELECT …")` calls
 *   2. M-style `""` escaped quotes inside the SQL
 *   3. Multi-line SQL bodies
 *   4. Nested function calls in the connection argument (so the
 *      paren-depth tracker doesn't short-circuit)
 *   5. Fallback form `Sql.Database(..., [Query="SELECT …"])`
 *   6. No native query → empty string (not null, not undefined)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractNativeQuery } from "../src/model-parser.js";

test("extractNativeQuery — simple single-line SELECT", () => {
  const m = `let Source = Sql.Database("server","db"),
    Q = Value.NativeQuery(Source, "SELECT * FROM Sales WHERE Year = 2024", null, [EnableFolding=true])
in Q`;
  assert.equal(extractNativeQuery(m), "SELECT * FROM Sales WHERE Year = 2024");
});

test("extractNativeQuery — embedded escaped double-quotes ('' → ')", () => {
  const m = `let Q = Value.NativeQuery(S, "SELECT ""col with space"" FROM t")
in Q`;
  assert.equal(extractNativeQuery(m), 'SELECT "col with space" FROM t');
});

test("extractNativeQuery — multi-line SQL body", () => {
  const m = `Value.NativeQuery(Source, "SELECT
    id,
    name
FROM Users
WHERE active = 1", null)`;
  const sql = extractNativeQuery(m);
  assert.ok(sql.startsWith("SELECT"));
  assert.ok(sql.includes("FROM Users"));
  assert.ok(sql.includes("WHERE active = 1"));
});

test("extractNativeQuery — connection argument contains a function call with commas", () => {
  // The first argument is a compound expression with its own parens +
  // commas. The extractor must walk paren-depth to find the top-level
  // comma that separates the SQL string from the connection.
  const m = `Value.NativeQuery(Sql.Database("s", "d", [Timeout=#duration(0,0,30,0)]), "SELECT 1")`;
  assert.equal(extractNativeQuery(m), "SELECT 1");
});

test("extractNativeQuery — Sql.Database options-record fallback", () => {
  const m = `Source = Sql.Database("server", "db", [Query="SELECT col FROM t WHERE x = 1"])`;
  assert.equal(extractNativeQuery(m), "SELECT col FROM t WHERE x = 1");
});

test("extractNativeQuery — no native query returns empty string", () => {
  const m = `let Source = Sql.Database("s","d"), dbo_Sales = Source{[Schema="dbo",Item="Sales"]}[Data] in dbo_Sales`;
  assert.equal(extractNativeQuery(m), "");
});

test("extractNativeQuery — non-SQL Query=\"...\" attribute is ignored (must contain SELECT/WITH/EXEC)", () => {
  const m = `Csv.Document(Source, [Query="some.csv", Encoding=1252])`;
  assert.equal(extractNativeQuery(m), "");
});

test("extractNativeQuery — empty and whitespace-only input is safe", () => {
  assert.equal(extractNativeQuery(""), "");
  assert.equal(extractNativeQuery("   \n\t"), "");
});
