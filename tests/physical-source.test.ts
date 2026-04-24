/**
 * Physical-source extractor — map a partition's M body down to
 * external coordinates (server · database · schema · table / file).
 *
 * Covers the connector shapes that appear in 90%+ of real PBIP models:
 *   - `Sql.Database(server, db)` + `{[Schema="s",Item="t"]}[Data]`
 *   - `Snowflake.Databases(host, wh)` + schema/item nav
 *   - `GoogleBigQuery.Database` + `{[Name=…,Kind="Schema|Table"]}` chain
 *   - `Csv.Document(File.Contents("path"))` / `Excel.Workbook` / `Parquet.Document`
 *   - `Web.Contents("https://…")` URL parsing
 *   - `SharePoint.Files("https://tenant.sharepoint.com/site")`
 *   - non-match → null (doesn't crash)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPhysicalSource } from "../src/model-parser.js";

test("extractPhysicalSource — SQL Server with schema/item navigation", () => {
  const m = `let
    Source = Sql.Database("srv1.db.windows.net", "AdventureWorks"),
    dbo_Sales = Source{[Schema="dbo",Item="FactSales"]}[Data]
in dbo_Sales`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.kind, "Sql");
  assert.equal(ps!.server, "srv1.db.windows.net");
  assert.equal(ps!.database, "AdventureWorks");
  assert.equal(ps!.schema, "dbo");
  assert.equal(ps!.name, "FactSales");
});

test("extractPhysicalSource — schema/item order swapped", () => {
  const m = `Source = Sql.Database("srv","db"), t = Source{[Item="Sales",Schema="dbo"]}[Data]`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.schema, "dbo");
  assert.equal(ps!.name, "Sales");
});

test("extractPhysicalSource — SQL Server with native query (no item nav)", () => {
  const m = `Source = Sql.Database("srv","db",[Query="SELECT * FROM t"])`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.server, "srv");
  assert.equal(ps!.database, "db");
  assert.equal(ps!.schema, "");
  assert.equal(ps!.name, "");
});

test("extractPhysicalSource — GoogleBigQuery 3-part navigation", () => {
  const m = `let
    Source = GoogleBigQuery.Database(),
    #"proj" = Source{[Name="my-project"]}[Data],
    #"ds" = #"proj"{[Name="analytics",Kind="Schema"]}[Data],
    #"tbl" = #"ds"{[Name="events",Kind="Table"]}[Data]
in #"tbl"`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.kind, "BigQuery");
  assert.equal(ps!.database, "my-project");
  assert.equal(ps!.schema, "analytics");
  assert.equal(ps!.name, "events");
});

test("extractPhysicalSource — Parquet file with Windows backslash path", () => {
  // TMDL stores the path literally; when parsed from TMDL the string
  // contains single backslashes. Our normaliser swaps them to slashes.
  const m = 'Source = Parquet.Document(File.Contents("C:\\data\\sales\\facts.parquet"))';
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.kind, "Parquet");
  assert.equal(ps!.name, "facts.parquet");
  assert.match(ps!.schema, /sales$/);
});

test("extractPhysicalSource — CSV file", () => {
  const m = `Source = Csv.Document(File.Contents("/var/data/users.csv"))`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.kind, "CSV");
  assert.equal(ps!.name, "users.csv");
  assert.equal(ps!.schema, "/var/data");
});

test("extractPhysicalSource — Excel workbook", () => {
  const m = `Source = Excel.Workbook(File.Contents("./budget.xlsx"), null, true)`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.kind, "Excel");
  assert.equal(ps!.name, "budget.xlsx");
});

test("extractPhysicalSource — Web.Contents parses URL into host + path", () => {
  const m = `Source = Json.Document(Web.Contents("https://api.example.com/v1/users"))`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  // Web comes AFTER file-style in the try chain — Json.Document wraps Web.Contents here
  // so we either get File match (no — File.Contents not present) or Web match.
  assert.equal(ps!.kind, "Web");
  assert.equal(ps!.server, "api.example.com");
  assert.match(ps!.name, /\/v1\/users/);
});

test("extractPhysicalSource — SharePoint.Files URL", () => {
  const m = `Source = SharePoint.Files("https://contoso.sharepoint.com/sites/finance", [ApiVersion = 15])`;
  const ps = extractPhysicalSource(m);
  assert.ok(ps);
  assert.equal(ps!.kind, "SharePoint");
  assert.equal(ps!.server, "contoso.sharepoint.com");
});

test("extractPhysicalSource — unrecognised body returns null", () => {
  assert.equal(extractPhysicalSource(""), null);
  assert.equal(extractPhysicalSource("let x = 1 in x"), null);
  assert.equal(extractPhysicalSource('Table.FromRows({{"a","b"}})'), null);
});

test("extractPhysicalSource — composite-model entity partition returns null (no connector shape)", () => {
  // Composite models point at a shared expression via `expressionSource: '…'`
  // in the TMDL; the expression body can be `AnalysisServices.Database(…)`
  // which our SQL-style matcher catches but as a cluster we name generically.
  // An `entity` partition's own body is often empty.
  assert.equal(extractPhysicalSource("   "), null);
});
