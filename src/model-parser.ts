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

export interface RawTable {
  name: string;
  description: string;
}

export interface RawModel {
  tables: RawTable[];
  measures: Array<{ name: string; table: string; daxExpression: string; formatString: string; description: string }>;
  columns: Array<{ name: string; table: string; dataType: string; isKey: boolean; isHidden: boolean; isCalculated: boolean; description: string }>;
  relationships: ModelRelationship[];
  functions: ModelFunction[];
  calcGroups: ModelCalcGroup[];
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

function parseTmdlModel(modelPath: string): RawModel {
  const tablesDir = path.join(modelPath, "definition", "tables");
  const tables: RawTable[] = [];
  const measures: RawModel["measures"] = [];
  const columns: RawModel["columns"] = [];
  const calcGroups: ModelCalcGroup[] = [];
  const relationships = parseTmdlRelationships(modelPath);
  const functions = parseTmdlFunctions(modelPath);

  if (!fs.existsSync(tablesDir)) return { tables, measures, columns, relationships, functions, calcGroups };

  for (const file of fs.readdirSync(tablesDir).filter(f => f.endsWith(".tmdl"))) {
    const content = fs.readFileSync(path.join(tablesDir, file), "utf8");
    const lines = content.split("\n");
    let tableName = "";
    let pendingDocComment = "";  // Accumulates /// lines to claim as description of the next table/column/measure
    let currentMeasure: { name: string; table: string; daxExpression: string; formatString: string; description: string } | null = null;
    let currentColumn: { name: string; table: string; dataType: string; isKey: boolean; isHidden: boolean; isCalculated: boolean; description: string } | null = null;
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
        tables.push({ name: tableName, description: pendingDocComment });
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
          currentMeasure = { name, table: tableName, daxExpression: dax, formatString: "", description: pendingDocComment };
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
        currentColumn = { name: colName, table: tableName, dataType: "string", isKey: false, isHidden: false, isCalculated, description: pendingDocComment };
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
        const tmdlProps = ["formatString:", "lineageTag:", "summarizeBy:", "dataType:", "sourceColumn:", "displayFolder:", "description:", "isHidden:", "isKey:", "sortByColumn:", "isNameInferred:", "isDataTypeInferred:"];
        const isProp = tmdlProps.some(p => propLine.startsWith(p));

        if (isProp) {
          // Flush expression before reading properties
          if (currentMeasure && collectingExpression && expressionLines.length > 0) {
            currentMeasure.daxExpression = expressionLines.join("\n").trim();
            collectingExpression = false;
            expressionLines = [];
          }

          if (propLine.startsWith("formatString:") && currentMeasure) {
            currentMeasure.formatString = propLine.replace("formatString:", "").trim();
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
          if (propLine.startsWith("description:")) {
            const desc = propLine.replace("description:", "").trim().replace(/^['"]|['"]$/g, "");
            if (currentMeasure && !currentMeasure.description) currentMeasure.description = desc;
            else if (currentColumn && !currentColumn.description) currentColumn.description = desc;
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

  return { tables, measures, columns, relationships, functions, calcGroups };
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
    tables.push({ name: tableName, description: joinDesc(table.description) });
    for (const m of table.measures || []) {
      measures.push({
        name: m.name,
        table: tableName,
        daxExpression: Array.isArray(m.expression) ? m.expression.join("\n") : (m.expression || ""),
        formatString: m.formatString || "",
        description: joinDesc(m.description),
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
  for (const expr of bim.model?.expressions || []) {
    if (expr.kind === "m") continue; // skip M parameters
    const exprText = Array.isArray(expr.expression) ? expr.expression.join("\n") : (expr.expression || "");
    const paramMatch = exprText.match(/^\(\s*(.*?)\s*\)\s*=>/s);
    functions.push({
      name: expr.name || "",
      parameters: paramMatch ? paramMatch[1].replace(/\s+/g, " ").trim() : "",
      expression: paramMatch ? exprText.replace(/^\(.*?\)\s*=>\s*/s, "").trim() : exprText.trim(),
      description: expr.description || "",
    });
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

  return { tables, measures, columns, relationships, functions, calcGroups };
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
