import type { FullData, TableData, ModelMeasure } from "./data-builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Semantic-Model Technical Specification — Markdown
//
// Two documents are produced:
//   generateMarkdown       → Technical specification (front matter → data dictionary → ...)
//   generateMeasuresMd     → Measures reference: A–Z grouped, each measure collapsible
//
// DAX expressions are intentionally omitted from both.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Render a measure/column status as a coloured <span> badge that the dashboard
 * MD renderer will style as a pill. In raw MD viewers the span degrades to
 * plain text, so the doc stays readable in external tools too.
 */
function statusLabel(s: "direct" | "indirect" | "unused" | string): string {
  if (s === "direct")   return '<span class="badge badge--success">Direct</span>';
  if (s === "indirect") return '<span class="badge badge--indirect">Indirect</span>';
  if (s === "unused")   return '<span class="badge badge--unused">Unused</span>';
  return String(s);
}

/** Key / column-annotation badges used in the Data Dictionary and Quality notes. */
const BADGE_PK     = '<span class="badge badge--pk">PK</span>';
const BADGE_PK_INF = '<span class="badge badge--pk-inf">PK*</span>';
const BADGE_FK     = '<span class="badge badge--fk">FK</span>';
const BADGE_CALC   = '<span class="badge badge--calc">CALC</span>';
const BADGE_HIDDEN = '<span class="badge badge--hidden">HIDDEN</span>';

/** GitHub-compatible slug for in-document anchor links. */
function slug(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Bucket letter used for A–Z grouping. Non-letter starts go to "#". */
function bucketLetter(name: string): string {
  const ch = (name.trim().charAt(0) || "").toUpperCase();
  return ch >= "A" && ch <= "Z" ? ch : "#";
}

type TableRole = "Fact" | "Dimension" | "Bridge" | "Disconnected" | "Calculation Group" | "Auto-date";

/**
 * Infer a table's role. Auto-date infrastructure tables (origin=auto-date)
 * short-circuit to the "Auto-date" label regardless of their relationship
 * topology — Power BI wires every LocalDateTable_<guid> into its date
 * column via a relationship, which would otherwise misclassify them as
 * "Dimension" and flood the user-table counts.
 */
function classifyTable(t: TableData): TableRole {
  if (t.origin === "auto-date") return "Auto-date";
  if (t.isCalcGroup) return "Calculation Group";
  const out = t.relationships.filter(r => r.direction === "outgoing").length;
  const inc = t.relationships.filter(r => r.direction === "incoming").length;
  if (out > 0 && inc === 0) return "Fact";
  if (out === 0 && inc > 0) return "Dimension";
  if (out > 0 && inc > 0) return "Bridge";
  return "Disconnected";
}

/** True for Power-BI-generated `LocalDateTable_<guid>` / `DateTableTemplate_<guid>` infrastructure. */
function isAutoDate(t: TableData): boolean { return t.origin === "auto-date"; }

/** User-authored tables only — the default audience for the MD exports. Hides
 *  auto-date infrastructure so counts, lists, and navs don't drown in noise
 *  on composite models (H&S has 10 auto-date tables out of 53 total).
 *  Sections that need every table (header summary, infrastructure appendix)
 *  read `data.tables` directly. */
function userTables(data: FullData): TableData[] {
  return (data.tables || []).filter(t => !isAutoDate(t));
}

/** Badge + inline label for an EXTERNALMEASURE proxy measure. Composite
 *  models re-expose measures from a remote AS cube via this DAX call; the
 *  local measure is a structural pointer, not a computation. Removing one
 *  breaks the composite contract, so every list that shows "unused" or
 *  "safe to remove" must distinguish them. */
const BADGE_PROXY = '<span class="badge badge--calc">EXTERNAL</span>';

/** Inline descriptor rendered next to a proxy measure's name. Includes the
 *  remote model and (when the remote name differs from the local one) the
 *  original measure name. Degrades gracefully in raw-MD viewers. */
function proxyTag(m: ModelMeasure): string {
  const p = m.externalProxy;
  if (!p) return "";
  const remote = p.remoteName && p.remoteName !== m.name ? ` · remote name \`${esc(p.remoteName)}\`` : "";
  return ` ${BADGE_PROXY} <small>→ ${esc(p.externalModel)}${remote}</small>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateMarkdown — Technical specification for the semantic model
// ═══════════════════════════════════════════════════════════════════════════════

export function generateMarkdown(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const hiddenSet = new Set(data.hiddenPages || []);
  const lines: string[] = [];

  const tables = [...data.tables].sort((a, b) => a.name.localeCompare(b.name));
  // User tables exclude `LocalDateTable_<guid>` and `DateTableTemplate_<guid>`
  // auto-date infrastructure. Every user-facing section counts, lists, and
  // navigates on `userTablesSorted`; the full list is kept for an
  // infrastructure appendix.
  const userTablesSorted = tables.filter(t => !isAutoDate(t));
  const autoDateTables = tables.filter(isAutoDate);
  const pages = [...data.pages].sort((a, b) => a.name.localeCompare(b.name));
  const functions = data.functions.filter(f => !f.name.endsWith(".About"));
  const calcGroups = data.calcGroups;
  const rolesByTable = new Map<string, TableRole>();
  for (const t of tables) rolesByTable.set(t.name, classifyTable(t));
  const roleCounts: Record<TableRole, number> = {
    "Fact": 0, "Dimension": 0, "Bridge": 0, "Disconnected": 0, "Calculation Group": 0, "Auto-date": 0,
  };
  // Only user tables contribute to the role counts in the Schema summary —
  // auto-date tables would otherwise inflate the "Dimension" bucket (PB
  // wires every LocalDateTable to its date column via a relationship).
  for (const t of userTablesSorted) roleCounts[rolesByTable.get(t.name)!]++;
  roleCounts["Auto-date"] = autoDateTables.length;
  const activeRelCount = data.relationships.filter(r => r.isActive).length;
  const inactiveRelCount = data.relationships.length - activeRelCount;
  const isStar = roleCounts.Bridge === 0 && roleCounts.Disconnected === 0 && roleCounts.Fact > 0;

  const mp = data.modelProperties;
  const culturesLabel = mp.cultures.length > 0
    ? mp.cultures.join(", ")
    : (mp.culture || "_unknown_");
  const implicitLabel = mp.discourageImplicitMeasures ? "Discouraged" : "Allowed";
  const valueFilterLabel = mp.valueFilterBehavior || "Automatic (default)";

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Semantic Model Technical Specification`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  if (mp.description) {
    // Render the model-level description as a leading blockquote so it sits
    // between the title and the metadata table.
    lines.push(`> ${mp.description.replace(/\n/g, " ")}`);
    lines.push("");
  }
  lines.push("| | |");
  lines.push("|---|---|");
  // UDF count excludes the `.About` shim entries Tabular Editor emits.
  const udfCount = functions.length;
  // Calc-group count plus the total number of items across all groups.
  const cgItemCount = calcGroups.reduce((acc, cg) => acc + cg.items.length, 0);

  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Compatibility level** | ${data.compatibilityLevel != null ? data.compatibilityLevel : "_unknown_"} |`);
  lines.push(`| **Cultures** | ${esc(culturesLabel)} |`);
  lines.push(`| **Implicit measures** | ${implicitLabel} |`);
  lines.push(`| **Value filter behavior** | ${esc(valueFilterLabel)} |`);
  // User tables only in the headline count; auto-date infrastructure
  // is noted separately so "53 tables" doesn't suggest 53 things the
  // modeller owns.
  const userTableCount = userTablesSorted.length;
  const userColumnCount = userTablesSorted.reduce((a, t) => a + t.columnCount, 0);
  const autoDateDisplay = autoDateTables.length > 0
    ? ` (+${autoDateTables.length} auto-date infrastructure, excluded)`
    : "";
  lines.push(`| **Model entities** | ${userTableCount} tables · ${userColumnCount} columns · ${data.totals.measuresInModel} measures · ${data.totals.relationships} relationships${autoDateDisplay} |`);
  lines.push(`| **User-defined functions** | ${udfCount} |`);
  lines.push(`| **Calculation groups** | ${calcGroups.length}${calcGroups.length > 0 ? ` (${cgItemCount} item${cgItemCount === 1 ? "" : "s"})` : ""} |`);
  lines.push(`| **Report surface** | ${data.totals.pages} pages · ${data.totals.visuals} visuals |`);
  lines.push(`| **Scope** | Schema, relationships, usage classification. DAX expressions omitted. |`);
  lines.push(`| **Companion documents** | Data Dictionary Reference · Measures Reference · Functions Reference · Calculation Groups Reference · Data Quality Review |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Document contents ─────────────────────────────────────────────────────
  lines.push("## Document Contents");
  lines.push("");
  lines.push("1. [Introduction](#1-introduction)");
  lines.push("    - 1.1 [Purpose](#11-purpose)");
  lines.push("    - 1.2 [Conventions](#12-conventions)");
  lines.push("    - 1.3 [Terminology](#13-terminology)");
  lines.push("2. [Model Architecture](#2-model-architecture)");
  lines.push("    - 2.1 [Schema summary](#21-schema-summary)");
  lines.push("    - 2.2 [Tables by role](#22-tables-by-role)");
  lines.push("    - 2.3 [Relationship inventory](#23-relationship-inventory)");
  lines.push("3. [Data Sources](#3-data-sources)");
  lines.push("    - 3.1 [Storage modes](#31-storage-modes)");
  lines.push("    - 3.2 [Parameters and expressions](#32-parameters-and-expressions)");
  lines.push("    - 3.3 [Per-table sources](#33-per-table-sources)");
  lines.push("4. [Data Dictionary — Summary](#4-data-dictionary--summary)  _(full inventory: Data Dictionary Reference)_");
  lines.push("5. [Measures — Summary](#5-measures--summary)");
  lines.push("6. [Calculation Groups](#6-calculation-groups)");
  lines.push("7. [User-Defined Functions](#7-user-defined-functions)");
  lines.push("8. [Report Pages](#8-report-pages)");
  lines.push("");
  lines.push("Appendix A — [Generation metadata](#appendix-a--generation-metadata)");
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 1. Introduction ───────────────────────────────────────────────────────
  lines.push("## 1. Introduction");
  lines.push("");

  lines.push("### 1.1 Purpose");
  lines.push("");
  lines.push(`This document is a reference specification of the **${reportName}** semantic model. ` +
    `It describes the entities the model exposes, how those entities are related, and how each ` +
    `measure and column is consumed by the accompanying Power BI report. It is intended for data ` +
    `engineers, report developers, and analysts who need to understand, review, or modify the model.`);
  lines.push("");
  lines.push(`The document is generated automatically from the ${"`"}.Report${"`"} and ${"`"}.SemanticModel${"`"} folders. ` +
    `It reflects the current state of those folders at generation time.`);
  lines.push("");

  lines.push("### 1.2 Conventions");
  lines.push("");
  lines.push("- Table **roles** are inferred from relationship topology:");
  lines.push("    - **Fact** — at least one outgoing foreign key and no incoming references.");
  lines.push("    - **Dimension** — referenced by at least one other table and has no outgoing foreign keys.");
  lines.push("    - **Bridge** — both outgoing and incoming relationships (many-to-many or role-playing).");
  lines.push("    - **Disconnected** — no relationships.");
  lines.push("    - **Calculation Group** — exposes a calculation-group object.");
  lines.push("- **Key annotations** on columns:");
  lines.push("    - **PK** — primary key set explicitly on the column.");
  lines.push("    - **PK\\*** — inferred primary key (column is the target of at least one relationship).");
  lines.push("    - **FK** — foreign key (column is the source of at least one relationship).");
  lines.push("- **Status** classification for measures and columns:");
  lines.push("    - **Direct** — bound to at least one visual, filter, or conditional-formatting expression.");
  lines.push("    - **Indirect** — not bound to a visual, but referenced by a Direct measure via DAX, or (for columns) used in a relationship.");
  lines.push("    - **Unused** — not referenced anywhere in the model or the report.");
  lines.push("- DAX expressions are omitted by design. See the companion **Measures Reference** for per-measure descriptions and dependency graphs.");
  lines.push("");

  lines.push("### 1.3 Terminology");
  lines.push("");
  lines.push("| Term | Meaning |");
  lines.push("|------|---------|");
  lines.push("| Semantic model | The tabular model exposed to Power BI — tables, columns, measures, relationships. |");
  lines.push("| Relationship | An active or inactive link between two columns that defines filter propagation. |");
  lines.push("| Calculation group | A Tabular feature that rewrites measure expressions based on a selected calc-group item. |");
  lines.push("| User-defined function | A reusable DAX function declared in the model (Tabular 1702+). Counted excluding the `.About` shim entries Tabular Editor sometimes emits. |");
  lines.push("| Compatibility level | Tabular engine capability marker (e.g. 1500, 1567, 1702). Higher levels enable newer features such as user-defined functions, INFO functions, and value-filter behaviours. |");
  lines.push("| Culture | Locale used for sorting, formatting, and translations. Each culture has its own file under `definition/cultures/`. |");
  lines.push("| Implicit measures | Power BI's auto-aggregation behaviour. When **discouraged**, dragging a numeric column directly to a visual will not implicitly create a SUM/COUNT — modellers must define explicit measures. |");
  lines.push("| Value filter behavior | How DAX value filters interact with strong-relationship cardinality (Automatic / Independent / Coalesce). Affects measure totals when many-to-many relationships are present. |");
  lines.push("| Visual binding | A field placed on a visual (data well), in a filter, or referenced by a conditional-formatting expression. |");
  lines.push("| Slicer field | A column bound to a slicer visual, making it interactively filterable by the user. |");
  lines.push("| Display folder | A modeller-defined grouping label that organises measures or columns under a named folder in the field list. |");
  lines.push("| Storage mode | How a table's data is loaded: **Import** (data copied into the model), **DirectQuery** (queried live), or **Dual** (both). |");
  lines.push("| Partition | A unit of storage backing a table — most tables have one. Each partition has its own source query (M code). |");
  lines.push("");

  lines.push("---");
  lines.push("");

  // ── 2. Model Architecture ─────────────────────────────────────────────────
  lines.push("## 2. Model Architecture");
  lines.push("");

  lines.push("### 2.1 Schema summary");
  lines.push("");
  lines.push(`- **${userTablesSorted.length}** user tables: ` +
    `${roleCounts.Fact} fact · ${roleCounts.Dimension} dimension · ` +
    `${roleCounts.Bridge} bridge · ${roleCounts["Calculation Group"]} calc group · ` +
    `${roleCounts.Disconnected} disconnected.`);
  if (autoDateTables.length > 0) {
    lines.push(`- **${autoDateTables.length}** Power BI auto-date infrastructure tables (\`LocalDateTable_<guid>\` / \`DateTableTemplate_<guid>\`) — excluded from role counts above. Disable Auto Date/Time in report settings to remove them.`);
  }
  lines.push(`- **${data.relationships.length}** relationships (${activeRelCount} active, ${inactiveRelCount} inactive).`);
  lines.push(`- **${userColumnCount}** user columns, **${data.totals.measuresInModel}** measures, **${data.totals.functions}** user-defined functions, **${data.totals.calcGroups}** calculation groups.`);
  lines.push(`- Topology: ${isStar ? "**star schema**" : "**not a pure star schema** (bridge or disconnected tables present)"}.`);
  lines.push("");

  lines.push("### 2.2 Tables by role");
  lines.push("");
  lines.push("| Table | Role | Columns | Measures | Keys | FKs | Hidden cols |");
  lines.push("|-------|------|--------:|---------:|-----:|----:|-----------:|");
  for (const t of userTablesSorted) {
    const role = rolesByTable.get(t.name) || "Disconnected";
    lines.push(`| [${t.name}](#${slug(t.name)}) | ${role} | ${t.columnCount} | ${t.measureCount} | ${t.keyCount} | ${t.fkCount} | ${t.hiddenColumnCount} |`);
  }
  lines.push("");
  if (autoDateTables.length > 0) {
    lines.push(`<details><summary>Auto-date infrastructure (${autoDateTables.length} tables) — not user content, collapsed</summary>`);
    lines.push("");
    lines.push("| Table | Columns |");
    lines.push("|-------|--------:|");
    for (const t of autoDateTables) {
      lines.push(`| ${esc(t.name)} | ${t.columnCount} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push("### 2.3 Relationship inventory");
  lines.push("");
  if (data.relationships.length === 0) {
    lines.push("_No relationships defined in this model._");
  } else {
    lines.push("| # | From (many) | To (one) | Active |");
    lines.push("|--:|-------------|----------|:------:|");
    data.relationships.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${esc(r.fromTable)}[${esc(r.fromColumn)}] | ${esc(r.toTable)}[${esc(r.toColumn)}] | ${r.isActive ? "✓" : "—"} |`);
    });
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 3. Data Sources ───────────────────────────────────────────────────────
  // Storage-mode summary, top-level expressions / parameters, and per-table
  // datasource inventory (mode + inferred type + best-effort location).
  lines.push("## 3. Data Sources");
  lines.push("");
  lines.push("Where the model gets its data from. Source type is inferred from the M code; location is the first string literal found and may be a file path, server, or URL.");
  lines.push("");

  lines.push("### 3.1 Storage modes");
  lines.push("");
  // Aggregate distinct partition modes across all tables.
  const modeCounts = new Map<string, number>();
  let tablesWithSource = 0;
  for (const t of tables) {
    if (t.partitions.length === 0) continue;
    tablesWithSource++;
    for (const p of t.partitions) {
      const m = (p.mode || "import").toLowerCase();
      modeCounts.set(m, (modeCounts.get(m) || 0) + 1);
    }
  }
  if (modeCounts.size === 0) {
    lines.push("_No partition information found._");
    lines.push("");
  } else {
    const parts: string[] = [];
    [...modeCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([m, c]) => parts.push(`**${c}** ${m}`));
    lines.push(`${tablesWithSource} table${tablesWithSource === 1 ? "" : "s"} with sources — ${parts.join(", ")}.`);
    lines.push("");
  }

  lines.push("### 3.2 Parameters and expressions");
  lines.push("");
  if (data.expressions.length === 0) {
    lines.push("_No top-level parameters or M expressions._");
    lines.push("");
  } else {
    lines.push("Model-level M expressions defined in `expressions.tmdl`. Parameters are referenced by other queries via their name; `DirectQuery to AS - …` expressions back composite-model entity partitions pointing at a remote Analysis Services cube.");
    lines.push("");
    // Recognised AS.Database(...) expressions get a structured row
    // (cluster + database extracted from the first two args); everything
    // else uses the generic truncated-value form.
    const asRx = /AnalysisServices\.Database\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"/i;
    lines.push("| Name | Kind | Value | Description |");
    lines.push("|------|------|-------|-------------|");
    for (const e of data.expressions) {
      const kind = e.kind === "parameter" ? "Parameter" : "M expression";
      const as = e.value?.match(asRx);
      let valCell: string;
      if (as) {
        // Split so the cluster URL and database name survive the 80-char
        // truncation that was eating the second argument.
        valCell = `**AnalysisServices.Database** · cluster \`${esc(as[1])}\` · database \`${esc(as[2])}\``;
      } else {
        let val = e.value || "";
        if (val.length > 80) val = val.substring(0, 77) + "…";
        valCell = `\`${esc(val)}\``;
      }
      lines.push(`| ${esc(e.name)} | ${kind} | ${valCell} | ${esc(e.description) || "—"} |`);
    }
    lines.push("");
  }

  lines.push("### 3.3 Per-table sources");
  lines.push("");
  // User tables only — auto-date infrastructure sources are noise.
  const tablesWithPartitions = userTablesSorted.filter(t => t.partitions.length > 0);
  if (tablesWithPartitions.length === 0) {
    lines.push("_No per-table partition information found._");
    lines.push("");
  } else {
    lines.push("| Table | Mode | Source type | Location |");
    lines.push("|-------|------|-------------|----------|");
    for (const t of tablesWithPartitions) {
      // One row per partition. Most tables have exactly one.
      for (const p of t.partitions) {
        const loc = p.sourceLocation ? "`" + esc(p.sourceLocation) + "`" : "—";
        lines.push(`| [${esc(t.name)}](#${slug(t.name)}) | ${esc(p.mode)} | ${esc(p.sourceType)} | ${loc} |`);
      }
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 4. Data Dictionary — summary only ─────────────────────────────────────
  // Full per-table column inventories, constraints, and hierarchies live in
  // the Data Dictionary Reference companion document. The main spec keeps
  // only a summary so it stays scale-invariant on big models.
  lines.push("## 4. Data Dictionary — Summary");
  lines.push("");
  if (tables.length === 0) {
    lines.push("_No tables found._");
    lines.push("");
  } else {
    lines.push(`**${tables.length}** table${tables.length === 1 ? "" : "s"} · **${data.totals.columnsInModel}** columns · **${tables.reduce((a, t) => a + t.hierarchies.length, 0)}** hierarch${tables.reduce((a, t) => a + t.hierarchies.length, 0) === 1 ? "y" : "ies"}. Per-table column inventories, constraints, hierarchies, and format / aggregation / sort / category metadata live in the companion **Data Dictionary Reference**.`);
    lines.push("");
    lines.push("| Table | Role | Columns | Hierarchies | Source | Description |");
    lines.push("|-------|------|--------:|------------:|--------|-------------|");
    tables.forEach(tbl => {
      const role = rolesByTable.get(tbl.name) || "Disconnected";
      const src = tbl.partitions.length > 0
        ? `${esc(tbl.partitions[0].mode)} · ${esc(tbl.partitions[0].sourceType)}`
        : "—";
      // Truncate long descriptions for this summary row.
      let desc = tbl.description ? esc(tbl.description) : "—";
      if (desc.length > 90) desc = desc.substring(0, 87) + "…";
      lines.push(`| ${esc(tbl.name)} | ${role} | ${tbl.columnCount} | ${tbl.hierarchies.length} | ${src} | ${desc} |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 4. Measures — Summary ─────────────────────────────────────────────────
  lines.push("## 5. Measures — Summary");
  lines.push("");
  if (data.measures.length === 0) {
    lines.push("_No measures defined in this model._");
    lines.push("");
  } else {
    const t = data.totals;
    lines.push(`**${t.measuresInModel}** measures total — ${t.measuresDirect} direct, ${t.measuresIndirect} indirect, ${t.measuresUnused} unused. ` +
      `See the companion **Measures Reference** (A–Z, collapsible) for per-measure descriptions, dependencies, and usage.`);
    lines.push("");
    lines.push("| Home table | Total | Direct | Indirect | Unused |");
    lines.push("|------------|------:|-------:|---------:|-------:|");
    const byTable = new Map<string, { total: number; direct: number; indirect: number; unused: number }>();
    for (const m of data.measures) {
      const cur = byTable.get(m.table) || { total: 0, direct: 0, indirect: 0, unused: 0 };
      cur.total++;
      if (m.status === "direct") cur.direct++;
      else if (m.status === "indirect") cur.indirect++;
      else cur.unused++;
      byTable.set(m.table, cur);
    }
    [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, v]) => {
      lines.push(`| ${esc(name)} | ${v.total} | ${v.direct} | ${v.indirect} | ${v.unused} |`);
    });
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 6. Calculation Groups — summary ───────────────────────────────────────
  lines.push("## 6. Calculation Groups — Summary");
  lines.push("");
  if (calcGroups.length === 0) {
    lines.push("_No calculation groups defined in this model._");
    lines.push("");
  } else {
    lines.push(`**${calcGroups.length}** calculation group${calcGroups.length === 1 ? "" : "s"} (${cgItemCount} item${cgItemCount === 1 ? "" : "s"} total). ` +
      `See the companion **Calculation Groups Reference** for per-item descriptions, format-string overrides, and bodies.`);
    lines.push("");
    lines.push("| Group | Items | Precedence |");
    lines.push("|-------|------:|----------:|");
    [...calcGroups].sort((a, b) => a.name.localeCompare(b.name)).forEach(cg => {
      lines.push(`| ${esc(cg.name)} | ${cg.items.length} | ${cg.precedence} |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 7. User-Defined Functions — summary ───────────────────────────────────
  lines.push("## 7. User-Defined Functions — Summary");
  lines.push("");
  if (functions.length === 0) {
    lines.push("_No user-defined DAX functions in this model._");
    lines.push("");
  } else {
    lines.push(`**${functions.length}** user-defined function${functions.length === 1 ? "" : "s"}. ` +
      `See the companion **Functions Reference** for parameters, descriptions, and bodies.`);
    lines.push("");
    lines.push("| Function | Parameters | Description |");
    lines.push("|----------|-----------:|-------------|");
    [...functions].sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
      const paramCount = f.parameters ? f.parameters.split(",").filter(s => s.trim()).length : 0;
      const shortDesc = f.description ? esc(f.description.length > 100 ? f.description.substring(0, 97) + "…" : f.description) : "—";
      lines.push(`| ${esc(f.name)} | ${paramCount} | ${shortDesc} |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 7. Report Pages ───────────────────────────────────────────────────────
  lines.push("## 8. Report Pages");
  lines.push("");
  lines.push(`The semantic model is consumed by the following **${pages.length}** pages in the accompanying report.`);
  lines.push("");
  if (pages.length === 0) {
    lines.push("_No pages analysed._");
    lines.push("");
  } else {
    // Detect duplicate display names so the table can flag them — PBIR
    // allows duplicate visible names since page identity is by pageId,
    // but duplicates usually indicate a copy-paste accident.
    const nameCounts = new Map<string, number>();
    for (const p of pages) {
      const key = p.name.trim();
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    const dupNames = new Set([...nameCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
    lines.push("| # | Page | Visibility | Visuals | Measures | Columns | Slicers | Coverage |");
    lines.push("|--:|------|------------|--------:|---------:|--------:|--------:|---------:|");
    pages.forEach((p, i) => {
      const vis = hiddenSet.has(p.name) ? "Hidden" : "Visible";
      // Trim leading/trailing whitespace and collapse internal doubles —
      // PBIR sometimes persists those from accidental drag-reorders in
      // Desktop. Display only; the data layer still carries the raw name.
      const display = p.name.replace(/\s+/g, " ").trim();
      const dupTag = dupNames.has(display) ? " _(duplicate name)_" : "";
      lines.push(`| ${i + 1} | ${esc(display)}${dupTag} | ${vis} | ${p.visualCount} | ${p.measureCount} | ${p.columnCount} | ${p.slicerCount} | ${p.coverage}% |`);
    });
    lines.push("");
    lines.push("_\"Coverage\" = percentage of all model measures used on this page._");
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // §9 Data Quality Review intentionally lifted out into a separate
  // Quality Review document (generateQualityMd). Keep this main spec
  // strictly technical / structural.

  // ── Appendix ──────────────────────────────────────────────────────────────
  lines.push("## Appendix A — Generation metadata");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Generated at | ${ts} |`);
  lines.push(`| Generator | powerbi-lineage |`);
  lines.push(`| Source format | TMDL or BIM (.SemanticModel) + PBIR (.Report) |`);
  lines.push(`| Report name | ${reportName} |`);
  lines.push("");
  lines.push(`_This document is regenerated on every run; manual edits will be lost. Edit the source model instead._`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateMeasuresMd — Companion measures reference
//   Front matter (same style), conventions pointer, A–Z jump nav, collapsible
//   <details> per measure.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateMeasuresMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];
  const t = data.totals;

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Measures Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  // Proxy measures (EXTERNALMEASURE re-exports from a remote AS cube)
  // are structurally different from local measures — removing them
  // breaks the composite-model contract. Called out in the front-matter
  // so the reader knows what to expect before they start scrolling.
  const proxies = data.measures.filter(m => m.externalProxy !== null);

  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Measures** | ${t.measuresInModel} total · ${t.measuresDirect} direct · ${t.measuresIndirect} indirect · ${t.measuresUnused} unused |`);
  if (proxies.length > 0) {
    const proxiedModels = [...new Set(proxies.map(m => m.externalProxy!.externalModel))];
    lines.push(`| **External proxies** | ${proxies.length} measure${proxies.length === 1 ? "" : "s"} re-exposing ${proxiedModels.length} remote model${proxiedModels.length === 1 ? "" : "s"} via EXTERNALMEASURE |`);
  }
  lines.push(`| **Scope** | Per-measure descriptions, dependencies, usage. DAX expressions omitted. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## How to read this document");
  lines.push("");
  lines.push("- Measures are grouped alphabetically by name. Empty letters are shown struck-through in the jump bar.");
  lines.push("- Each measure is a collapsible block. Click the row to expand / collapse.");
  lines.push("- The summary line shows: **Name** — home table · status marker (only shown when _unused_ or _indirect_).");
  lines.push("- Inside each block:");
  lines.push("    - **Metadata** — home table, format string, status, visual and page usage counts.");
  lines.push("    - **Description** — captured from the model's `///` doc comments or `description:` property.");
  lines.push("    - **Depends on** — other measures referenced by this measure's DAX.");
  lines.push("    - **Used by** — measures that call this one (reverse dependency).");
  if (proxies.length > 0) {
    lines.push('- `EXTERNAL` badge marks an `EXTERNALMEASURE(...)` proxy — a local placeholder that re-exposes a measure from a remote Analysis Services cube via a DirectQuery connection. Proxy measures have `usageCount = 0` by the "bound to a visual" rule, but removing one breaks the composite-model contract with the external cube. Treat them as structural, not as candidates for removal.');
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Proxy summary (composite models only) ────────────────────────────────
  if (proxies.length > 0) {
    const byModel = new Map<string, ModelMeasure[]>();
    for (const m of proxies) {
      const model = m.externalProxy!.externalModel;
      if (!byModel.has(model)) byModel.set(model, []);
      byModel.get(model)!.push(m);
    }
    lines.push("## External proxy measures");
    lines.push("");
    lines.push(`${proxies.length} measure${proxies.length === 1 ? "" : "s"} are \`EXTERNALMEASURE\` proxies re-exposing measures from ${byModel.size} remote Analysis Services model${byModel.size === 1 ? "" : "s"}. Grouped by external model below; each link jumps to the measure's A–Z entry.`);
    lines.push("");
    for (const [model, ms] of [...byModel.entries()].sort()) {
      ms.sort((a, b) => a.name.localeCompare(b.name));
      const sample = ms[0].externalProxy!;
      lines.push(`### \`${esc(model)}\`${sample.cluster ? " &nbsp; <small>" + esc(sample.cluster) + "</small>" : ""}`);
      lines.push("");
      lines.push("| Local name | Remote name | Type | Home table |");
      lines.push("|------------|-------------|------|------------|");
      for (const m of ms) {
        const p = m.externalProxy!;
        const remote = p.remoteName === m.name ? "_same_" : `\`${esc(p.remoteName)}\``;
        lines.push(`| [${esc(m.name)}](#${slug(m.name)}) | ${remote} | ${esc(p.type)} | ${esc(m.table)} |`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  if (data.measures.length === 0) {
    lines.push("_No measures defined in this model._");
    return lines.join("\n");
  }

  // Bucket by first letter A–Z; non-letters into "#".
  const buckets = new Map<string, ModelMeasure[]>();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  for (const L of letters) buckets.set(L, []);
  buckets.set("#", []);
  for (const m of data.measures) buckets.get(bucketLetter(m.name))!.push(m);
  for (const arr of buckets.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  // ── Jump nav ──────────────────────────────────────────────────────────────
  const navItems: string[] = [];
  for (const L of letters) {
    const count = buckets.get(L)!.length;
    if (count > 0) navItems.push(`[${L}](#${L.toLowerCase()})`);
    else navItems.push(`~~${L}~~`);
  }
  if (buckets.get("#")!.length > 0) navItems.push("[#](#other)");
  lines.push("## Jump to");
  lines.push("");
  lines.push(navItems.join(" · "));
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Sections ──────────────────────────────────────────────────────────────
  const renderSection = (heading: string, anchor: string, items: ModelMeasure[]) => {
    lines.push(`## ${heading}`);
    lines.push(`<a id="${anchor}"></a>`);
    lines.push("");
    if (items.length === 0) {
      lines.push(`_No measures starting with ${heading}._`);
      lines.push("");
      lines.push("[↑ Jump to](#jump-to)");
      lines.push("");
      lines.push("---");
      lines.push("");
      return;
    }
    for (const m of items) {
      // Status tag: unused/indirect suffix in the summary line. Proxy
      // measures legitimately carry status=unused (by the "bound to a
      // visual" rule) but displaying them as unused is misleading —
      // suppress the status tag when the measure is a proxy so readers
      // aren't nudged toward removing it.
      const isProxy = m.externalProxy !== null;
      const statusTag =
        isProxy ? " · _external proxy_"
        : m.status === "unused" ? " · _unused_"
        : m.status === "indirect" ? " · _indirect_"
        : "";
      lines.push(`<details>`);
      lines.push(`<a id="${slug(m.name)}"></a>`);
      lines.push(`<summary><strong>${esc(m.name)}</strong>${proxyTag(m)} <small>— ${esc(m.table)}${statusTag}</small></summary>`);
      lines.push("");
      const meta = [
        `**Table:** ${esc(m.table)}`,
        `**Format:** ${esc(m.formatString) || "—"}`,
        `**Status:** ${isProxy ? '<span class="badge badge--calc">External proxy</span>' : statusLabel(m.status)}`,
        `**Visuals:** ${m.usageCount}`,
        `**Pages:** ${m.pageCount}`,
      ];
      lines.push(meta.join(" · "));
      lines.push("");
      if (m.externalProxy) {
        const p = m.externalProxy;
        lines.push(`**External source**`);
        lines.push("");
        lines.push("| Field | Value |");
        lines.push("|-------|-------|");
        lines.push(`| Remote model | \`${esc(p.externalModel)}\` |`);
        if (p.cluster) lines.push(`| AS cluster | \`${esc(p.cluster)}\` |`);
        lines.push(`| Remote measure name | \`${esc(p.remoteName)}\`${p.remoteName === m.name ? " _(same as local)_" : ""} |`);
        lines.push(`| DAX type | \`${esc(p.type)}\` |`);
        lines.push("");
      }
      if (m.description) {
        lines.push(`> ${m.description.replace(/\n/g, " ")}`);
        lines.push("");
      }
      if (m.daxDependencies.length > 0) {
        lines.push(`**Depends on**`);
        lines.push("");
        lines.push(m.daxDependencies.map(d => `<span class="chip chip--measure">${esc(d)}</span>`).join(" "));
        lines.push("");
      }
      if (m.dependedOnBy && m.dependedOnBy.length > 0) {
        lines.push(`**Used by**`);
        lines.push("");
        lines.push(m.dependedOnBy.map(d => `<span class="chip chip--measure">${esc(d)}</span>`).join(" "));
        lines.push("");
      }
      lines.push(`</details>`);
      lines.push("");
    }
    lines.push("[↑ Jump to](#jump-to)");
    lines.push("");
    lines.push("---");
    lines.push("");
  };

  for (const L of letters) renderSection(L, L.toLowerCase(), buckets.get(L)!);
  if (buckets.get("#")!.length > 0) renderSection("Other (non-letter starts)", "other", buckets.get("#")!);

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateFunctionsMd — Companion functions reference
//   Front matter · how-to-read · one collapsible <details> per UDF with:
//     - parameters table (name / type)
//     - description
//     - measures that reference this function (from DAX expression scan,
//       same heuristic as the dashboard Functions tab)
//     - body in a ```dax fenced block (gets proper code-block styling in
//       the dashboard MD renderer; plain code in external viewers)
//   A–Z jump nav intentionally dropped — UDF counts are small enough that a
//   flat alphabetical list is easier to scan.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateFunctionsMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];
  // Same convention as the dashboard: drop Tabular Editor's `.About` shim entries.
  const fns = [...data.functions].filter(f => !f.name.endsWith(".About")).sort((a, b) => a.name.localeCompare(b.name));

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Functions Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Functions** | ${fns.length} |`);
  lines.push(`| **Scope** | Per-function description, parameters, referencing measures, and DAX body. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## How to read this document");
  lines.push("");
  lines.push("- Functions are user-defined DAX functions declared in the model (Tabular 1702+). The `.About` shim entries Tabular Editor emits are excluded.");
  lines.push("- Each function is collapsible. Click the row to expand / collapse.");
  lines.push("- Inside each block:");
  lines.push("    - **Signature** — inline form `name(Param : TYPE, …)`.");
  lines.push("    - **Description** — captured from the model's `///` doc comments.");
  lines.push("    - **Parameters** — tabular breakdown of each formal parameter and its declared type.");
  lines.push("    - **Used by** — measures whose DAX expression references the function (by name).");
  lines.push("    - **Body** — the function expression itself, rendered as a fenced `dax` code block.");
  lines.push("");
  lines.push("---");
  lines.push("");

  if (fns.length === 0) {
    lines.push("_No user-defined functions in this model._");
    lines.push("");
    lines.push(`_Generated by powerbi-lineage · ${ts}_`);
    lines.push("");
    return lines.join("\n");
  }

  // Parse TMDL parameter list into structured { name, type } pairs.
  // Input shape: "Param : TYPE, Other : TYPE". Missing type → empty string.
  const parseParams = (paramStr: string): Array<{ name: string; type: string }> => {
    if (!paramStr) return [];
    return paramStr.split(",").map(p => {
      const parts = p.trim().split(/\s*:\s*/);
      return parts.length >= 2
        ? { name: parts[0].trim(), type: parts.slice(1).join(":").trim() }
        : { name: p.trim(), type: "" };
    }).filter(p => p.name);
  };

  // "Used by" heuristic matches the dashboard Functions tab exactly.
  const refsFor = (name: string) =>
    data.measures.filter(m =>
      m.daxExpression.includes("'" + name + "'") || m.daxExpression.includes(name + "(")
    );

  for (const f of fns) {
    const params = parseParams(f.parameters);
    const refMeasures = refsFor(f.name);
    // One-line signature reused in the summary and rendered as inline code.
    const sigText = f.name + "(" + params.map(p => p.type ? `${p.name} : ${p.type}` : p.name).join(", ") + ")";
    const parts: string[] = [];
    parts.push(`${params.length} param${params.length === 1 ? "" : "s"}`);
    parts.push(`used by ${refMeasures.length} measure${refMeasures.length === 1 ? "" : "s"}`);

    lines.push(`<details>`);
    lines.push(`<summary><strong>${esc(f.name)}</strong> <small>— ${parts.join(" · ")}</small></summary>`);
    lines.push("");
    // Signature — a bare inline code line makes the shape scannable before you expand further.
    lines.push(`\`${sigText}\``);
    lines.push("");

    if (f.description) {
      lines.push(`> ${f.description.replace(/\n/g, " ")}`);
      lines.push("");
    }

    // Parameters as a table (each row independently styled, not a wall of purple).
    lines.push("**Parameters**");
    lines.push("");
    if (params.length === 0) {
      lines.push("_None._");
      lines.push("");
    } else {
      lines.push("| # | Name | Type |");
      lines.push("|--:|------|------|");
      params.forEach((p, i) => {
        lines.push(`| ${i + 1} | ${esc(p.name)} | ${esc(p.type) || "—"} |`);
      });
      lines.push("");
    }

    // Used by — referencing measures rendered as amber chips to match the
    // dashboard Functions-tab "measures using this function" list. Fits on
    // a single flow-wrapping line so big lists stay compact.
    lines.push(`**Used by**` + (refMeasures.length > 0 ? ` (${refMeasures.length})` : ""));
    lines.push("");
    if (refMeasures.length === 0) {
      lines.push("_No measures reference this function._");
      lines.push("");
    } else {
      const chips = [...refMeasures].sort((a, b) => a.name.localeCompare(b.name))
        .map(m => `<span class="chip chip--measure">${esc(m.name)}</span>`)
        .join(" ");
      lines.push(chips);
      lines.push("");
    }

    // Body — fenced with a language tag so the MD renderer (and external
    // viewers that support syntax highlighting) can style it separately from
    // inline code.
    if (f.expression) {
      lines.push("**Body**");
      lines.push("");
      lines.push("```dax");
      lines.push(f.expression);
      lines.push("```");
      lines.push("");
    }
    lines.push(`</details>`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateCalcGroupsMd — Companion calculation-groups reference
//   Front matter, "How to read", one section per calculation group with the
//   precedence and a collapsible block per item. Item bodies are included for
//   the same reason as functions: they ARE the definition.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateCalcGroupsMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];
  const cgs = data.calcGroups;
  const totalItems = cgs.reduce((acc, cg) => acc + cg.items.length, 0);

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Calculation Groups Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Calculation groups** | ${cgs.length} (${totalItems} item${totalItems === 1 ? "" : "s"}) |`);
  lines.push(`| **Scope** | Per-group precedence, items, item descriptions, and item bodies. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## How to read this document");
  lines.push("");
  lines.push("- A calculation group is a Tabular feature that **rewrites** measure expressions based on which calc-group item the user has selected (typically via a slicer). One classic use is a Time Intelligence calc group with items like _Current_, _YTD_, _Prior Year_.");
  lines.push("- **Precedence** controls evaluation order when multiple calc groups apply at once. Higher precedence wins.");
  lines.push("- Each item is collapsible. Click the row to expand / collapse.");
  lines.push("- Inside each item:");
  lines.push("    - **Description** — captured from the model's `///` doc comments.");
  lines.push("    - **Format string expression** — when present, overrides the underlying measure's format string.");
  lines.push("    - **Body** — the DAX expression that rewrites the underlying measure.");
  lines.push("");
  lines.push("---");
  lines.push("");

  if (cgs.length === 0) {
    lines.push("_No calculation groups in this model._");
    return lines.join("\n");
  }

  // Jump nav: one entry per group.
  lines.push("## Jump to");
  lines.push("");
  lines.push(cgs.map(cg => `[${cg.name}](#${slug(cg.name)})`).join(" · "));
  lines.push("");
  lines.push("---");
  lines.push("");

  cgs.forEach((cg, i) => {
    lines.push(`## ${i + 1}. ${cg.name}`);
    lines.push(`<a id="${slug(cg.name)}"></a>`);
    lines.push("");
    if (cg.description) {
      lines.push(`> ${cg.description.replace(/\n/g, " ")}`);
      lines.push("");
    }
    lines.push(`**Precedence:** ${cg.precedence} · **Items:** ${cg.items.length}`);
    lines.push("");

    if (cg.items.length === 0) {
      lines.push("_No items defined._");
      lines.push("");
    } else {
      for (const item of cg.items) {
        lines.push(`<details>`);
        lines.push(`<summary><strong>${esc(item.name)}</strong> <small>— ordinal ${item.ordinal}</small></summary>`);
        lines.push("");
        if (item.description) {
          lines.push(`> ${item.description.replace(/\n/g, " ")}`);
          lines.push("");
        }
        if (item.formatStringExpression) {
          lines.push("**Format string expression**");
          lines.push("");
          lines.push("```");
          lines.push(item.formatStringExpression);
          lines.push("```");
          lines.push("");
        }
        if (item.expression) {
          lines.push("**Body**");
          lines.push("");
          lines.push("```");
          lines.push(item.expression);
          lines.push("```");
          lines.push("");
        }
        lines.push(`</details>`);
        lines.push("");
      }
    }
    lines.push("[↑ Jump to](#jump-to)");
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateQualityMd — Companion data-quality review document
//   Standalone audit doc, separate from the technical specification. Surfaces
//   coverage, removal candidates, indirect entities, and inactive
//   relationships — the actionable findings.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateQualityMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];

  // Proxy measures carry status=unused by the "bound to a visual"
  // rule, but they're EXTERNALMEASURE re-exports and removing them
  // breaks the composite-model contract. Split them out of the
  // "Removal candidates" list into their own structural-only bucket.
  //
  // Auto-date tables (LocalDateTable_<guid> / DateTableTemplate_<guid>)
  // are Power BI infrastructure, not user content. Their columns are
  // auto-generated and can't be documented or format-string'd, so
  // hiding them from Quality sections removes the dominant noise
  // source on composite models (H&S: 70 of 218 undocumented columns,
  // 40 of 41 unformatted numeric columns).
  const autoDateTableNames = new Set(data.tables.filter(isAutoDate).map(t => t.name));
  const isAutoDateCol = (c: { table: string }) => autoDateTableNames.has(c.table);

  const unusedM_all = data.measures.filter(m => m.status === "unused");
  const unusedM     = unusedM_all.filter(m => m.externalProxy === null);  // real removal candidates
  const proxyM      = data.measures.filter(m => m.externalProxy !== null);
  const unusedC_all = data.columns.filter(c => c.status === "unused");
  const unusedC     = unusedC_all.filter(c => !isAutoDateCol(c));
  const unusedC_autoDate = unusedC_all.filter(isAutoDateCol);
  const indirectM   = data.measures.filter(m => m.status === "indirect");
  const indirectC   = data.columns.filter(c => c.status === "indirect");
  const inactiveRels = data.relationships.filter(r => !r.isActive);

  const measureCoveragePct = data.totals.measuresInModel > 0
    ? Math.round((data.totals.measuresDirect / data.totals.measuresInModel) * 100)
    : 0;
  const columnCoveragePct = data.totals.columnsInModel > 0
    ? Math.round((data.totals.columnsDirect / data.totals.columnsInModel) * 100)
    : 0;

  // ── Documentation coverage ──────────────────────────────────────────────
  // "Undocumented" = no /// doc-comment captured and no description: property.
  // Auto-date infrastructure tables / columns can't be documented (they're
  // auto-generated) so excluding them from the coverage denominator is the
  // honest percentage. Shown separately in the "Infrastructure note".
  const userTablesList   = userTables(data);
  const userColumnsList  = data.columns.filter(c => !isAutoDateCol(c));
  const undocumentedTables   = userTablesList.filter(t => !t.description);
  const undocumentedColumns  = userColumnsList.filter(c => !c.description);
  const undocumentedMeasures = data.measures.filter(m => !m.description);
  const autoDateTableCount   = data.tables.length - userTablesList.length;
  const autoDateColumnCount  = data.columns.length - userColumnsList.length;
  const tableDocPct   = userTablesList.length   > 0 ? Math.round(((userTablesList.length   - undocumentedTables.length)   / userTablesList.length)   * 100) : 0;
  const columnDocPct  = userColumnsList.length  > 0 ? Math.round(((userColumnsList.length  - undocumentedColumns.length)  / userColumnsList.length)  * 100) : 0;
  const measureDocPct = data.totals.measuresInModel > 0 ? Math.round(((data.totals.measuresInModel - undocumentedMeasures.length) / data.totals.measuresInModel) * 100) : 0;

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Data Quality Review`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  lines.push(`| **Measure coverage** | ${data.totals.measuresDirect} of ${data.totals.measuresInModel} (${measureCoveragePct}%) bound to a visual |`);
  lines.push(`| **Column coverage** | ${data.totals.columnsDirect} of ${data.totals.columnsInModel} (${columnCoveragePct}%) bound to a visual |`);
  lines.push(`| **Removal candidates** | ${unusedM.length} measure${unusedM.length === 1 ? "" : "s"} · ${unusedC.length} column${unusedC.length === 1 ? "" : "s"} |`);
  if (proxyM.length > 0) {
    lines.push(`| **External proxies (keep)** | ${proxyM.length} EXTERNALMEASURE measure${proxyM.length === 1 ? "" : "s"} — structural, not removal candidates |`);
  }
  if (autoDateTableCount > 0) {
    lines.push(`| **Auto-date infrastructure (excluded)** | ${autoDateTableCount} table${autoDateTableCount === 1 ? "" : "s"} · ${autoDateColumnCount} column${autoDateColumnCount === 1 ? "" : "s"} — Power BI infrastructure, not user content |`);
  }
  lines.push(`| **Indirect entities** | ${indirectM.length} measure${indirectM.length === 1 ? "" : "s"} · ${indirectC.length} column${indirectC.length === 1 ? "" : "s"} |`);
  lines.push(`| **Inactive relationships** | ${inactiveRels.length === 0 ? "none" : inactiveRels.length} |`);
  lines.push(`| **Missing descriptions** | ${undocumentedTables.length} table${undocumentedTables.length === 1 ? "" : "s"} · ${undocumentedColumns.length} column${undocumentedColumns.length === 1 ? "" : "s"} · ${undocumentedMeasures.length} measure${undocumentedMeasures.length === 1 ? "" : "s"} |`);
  lines.push(`| **Scope** | Coverage, removal candidates, indirect-use entities, inactive relationships, documentation coverage, modelling hygiene. Action-oriented review of the model. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── How to read ───────────────────────────────────────────────────────────
  lines.push("## How to read this document");
  lines.push("");
  lines.push("This document complements the **Semantic-model specification** (the main technical doc). The spec describes _what is in_ the model; this review surfaces _what to act on_:");
  lines.push("");
  lines.push("- **Coverage** — how much of the model is actually consumed by the report.");
  lines.push("- **Removal candidates** — entities that are not referenced anywhere. Safe to delete after a final eyeball.");
  lines.push("- **Indirect entities** — not on a visual, but referenced via DAX or relationships. **Keep these.** Removing them silently breaks measures or filter propagation.");
  lines.push("- **Inactive relationships** — defined but dormant unless explicitly activated via `USERELATIONSHIP()` in DAX.");
  lines.push("- **Documentation coverage** — tables, columns, and measures lacking a description (`///` doc comment or `description:` property). Undocumented fields are hard to hand over.");
  lines.push("- **Modelling hygiene** — low-priority signals: numeric columns without a format string, category / type mismatches.");
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 1. Coverage ───────────────────────────────────────────────────────────
  lines.push("## 1. Coverage");
  lines.push("");
  lines.push("| Entity | Direct | Indirect | Unused | Total | Direct coverage |");
  lines.push("|--------|------:|---------:|-------:|------:|----------------:|");
  lines.push(`| Measures | ${data.totals.measuresDirect} | ${data.totals.measuresIndirect} | ${data.totals.measuresUnused} | ${data.totals.measuresInModel} | ${measureCoveragePct}% |`);
  lines.push(`| Columns | ${data.totals.columnsDirect} | ${data.totals.columnsIndirect} | ${data.totals.columnsUnused} | ${data.totals.columnsInModel} | ${columnCoveragePct}% |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 2. Removal candidates ─────────────────────────────────────────────────
  lines.push("## 2. Removal candidates");
  lines.push("");
  if (unusedM.length === 0 && unusedC.length === 0 && proxyM.length === 0 && unusedC_autoDate.length === 0) {
    lines.push("_No unused entities — nothing to remove._");
    lines.push("");
  } else {
    lines.push("Entities not referenced by any visual, measure, or relationship. Review then delete.");
    lines.push("");
    let n = 1;
    if (unusedM.length > 0) {
      lines.push(`### 2.${n++} Unused measures (${unusedM.length})`);
      lines.push("");
      lines.push("| Measure | Home table | Format |");
      lines.push("|---------|-----------|--------|");
      [...unusedM].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(m => {
        lines.push(`| ${esc(m.name)} | ${esc(m.table)} | ${esc(m.formatString) || "—"} |`);
      });
      lines.push("");
    }
    if (unusedC.length > 0) {
      lines.push(`### 2.${n++} Unused columns (${unusedC.length})`);
      lines.push("");
      lines.push("| Column | Home table | Data type | Notes |");
      lines.push("|--------|-----------|-----------|-------|");
      [...unusedC].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(c => {
        const notes: string[] = [];
        if (c.isHidden) notes.push(BADGE_HIDDEN);
        if (c.isCalculated) notes.push(BADGE_CALC);
        if (c.isKey) notes.push(BADGE_PK);
        lines.push(`| ${esc(c.name)} | ${esc(c.table)} | ${esc(c.dataType)} | ${notes.join(" ") || "—"} |`);
      });
      lines.push("");
    }
    // Proxy measures — NOT removal candidates. Spelled out loudly so
    // nobody skims the "Unused measures" section and starts deleting.
    if (proxyM.length > 0) {
      lines.push(`### 2.${n++} External proxy measures — DO NOT REMOVE (${proxyM.length})`);
      lines.push("");
      lines.push("These measures have `usageCount = 0` by the \"bound to a visual\" rule, but they are `EXTERNALMEASURE(...)` proxies re-exposing measures from a remote Analysis Services cube. Removing one breaks the composite-model contract — the dependent report pages will stop working. Listed here for transparency; they do NOT belong in the removal candidates above.");
      lines.push("");
      lines.push("| Proxy measure | Home table | Remote model | Remote name |");
      lines.push("|---------------|-----------|--------------|-------------|");
      [...proxyM].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(m => {
        const p = m.externalProxy!;
        const remote = p.remoteName === m.name ? "_same_" : `\`${esc(p.remoteName)}\``;
        lines.push(`| ${esc(m.name)} | ${esc(m.table)} | \`${esc(p.externalModel)}\` | ${remote} |`);
      });
      lines.push("");
    }
    // Auto-date column noise — collapsed into a details block so the real
    // actionable list stays readable.
    if (unusedC_autoDate.length > 0) {
      lines.push(`### 2.${n++} Auto-date infrastructure columns (${unusedC_autoDate.length}) — not actionable`);
      lines.push("");
      lines.push(`<details><summary>${unusedC_autoDate.length} auto-generated columns across ${autoDateTableCount} \`LocalDateTable_<guid>\` / \`DateTableTemplate_<guid>\` tables. Collapsed because these are Power BI infrastructure — disabling Auto Date/Time in the report's settings is the one place to act on them, not this list.</summary>`);
      lines.push("");
      lines.push("| Column | Home table | Data type |");
      lines.push("|--------|-----------|-----------|");
      [...unusedC_autoDate].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(c => {
        lines.push(`| ${esc(c.name)} | ${esc(c.table)} | ${esc(c.dataType)} |`);
      });
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // ── 3. Indirect entities ──────────────────────────────────────────────────
  lines.push("## 3. Indirect entities");
  lines.push("");
  if (indirectM.length === 0 && indirectC.length === 0) {
    lines.push("_No indirect entities detected._");
    lines.push("");
  } else {
    lines.push("Not bound to a visual, but **kept alive** because something else needs them — measure DAX, calc-column DAX, or a relationship. **Do not remove without checking upstream references.**");
    lines.push("");
    if (indirectM.length > 0) {
      lines.push(`### 3.1 Indirect measures (${indirectM.length})`);
      lines.push("");
      lines.push("| Measure | Home table | Used by |");
      lines.push("|---------|-----------|---------|");
      [...indirectM].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(m => {
        const usedBy = m.dependedOnBy && m.dependedOnBy.length > 0
          ? m.dependedOnBy.map(d => "`" + d + "`").join(", ")
          : "—";
        lines.push(`| ${esc(m.name)} | ${esc(m.table)} | ${usedBy} |`);
      });
      lines.push("");
    }
    if (indirectC.length > 0) {
      lines.push(`### 3.${indirectM.length > 0 ? "2" : "1"} Indirect columns (${indirectC.length})`);
      lines.push("");
      lines.push("Referenced by a measure's DAX expression or used in a relationship.");
      lines.push("");
      lines.push("| Column | Home table | Data type |");
      lines.push("|--------|-----------|-----------|");
      [...indirectC].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name)).forEach(c => {
        lines.push(`| ${esc(c.name)} | ${esc(c.table)} | ${esc(c.dataType)} |`);
      });
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // ── 5. Documentation coverage is pushed after section 4 below. ────────────

  // ── 4. Inactive relationships ─────────────────────────────────────────────
  lines.push("## 4. Inactive relationships");
  lines.push("");
  if (inactiveRels.length === 0) {
    lines.push("_No inactive relationships in this model._");
    lines.push("");
  } else {
    lines.push("Defined but dormant. Inactive relationships only take effect when wrapped in `USERELATIONSHIP()` inside a DAX measure. Often used for role-playing dimensions (e.g. multiple date relationships).");
    lines.push("");
    lines.push("| # | From | To |");
    lines.push("|--:|------|----|");
    inactiveRels.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${esc(r.fromTable)}[${esc(r.fromColumn)}] | ${esc(r.toTable)}[${esc(r.toColumn)}] |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── 5. Documentation coverage ─────────────────────────────────────────────
  lines.push("## 5. Documentation coverage");
  lines.push("");
  lines.push("Tables, columns, and measures that do not expose a description. A description is either a `///` doc comment preceding the entity or a `description:` property on it. Undocumented entities make the model harder to hand over and weaken auto-generated documentation like this one.");
  if (autoDateTableCount > 0) {
    lines.push("");
    lines.push(`_Auto-date infrastructure is excluded — ${autoDateTableCount} \`LocalDateTable_<guid>\` / \`DateTableTemplate_<guid>\` tables and their ${autoDateColumnCount} columns can't be documented (they're auto-generated by Power BI). Disable Auto Date/Time in the report settings if you want them gone._`);
  }
  lines.push("");

  // Overview table — denominators exclude auto-date infrastructure, same
  // as the counts above. See the note right beneath the section heading.
  const userTableCount  = userTablesList.length;
  const userColumnCount = userColumnsList.length;
  lines.push("### 5.1 Summary");
  lines.push("");
  lines.push("| Entity | Documented | Missing | Total | Coverage |");
  lines.push("|--------|-----------:|--------:|------:|---------:|");
  lines.push(`| Tables (user) | ${userTableCount - undocumentedTables.length} | ${undocumentedTables.length} | ${userTableCount} | ${tableDocPct}% |`);
  lines.push(`| Columns (user) | ${userColumnCount - undocumentedColumns.length} | ${undocumentedColumns.length} | ${userColumnCount} | ${columnDocPct}% |`);
  lines.push(`| Measures | ${data.totals.measuresInModel - undocumentedMeasures.length} | ${undocumentedMeasures.length} | ${data.totals.measuresInModel} | ${measureDocPct}% |`);
  lines.push("");

  // Undocumented tables
  lines.push("### 5.2 Undocumented tables");
  lines.push("");
  if (undocumentedTables.length === 0) {
    lines.push("_All tables have descriptions._");
    lines.push("");
  } else {
    for (const t of [...undocumentedTables].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- ${esc(t.name)}`);
    }
    lines.push("");
  }

  // Undocumented columns — grouped by table so it's actionable
  lines.push("### 5.3 Undocumented columns");
  lines.push("");
  if (undocumentedColumns.length === 0) {
    lines.push("_All columns have descriptions._");
    lines.push("");
  } else {
    const colsByTable = new Map<string, typeof undocumentedColumns>();
    for (const c of undocumentedColumns) {
      const arr = colsByTable.get(c.table) || [];
      arr.push(c);
      colsByTable.set(c.table, arr);
    }
    lines.push("| Table | Missing | Columns |");
    lines.push("|-------|--------:|---------|");
    [...colsByTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([tbl, cs]) => {
      const names = cs.map(c => esc(c.name)).sort((a, b) => a.localeCompare(b)).join(", ");
      lines.push(`| ${esc(tbl)} | ${cs.length} | ${names} |`);
    });
    lines.push("");
  }

  // Undocumented measures — grouped by home table
  lines.push("### 5.4 Undocumented measures");
  lines.push("");
  if (undocumentedMeasures.length === 0) {
    lines.push("_All measures have descriptions._");
    lines.push("");
  } else {
    const msByTable = new Map<string, typeof undocumentedMeasures>();
    for (const m of undocumentedMeasures) {
      const arr = msByTable.get(m.table) || [];
      arr.push(m);
      msByTable.set(m.table, arr);
    }
    lines.push("| Home table | Missing | Measures |");
    lines.push("|------------|--------:|----------|");
    [...msByTable.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([tbl, ms]) => {
      const names = ms.map(m => esc(m.name)).sort((a, b) => a.localeCompare(b)).join(", ");
      lines.push(`| ${esc(tbl)} | ${ms.length} | ${names} |`);
    });
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // ── 6. Modelling hygiene (low-priority signals) ───────────────────────────
  lines.push("## 6. Modelling hygiene");
  lines.push("");
  lines.push("Low-priority signals — not bugs, but potential sources of inconsistency in the field list and visual rendering.");
  lines.push("");

  // 6.1 Numeric columns without a format string (cosmetic).
  // Auto-date tables excluded — their Day/MonthNo/QuarterNo/Year
  // columns are auto-generated by Power BI and can't be format-
  // stringed by the modeller. On H&S those were 40 of 41 rows of
  // un-actionable noise; filtering here makes the real actionable
  // finding visible.
  const numericTypes = new Set(["int64", "decimal", "double", "currency"]);
  const numericNoFormat = userTablesList.flatMap(t => t.columns
    .filter(c => numericTypes.has((c.dataType || "").toLowerCase()))
    .filter(c => !c.formatString)
    .filter(c => !c.isKey && !c.isInferredPK && !c.isFK)    // keys aren't formatted
    .map(c => ({ table: t.name, column: c.name, type: c.dataType }))
  );
  lines.push("### 6.1 Numeric columns without a format string");
  lines.push("");
  if (numericNoFormat.length === 0) {
    lines.push("_All numeric non-key columns have a format string._");
    lines.push("");
  } else {
    lines.push(`${numericNoFormat.length} numeric column${numericNoFormat.length === 1 ? "" : "s"} will use the default format (raw number). Setting a format string makes visuals consistent and avoids "12345.678" rendering.`);
    lines.push("");
    lines.push("| Table | Column | Data type |");
    lines.push("|-------|--------|-----------|");
    numericNoFormat.forEach(r => lines.push(`| ${esc(r.table)} | ${esc(r.column)} | ${esc(r.type)} |`));
    lines.push("");
  }

  // 6.2 Data-category mismatches: URL-type category on a non-string column
  const urlCategories = new Set(["webUrl", "imageUrl"]);
  const categoryMismatches = data.tables.flatMap(t => t.columns
    .filter(c => c.dataCategory && urlCategories.has(c.dataCategory))
    .filter(c => (c.dataType || "").toLowerCase() !== "string")
    .map(c => ({ table: t.name, column: c.name, category: c.dataCategory, type: c.dataType }))
  );
  lines.push("### 6.2 Data-category / type mismatches");
  lines.push("");
  if (categoryMismatches.length === 0) {
    lines.push("_No data-category / type mismatches detected._");
    lines.push("");
  } else {
    lines.push("Columns tagged with a URL data category should be string-typed. A mismatch usually means the category was set but the underlying column is numeric or date.");
    lines.push("");
    lines.push("| Table | Column | Data category | Data type |");
    lines.push("|-------|--------|---------------|-----------|");
    categoryMismatches.forEach(r => lines.push(`| ${esc(r.table)} | ${esc(r.column)} | ${esc(r.category)} | ${esc(r.type)} |`));
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// generateDataDictionaryMd — Companion data-dictionary document
//   Per-table column inventories, constraints, hierarchies. Each table sits
//   in its own <details> so big models stay navigable. The main technical
//   spec keeps only a summary pointing here.
// ═══════════════════════════════════════════════════════════════════════════════

export function generateDataDictionaryMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];

  const tablesAll = [...data.tables].sort((a, b) => a.name.localeCompare(b.name));
  const userTablesSorted = tablesAll.filter(t => !isAutoDate(t));
  const autoDateTables = tablesAll.filter(isAutoDate);
  const totalHierarchies = userTablesSorted.reduce((acc, t) => acc + t.hierarchies.length, 0);
  const userColumnCount = userTablesSorted.reduce((a, t) => a + t.columnCount, 0);
  const autoDateColumnCount = autoDateTables.reduce((a, t) => a + t.columnCount, 0);

  // ── Front matter ──────────────────────────────────────────────────────────
  lines.push(`# Data Dictionary Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Document version** | 1.0 (auto-generated) |`);
  lines.push(`| **Generated** | ${ts} |`);
  const autoDateNote = autoDateTables.length > 0
    ? ` (+${autoDateTables.length} auto-date infrastructure, collapsed below)`
    : "";
  lines.push(`| **Tables** | ${userTablesSorted.length}${autoDateNote} |`);
  lines.push(`| **Columns** | ${userColumnCount}${autoDateColumnCount > 0 ? ` (+${autoDateColumnCount} auto-date)` : ""} |`);
  lines.push(`| **Hierarchies** | ${totalHierarchies} |`);
  lines.push(`| **Scope** | Per-table column inventories with constraints, aggregation defaults, sort columns, data categories, format strings, and hierarchies. |`);
  lines.push(`| **Companion document** | Semantic-model specification |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── How to read ───────────────────────────────────────────────────────────
  lines.push("## How to read this document");
  lines.push("");
  lines.push("One entry per table, collapsible so a big model stays scannable. Jump to any table via the nav below.");
  lines.push("");
  lines.push("Each column entry surfaces:");
  lines.push("- **Constraints** — PK / PK\\* (inferred) / FK → target / Ref ← source / Calculated / Hidden.");
  lines.push("- **Summarize by** — default aggregation (`none` / `sum` / `average` / `count` / …). Drag-to-visual behaviour depends on this.");
  lines.push("- **Sort by** — column name when this column displays in the order of a different sort column (e.g. `Month` sorted by `Month Number`).");
  lines.push("- **Data category** — semantic hint (`ImageUrl`, `WebUrl`, `StateOrProvince`, `City`, …) used by map visuals and image cells.");
  lines.push("- **Format** — column-level format string for numeric / date columns (measure format strings live in the Measures Reference).");
  lines.push("- **Description** — from `///` doc comments or `description:` properties.");
  lines.push("");
  lines.push("Hierarchies, when present, list the ordered levels and the backing column for each level.");
  lines.push("");
  lines.push("---");
  lines.push("");

  if (userTablesSorted.length === 0 && autoDateTables.length === 0) {
    lines.push("_No tables found._");
    return lines.join("\n");
  }

  // ── Jump nav — user tables only on the hot path ───────────────────────────
  lines.push("## Jump to");
  lines.push("");
  lines.push(userTablesSorted.map(t => `[${t.name}](#${slug(t.name)})`).join(" · "));
  if (autoDateTables.length > 0) {
    lines.push("");
    lines.push(`_${autoDateTables.length} auto-date infrastructure tables collapsed at the bottom of this document._`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── One collapsible section per user table ────────────────────────────────
  for (const tbl of userTablesSorted) {
    const cgTag = tbl.isCalcGroup ? " · _calculation group_" : "";
    lines.push(`## ${tbl.name}`);
    lines.push(`<a id="${slug(tbl.name)}"></a>`);
    lines.push("");

    // Summary line outside the details so it's always visible.
    const summary = `${tbl.columnCount} column${tbl.columnCount === 1 ? "" : "s"} · ${tbl.measureCount} measure${tbl.measureCount === 1 ? "" : "s"} · ${tbl.keyCount} key${tbl.keyCount === 1 ? "" : "s"} · ${tbl.fkCount} FK${tbl.fkCount === 1 ? "" : "s"} · ${tbl.hierarchies.length} hierarch${tbl.hierarchies.length === 1 ? "y" : "ies"}${cgTag}`;
    lines.push(`<details>`);
    lines.push(`<summary><strong>${esc(tbl.name)}</strong> <small>— ${summary}</small></summary>`);
    lines.push("");

    if (tbl.description) {
      lines.push(`> ${tbl.description.replace(/\n/g, " ")}`);
      lines.push("");
    }

    // Source (if any)
    if (tbl.partitions.length > 0) {
      const p = tbl.partitions[0];
      const loc = p.sourceLocation ? " · `" + esc(p.sourceLocation) + "`" : "";
      const extra = tbl.partitions.length > 1 ? ` (+${tbl.partitions.length - 1} more)` : "";
      lines.push(`**Source:** ${esc(p.mode)} · ${esc(p.sourceType)}${loc}${extra}`);
      lines.push("");
    }

    // ── Columns ─────────────────────────────────────────────────────────────
    if (tbl.columns.length === 0) {
      lines.push("_No columns._");
      lines.push("");
    } else {
      lines.push("### Columns");
      lines.push("");
      lines.push("| # | Name | Type | Constraints | Summarize by | Sort by | Category | Format | Description |");
      lines.push("|--:|------|------|-------------|--------------|---------|----------|--------|-------------|");
      tbl.columns.forEach((c, i) => {
        const constraints: string[] = [];
        if (c.isKey) constraints.push(BADGE_PK);
        else if (c.isInferredPK) constraints.push(BADGE_PK_INF);
        if (c.isFK && c.fkTarget) constraints.push(`${BADGE_FK} → ${c.fkTarget.table}[${c.fkTarget.column}]`);
        if (c.incomingRefs && c.incomingRefs.length > 0) {
          for (const r of c.incomingRefs) {
            constraints.push(`Ref ← ${r.table}[${r.column}]${r.isActive ? "" : " (inactive)"}`);
          }
        }
        if (c.isCalculated) constraints.push(BADGE_CALC);
        if (c.isHidden) constraints.push(BADGE_HIDDEN);
        const cstr = constraints.length > 0 ? constraints.join("<br>") : "—";
        // Default values suppressed to an em-dash so the table is
        // scannable. `none` is Power BI's default aggregation for
        // string columns; `Uncategorized` is the default data-category
        // for anything without a semantic tag. On H&S ~95% of column
        // rows carried both defaults — they drowned the meaningful
        // cases (e.g. `sum` on numeric facts, `ImageUrl` on dim_site).
        const summ = c.summarizeBy && c.summarizeBy !== "none" ? esc(c.summarizeBy) : "—";
        const cat = c.dataCategory && c.dataCategory !== "Uncategorized" ? esc(c.dataCategory) : "—";
        lines.push(`| ${i + 1} | ${esc(c.name)} | ${esc(c.dataType)} | ${cstr} | ${summ} | ${esc(c.sortByColumn) || "—"} | ${cat} | ${esc(c.formatString) || "—"} | ${esc(c.description) || "—"} |`);
      });
      lines.push("");
    }

    // ── Hierarchies ─────────────────────────────────────────────────────────
    if (tbl.hierarchies.length > 0) {
      lines.push("### Hierarchies");
      lines.push("");
      for (const h of tbl.hierarchies) {
        lines.push(`**${esc(h.name)}**` + (h.description ? ` — ${esc(h.description)}` : ""));
        lines.push("");
        if (h.levels.length > 0) {
          lines.push("| Order | Level | Column | Description |");
          lines.push("|------:|-------|--------|-------------|");
          h.levels.forEach((lv, i) => {
            lines.push(`| ${i + 1} | ${esc(lv.name)} | ${esc(lv.column)} | ${esc(lv.description) || "—"} |`);
          });
          lines.push("");
        }
      }
    }

    lines.push("</details>");
    lines.push("");
    lines.push("[↑ Jump to](#jump-to)");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ── Auto-date infrastructure appendix ─────────────────────────────────────
  // A single collapsed block listing every LocalDateTable_<guid> /
  // DateTableTemplate_<guid> table. Users who need the detail can open
  // it; everyone else isn't distracted by 10 near-identical entries.
  if (autoDateTables.length > 0) {
    lines.push("## Auto-date infrastructure");
    lines.push("");
    lines.push(`Power BI generates a \`LocalDateTable_<guid>\` or \`DateTableTemplate_<guid>\` per date column when the report's Auto Date/Time setting is on. ${autoDateTables.length} such tables (${autoDateColumnCount} columns) are present in this model. They are auto-generated, not user content — documented here for completeness only.`);
    lines.push("");
    lines.push("<details><summary>Show auto-date infrastructure tables</summary>");
    lines.push("");
    lines.push("| Table | Columns |");
    lines.push("|-------|--------:|");
    for (const t of autoDateTables) {
      const cols = t.columns.map(c => `\`${esc(c.name)}\``).join(", ");
      lines.push(`| ${esc(t.name)} | ${t.columnCount} — ${cols} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}
