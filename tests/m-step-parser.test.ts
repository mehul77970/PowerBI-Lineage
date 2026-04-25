/**
 * M-step parser — classifies each step in a let…in body into one of
 * ten kinds so a data engineer can read a partition's ETL shape
 * without slogging through raw M.
 *
 * Covers: each kind individually, sequence walks, comment / string
 * resilience, quoted `#"..."` step names, nested let inside each
 * lambdas (must not be promoted), and non-let bodies (must return
 * empty array rather than crashing).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMSteps } from "../src/model-parser.js";

test("parseMSteps — empty / non-let body returns []", () => {
  assert.deepEqual(parseMSteps(""), []);
  assert.deepEqual(parseMSteps("   "), []);
  assert.deepEqual(parseMSteps("42"), []);
  assert.deepEqual(parseMSteps("Sql.Database(\"s\", \"d\")"), []);
});

test("parseMSteps — classifies a classic SQL-import pipeline", () => {
  const m = `let
    Source = Sql.Database("server", "db"),
    dbo_Sales = Source{[Schema="dbo",Item="Sales"]}[Data],
    #"Filtered Rows" = Table.SelectRows(dbo_Sales, each [Year] = 2024),
    #"Changed Type" = Table.TransformColumnTypes(#"Filtered Rows", {{"Amount", type number}}),
    #"Renamed Columns" = Table.RenameColumns(#"Changed Type", {{"Amount", "Net"}})
in
    #"Renamed Columns"`;
  const steps = parseMSteps(m);
  const kinds = steps.map(s => s.kind);
  assert.deepEqual(kinds, ["source", "navigation", "filter", "typeChange", "rename"]);
  assert.equal(steps[0].name, "Source");
  assert.equal(steps[0].primaryFn, "Sql.Database");
  assert.equal(steps[1].name, "dbo_Sales");
  assert.equal(steps[2].name, "Filtered Rows");
  assert.match(steps[2].summary, /Year/);
  assert.match(steps[3].summary, /1 column/);
});

test("parseMSteps — AddColumn / ExpandTable / Join / Projection", () => {
  const m = `let
    A = Foo,
    Joined = Table.NestedJoin(A, {"k"}, B, {"k"}, "B", JoinKind.Inner),
    Expanded = Table.ExpandTableColumn(Joined, "B", {"val"}, {"B.val"}),
    Projected = Table.SelectColumns(Expanded, {"k","val","B.val"}),
    WithFlag = Table.AddColumn(Projected, "Flag", each [val] > 0)
in WithFlag`;
  const kinds = parseMSteps(m).map(s => s.kind);
  assert.deepEqual(kinds, ["custom", "join", "expand", "projection", "addColumn"]);
});

test("parseMSteps — `each let … in …` lambdas do NOT start a new outer step", () => {
  // Inside a Table.AddColumn lambda, a nested `let … in` is at paren
  // depth > 0 so the outer splitter must ignore its commas AND must
  // not treat the inner `in` as the end of the outer let.
  const m = `let
    A = Foo,
    B = Table.AddColumn(A, "Bucket", each let v = [amount] in if v < 0 then "neg" else "pos")
in B`;
  const steps = parseMSteps(m);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].kind, "addColumn");
  assert.equal(steps[1].name, "B");
});

test("parseMSteps — string-literal commas don't split steps", () => {
  const m = `let
    Source = Sql.Database("server,with,commas", "db"),
    Navigated = Source{[Item="Sales"]}[Data]
in Navigated`;
  const steps = parseMSteps(m);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].kind, "source");
});

test("parseMSteps — line + block comments inside body are skipped", () => {
  const m = `let
    // prev: Source = Sql.Database("old","db"),
    Source = Sql.Database("s","d"), /* , fake = 1 */
    Navigated = Source{[Item="T"]}[Data]
in Navigated`;
  const steps = parseMSteps(m);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].name, "Source");
});

test("parseMSteps — quoted #\"Name with space\" step names are unquoted", () => {
  const m = `let
    #"Step One" = 1,
    #"Step Two" = #"Step One" + 1
in #"Step Two"`;
  const names = parseMSteps(m).map(s => s.name);
  assert.deepEqual(names, ["Step One", "Step Two"]);
});

test("parseMSteps — unknown / bespoke function falls through to custom", () => {
  const m = `let
    X = MyCompany.Custom.ScalarFn(42)
in X`;
  const steps = parseMSteps(m);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].kind, "custom");
  assert.equal(steps[0].primaryFn, "MyCompany.Custom.ScalarFn");
});

test("parseMSteps — navigation detected for `Source{[Item=...]}[Data]`", () => {
  const m = `let Src = Foo, T = Src{[Item="Sales"]}[Data] in T`;
  const steps = parseMSteps(m);
  assert.equal(steps[1].kind, "navigation");
  assert.equal(steps[1].summary, "Sales");
});

test("parseMSteps — Table.Combine and List.Combine classify as 'union', not 'join'", () => {
  // Composite-model entity partitions emit `Cubes = Table.Combine(...)`
  // — that's a UNION/concat operation, not a join. Misclassifying as
  // join was misleading every reader of those models.
  const m = `let A = Foo, Cubes = Table.Combine({A, B, C}) in Cubes`;
  const steps = parseMSteps(m);
  assert.equal(steps[1].kind, "union");
  assert.equal(steps[1].primaryFn, "Table.Combine");

  const m2 = `let xs = List.Combine({L1, L2}) in xs`;
  const s2 = parseMSteps(m2);
  assert.equal(s2[0].kind, "union");
});

test("parseMSteps — Table.FromRows / #table() literal constructors are sources with their own primaryFn", () => {
  // Power BI's "Enter Data" feature generates
  // `Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText(...))))`.
  // The outer constructor is what the user sees; we mustn't report the
  // inner `Json.Document` as primary just because the source-connector
  // regex happened to match it.
  const cases: Array<[string, string]> = [
    ['Table.FromRows(Json.Document(Binary.FromText("abc")))', "Table.FromRows"],
    ['Table.FromList({1,2,3}, Splitter.SplitByNothing())', "Table.FromList"],
    ['Table.FromRecords({[a=1]})', "Table.FromRecords"],
    ['#table({"col"}, {{"x"}, {"y"}})', "#table"],
  ];
  for (const [body, expectFn] of cases) {
    const m = `let S = ${body} in S`;
    const s = parseMSteps(m);
    assert.equal(s.length, 1);
    assert.equal(s[0].kind, "source");
    assert.equal(s[0].primaryFn, expectFn);
  }
});

test("parseMSteps — Csv.Document / Excel.Workbook / Web.Contents all classify as source", () => {
  for (const call of [
    'Csv.Document(File.Contents("data.csv"))',
    'Excel.Workbook(File.Contents("book.xlsx"))',
    'Web.Contents("https://api.example.com/data")',
    'Json.Document(File.Contents("x.json"))',
    'SharePoint.Files("https://x.sharepoint.com/site")',
  ]) {
    const m = `let S = ${call} in S`;
    const s = parseMSteps(m);
    assert.equal(s.length, 1, `${call}: expected 1 step`);
    assert.equal(s[0].kind, "source", `${call}: expected source`);
  }
});
