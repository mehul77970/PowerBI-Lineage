import { findSemanticModelPath, parseModel, ModelRelationship, ModelFunction, ModelCalcGroup } from "./model-parser.js";
import { scanReportBindings } from "./report-scanner.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface BindingRef {
  pageId: string;
  pageName: string;
  visualId: string;
  visualType: string;
  visualTitle: string;
  bindingRole: string;
}

export interface ModelMeasure {
  name: string;
  table: string;
  daxExpression: string;
  formatString: string;
  description: string;
  daxDependencies: string[];
  dependedOnBy: string[];
  usedIn: BindingRef[];
  usageCount: number;
  pageCount: number;
  status: "direct" | "indirect" | "unused";
}

export interface ModelColumn {
  name: string;
  table: string;
  dataType: string;
  description: string;
  isSlicerField: boolean;
  isKey: boolean;
  isHidden: boolean;
  isCalculated: boolean;
  usedIn: BindingRef[];
  usageCount: number;
  pageCount: number;
  status: "direct" | "indirect" | "unused";
}

export interface TableColumnData {
  name: string;
  dataType: string;
  description: string;
  isKey: boolean;
  isInferredPK: boolean;
  isHidden: boolean;
  isCalculated: boolean;
  isFK: boolean;
  fkTarget?: { table: string; column: string };
  incomingRefs: Array<{ table: string; column: string; isActive: boolean }>;
  usageCount: number;
  status: "direct" | "indirect" | "unused";
}

export interface TableRelationshipRef {
  direction: "outgoing" | "incoming";
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  isActive: boolean;
}

export interface TableData {
  name: string;
  description: string;
  isCalcGroup: boolean;
  columnCount: number;
  measureCount: number;
  keyCount: number;
  fkCount: number;
  hiddenColumnCount: number;
  columns: TableColumnData[];
  measures: Array<{ name: string; status: string; usageCount: number }>;
  relationships: TableRelationshipRef[];
}

export interface PageData {
  name: string;
  visualCount: number;
  measures: string[];
  columns: string[];
  measureCount: number;
  columnCount: number;
  slicerCount: number;
  typeCounts: Record<string, number>;
  coverage: number;
  visuals: Array<{ type: string; title: string; bindings: Array<{ fieldName: string; fieldTable: string; fieldType: string }> }>;
}

export interface FullData {
  measures: ModelMeasure[];
  columns: ModelColumn[];
  relationships: ModelRelationship[];
  functions: ModelFunction[];
  calcGroups: ModelCalcGroup[];
  tables: TableData[];
  pages: PageData[];
  hiddenPages: string[];
  totals: {
    measuresInModel: number;
    measuresDirect: number;
    measuresIndirect: number;
    measuresUnused: number;
    columnsInModel: number;
    columnsDirect: number;
    columnsIndirect: number;
    columnsUnused: number;
    relationships: number;
    functions: number;
    calcGroups: number;
    tables: number;
    pages: number;
    visuals: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAX dependency parsing
// ═══════════════════════════════════════════════════════════════════════════════

function parseDaxDependencies(daxExpression: string, allMeasureNames: string[]): string[] {
  const deps = new Set<string>();
  for (const name of allMeasureNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\[${escaped}\\]`, "gi").test(daxExpression)) {
      deps.add(name);
    }
  }
  return [...deps];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-Reference + Build Full Data
// ═══════════════════════════════════════════════════════════════════════════════

export function buildFullData(reportPath: string): FullData {
  const modelPath = findSemanticModelPath(reportPath);
  const rawModel = parseModel(modelPath);
  const allMeasureNames = rawModel.measures.map(m => m.name);
  const { bindings, pageCount, visualCount, hiddenPages } = scanReportBindings(reportPath);

  // Build measures
  const measures: ModelMeasure[] = rawModel.measures.map(m => {
    const deps = parseDaxDependencies(m.daxExpression, allMeasureNames.filter(n => n !== m.name));
    const usedIn = bindings
      .filter(b => b.fieldType === "measure" && b.fieldName === m.name && b.tableName === m.table)
      .map(b => ({ pageId: b.pageId, pageName: b.pageName, visualId: b.visualId, visualType: b.visualType, visualTitle: b.visualTitle, bindingRole: b.bindingRole }));

    // Deduplicate by visual (same measure can appear in same visual via autoFilter)
    const uniqueVisuals = new Map<string, BindingRef>();
    for (const u of usedIn) {
      const key = `${u.pageId}|${u.visualId}`;
      const existing = uniqueVisuals.get(key);
      // Prefer non-Filter binding role
      if (!existing || (existing.bindingRole === "Filter" && u.bindingRole !== "Filter")) uniqueVisuals.set(key, u);
    }
    const dedupedUsedIn = [...uniqueVisuals.values()];

    return {
      name: m.name,
      table: m.table,
      daxExpression: m.daxExpression,
      formatString: m.formatString,
      description: m.description,
      daxDependencies: deps,
      dependedOnBy: [], // filled below
      usedIn: dedupedUsedIn,
      usageCount: dedupedUsedIn.length,
      pageCount: new Set(dedupedUsedIn.map(u => u.pageName)).size,
      status: "unused", // classified below
    };
  });

  // Build columns
  const SLICER_TYPES = new Set(["slicer", "listSlicer", "textSlicer", "advancedSlicerVisual"]);
  const columns: ModelColumn[] = rawModel.columns.map(c => {
    const usedIn = bindings
      .filter(b => (b.fieldType === "column" || b.fieldType === "aggregation") && b.fieldName === c.name && b.tableName === c.table)
      .map(b => ({ pageId: b.pageId, pageName: b.pageName, visualId: b.visualId, visualType: b.visualType, visualTitle: b.visualTitle, bindingRole: b.bindingRole }));

    const uniqueVisuals = new Map<string, BindingRef>();
    for (const u of usedIn) {
      const key = `${u.pageId}|${u.visualId}`;
      const existing = uniqueVisuals.get(key);
      if (!existing || (existing.bindingRole === "Filter" && u.bindingRole !== "Filter")) uniqueVisuals.set(key, u);
    }
    const dedupedUsedIn = [...uniqueVisuals.values()];

    return {
      name: c.name,
      table: c.table,
      dataType: c.dataType,
      description: c.description,
      isSlicerField: dedupedUsedIn.some(u => SLICER_TYPES.has(u.visualType)),
      isKey: c.isKey,
      isHidden: c.isHidden,
      isCalculated: c.isCalculated,
      usedIn: dedupedUsedIn,
      usageCount: dedupedUsedIn.length,
      pageCount: new Set(dedupedUsedIn.map(u => u.pageName)).size,
      status: "unused", // classified below
    };
  });

  // Reverse dependencies
  for (const m of measures) {
    m.dependedOnBy = measures.filter(x => x.daxDependencies.includes(m.name)).map(x => x.name);
  }

  // ── Classify measures: direct → indirect → unused ──
  // Direct: bound to a visual
  for (const m of measures) {
    if (m.usageCount > 0) m.status = "direct";
  }
  // Indirect: referenced (transitively) by any direct measure
  const measureMap = new Map(measures.map(m => [m.name, m]));
  const markIndirect = (name: string, visited: Set<string>) => {
    if (visited.has(name)) return;
    visited.add(name);
    const m = measureMap.get(name);
    if (!m) return;
    for (const dep of m.daxDependencies) {
      const dm = measureMap.get(dep);
      if (dm && dm.status === "unused") dm.status = "indirect";
      markIndirect(dep, visited);
    }
  };
  for (const m of measures) {
    if (m.status === "direct" || m.status === "indirect") {
      markIndirect(m.name, new Set());
    }
  }

  // ── Classify columns: direct → indirect → unused ──
  // Direct: bound to a visual
  for (const c of columns) {
    if (c.usageCount > 0) { c.status = "direct"; continue; }
  }
  // Indirect: referenced in any measure's DAX or used in a relationship
  const relationshipColumns = new Set<string>();
  for (const r of rawModel.relationships) {
    relationshipColumns.add(`${r.fromTable}|${r.fromColumn}`);
    relationshipColumns.add(`${r.toTable}|${r.toColumn}`);
  }
  // Build set of columns referenced in DAX
  const daxReferencedColumns = new Set<string>();
  for (const m of measures) {
    if (m.status === "unused") continue; // only check direct/indirect measures
    for (const c of columns) {
      if (daxReferencedColumns.has(`${c.table}|${c.name}`)) continue;
      const qualifiedRef = `${c.table}[${c.name}]`;
      const shortRef = `[${c.name}]`;
      if (m.daxExpression.includes(qualifiedRef) || m.daxExpression.includes(shortRef)) {
        daxReferencedColumns.add(`${c.table}|${c.name}`);
      }
    }
  }
  for (const c of columns) {
    if (c.status !== "unused") continue;
    const key = `${c.table}|${c.name}`;
    if (relationshipColumns.has(key) || daxReferencedColumns.has(key)) {
      c.status = "indirect";
    }
  }

  // Build page data
  const pageMap = new Map<string, { name: string; visuals: Map<string, { type: string; title: string; bindings: Array<{ fieldName: string; fieldTable: string; fieldType: string }> }>; measures: Set<string>; columns: Set<string> }>();

  const addToPage = (pageName: string, visualType: string, visualTitle: string, fieldName: string, fieldTable: string, fieldType: string) => {
    if (!pageMap.has(pageName)) pageMap.set(pageName, { name: pageName, visuals: new Map(), measures: new Set(), columns: new Set() });
    const p = pageMap.get(pageName)!;
    const vKey = visualTitle || visualType;
    if (!p.visuals.has(vKey)) p.visuals.set(vKey, { type: visualType, title: vKey, bindings: [] });
    const vBindings = p.visuals.get(vKey)!.bindings;
    if (!vBindings.some(b => b.fieldName === fieldName && b.fieldTable === fieldTable)) {
      vBindings.push({ fieldName, fieldTable, fieldType });
    }
    if (fieldType === "measure") p.measures.add(fieldName);
    else p.columns.add(fieldName);
  };

  measures.forEach(m => m.usedIn.forEach(u => addToPage(u.pageName, u.visualType, u.visualTitle, m.name, m.table, "measure")));
  columns.forEach(c => c.usedIn.forEach(u => addToPage(u.pageName, u.visualType, u.visualTitle, c.name, c.table, "column")));

  // Build table data — aggregate columns + measures + relationships per table
  const calcGroupNames = new Set(rawModel.calcGroups.map(cg => cg.name));
  const tableNames = new Set<string>();
  rawModel.columns.forEach(c => tableNames.add(c.table));
  rawModel.measures.forEach(m => tableNames.add(m.table));
  // Ensure calc group tables appear even if they have no non-system columns
  calcGroupNames.forEach(n => tableNames.add(n));

  // Build a quick lookup of raw-table descriptions so TableData can carry them through.
  const tableDescByName = new Map<string, string>();
  for (const rt of rawModel.tables) tableDescByName.set(rt.name, rt.description || "");
  // Calc groups also expose descriptions on their own entity.
  for (const cg of rawModel.calcGroups) {
    if (cg.description && !tableDescByName.get(cg.name)) tableDescByName.set(cg.name, cg.description);
  }

  const tables: TableData[] = [...tableNames].sort((a, b) => a.localeCompare(b)).map(tableName => {
    // Outgoing: this table's column is the `fromColumn` (FK pointing to another table)
    // Incoming: this table's column is the `toColumn` (PK referenced by another table's FK)
    const outgoingRels = rawModel.relationships.filter(r => r.fromTable === tableName);
    const incomingRels = rawModel.relationships.filter(r => r.toTable === tableName);
    const fkByColumn = new Map<string, { table: string; column: string }>();
    outgoingRels.forEach(r => fkByColumn.set(r.fromColumn, { table: r.toTable, column: r.toColumn }));
    const incomingByColumn = new Map<string, Array<{ table: string; column: string; isActive: boolean }>>();
    incomingRels.forEach(r => {
      const list = incomingByColumn.get(r.toColumn) || [];
      list.push({ table: r.fromTable, column: r.fromColumn, isActive: r.isActive });
      incomingByColumn.set(r.toColumn, list);
    });

    // Pull matching ModelColumn entries for this table (skip calc group implicit Name column)
    const tableColumns: TableColumnData[] = columns
      .filter(c => c.table === tableName)
      .filter(c => !(calcGroupNames.has(tableName) && c.name === "Name"))
      .map(c => {
        const fkTarget = fkByColumn.get(c.name);
        const incomingRefs = incomingByColumn.get(c.name) || [];
        return {
          name: c.name,
          dataType: c.dataType || "string",
          description: c.description || "",
          isKey: c.isKey,
          isInferredPK: incomingRefs.length > 0,
          isHidden: c.isHidden,
          isCalculated: c.isCalculated,
          isFK: !!fkTarget,
          fkTarget,
          incomingRefs,
          usageCount: c.usageCount,
          status: c.status,
        };
      })
      .sort((a, b) => {
        // PK (explicit or inferred) first, then FK, then the rest alphabetical
        const aPK = a.isKey || a.isInferredPK;
        const bPK = b.isKey || b.isInferredPK;
        if (aPK !== bPK) return aPK ? -1 : 1;
        if (a.isFK !== b.isFK) return a.isFK ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const tableMeasures = measures
      .filter(m => m.table === tableName)
      .map(m => ({ name: m.name, status: m.status, usageCount: m.usageCount }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const tableRels: TableRelationshipRef[] = [
      ...outgoingRels.map(r => ({ direction: "outgoing" as const, fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn, isActive: r.isActive })),
      ...incomingRels.map(r => ({ direction: "incoming" as const, fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable, toColumn: r.toColumn, isActive: r.isActive })),
    ];

    return {
      name: tableName,
      description: tableDescByName.get(tableName) || "",
      isCalcGroup: calcGroupNames.has(tableName),
      columnCount: tableColumns.length,
      measureCount: tableMeasures.length,
      keyCount: tableColumns.filter(c => c.isKey || c.isInferredPK).length,
      fkCount: tableColumns.filter(c => c.isFK).length,
      hiddenColumnCount: tableColumns.filter(c => c.isHidden).length,
      columns: tableColumns,
      measures: tableMeasures,
      relationships: tableRels,
    };
  });

  const pages: PageData[] = [...pageMap.values()].map(p => {
    const visuals = [...p.visuals.values()];
    const typeCounts: Record<string, number> = {};
    visuals.forEach(v => { typeCounts[v.type] = (typeCounts[v.type] || 0) + 1; });
    return {
      name: p.name,
      visualCount: visuals.length,
      measures: [...p.measures],
      columns: [...p.columns],
      measureCount: p.measures.size,
      columnCount: p.columns.size,
      slicerCount: typeCounts["slicer"] || 0,
      typeCounts,
      coverage: rawModel.measures.length > 0 ? Math.round(p.measures.size / rawModel.measures.length * 100) : 0,
      visuals,
    };
  });

  return {
    measures,
    columns,
    relationships: rawModel.relationships,
    functions: rawModel.functions,
    calcGroups: rawModel.calcGroups,
    tables,
    pages,
    hiddenPages,
    totals: {
      measuresInModel: measures.length,
      measuresDirect: measures.filter(m => m.status === "direct").length,
      measuresIndirect: measures.filter(m => m.status === "indirect").length,
      measuresUnused: measures.filter(m => m.status === "unused").length,
      columnsInModel: columns.length,
      columnsDirect: columns.filter(c => c.status === "direct").length,
      columnsIndirect: columns.filter(c => c.status === "indirect").length,
      columnsUnused: columns.filter(c => c.status === "unused").length,
      relationships: rawModel.relationships.length,
      functions: rawModel.functions.length,
      calcGroups: rawModel.calcGroups.length,
      tables: tables.length,
      pages: pageCount,
      visuals: visualCount,
    },
  };
}
