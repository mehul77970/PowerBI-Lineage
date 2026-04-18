import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface CalcItem {
  name: string;
  ordinal: number;
  expression: string;
  formatStringExpression: string;
  description: string;
}

export interface ModelCalcGroup {
  name: string;
  description: string;
  precedence: number;
  items: CalcItem[];
}

export interface ModelRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  isActive: boolean;
}

export interface ModelFunction {
  name: string;
  parameters: string;
  expression: string;
  description: string;
}

export interface RawPartition {
  /** Partition name (Power BI auto-generates these as `<TableName>-<uuid>`). */
  name: string;
  /** Storage mode: import, directQuery, dual, calculated, calculationGroup, m, etc. */
  mode: string;
  /** Inferred friendly source type (Parquet, SQL Server, Excel, …) — best-effort. */
  sourceType: string;
  /** Best-effort location string extracted from the M (first string literal). */
  sourceLocation: string;
}

export interface RawHierarchyLevel {
  name: string;
  column: string;
  description: string;
}

export interface RawHierarchy {
  name: string;
  description: string;
  levels: RawHierarchyLevel[];
}

export interface RawTable {
  name: string;
  description: string;
  partitions: RawPartition[];
  hierarchies: RawHierarchy[];
}

/** Top-level M expressions in expressions.tmdl — typically parameters. */
export interface RawExpression {
  name: string;
  description: string;
  /** "parameter" if value is a literal; "m" if it's an M query. */
  kind: "parameter" | "m";
  /** Single-line literal value (parameters) or trimmed M body (m queries). */
  value: string;
  /** Raw `meta [...]` block contents, if present. */
  metadata: string;
}

/**
 * Top-level metadata about the model itself — equivalent to the "Semantic
 * model" properties pane in Power BI Desktop. All fields are best-effort
 * from `model.tmdl` / `definition/cultures/*` (or BIM `model.*`).
 */
export interface ModelProperties {
  /** Model name from `model NAME`. Usually the literal "Model". */
  name: string;
  /** /// doc-comment description above the `model` keyword. */
  description: string;
  /** Default culture code, e.g. "en-US". */
  culture: string;
  /** sourceQueryCulture if set. */
  sourceQueryCulture: string;
  /** True when the `discourageImplicitMeasures` flag is present. */
  discourageImplicitMeasures: boolean;
  /** valueFilterBehavior value when explicitly set ("Independent", "Coalesce", …); empty → Automatic (default). */
  valueFilterBehavior: string;
  /** Culture codes — one per file under `definition/cultures/`. */
  cultures: string[];
  /** defaultPowerBIDataSourceVersion if set. */
  defaultPowerBIDataSourceVersion: string;
}

export interface RawModel {
  tables: RawTable[];
  measures: Array<{ name: string; table: string; daxExpression: string; formatString: string; description: string; displayFolder: string }>;
  columns: Array<{ name: string; table: string; dataType: string; isKey: boolean; isHidden: boolean; isCalculated: boolean; description: string; displayFolder: string; summarizeBy: string; sortByColumn: string; dataCategory: string; formatString: string }>;
  relationships: ModelRelationship[];
  functions: ModelFunction[];
  calcGroups: ModelCalcGroup[];
  expressions: RawExpression[];
  /** Compatibility level read from database.tmdl, when present (1500, 1702, …). */
  compatibilityLevel: number | null;
  modelProperties: ModelProperties;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1: Locate Semantic Model
// ═══════════════════════════════════════════════════════════════════════════════

export function findSemanticModelPath(reportPath: string): string {
  const projectDir = path.dirname(reportPath);

  // Try definition.pbir first (explicit pointer)
  const pbirFile = path.join(reportPath, "definition.pbir");
  if (fs.existsSync(pbirFile)) {
    try {
      const pbir = JSON.parse(fs.readFileSync(pbirFile, "utf8"));
      const rel = pbir?.datasetReference?.byPath?.path;
      if (rel) {
        const candidate = path.resolve(projectDir, rel);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch { /* fall through */ }
  }

  // Scan sibling folders
  const entries = fs.readdirSync(projectDir, { withFileTypes: true });
  const modelDir = entries.find(e => e.isDirectory() && e.name.endsWith(".SemanticModel"));
  if (!modelDir) throw new Error("No .SemanticModel folder found alongside the report");
  return path.join(projectDir, modelDir.name);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2: Parse Model (TMDL + BIM)
// ═══════════════════════════════════════════════════════════════════════════════

function parseTmdlRelationships(modelPath: string): ModelRelationship[] {
  const relFile = path.join(modelPath, "definition", "relationships.tmdl");
  if (!fs.existsSync(relFile)) return [];
  const content = fs.readFileSync(relFile, "utf8");
  const rels: ModelRelationship[] = [];
  let current: Partial<ModelRelationship> | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("relationship ")) {
      if (current?.fromTable) rels.push({ fromTable: current.fromTable!, fromColumn: current.fromColumn!, toTable: current.toTable!, toColumn: current.toColumn!, isActive: current.isActive !== false });
      current = { isActive: true };
    } else if (current && trimmed.startsWith("fromColumn:")) {
      const val = trimmed.replace("fromColumn:", "").trim();
      const dot = val.indexOf(".");
      if (dot > 0) {
        current.fromTable = val.substring(0, dot).replace(/^'(.*)'$/, "$1");
        current.fromColumn = val.substring(dot + 1).replace(/^'(.*)'$/, "$1");
      }
    } else if (current && trimmed.startsWith("toColumn:")) {
      const val = trimmed.replace("toColumn:", "").trim();
      const dot = val.indexOf(".");
      if (dot > 0) {
        current.toTable = val.substring(0, dot).replace(/^'(.*)'$/, "$1");
        current.toColumn = val.substring(dot + 1).replace(/^'(.*)'$/, "$1");
      }
    } else if (current && trimmed.startsWith("isActive:")) {
      current.isActive = trimmed.includes("true");
    }
  }
  if (current?.fromTable) rels.push({ fromTable: current.fromTable!, fromColumn: current.fromColumn!, toTable: current.toTable!, toColumn: current.toColumn!, isActive: current.isActive !== false });
  return rels;
}

function parseTmdlFunctions(modelPath: string): ModelFunction[] {
  const funcFile = path.join(modelPath, "definition", "functions.tmdl");
  if (!fs.existsSync(funcFile)) return [];
  const content = fs.readFileSync(funcFile, "utf8");
  const funcs: ModelFunction[] = [];
  let pendingDesc = "";
  let funcDesc = "";
  let name = "";
  let params = "";
  let exprLines: string[] = [];
  let inFunc = false;
  let inBacktickBlock = false;

  const flush = () => {
    if (name) {
      funcs.push({ name, parameters: params, expression: exprLines.join("\n").trim(), description: funcDesc.trim() });
    }
    name = "";
    params = "";
    exprLines = [];
    funcDesc = "";
    inFunc = false;
    inBacktickBlock = false;
  };

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Collect /// doc comments (can appear between functions)
    if (trimmed.startsWith("///")) {
      pendingDesc += (pendingDesc ? " " : "") + trimmed.replace(/^\/\/\/\s*/, "");
      continue;
    }

    // Function declaration: function 'name' = or function 'name' = ```
    if (trimmed.startsWith("function ")) {
      if (inFunc) flush();
      funcDesc = pendingDesc;
      pendingDesc = "";
      const match = trimmed.match(/^function\s+'([^']+)'\s*=\s*(```)?(.*)$/);
      if (match) {
        name = match[1];
        inFunc = true;
        inBacktickBlock = !!match[2];
        const rest = match[3]?.trim();
        if (rest) exprLines.push(rest);
      } else {
        const m2 = trimmed.match(/^function\s+(\S+)\s*=\s*(```)?(.*)$/);
        if (m2) {
          name = m2[1];
          inFunc = true;
          inBacktickBlock = !!m2[2];
          const rest = m2[3]?.trim();
          if (rest) exprLines.push(rest);
        }
      }
      continue;
    }

    if (inFunc) {
      if (inBacktickBlock && trimmed === "```") continue;
      if (trimmed.startsWith("lineageTag:")) continue;
      exprLines.push(trimmed);
    } else {
      // Reset pending description if non-comment, non-function, non-empty
      if (trimmed && !trimmed.startsWith("///")) pendingDesc = "";
    }
  }
  flush();

  // Extract parameters from expression: (Param : TYPE, ...) =>
  for (const f of funcs) {
    const paramMatch = f.expression.match(/^\(\s*(.*?)\s*\)\s*=>/s);
    if (paramMatch) {
      f.parameters = paramMatch[1].replace(/\s+/g, " ").trim();
      f.expression = f.expression.replace(/^\(.*?\)\s*=>\s*/s, "").trim();
    }
  }

  return funcs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Datasource extraction
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Infer a friendly source-type label and a best-effort location from M code.
 * Matches the most common Power Query connectors. Falls back to "Unknown / M".
 */
/**
 * Each pattern carries a lowercase "keyword" — a distinctive prefix
 * that MUST appear in the M code for the regex to possibly match.
 * We do a single case-insensitive substring check before running
 * the regex. With ~45 patterns and 48+ partitions per composite
 * model, that's ~2,000 regex tests avoided per generate() on H&S.
 *
 * The keyword is a plain lowercase substring (no regex metacharacters)
 * and the M source is lowercased once per call. Order of patterns
 * still matters for the Binary.FromText / Table.FromRows first-match
 * semantics (they can wrap other calls).
 */
const SOURCE_PATTERNS: Array<{ kw: string; re: RegExp; name: string }> = [
  // Inline wrappers FIRST — they often wrap other sources and would otherwise mis-classify.
  { kw: "binary.fromtext",         re: /Binary\.FromText\(/,             name: "Inline (encoded)" },
  { kw: "table.fromrows",          re: /Table\.FromRows\(/,              name: "Inline data" },
  { kw: "#table",                  re: /#table\(/,                       name: "Inline data" },
  { kw: "parquet.document",        re: /Parquet\.Document\(/i,           name: "Parquet" },
  { kw: "sql.database",            re: /Sql\.Database\(/i,               name: "SQL Server" },
  { kw: "sql.databases",           re: /Sql\.Databases\(/i,              name: "SQL Server" },
  { kw: "odata.feed",              re: /OData\.Feed\(/i,                 name: "OData" },
  { kw: "excel.workbook",          re: /Excel\.Workbook\(/i,             name: "Excel" },
  { kw: "csv.document",            re: /Csv\.Document\(/i,               name: "CSV" },
  { kw: "json.document",           re: /Json\.Document\(/i,              name: "JSON" },
  { kw: "xml.tables",              re: /Xml\.Tables\(/i,                 name: "XML" },
  { kw: "web.contents",            re: /Web\.Contents\(/i,               name: "Web" },
  { kw: "web.page",                re: /Web\.Page\(/i,                   name: "Web (HTML)" },
  { kw: "folder.files",            re: /Folder\.Files\(/i,               name: "Folder" },
  { kw: "folder.contents",         re: /Folder\.Contents\(/i,            name: "Folder" },
  { kw: "sharepoint.tables",       re: /SharePoint\.Tables\(/i,          name: "SharePoint" },
  { kw: "sharepoint.files",        re: /SharePoint\.Files\(/i,           name: "SharePoint Files" },
  { kw: "sharepoint.contents",     re: /SharePoint\.Contents\(/i,        name: "SharePoint" },
  { kw: "azurestorage.blobs",      re: /AzureStorage\.Blobs\(/i,         name: "Azure Blob Storage" },
  { kw: "azurestorage.datalake",   re: /AzureStorage\.DataLake\(/i,      name: "Azure Data Lake" },
  { kw: "azurestorage.tables",     re: /AzureStorage\.Tables\(/i,        name: "Azure Table Storage" },
  { kw: "snowflake.databases",     re: /Snowflake\.Databases\(/i,        name: "Snowflake" },
  { kw: "salesforce.data",         re: /Salesforce\.Data\(/i,            name: "Salesforce" },
  { kw: "salesforce.reports",      re: /Salesforce\.Reports\(/i,         name: "Salesforce Reports" },
  { kw: "postgresql.database",     re: /PostgreSQL\.Database\(/i,        name: "PostgreSQL" },
  { kw: "mysql.database",          re: /MySQL\.Database\(/i,             name: "MySQL" },
  { kw: "oracle.database",         re: /Oracle\.Database\(/i,            name: "Oracle" },
  { kw: "teradata.database",       re: /Teradata\.Database\(/i,          name: "Teradata" },
  { kw: "analysisservices.database", re: /AnalysisServices\.Database\(/i, name: "Analysis Services" },
  { kw: "powerbi.dataflows",       re: /PowerBI\.Dataflows\(/i,          name: "Power BI Dataflow" },
  { kw: "powerplatform.dataflows", re: /PowerPlatform\.Dataflows\(/i,    name: "Power Platform Dataflow" },
  { kw: "commondataservice.",      re: /CommonDataService\./i,           name: "Dataverse" },
  { kw: "cds.contents",            re: /Cds\.Contents\(/i,               name: "Dataverse" },
  { kw: "adobeanalytics.",         re: /AdobeAnalytics\./i,              name: "Adobe Analytics" },
  { kw: "googleanalytics.",        re: /GoogleAnalytics\./i,             name: "Google Analytics" },
  { kw: "exchange.contents",       re: /Exchange\.Contents\(/i,          name: "Exchange" },
  { kw: "access.database",         re: /Access\.Database\(/i,            name: "Access" },
  { kw: "hdfs.files",              re: /Hdfs\.Files\(/i,                 name: "HDFS" },
  { kw: "azurecosmosdb.",          re: /AzureCosmosDB\./i,               name: "Cosmos DB" },
  { kw: "amazonredshift.",         re: /AmazonRedshift\./i,              name: "Amazon Redshift" },
  { kw: "amazonathena.",           re: /AmazonAthena\./i,                name: "Amazon Athena" },
  { kw: "googlebigquery.",         re: /GoogleBigQuery\./i,              name: "BigQuery" },
  { kw: "bigquery.database",       re: /BigQuery\.Database\(/i,          name: "BigQuery" },
  { kw: "databricks.",             re: /Databricks\./i,                  name: "Databricks" },
];

function inferSource(m: string): { sourceType: string; sourceLocation: string } {
  let sourceType = "Unknown / M";
  // Lowercase once so every keyword check is a cheap indexOf.
  const lower = m.toLowerCase();
  for (const p of SOURCE_PATTERNS) {
    if (lower.indexOf(p.kw) < 0) continue;   // fast path
    if (p.re.test(m)) { sourceType = p.name; break; }
  }
  // Best-effort location: first quoted string literal in the M.
  const stringMatch = m.match(/"([^"]+)"/);
  const sourceLocation = stringMatch ? stringMatch[1] : "";
  return { sourceType, sourceLocation };
}

/**
 * Pull all `partition <name> = <mode>` blocks from a single table TMDL file.
 * Captures the multi-line `source =` body so we can infer the source type.
 * The body itself is not exposed on the returned RawPartition (per design).
 */
function extractTmdlPartitions(
  content: string,
  expressions: RawExpression[] = [],
): RawPartition[] {
  const lines = content.split("\n");
  const out: RawPartition[] = [];
  // Build a lookup so entity partitions can resolve `expressionSource: 'NAME'`
  // back to the body captured by parseTmdlExpressions. Composite models
  // point every directQuery partition at a shared AnalysisServices.Database
  // expression; without this resolution step they all collapse to
  // "Unknown / M" even though we know the source kind.
  const expressionByName = new Map<string, string>();
  for (const e of expressions) expressionByName.set(e.name, e.value);

  let current: {
    name: string;
    mode: string;
    sourceLines: string[];
    /** Set when we hit `expressionSource: '…'` in an entity partition. */
    expressionSource: string | null;
  } | null = null;
  let inSource = false;

  const flush = () => {
    if (!current) return;
    let mCode = current.sourceLines.join("\n").trim();
    // Entity partition → use the body of the referenced shared expression
    // for source inference. Falls back to the inline M code if the
    // reference can't be resolved (typo, missing expression, etc.).
    if (current.expressionSource) {
      const body = expressionByName.get(current.expressionSource);
      if (body) mCode = body;
    }
    const { sourceType, sourceLocation } = inferSource(mCode);
    out.push({
      name: current.name,
      mode: current.mode || "import",
      sourceType,
      sourceLocation,
    });
    current = null;
    inSource = false;
  };

  for (const line of lines) {
    const tabCount = line.search(/[^\t]/);
    const trimmed = line.trim();

    // New partition declaration at depth 1.
    if (tabCount === 1 && /^partition\s+/.test(trimmed)) {
      flush();
      // Partition name can be a bare identifier OR a quoted name with
      // spaces (e.g. `partition 'Date NEW' = entity`). Previous regex
      // used \S+ which stopped at the first space inside quoted names.
      const m = trimmed.match(/^partition\s+('[^']+'|"[^"]+"|[\w.-]+)\s*=\s*(\w+)/);
      const rawName = m ? m[1] : "";
      current = {
        name: rawName.replace(/^['"]|['"]$/g, ""),
        mode: "",
        sourceLines: [],
        expressionSource: null,
      };
      continue;
    }

    if (!current) continue;

    // Anything at depth ≤ 1 closes the current partition (next sibling).
    if (tabCount <= 1 && trimmed.length > 0) {
      flush();
      continue;
    }

    if (tabCount === 2) {
      inSource = false;
      if (trimmed.startsWith("mode:")) {
        current.mode = trimmed.replace("mode:", "").trim();
      } else if (trimmed.startsWith("source")) {
        // Two TMDL source forms:
        //   source = <inline M>            (import / query partitions)
        //   source                         (entity partition — nested
        //     entityName: …                 fields on following lines)
        //     expressionSource: '…'
        const eq = trimmed.indexOf("=");
        if (eq >= 0) {
          const rest = trimmed.substring(eq + 1).trim();
          if (rest) current.sourceLines.push(rest);
        }
        inSource = true;  // Walk into the source block either way.
      }
    } else if (tabCount >= 3 && inSource) {
      // Entity partition: capture the expressionSource reference so
      // the flush() step can resolve it against the expression map.
      const mExprSource = trimmed.match(/^expressionSource:\s*(['"]?)([^'"\n]+)\1/);
      if (mExprSource) {
        current.expressionSource = mExprSource[2];
      } else {
        // Inline M body line — keep accumulating.
        current.sourceLines.push(line);
      }
    }
  }
  flush();
  return out;
}

/**
 * Parse `definition/expressions.tmdl` — top-level M expressions and parameters.
 * Captures preceding /// doc comments, the value (literal or first M line),
 * and any `meta [...]` block on the declaration line.
 */
/**
 * Pull all hierarchy definitions out of a single table TMDL file.
 * Example:
 *   hierarchy Year-Quarter-Month
 *     lineageTag: ...
 *     /// Top level. Calendar year.
 *     level Year
 *       lineageTag: ...
 *       column: Year
 *     ...
 */
function extractTmdlHierarchies(content: string): RawHierarchy[] {
  const lines = content.split("\n");
  const out: RawHierarchy[] = [];
  let pendingDoc = "";     // /// comments waiting to be claimed by the next hierarchy or level
  let current: RawHierarchy | null = null;
  let currentLevel: RawHierarchyLevel | null = null;

  const flushLevel = () => {
    if (current && currentLevel) current.levels.push(currentLevel);
    currentLevel = null;
  };
  const flushHierarchy = () => {
    flushLevel();
    if (current) out.push(current);
    current = null;
  };

  for (const line of lines) {
    const tabCount = line.search(/[^\t]/);
    const trimmed = line.trim();

    // Doc comments always go to `pendingDoc` — consumed by whatever declaration follows.
    if (trimmed.startsWith("///")) {
      pendingDoc += (pendingDoc ? " " : "") + trimmed.replace(/^\/\/\/\s*/, "");
      continue;
    }

    // Start of hierarchy at depth 1.
    if (tabCount === 1 && /^hierarchy\s+/.test(trimmed)) {
      flushHierarchy();
      const name = trimmed.replace(/^hierarchy\s+/, "").replace(/^'(.*)'$/, "$1").trim();
      current = { name, description: pendingDoc, levels: [] };
      pendingDoc = "";
      continue;
    }

    // Anything else at depth <= 1 ends the current hierarchy block (next sibling).
    if (tabCount <= 1 && trimmed.length > 0) {
      flushHierarchy();
      pendingDoc = "";
      continue;
    }

    if (!current) continue;

    // Level declaration at depth 2 — start new level, close previous.
    if (tabCount === 2 && /^level\s+/.test(trimmed)) {
      flushLevel();
      const name = trimmed.replace(/^level\s+/, "").replace(/^'(.*)'$/, "$1").trim();
      currentLevel = { name, column: "", description: pendingDoc };
      pendingDoc = "";
      continue;
    }

    // Depth-3 properties on the current level.
    if (tabCount === 3 && currentLevel && trimmed.startsWith("column:")) {
      currentLevel.column = trimmed.replace("column:", "").trim().replace(/^'(.*)'$/, "$1");
      continue;
    }

    // Ignore annotations / lineageTag etc. — they don't contribute to the public shape.
  }
  flushHierarchy();
  return out;
}

function parseTmdlExpressions(modelPath: string): RawExpression[] {
  const file = path.join(modelPath, "definition", "expressions.tmdl");
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  const out: RawExpression[] = [];

  let pendingDoc = "";
  let current: RawExpression | null = null;
  let collectingValue = false;
  let valueLines: string[] = [];

  const flush = () => {
    if (!current) return;
    if (collectingValue && valueLines.length > 0) {
      current.value = valueLines.join("\n").trim();
    }
    out.push(current);
    current = null;
    collectingValue = false;
    valueLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("///")) {
      pendingDoc += (pendingDoc ? " " : "") + trimmed.replace(/^\/\/\/\s*/, "");
      continue;
    }
    if (/^expression\s+/.test(trimmed)) {
      flush();
      // expression NAME = VALUE [meta [...]]
      // NAME is either a bare identifier (\w+) or a quoted name that
      // can contain spaces (`'DirectQuery to AS - Foo'`) — previous
      // regex used \S+ which stopped at the first space inside quoted
      // names, so every expression in a composite model failed to
      // parse (0 out of N) and all DQ partitions resolved to
      // "Unknown / M". Match quoted or bare.
      const m = trimmed.match(/^expression\s+('[^']+'|"[^"]+"|[\w.-]+)\s*=\s*(.*)$/);
      if (m) {
        const name = m[1].replace(/^['"]|['"]$/g, "");
        let rest = m[2];
        let metadata = "";
        const metaIdx = rest.indexOf(" meta [");
        if (metaIdx >= 0) {
          // Naive but fine — meta block is one balanced [...]; capture between brackets.
          const start = rest.indexOf("[", metaIdx);
          const end = rest.lastIndexOf("]");
          if (start > 0 && end > start) {
            metadata = rest.substring(start + 1, end).trim();
            rest = rest.substring(0, metaIdx).trim();
          }
        }
        const isLiteral = /^(["']).*\1$/.test(rest) || /^(true|false|\d+(\.\d+)?)$/.test(rest);
        current = {
          name,
          description: pendingDoc,
          kind: isLiteral ? "parameter" : "m",
          value: rest,
          metadata,
        };
        pendingDoc = "";
        // Multi-line M expression continues if value is empty.
        if (!rest) { collectingValue = true; valueLines = []; }
      }
      continue;
    }
    // Inside an expression: skip lineageTag / annotation; collect M body if multi-line.
    if (current) {
      if (/^lineageTag:/.test(trimmed) || /^annotation\b/.test(trimmed) || /^changedProperty\b/.test(trimmed)) continue;
      if (collectingValue && trimmed) valueLines.push(line);
    } else if (trimmed && !trimmed.startsWith("///")) {
      // Reset orphaned pendingDoc so it doesn't leak to the next expression.
      pendingDoc = "";
    }
  }
  flush();
  return out;
}

/** Read compatibility level from `definition/database.tmdl`. */
function parseTmdlDatabaseLevel(modelPath: string): number | null {
  const file = path.join(modelPath, "definition", "database.tmdl");
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf8");
  const m = content.match(/compatibilityLevel:\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Parse top-level model metadata from `definition/model.tmdl` and the
 * `definition/cultures/` folder. Mirrors the "Semantic model" pane in
 * Power BI Desktop. Server / Database name are runtime-only and not parsed.
 */
function parseTmdlModelProperties(modelPath: string): ModelProperties {
  const props: ModelProperties = {
    name: "",
    description: "",
    culture: "",
    sourceQueryCulture: "",
    discourageImplicitMeasures: false,
    valueFilterBehavior: "",
    cultures: [],
    defaultPowerBIDataSourceVersion: "",
  };

  // Cultures — each file under definition/cultures/ is one culture.
  const culturesDir = path.join(modelPath, "definition", "cultures");
  if (fs.existsSync(culturesDir)) {
    props.cultures = fs.readdirSync(culturesDir)
      .filter(f => f.endsWith(".tmdl"))
      .map(f => f.replace(/\.tmdl$/, ""))
      .sort();
  }

  const modelFile = path.join(modelPath, "definition", "model.tmdl");
  if (!fs.existsSync(modelFile)) return props;
  const lines = fs.readFileSync(modelFile, "utf8").split("\n");

  let pendingDoc = "";
  let inModelBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const tabCount = line.search(/[^\t]/);

    // Doc comment preceding the `model` keyword becomes its description.
    if (trimmed.startsWith("///") && !inModelBlock) {
      pendingDoc += (pendingDoc ? " " : "") + trimmed.replace(/^\/\/\/\s*/, "");
      continue;
    }

    // Model declaration at depth 0 — capture name + description.
    if (tabCount === 0 && /^model\s+/.test(trimmed)) {
      props.name = trimmed.replace(/^model\s+/, "").trim();
      props.description = pendingDoc;
      pendingDoc = "";
      inModelBlock = true;
      continue;
    }

    // Properties live at depth 1 inside the model block.
    if (inModelBlock && tabCount === 1) {
      if (trimmed.startsWith("culture:")) {
        props.culture = trimmed.replace("culture:", "").trim();
      } else if (trimmed.startsWith("sourceQueryCulture:")) {
        props.sourceQueryCulture = trimmed.replace("sourceQueryCulture:", "").trim();
      } else if (trimmed.startsWith("discourageImplicitMeasures")) {
        props.discourageImplicitMeasures = true;
      } else if (trimmed.startsWith("valueFilterBehavior:")) {
        props.valueFilterBehavior = trimmed.replace("valueFilterBehavior:", "").trim();
      } else if (trimmed.startsWith("defaultPowerBIDataSourceVersion:")) {
        props.defaultPowerBIDataSourceVersion = trimmed.replace("defaultPowerBIDataSourceVersion:", "").trim();
      }
      continue;
    }

    // Anything at depth 0 that isn't the model declaration ends the block.
    if (inModelBlock && tabCount === 0 && trimmed.length > 0) {
      inModelBlock = false;
    }
  }
  return props;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tables, columns, measures, calc-groups
// ═══════════════════════════════════════════════════════════════════════════════

function parseTmdlModel(modelPath: string): RawModel {
  const tablesDir = path.join(modelPath, "definition", "tables");
  const tables: RawTable[] = [];
  const measures: RawModel["measures"] = [];
  const columns: RawModel["columns"] = [];
  const calcGroups: ModelCalcGroup[] = [];
  const relationships = parseTmdlRelationships(modelPath);
  const functions = parseTmdlFunctions(modelPath);
  const expressions = parseTmdlExpressions(modelPath);
  const compatibilityLevel = parseTmdlDatabaseLevel(modelPath);
  const modelProperties = parseTmdlModelProperties(modelPath);

  if (!fs.existsSync(tablesDir)) {
    return { tables, measures, columns, relationships, functions, calcGroups, expressions, compatibilityLevel, modelProperties };
  }

  for (const file of fs.readdirSync(tablesDir).filter(f => f.endsWith(".tmdl"))) {
    const content = fs.readFileSync(path.join(tablesDir, file), "utf8");
    const lines = content.split("\n");
    // Extract partition (datasource) info and hierarchy definitions up-front.
    const filePartitions = extractTmdlPartitions(content, expressions);
    const fileHierarchies = extractTmdlHierarchies(content);
    let tableName = "";
    let pendingDocComment = "";  // Accumulates /// lines to claim as description of the next table/column/measure
    let currentMeasure: { name: string; table: string; daxExpression: string; formatString: string; description: string; displayFolder: string } | null = null;
    let currentColumn: { name: string; table: string; dataType: string; isKey: boolean; isHidden: boolean; isCalculated: boolean; description: string; displayFolder: string; summarizeBy: string; sortByColumn: string; dataCategory: string; formatString: string } | null = null;
    let collectingExpression = false;
    let expressionLines: string[] = [];

    // Calc group tracking
    let isCalcGroupTable = false;
    let inCalcGroupSection = false;
    let calcGroupDesc = "";
    let calcGroupPrecedence = 10;
    let pendingCalcDesc = "";
    let calcGroupItems: CalcItem[] = [];
    let calcItemOrdinal = 0;
    let currentCalcItem: CalcItem | null = null;
    let calcItemExprLines: string[] = [];
    let collectingCalcItemExpr = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimEnd();

      // Detect indentation depth (tab count) — computed early so /// handler can check context
      const tabCount = line.search(/[^\t]/);
      const _trim = trimmed.trim();

      // /// doc comment — accumulate for next table/column/measure.
      // Calc-group items use their own /// handler at depth 2 (see below).
      if (_trim.startsWith("///") && !inCalcGroupSection) {
        pendingDocComment += (pendingDocComment ? " " : "") + _trim.replace(/^\/\/\/\s*/, "");
        continue;
      }

      // Table name (no leading tabs)
      if (/^table\s+/.test(trimmed)) {
        tableName = trimmed.replace(/^table\s+/, "").replace(/^'(.*)'$/, "$1").trim();
        tables.push({ name: tableName, description: pendingDocComment, partitions: filePartitions, hierarchies: fileHierarchies });
        pendingDocComment = "";
        continue;
      }

      // New measure at depth 1
      if (tabCount === 1 && /^\tmeasure\s+/.test(line)) {
        // Flush previous measure
        if (currentMeasure && collectingExpression) {
          currentMeasure.daxExpression = expressionLines.join("\n").trim();
        }
        collectingExpression = false;
        expressionLines = [];
        currentColumn = null;

        const rest = trimmed.replace(/^\s*measure\s+/, "");
        const eqIdx = rest.indexOf("=");
        if (eqIdx > 0) {
          let name = rest.substring(0, eqIdx).trim().replace(/^'(.*)'$/, "$1");
          const dax = rest.substring(eqIdx + 1).trim();
          currentMeasure = { name, table: tableName, daxExpression: dax, formatString: "", description: pendingDocComment, displayFolder: "" };
          measures.push(currentMeasure);
          pendingDocComment = "";
          // Check if DAX continues on next lines
          collectingExpression = true;
          expressionLines = [dax];
        }
        continue;
      }

      // New column at depth 1
      if (tabCount === 1 && /^\tcolumn\s+/.test(line)) {
        if (currentMeasure && collectingExpression) {
          currentMeasure.daxExpression = expressionLines.join("\n").trim();
        }
        collectingExpression = false;
        expressionLines = [];
        currentMeasure = null;

        const colRest = trimmed.replace(/^\s*column\s+/, "");
        const colEq = colRest.indexOf("=");
        const colName = (colEq > 0 ? colRest.substring(0, colEq) : colRest).trim().replace(/^'(.*)'$/, "$1");
        const isCalculated = colEq > 0;
        currentColumn = { name: colName, table: tableName, dataType: "string", isKey: false, isHidden: false, isCalculated, description: pendingDocComment, displayFolder: "", summarizeBy: "", sortByColumn: "", dataCategory: "", formatString: "" };
        columns.push(currentColumn);
        pendingDocComment = "";
        continue;
      }

      // Calc group section at depth 1
      if (tabCount === 1 && /^\tcalculationGroup/.test(line)) {
        isCalcGroupTable = true;
        inCalcGroupSection = true;
        calcGroupDesc = pendingCalcDesc;
        pendingCalcDesc = "";
        currentMeasure = null;
        currentColumn = null;
        collectingExpression = false;
        expressionLines = [];
        continue;
      }

      // Inside calc group: depth-2 lines
      if (inCalcGroupSection && tabCount === 2) {
        const t2 = trimmed.trim();

        // Doc comment for next item
        if (t2.startsWith("///")) {
          if (currentCalcItem) {
            // Flush previous item expression
            if (collectingCalcItemExpr) {
              currentCalcItem.expression = calcItemExprLines.join("\n").trim();
              collectingCalcItemExpr = false;
              calcItemExprLines = [];
            }
            calcGroupItems.push(currentCalcItem);
            currentCalcItem = null;
          }
          pendingCalcDesc += (pendingCalcDesc ? " " : "") + t2.replace(/^\/\/\/\s*/, "");
          continue;
        }

        // precedence property
        if (t2.startsWith("precedence:")) {
          calcGroupPrecedence = parseInt(t2.replace("precedence:", "").trim()) || 10;
          continue;
        }

        // calculationItem Name = expr
        const ciMatch = t2.match(/^calculationItem\s+'?([^'=]+?)'?\s*=\s*(.*)$/);
        if (ciMatch) {
          if (currentCalcItem) {
            if (collectingCalcItemExpr) {
              currentCalcItem.expression = calcItemExprLines.join("\n").trim();
              collectingCalcItemExpr = false;
              calcItemExprLines = [];
            }
            calcGroupItems.push(currentCalcItem);
          }
          const itemExpr = ciMatch[2].trim();
          currentCalcItem = {
            name: ciMatch[1].trim(),
            ordinal: calcItemOrdinal++,
            expression: itemExpr,
            formatStringExpression: "",
            description: pendingCalcDesc,
          };
          pendingCalcDesc = "";
          if (!itemExpr) {
            collectingCalcItemExpr = true;
            calcItemExprLines = [];
          }
          continue;
        }

        // formatStringDefinition or other known props on item
        if (currentCalcItem && t2.startsWith("formatStringExpression:")) {
          currentCalcItem.formatStringExpression = t2.replace("formatStringExpression:", "").trim();
          continue;
        }

        // Expression continuation at depth 3
        if (collectingCalcItemExpr && currentCalcItem && tabCount >= 3) {
          calcItemExprLines.push(t2);
          continue;
        }

        continue;
      }

      // Depth 3 inside calc item expression
      if (inCalcGroupSection && collectingCalcItemExpr && currentCalcItem && tabCount >= 3) {
        calcItemExprLines.push(trimmed.trim());
        continue;
      }

      // Other depth-1 items (partition, hierarchy, etc.) end current measure/column
      if (tabCount === 1 && !line.match(/^\t\s/)) {
        // Exit calc group section
        if (inCalcGroupSection) {
          if (currentCalcItem) {
            if (collectingCalcItemExpr) currentCalcItem.expression = calcItemExprLines.join("\n").trim();
            calcGroupItems.push(currentCalcItem);
            currentCalcItem = null;
          }
          inCalcGroupSection = false;
        }
        if (currentMeasure && collectingExpression) {
          currentMeasure.daxExpression = expressionLines.join("\n").trim();
        }
        collectingExpression = false;
        expressionLines = [];
        currentMeasure = null;
        // Skip the Name column that belongs to the calc group table
        if (isCalcGroupTable && /^\tcolumn\s+/.test(line)) { currentColumn = null; continue; }
        currentColumn = null;
        continue;
      }

      // Depth 2+ properties
      if (tabCount >= 2) {
        const propLine = trimmed.trim();

        // Known TMDL property keywords that terminate expression collection
        const tmdlProps = ["formatString:", "lineageTag:", "summarizeBy:", "dataType:", "sourceColumn:", "displayFolder:", "description:", "isHidden:", "isKey:", "sortByColumn:", "dataCategory:", "isNameInferred:", "isDataTypeInferred:"];
        const isProp = tmdlProps.some(p => propLine.startsWith(p));

        if (isProp) {
          // Flush expression before reading properties
          if (currentMeasure && collectingExpression && expressionLines.length > 0) {
            currentMeasure.daxExpression = expressionLines.join("\n").trim();
            collectingExpression = false;
            expressionLines = [];
          }

          if (propLine.startsWith("formatString:")) {
            const fmt = propLine.replace("formatString:", "").trim().replace(/^['"]|['"]$/g, "");
            if (currentMeasure) currentMeasure.formatString = fmt;
            else if (currentColumn) currentColumn.formatString = fmt;
          }
          if (propLine.startsWith("dataType:") && currentColumn) {
            currentColumn.dataType = propLine.replace("dataType:", "").trim();
          }
          if (propLine.startsWith("isKey:") && currentColumn) {
            currentColumn.isKey = propLine.replace("isKey:", "").trim().toLowerCase() === "true";
          }
          if (propLine.startsWith("isHidden:") && currentColumn) {
            currentColumn.isHidden = propLine.replace("isHidden:", "").trim().toLowerCase() === "true";
          }
          if (propLine.startsWith("summarizeBy:") && currentColumn) {
            currentColumn.summarizeBy = propLine.replace("summarizeBy:", "").trim().replace(/^['"]|['"]$/g, "");
          }
          if (propLine.startsWith("sortByColumn:") && currentColumn) {
            currentColumn.sortByColumn = propLine.replace("sortByColumn:", "").trim().replace(/^['"]|['"]$/g, "");
          }
          if (propLine.startsWith("dataCategory:") && currentColumn) {
            currentColumn.dataCategory = propLine.replace("dataCategory:", "").trim().replace(/^['"]|['"]$/g, "");
          }
          if (propLine.startsWith("description:")) {
            const desc = propLine.replace("description:", "").trim().replace(/^['"]|['"]$/g, "");
            if (currentMeasure && !currentMeasure.description) currentMeasure.description = desc;
            else if (currentColumn && !currentColumn.description) currentColumn.description = desc;
          }
          if (propLine.startsWith("displayFolder:")) {
            const folder = propLine.replace("displayFolder:", "").trim().replace(/^['"]|['"]$/g, "");
            if (currentMeasure) currentMeasure.displayFolder = folder;
            else if (currentColumn) currentColumn.displayFolder = folder;
          }
          continue;
        }

        // Annotation/expression continuation at depth 2
        if (propLine.startsWith("annotation ") || propLine.startsWith("changedProperty ") || propLine.startsWith("extendedProperty ")) {
          if (currentMeasure && collectingExpression) {
            currentMeasure.daxExpression = expressionLines.join("\n").trim();
            collectingExpression = false;
            expressionLines = [];
          }
          continue;
        }

        // Multi-line DAX expression continuation (depth 3+)
        if (collectingExpression && currentMeasure && tabCount >= 3) {
          expressionLines.push(propLine);
          continue;
        }
      }
    }

    // Flush final measure
    if (currentMeasure && collectingExpression) {
      currentMeasure.daxExpression = expressionLines.join("\n").trim();
    }

    // Flush final calc item and register calc group
    if (isCalcGroupTable) {
      if (currentCalcItem) {
        if (collectingCalcItemExpr) currentCalcItem.expression = calcItemExprLines.join("\n").trim();
        calcGroupItems.push(currentCalcItem);
      }
      calcGroups.push({ name: tableName, description: calcGroupDesc, precedence: calcGroupPrecedence, items: calcGroupItems });
    }
  }

  return { tables, measures, columns, relationships, functions, calcGroups, expressions, compatibilityLevel, modelProperties };
}

function parseBimFile(bimPath: string): RawModel {
  const bim = JSON.parse(fs.readFileSync(bimPath, "utf8"));
  const tables: RawTable[] = [];
  const measures: RawModel["measures"] = [];
  const columns: RawModel["columns"] = [];

  const joinDesc = (d: unknown): string =>
    Array.isArray(d) ? d.join("\n") : (typeof d === "string" ? d : "");

  for (const table of bim.model?.tables || []) {
    const tableName = table.name;
    // Per-table partitions: name, mode, source M.
    const tablePartitions: RawPartition[] = (table.partitions || []).map((p: any) => {
      const src = p?.source || {};
      const mCode = Array.isArray(src.expression) ? src.expression.join("\n") : (src.expression || "");
      const { sourceType, sourceLocation } = inferSource(mCode);
      return {
        name: p.name || "",
        mode: p.mode || src.type || "import",
        sourceType,
        sourceLocation,
      };
    });
    // Hierarchies defined on the table.
    const tableHierarchies: RawHierarchy[] = (table.hierarchies || []).map((h: any) => ({
      name: h.name || "",
      description: joinDesc(h.description),
      levels: (h.levels || []).map((lv: any) => ({
        name: lv.name || "",
        column: lv.column || "",
        description: joinDesc(lv.description),
      })),
    }));
    tables.push({ name: tableName, description: joinDesc(table.description), partitions: tablePartitions, hierarchies: tableHierarchies });
    for (const m of table.measures || []) {
      measures.push({
        name: m.name,
        table: tableName,
        daxExpression: Array.isArray(m.expression) ? m.expression.join("\n") : (m.expression || ""),
        formatString: m.formatString || "",
        description: joinDesc(m.description),
        displayFolder: typeof m.displayFolder === "string" ? m.displayFolder : "",
      });
    }
    for (const c of table.columns || []) {
      if (c.type === "rowNumber") continue;
      columns.push({
        name: c.name,
        table: tableName,
        dataType: c.dataType || "string",
        isKey: c.isKey === true,
        isHidden: c.isHidden === true,
        isCalculated: c.type === "calculated",
        description: joinDesc(c.description),
        displayFolder: typeof c.displayFolder === "string" ? c.displayFolder : "",
        summarizeBy: typeof c.summarizeBy === "string" ? c.summarizeBy : "",
        sortByColumn: typeof c.sortByColumn === "string" ? c.sortByColumn : "",
        dataCategory: typeof c.dataCategory === "string" ? c.dataCategory : "",
        formatString: typeof c.formatString === "string" ? c.formatString : "",
      });
    }
  }
  const relationships: ModelRelationship[] = (bim.model?.relationships || []).map((r: any) => ({
    fromTable: r.fromTable || "",
    fromColumn: r.fromColumn || "",
    toTable: r.toTable || "",
    toColumn: r.toColumn || "",
    isActive: r.isActive !== false,
  }));

  const functions: ModelFunction[] = [];
  const expressions: RawExpression[] = [];
  for (const expr of bim.model?.expressions || []) {
    const exprText = Array.isArray(expr.expression) ? expr.expression.join("\n") : (expr.expression || "");
    const paramMatch = exprText.match(/^\(\s*(.*?)\s*\)\s*=>/s);
    if (paramMatch) {
      // Looks like a DAX/M-style function definition.
      functions.push({
        name: expr.name || "",
        parameters: paramMatch[1].replace(/\s+/g, " ").trim(),
        expression: exprText.replace(/^\(.*?\)\s*=>\s*/s, "").trim(),
        description: expr.description || "",
      });
    } else if (expr.kind === "m") {
      // Top-level M expression / parameter.
      const literalMatch = exprText.match(/^\s*(["'])(.*)\1\s*$/);
      const isLiteral = !!literalMatch || /^(true|false|\d+(\.\d+)?)$/.test(exprText.trim());
      expressions.push({
        name: expr.name || "",
        description: joinDesc(expr.description),
        kind: isLiteral ? "parameter" : "m",
        value: exprText.trim(),
        metadata: "",
      });
    }
  }

  const calcGroups: ModelCalcGroup[] = [];
  for (const table of bim.model?.tables || []) {
    if (!table.calculationGroup) continue;
    const cg = table.calculationGroup;
    const items: CalcItem[] = (cg.calculationItems || []).map((ci: any, idx: number) => ({
      name: ci.name || "",
      ordinal: ci.ordinal ?? idx,
      expression: Array.isArray(ci.expression) ? ci.expression.join("\n") : (ci.expression || ""),
      formatStringExpression: Array.isArray(ci.formatStringDefinition) ? ci.formatStringDefinition.join("\n") : (ci.formatStringDefinition || ""),
      description: ci.description || "",
    }));
    items.sort((a, b) => a.ordinal - b.ordinal);
    calcGroups.push({ name: table.name || "", description: joinDesc(table.description), precedence: cg.precedence ?? 0, items });
  }

  const compatibilityLevel = typeof bim.compatibilityLevel === "number" ? bim.compatibilityLevel : null;

  const bm = bim.model || {};
  const modelProperties: ModelProperties = {
    name: typeof bm.name === "string" ? bm.name : "Model",
    description: joinDesc(bm.description),
    culture: typeof bm.culture === "string" ? bm.culture : "",
    sourceQueryCulture: typeof bm.sourceQueryCulture === "string" ? bm.sourceQueryCulture : "",
    discourageImplicitMeasures: bm.discourageImplicitMeasures === true,
    valueFilterBehavior: typeof bm.valueFilterBehavior === "string" ? bm.valueFilterBehavior : "",
    cultures: Array.isArray(bm.cultures)
      ? bm.cultures.map((c: any) => c?.name).filter((n: any) => typeof n === "string").sort()
      : [],
    defaultPowerBIDataSourceVersion: typeof bm.defaultPowerBIDataSourceVersion === "string" ? bm.defaultPowerBIDataSourceVersion : "",
  };

  return { tables, measures, columns, relationships, functions, calcGroups, expressions, compatibilityLevel, modelProperties };
}

function parseBimModel(modelPath: string): RawModel {
  const bimPath = path.join(modelPath, "model.bim");
  if (!fs.existsSync(bimPath)) {
    const defBimPath = path.join(modelPath, "definition", "model.bim");
    if (!fs.existsSync(defBimPath)) throw new Error("No model.bim found");
    return parseBimFile(defBimPath);
  }
  return parseBimFile(bimPath);
}

export function parseModel(modelPath: string): RawModel {
  const tablesDir = path.join(modelPath, "definition", "tables");
  if (fs.existsSync(tablesDir) && fs.readdirSync(tablesDir).some(f => f.endsWith(".tmdl"))) {
    return parseTmdlModel(modelPath);
  }
  return parseBimModel(modelPath);
}
