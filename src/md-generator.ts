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
 * Render a measure/column status as a coloured <span> badge that the
 * dashboard MD renderer styles as a pill. The Unicode glyph inside each
 * span is what survives CSS stripping — ADO Wiki and GitHub drop the
 * `class` attribute, leaving the plain text `✓ Direct` / `↻ Indirect` /
 * `⚠ Unused`. The glyph preserves visual separation from surrounding
 * text even without the pill styling.
 */
function statusLabel(s: "direct" | "indirect" | "unused" | string): string {
  if (s === "direct")   return '<span class="badge badge--success">✓ Direct</span>';
  if (s === "indirect") return '<span class="badge badge--indirect">↻ Indirect</span>';
  if (s === "unused")   return '<span class="badge badge--unused">⚠ Unused</span>';
  return String(s);
}

/**
 * Key / column-annotation badges — used in Data Dictionary column rows
 * and Quality-tab notes.
 *
 * The Unicode prefix is the only signal that survives CSS stripping on
 * ADO Wiki / GitHub / any raw-MD viewer. In the dashboard the whole
 * span (glyph + label) renders as a single coloured pill.
 *
 * Mapping rationale:
 *   🔑 PK    — key icon, primary key set explicitly
 *   🗝 PK*   — skeleton key, inferred PK (column is target of ≥1 rel)
 *   🔗 FK    — link icon, foreign key (column is source of ≥1 rel)
 *   🧮 CALC  — abacus, calculated column / calc group
 *   👁 HIDDEN — eye (visible-eye reads as "peek-only"; CSS strikes it)
 */
const BADGE_PK     = '<span class="badge badge--pk">🔑 PK</span>';
const BADGE_PK_INF = '<span class="badge badge--pk-inf">🗝 PK*</span>';
const BADGE_FK     = '<span class="badge badge--fk">🔗 FK</span>';
const BADGE_CALC   = '<span class="badge badge--calc">🧮 CALC</span>';
const BADGE_HIDDEN = '<span class="badge badge--hidden">👁 HIDDEN</span>';

/** GitHub-compatible slug for in-document anchor links. */
function slug(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Azure DevOps Wiki-compatible heading slug.
 *
 * The hand-rolled TOCs and Jump-to navs in these MD docs need their
 * `[text](#anchor)` links to resolve to actual heading anchors in both
 * ADO Wiki AND GitHub AND our dashboard's inline MD renderer. ADO
 * Wiki's slug algorithm differs from GitHub's in a handful of
 * punctuation-stripping rules — most headings slug identically on
 * both, but punctuation like `:`, `(`, `)`, `,` produces different
 * anchors.
 *
 * This function matches ADO Wiki's rules per Microsoft's docs
 * (learn.microsoft.com/azure/devops/project/wiki/markdown-guidance):
 *
 *   1. Lowercase.
 *   2. Strip punctuation ADO itself strips — `:.,/&()!?'"`` `
 *   3. Replace any remaining non-word-non-hyphen char with a hyphen.
 *   4. Collapse consecutive hyphens, trim leading/trailing.
 *
 * GitHub is more lenient — anything that works as an ADO slug also
 * resolves on GitHub because GitHub's algorithm happens to produce
 * the same output for the character classes we emit as headings.
 *
 * `slug()` is retained for any non-MD callers that still want the old
 * GitHub-specific rules; all MD generators use `adoSlug()` now.
 */
function adoSlug(heading: string): string {
  return String(heading)
    .toLowerCase()
    // Strip the punctuation ADO Wiki itself strips. These chars do NOT
    // become hyphens — they vanish entirely, joining the surrounding
    // text.
    .replace(/[:.,/&()!?'"`]/g, "")
    // Replace remaining non-word-non-hyphen (Unicode whitespace,
    // em-dash, en-dash, etc.) with a hyphen.
    .replace(/[^\w\-]+/g, "-")
    // Collapse consecutive hyphens.
    .replace(/-+/g, "-")
    // Trim leading/trailing hyphens.
    .replace(/^-+|-+$/g, "");
}
export { adoSlug };

/**
 * Escape a string for use as a Mermaid node LABEL (inside "quotes").
 * Mermaid is stricter than Markdown — double quotes and backticks
 * inside labels break parsing even when they'd be fine in MD.
 */
function mmLabel(s: string): string {
  return String(s).replace(/"/g, "\\\"").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Truncate a Mermaid node label so a long visual title or DAX
 * expression doesn't distort the whole graph. Mermaid auto-wraps
 * long labels but layouts get weird past ~40 chars.
 */
function mmTrunc(s: string, max = 40): string {
  const t = String(s);
  return t.length > max ? t.substring(0, max - 1) + "…" : t;
}

/**
 * Render a Mermaid lineage graph for one measure: upstream measures
 * on the left, the measure itself in the centre, downstream visuals
 * on the right. Returns an empty string when there's nothing to draw
 * (no deps either way and no usage) — caller should skip emission.
 *
 * Node ID scheme is local to this block (m0 for current, m1..mN for
 * upstream, v1..vN for downstream visuals) so multiple graphs in the
 * same doc don't collide.
 *
 * Downstream visuals are de-duplicated by title and capped at 12 with
 * a "+N more" node so the graph stays readable on dense reports.
 */
function mermaidMeasureLineage(m: ModelMeasure): string {
  const upstream = m.daxDependencies ?? [];
  const downstream = m.usedIn ?? [];
  const downByTitle = new Map<string, { title: string; type: string }>();
  for (const u of downstream) {
    const key = u.visualTitle || u.visualType || u.visualId;
    if (!downByTitle.has(key)) downByTitle.set(key, { title: key, type: u.visualType });
  }
  const downVisuals = [...downByTitle.values()];
  if (upstream.length === 0 && downVisuals.length === 0) return "";

  const MAX_VISUALS = 12;
  const shown = downVisuals.slice(0, MAX_VISUALS);
  const overflow = downVisuals.length - shown.length;

  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("graph LR");
  // Upstream measures
  upstream.forEach((dep, i) => {
    lines.push(`  m${i + 1}["${mmLabel(dep)}"]:::measure --> m0`);
  });
  // Current measure (always centre)
  lines.push(`  m0("${mmLabel(m.name)}"):::current`);
  // Downstream visuals
  shown.forEach((v, i) => {
    const label = mmTrunc(`${v.title}${v.type && v.type !== v.title ? " · " + v.type : ""}`);
    lines.push(`  m0 --> v${i + 1}["${mmLabel(label)}"]:::visual`);
  });
  if (overflow > 0) {
    lines.push(`  m0 --> vMore["+${overflow} more visual${overflow === 1 ? "" : "s"}"]:::more`);
  }
  // Styling — muted pastel fills so the graph stays subtle in both
  // dashboard + ADO Wiki themes.
  lines.push("  classDef current fill:#fff3b3,stroke:#b38f00,stroke-width:2px");
  lines.push("  classDef measure fill:#fde4c0,stroke:#b36200");
  lines.push("  classDef visual  fill:#d1e7dd,stroke:#0a7a3b");
  lines.push("  classDef more    fill:#eee,stroke:#888,color:#555");
  lines.push("```");
  return lines.join("\n");
}

/**
 * Render a Mermaid star-fragment graph for one fact table: the fact
 * table itself in the centre, its outgoing-relationship dimensions
 * arranged around it. Empty when the table has no outgoing
 * relationships (nothing to draw).
 *
 * Only called for fact tables (`classifyTable === "Fact"`). Bridge /
 * dimension / calc-group / disconnected / auto-date tables skip —
 * too many topology edge cases with too little reader value.
 */
function mermaidTableRelationships(t: TableData): string {
  const out = (t.relationships || []).filter(r => r.direction === "outgoing");
  if (out.length === 0) return "";

  // Dedupe by "to" table (a fact may reference the same dimension
  // through multiple FK columns — shown as one edge with a label
  // listing the FK column names).
  const byDim = new Map<string, string[]>();
  for (const r of out) {
    if (!byDim.has(r.toTable)) byDim.set(r.toTable, []);
    byDim.get(r.toTable)!.push(r.fromColumn);
  }

  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("graph LR");
  // Unique node id per table — use an index so duplicate names
  // across the emission don't cause id collisions.
  lines.push(`  f0("${mmLabel(t.name)}"):::fact`);
  let i = 1;
  for (const [dim, fks] of byDim) {
    const label = fks.length === 1 ? `[${fks[0]}]` : `[${fks.join(", ")}]`;
    lines.push(`  f0 -- "${mmLabel(label)}" --> d${i}["${mmLabel(dim)}"]:::dim`);
    i++;
  }
  lines.push("  classDef fact fill:#fde4c0,stroke:#b36200,stroke-width:2px");
  lines.push("  classDef dim  fill:#d1e7dd,stroke:#0a7a3b");
  lines.push("```");
  return lines.join("\n");
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
const BADGE_PROXY = '<span class="badge badge--calc">🌐 EXTERNAL</span>';

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
  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/Model -->`);
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
  lines.push(`| **Companion documents** | Data Dictionary · Sources · Measures · Functions · Calc Groups · Pages · Improvements · Index |`);
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
  // adoSlug collapses consecutive hyphens — "## 4. Data Dictionary — Summary"
  // (em-dash between two spaces) slugs to 4-data-dictionary-summary, not
  // 4-data-dictionary--summary. Matched here so the anchor-resolution
  // test passes on ADO Wiki.
  lines.push("4. [Data Dictionary — Summary](#4-data-dictionary-summary)  _(full inventory: Data Dictionary Reference)_");
  lines.push("5. [Measures — Summary](#5-measures-summary)");
  lines.push("6. [Calculation Groups](#6-calculation-groups-summary)");
  lines.push("7. [User-Defined Functions](#7-user-defined-functions-summary)");
  lines.push("8. [Report Pages](#8-report-pages)");
  lines.push("");
  lines.push("Appendix A — [Generation metadata](#appendix-a-generation-metadata)");
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
    // Table name is plain text — per-table detail lives in the
    // Data Dictionary Reference (separate file). Wrapping it in a
    // markdown link to `#${slug}` would 404 because this file has
    // no per-table sections.
    lines.push(`| ${esc(t.name)} | ${role} | ${t.columnCount} | ${t.measureCount} | ${t.keyCount} | ${t.fkCount} | ${t.hiddenColumnCount} |`);
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
    lines.push("| # | From | To | Cardinality | Filter | Active |");
    lines.push("|--:|------|----|:-----------:|:------:|:------:|");
    data.relationships.forEach((r, i) => {
      const card = `${r.fromCardinality} → ${r.toCardinality}`;
      const filter = r.crossFilteringBehavior === "bothDirections" ? "both ↔" : "single →";
      lines.push(`| ${i + 1} | ${esc(r.fromTable)}[${esc(r.fromColumn)}] | ${esc(r.toTable)}[${esc(r.toColumn)}] | ${card} | ${filter} | ${r.isActive ? "✓" : "—"} |`);
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
        // Plain text — see §2.2 comment for the rationale (no
        // per-table section in this doc).
        lines.push(`| ${esc(t.name)} | ${esc(p.mode)} | ${esc(p.sourceType)} | ${loc} |`);
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
    lines.push("| # | Page | Visibility | Visuals | Measures | Columns | Slicers |");
    lines.push("|--:|------|------------|--------:|---------:|--------:|--------:|");
    pages.forEach((p, i) => {
      const vis = hiddenSet.has(p.name) ? "Hidden" : "Visible";
      // Trim leading/trailing whitespace and collapse internal doubles —
      // PBIR sometimes persists those from accidental drag-reorders in
      // Desktop. Display only; the data layer still carries the raw name.
      const display = p.name.replace(/\s+/g, " ").trim();
      const dupTag = dupNames.has(display) ? " _(duplicate name)_" : "";
      lines.push(`| ${i + 1} | ${esc(display)}${dupTag} | ${vis} | ${p.visualCount} | ${p.measureCount} | ${p.columnCount} | ${p.slicerCount} |`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // §9 Data Quality Review intentionally lifted out into a separate
  // Improvements document (generateImprovementsMd). Keep this main spec
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
  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/Measures -->`);
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
        lines.push(`| [${esc(m.name)}](#${adoSlug(m.name)}) | ${remote} | ${esc(p.type)} | ${esc(m.table)} |`);
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
  const renderSection = (heading: string, _anchor: string, items: ModelMeasure[]) => {
    // <a id="..."> is redundant here — `## ${heading}` auto-anchors
    // to the same slug on every platform we render on.
    lines.push(`## ${heading}`);
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
      // Keep the <a id> anchor INSIDE the details — the <details>
      // element itself isn't anchorable by heading auto-slug, so this
      // is the jump target for the proxy-summary table at the top.
      // ADO Wiki honours this for <a id> in practice; if it ever
      // doesn't, the link lands at the nearest heading (the A-Z
      // letter section) which is close enough.
      lines.push(`<details>`);
      lines.push(`<a id="${adoSlug(m.name)}"></a>`);
      lines.push(`<summary><strong>${esc(m.name)}</strong>${proxyTag(m)} <small>— ${esc(m.table)}${statusTag}</small></summary>`);
      lines.push("");
      const meta = [
        `**Table:** ${esc(m.table)}`,
        `**Format:** ${esc(m.formatString) || "—"}`,
        `**Status:** ${isProxy ? '<span class="badge badge--calc">🌐 External proxy</span>' : statusLabel(m.status)}`,
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
      // Lineage graph: upstream measures → this measure → downstream
      // visuals. Emits a mermaid code block when the measure has
      // either dependencies or usage; otherwise skipped (no signal
      // to render). Mermaid renders natively in ADO Wiki + GitHub;
      // the dashboard falls back to rendering the source as a code
      // block (acceptable — the text lists below cover the same data).
      const mermaid = mermaidMeasureLineage(m);
      if (mermaid) {
        lines.push(`**Lineage**`);
        lines.push("");
        lines.push(mermaid);
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
  // Heading text is plain "Other" so its auto-slug is `other`,
  // matching the Jump-to link `[#](#other)`. The old form
  // "Other (non-letter starts)" adoSlugs to `other-non-letter-starts`
  // which wouldn't resolve.
  if (buckets.get("#")!.length > 0) renderSection("Other", "other", buckets.get("#")!);

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
  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/Functions -->`);
  lines.push(`# Functions Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");

  // Empty-model short-circuit — skip the entire front-matter block
  // and how-to-read preamble. A minimal doc reads better than a
  // full skeleton with one "no UDFs" line buried at the bottom.
  if (fns.length === 0) {
    lines.push("_This model defines no user-defined DAX functions._");
    lines.push("");
    lines.push("> User-defined functions are a Tabular 1702+ feature. When present, this document lists each one with its parameters, description, body, and the measures that reference it.");
    lines.push("");
    lines.push(`_Generated by powerbi-lineage · ${ts}_`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`> User-defined DAX functions declared in the model.`);
  lines.push("");
  lines.push("| At a glance | |");
  lines.push("|---|---|");
  lines.push(`| **Functions** | ${fns.length} |`);
  lines.push(`| With description | ${fns.filter(f => f.description && f.description.trim()).length} |`);
  lines.push("");
  lines.push("**How to read this:** Each function is collapsible. Click to expand for signature, description, parameters, the measures that reference it, and the DAX body.");
  lines.push("");
  lines.push("---");
  lines.push("");

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
  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/CalcGroups -->`);
  lines.push(`# Calculation Groups Reference`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");

  // Empty-model short-circuit — skip the whole front-matter and
  // teaching block when there are no calc groups to document.
  if (cgs.length === 0) {
    lines.push("_This model defines no calculation groups._");
    lines.push("");
    lines.push("> Calculation groups are a Tabular feature that rewrites measure expressions based on a slicer-selected item — classic use is Time Intelligence (Current / YTD / Prior Year). When present, this document lists each group's items, precedence, and DAX bodies.");
    lines.push("");
    lines.push(`_Generated by powerbi-lineage · ${ts}_`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`> Tabular calculation groups — items rewrite measure expressions based on slicer selection (e.g. Current / YTD / Prior Year).`);
  lines.push("");
  lines.push("| At a glance | |");
  lines.push("|---|---|");
  lines.push(`| **Calculation groups** | ${cgs.length} |`);
  lines.push(`| Total items | ${totalItems} |`);
  lines.push("");
  lines.push("**How to read this:** Each group lists its items as collapsibles. Items show the format-string override (when present) and the rewriting DAX expression. **Precedence** controls evaluation order when multiple groups apply at once — higher wins.");
  lines.push("");
  lines.push("---");
  lines.push("");

  // Jump nav: one entry per group.
  lines.push("## Jump to");
  lines.push("");
  // Each calc-group heading carries a number prefix (`## 1. Foo`) so
  // the heading auto-slug is `1-foo`, NOT just `foo` — the jump-to
  // links below need to match the auto-slug of the actual heading.
  lines.push(cgs.map((cg, i) => `[${cg.name}](#${adoSlug(`${i + 1}. ${cg.name}`)})`).join(" · "));
  lines.push("");
  lines.push("---");
  lines.push("");

  cgs.forEach((cg, i) => {
    lines.push(`## ${i + 1}. ${cg.name}`);
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
  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/DataDictionary -->`);
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

  // ── Group user tables by role so reviewers find the fact tables
  //     first, dimensions next, and infra-style tables last. Within each
  //     group: alphabetical. Same classifier the rest of the app uses.
  const tablesByRole = new Map<TableRole, TableData[]>();
  for (const t of userTablesSorted) {
    const role = classifyTable(t);
    if (!tablesByRole.has(role)) tablesByRole.set(role, []);
    tablesByRole.get(role)!.push(t);
  }
  // Display order: hot path first.
  const ROLE_ORDER: TableRole[] = ["Fact", "Bridge", "Dimension", "Disconnected", "Calculation Group"];
  const ROLE_LABEL: Record<TableRole, string> = {
    "Fact": "Fact tables",
    "Bridge": "Bridge tables",
    "Dimension": "Dimension tables",
    "Disconnected": "Disconnected tables",
    "Calculation Group": "Calculation groups",
    "Auto-date": "Auto-date infrastructure",
  };
  const orderedRoles = ROLE_ORDER.filter(r => (tablesByRole.get(r) || []).length > 0);

  // ── Jump nav — grouped by role for fast scanning ──────────────────────────
  lines.push("## Jump to");
  lines.push("");
  for (const role of orderedRoles) {
    const ts = tablesByRole.get(role)!;
    lines.push(`**${ROLE_LABEL[role]} (${ts.length}):** ` +
      ts.map(t => `[${t.name}](#${adoSlug(t.name)})`).join(" · "));
    lines.push("");
  }
  if (autoDateTables.length > 0) {
    lines.push(`_${autoDateTables.length} auto-date infrastructure tables collapsed at the bottom._`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // ── Per-role section, then per-table collapsibles ────────────────────────
  for (const role of orderedRoles) {
    const tablesInRole = tablesByRole.get(role)!;
    lines.push(`## ${ROLE_LABEL[role]} (${tablesInRole.length})`);
    lines.push("");
    for (const tbl of tablesInRole) {
      const cgTag = tbl.isCalcGroup ? " · _calculation group_" : "";
      // h3 — nested under the role's h2 ("## Fact tables (N)").
      // Heading slug is text-only, so anchor (#tbl-name) still resolves.
      lines.push(`### ${tbl.name}`);
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

      // Star-fragment Mermaid — fact tables only.
      if (classifyTable(tbl) === "Fact") {
        const mermaid = mermaidTableRelationships(tbl);
        if (mermaid) {
          lines.push("#### Star fragment");
          lines.push("");
          lines.push(mermaid);
          lines.push("");
        }
      }

      // ── Columns ─────────────────────────────────────────────────────────
      if (tbl.columns.length === 0) {
        lines.push("_No columns._");
        lines.push("");
      } else {
        lines.push("#### Columns");
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
          const summ = c.summarizeBy && c.summarizeBy !== "none" ? esc(c.summarizeBy) : "—";
          const cat = c.dataCategory && c.dataCategory !== "Uncategorized" ? esc(c.dataCategory) : "—";
          lines.push(`| ${i + 1} | ${esc(c.name)} | ${esc(c.dataType)} | ${cstr} | ${summ} | ${esc(c.sortByColumn) || "—"} | ${cat} | ${esc(c.formatString) || "—"} | ${esc(c.description) || "—"} |`);
        });
        lines.push("");
      }

      // ── Hierarchies ─────────────────────────────────────────────────────
      if (tbl.hierarchies.length > 0) {
        lines.push("#### Hierarchies");
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
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
// Data Sources document — Tier-1 doc-generation addition
//
// A focused catalog of where every table gets its data. The main
// model.md lists tables but doesn't surface the source topology
// (connection types, file paths, DirectQuery entity references, etc.).
// Auditors and data-governance reviewers read this to understand
// what external systems the model depends on.
//
// Sections:
//   1. Summary — source-type counts, partition modes breakdown
//   2. Data Sources — tables grouped by sourceType / folder
//   3. Field Parameters — parameterKind === "field" tables
//   4. Composite Model Proxies — parameterKind === "compositeModelProxy"
//   5. Calculation Groups — short cross-ref to calcgroups.md
//   6. Appendix — auto-date infrastructure
//
// Uses the same folder-vs-file grouping logic the Tables tab uses —
// Parquet / Excel / CSV etc. get collapsed by containing folder so a
// multi-file model doesn't shard into N single-table sources.
// ═══════════════════════════════════════════════════════════════════════════════

// File-based source types: sourceLocation is path+filename. Group by
// containing folder rather than full path so sibling tables collapse
// into one branch. Mirrors client/main.ts's T_FILE_SOURCE_TYPES.
const FILE_SOURCE_TYPES = new Set([
  "Parquet", "Excel", "CSV", "JSON", "XML", "Access",
  "Inline (encoded)", "Inline data",
]);

function splitPath(loc: string): { folder: string; file: string } {
  if (!loc) return { folder: "", file: "" };
  const i = Math.max(loc.lastIndexOf("/"), loc.lastIndexOf("\\"));
  if (i < 0) return { folder: "", file: loc };
  return { folder: loc.substring(0, i), file: loc.substring(i + 1) };
}

function folderTail(folder: string): string {
  if (!folder) return "";
  const i = Math.max(folder.lastIndexOf("/"), folder.lastIndexOf("\\"));
  return i >= 0 ? folder.substring(i + 1) : folder;
}

interface SourceBucket {
  key: string;
  label: string;
  sub: string;
  tables: TableData[];
}

function sourceBucketFor(t: TableData): { key: string; label: string; sub: string } {
  const p = t.partitions && t.partitions[0];
  if (!p) return { key: "__nosrc__", label: "No source", sub: "" };
  if (p.sourceType === "Analysis Services") {
    const loc = p.sourceLocation || "";
    const tail = loc.includes("/") ? loc.substring(loc.lastIndexOf("/") + 1) : loc;
    return { key: "AS:" + loc, label: "AS · " + (tail || "(unknown)"), sub: loc };
  }
  if (FILE_SOURCE_TYPES.has(p.sourceType)) {
    const { folder } = splitPath(p.sourceLocation || "");
    if (folder) {
      const tail = folderTail(folder);
      return { key: p.sourceType + "|" + folder, label: p.sourceType + (tail ? " · " + tail : ""), sub: folder };
    }
    return { key: p.sourceType + "|__all__", label: p.sourceType, sub: "" };
  }
  return { key: p.sourceType + "|" + (p.sourceLocation || ""), label: p.sourceType, sub: p.sourceLocation || "" };
}

function fileSubFor(t: TableData): string {
  const p = t.partitions && t.partitions[0];
  if (!p || !FILE_SOURCE_TYPES.has(p.sourceType)) return "";
  const { file } = splitPath(p.sourceLocation || "");
  return file || "";
}

export function generateSourcesMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];

  const userTables = data.tables.filter(t => t.origin !== "auto-date");
  const autoDateTables = data.tables.filter(t => t.origin === "auto-date");
  const fieldParams = userTables.filter(t => t.parameterKind === "field");
  const proxyTables = userTables.filter(t => t.parameterKind === "compositeModelProxy");
  const calcGroupTablesLocal = userTables.filter(t => t.isCalcGroup);
  const regularTables = userTables.filter(
    t => !t.parameterKind && !t.isCalcGroup,
  );

  const buckets = new Map<string, SourceBucket>();
  for (const t of regularTables) {
    const b = sourceBucketFor(t);
    if (!buckets.has(b.key)) {
      buckets.set(b.key, { key: b.key, label: b.label, sub: b.sub, tables: [] });
    }
    buckets.get(b.key)!.tables.push(t);
  }
  const sortedBuckets = [...buckets.values()].sort((a, b) => {
    if (a.key === "__nosrc__" && b.key !== "__nosrc__") return 1;
    if (b.key === "__nosrc__" && a.key !== "__nosrc__") return -1;
    return a.label.localeCompare(b.label);
  });

  const modeCounts: Record<string, number> = {};
  for (const t of userTables) {
    for (const p of t.partitions || []) {
      const m = p.mode || "unknown";
      modeCounts[m] = (modeCounts[m] || 0) + 1;
    }
  }

  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/Sources -->`);
  lines.push(`# Data Sources`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push(`> Where every table in the model gets its data — connection type, partition mode, and the tables each source feeds.`);
  lines.push("");

  lines.push("| At a glance | |");
  lines.push("|---|---|");
  lines.push(`| **Source buckets** | ${sortedBuckets.length} |`);
  lines.push(`| User tables with a source | ${regularTables.length} |`);
  if (fieldParams.length > 0) lines.push(`| Field parameters | ${fieldParams.length} |`);
  if (proxyTables.length > 0) lines.push(`| Composite-model proxies | ${proxyTables.length} |`);
  if (calcGroupTablesLocal.length > 0) lines.push(`| Calculation groups | ${calcGroupTablesLocal.length} |`);
  if (autoDateTables.length > 0) lines.push(`| Auto-date infrastructure | ${autoDateTables.length} _(appendix)_ |`);
  lines.push("");

  if (Object.keys(modeCounts).length > 0) {
    lines.push(`**Partitions by storage mode:** ` +
      Object.entries(modeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([mode, n]) => `\`${mode}\` × ${n}`)
        .join(" · "));
    lines.push("");
  }
  lines.push(`**How to read this:** §2 lists each data source bucket with the tables it feeds. §3 / §4 / §5 cover field parameters, composite-model proxies, and calc groups separately because they're not real "data sources" in the connection sense.`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push(`## 2. Data Sources`);
  lines.push("");
  if (sortedBuckets.length === 0) {
    lines.push("_No user tables have partitions (calc groups / field parameters / proxies only)._");
    lines.push("");
  } else {
    for (const b of sortedBuckets) {
      lines.push(`### ${esc(b.label)}`);
      lines.push("");
      if (b.sub) {
        lines.push(`\`${esc(b.sub)}\``);
        lines.push("");
      }
      lines.push(`**${b.tables.length} table${b.tables.length === 1 ? "" : "s"}** backing this source.`);
      lines.push("");
      lines.push("| Table | Mode | Kind | Columns | Measures | File / detail |");
      lines.push("|---|---|---|--:|--:|---|");
      for (const t of b.tables.sort((a, b) => a.name.localeCompare(b.name))) {
        const p = t.partitions[0];
        const mode = p ? p.mode : "—";
        const kind = p ? (p.partitionKind || "—") : "—";
        const sub = fileSubFor(t) || (p?.expressionSource ? `expr: ${p.expressionSource}` : "");
        lines.push(`| ${esc(t.name)} | \`${esc(mode)}\` | \`${esc(kind)}\` | ${t.columnCount} | ${t.measureCount} | ${esc(sub) || "—"} |`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // ── 2.1 Native queries ────────────────────────────────────────────────────
  // Surface the actual SQL that each `Value.NativeQuery(...)` or
  // `Sql.Database(..., [Query="..."])` partition runs against its source.
  // Power BI's folded query output is machine-generated — the hand-written
  // SQL in the partition is what the data engineer needs to review.
  const nativeQueries: Array<{ table: string; partition: string; sql: string }> = [];
  for (const t of regularTables) {
    for (const p of t.partitions) {
      if (p.nativeQuery) {
        nativeQueries.push({ table: t.name, partition: p.name, sql: p.nativeQuery });
      }
    }
  }
  if (nativeQueries.length > 0) {
    lines.push(`## 2.1 Native queries`);
    lines.push("");
    lines.push(`**${nativeQueries.length}** partition${nativeQueries.length === 1 ? "" : "s"} execute${nativeQueries.length === 1 ? "s" : ""} a hand-written SQL query instead of relying on folded M. The SQL below is exactly what the source database receives.`);
    lines.push("");
    for (const nq of nativeQueries) {
      lines.push(`### \`${esc(nq.table)}\``);
      lines.push("");
      if (nq.partition && nq.partition !== nq.table) {
        lines.push(`_Partition: \`${esc(nq.partition)}\`_`);
        lines.push("");
      }
      lines.push("```sql");
      lines.push(nq.sql);
      lines.push("```");
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  // ── 2.2 M-step breakdown ──────────────────────────────────────────────────
  // Per-partition ETL walk — each step classified by its primary verb so
  // the review eye can jump straight to filter / join / custom steps
  // without reading raw M.
  const withSteps = regularTables.filter(t => t.partitions.some(p => p.steps && p.steps.length > 0));
  if (withSteps.length > 0) {
    lines.push(`## 2.2 M-step breakdown`);
    lines.push("");
    lines.push(`**${withSteps.length}** table${withSteps.length === 1 ? "" : "s"} with a \`let … in\` M body. Each step below is classified by its dominant M function so you can spot filter / join / custom steps without reading raw M.`);
    lines.push("");
    for (const t of withSteps) {
      for (const p of t.partitions) {
        if (!p.steps || p.steps.length === 0) continue;
        lines.push(`### \`${esc(t.name)}\``);
        lines.push("");
        if (p.name && p.name !== t.name) {
          lines.push(`_Partition: \`${esc(p.name)}\`_`);
          lines.push("");
        }
        lines.push("| # | Step | Kind | Function | Detail |");
        lines.push("|--:|------|:-----|----------|--------|");
        p.steps.forEach((s, i) => {
          const fn = s.primaryFn ? `\`${esc(s.primaryFn)}\`` : "—";
          const detail = s.summary ? esc(s.summary) : "—";
          lines.push(`| ${i + 1} | ${esc(s.name)} | \`${s.kind}\` | ${fn} | ${detail} |`);
        });
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(`## 3. Field Parameters`);
  lines.push("");
  if (fieldParams.length === 0) {
    lines.push("_None — the model doesn't use Power BI's field-parameter feature._");
    lines.push("");
  } else {
    lines.push(`Tables created via Power BI's field-parameter UI — each column carries the \`extendedProperty ParameterMetadata\` annotation. These drive slicer-controlled measure / field switching at runtime.`);
    lines.push("");
    for (const t of fieldParams.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`### \`${esc(t.name)}\``);
      lines.push("");
      if (t.description) {
        lines.push(`> ${esc(t.description).replace(/\n/g, " ")}`);
        lines.push("");
      }
      lines.push(`${t.columnCount} column${t.columnCount === 1 ? "" : "s"}:`);
      lines.push("");
      for (const c of t.columns) {
        const hidden = c.isHidden ? " " + BADGE_HIDDEN : "";
        const sort = c.sortByColumn ? ` _(sorted by \`${esc(c.sortByColumn)}\`)_` : "";
        lines.push(`- **${esc(c.name)}** · \`${esc(c.dataType)}\`${hidden}${sort}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(`## 4. Composite Model Proxies`);
  lines.push("");
  if (proxyTables.length === 0) {
    lines.push("_None — the model doesn't use DirectQuery-to-AS composite references._");
    lines.push("");
  } else {
    lines.push(`Single-column DirectQuery-to-Analysis-Services proxy tables. These are remote-handle stubs Power BI auto-generates when a composite model references a remote AS cube. They're not real user tables — the data lives in the remote model.`);
    lines.push("");
    const byModel = new Map<string, TableData[]>();
    for (const t of proxyTables) {
      const p = (t.partitions || []).find(p => p.mode === "directQuery" && p.expressionSource);
      const exprSrc = p?.expressionSource || "";
      const m = exprSrc.match(/^DirectQuery to AS - (.+)$/);
      const key = m ? m[1] : exprSrc || "Unknown";
      if (!byModel.has(key)) byModel.set(key, []);
      byModel.get(key)!.push(t);
    }
    for (const [modelName, tables] of [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`### Remote model: \`${esc(modelName)}\``);
      lines.push("");
      lines.push(`**${tables.length} proxy table${tables.length === 1 ? "" : "s"}**:`);
      lines.push("");
      for (const t of tables.sort((a, b) => a.name.localeCompare(b.name))) {
        const desc = t.description ? ` — ${esc(t.description).replace(/\n/g, " ")}` : "";
        lines.push(`- **${esc(t.name)}**${desc}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(`## 5. Calculation Groups`);
  lines.push("");
  if (calcGroupTablesLocal.length === 0) {
    lines.push("_None._");
    lines.push("");
  } else {
    lines.push(`${calcGroupTablesLocal.length} calc group${calcGroupTablesLocal.length === 1 ? "" : "s"} — full details in the Calc Groups reference document.`);
    lines.push("");
    for (const t of calcGroupTablesLocal.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- **${esc(t.name)}**`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  if (autoDateTables.length > 0) {
    lines.push(`## Appendix — Auto-date infrastructure`);
    lines.push("");
    lines.push(`<details><summary>${autoDateTables.length} auto-date table${autoDateTables.length === 1 ? "" : "s"} (\`LocalDateTable_*\`, \`DateTableTemplate_*\`)</summary>`);
    lines.push("");
    lines.push(`These are Power BI-generated infrastructure tables — one per date column when **Auto Date/Time** is enabled. Not user-authored content; listed for completeness only.`);
    lines.push("");
    lines.push("| Name | Columns |");
    lines.push("|---|--:|");
    for (const t of autoDateTables.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| \`${esc(t.name)}\` | ${t.columnCount} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Report Pages document — Tier-1 doc-generation addition
//
// model.md §8 lists one row per page. This doc goes deep — every
// visual, its type, title, and field bindings. For stakeholders who
// want "what's actually on page X" without opening Power BI.
// ═══════════════════════════════════════════════════════════════════════════════

export function generatePagesMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const lines: string[] = [];
  const hiddenSet = new Set(data.hiddenPages || []);

  // Split visible from hidden up front. Visible pages get full per-
  // page sections in binding-count-descending order (biggest-impact
  // pages first). Hidden pages — usually tooltip / drillthrough
  // scaffolds — collapse into an appendix at the end so they don't
  // crowd out the real content.
  const visible = data.pages
    .filter(p => !hiddenSet.has(p.name))
    .sort((a, b) => (b.measureCount + b.columnCount) - (a.measureCount + a.columnCount)
                  || b.visualCount - a.visualCount
                  || a.name.localeCompare(b.name));
  const hidden = data.pages
    .filter(p => hiddenSet.has(p.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalVisuals = data.pages.reduce((a, p) => a + (p.visualCount || 0), 0);
  const totalMeasures = data.pages.reduce((a, p) => a + (p.measureCount || 0), 0);
  const totalColumns = data.pages.reduce((a, p) => a + (p.columnCount || 0), 0);

  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/Pages -->`);
  lines.push(`# Report Pages`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");

  // Front-matter triptych
  lines.push(`> Every page in the report — what visuals are on it and what model fields each visual binds to.`);
  lines.push("");

  lines.push("| At a glance | |");
  lines.push("|---|---|");
  lines.push(`| **Visible pages** | ${visible.length} |`);
  lines.push(`| Hidden pages _(tooltips / drillthrough)_ | ${hidden.length} |`);
  lines.push(`| Visuals across all pages | ${totalVisuals} |`);
  lines.push(`| Measure bindings | ${totalMeasures} |`);
  lines.push(`| Column bindings | ${totalColumns} |`);
  lines.push("");
  lines.push(`**How to read this:** Visible pages come first, sorted by binding count (biggest-impact pages on top). Each section opens with a stats line; click "Visuals (N)" to see the full per-visual binding table. Hidden / utility pages live in the appendix at the end.`);
  lines.push("");

  if (data.pages.length === 0) {
    lines.push("_No pages analysed._");
    lines.push("");
    lines.push(`_Generated by powerbi-lineage · ${ts}_`);
    return lines.join("\n");
  }

  // Page index — only visible pages, with binding-count badge
  if (visible.length > 0) {
    lines.push(`### Visible page index`);
    lines.push("");
    for (const p of visible) {
      const anchor = adoSlug(`${p.name}`);
      lines.push(`- [${esc(p.name)}](#${anchor}) — ${p.visualCount} visual${p.visualCount === 1 ? "" : "s"}, ${p.measureCount} measure${p.measureCount === 1 ? "" : "s"}, ${p.columnCount} column${p.columnCount === 1 ? "" : "s"}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  // Visible pages — full sections
  if (visible.length > 0) {
    lines.push(`## Visible pages (${visible.length})`);
    lines.push("");
  }
  for (const p of visible) {
    lines.push(`### ${esc(p.name)}`);
    lines.push("");

    // Compact one-line stats instead of a 5-row stat table
    const statBits: string[] = [];
    statBits.push(`**${p.visualCount}** visual${p.visualCount === 1 ? "" : "s"}`);
    if (p.slicerCount > 0) statBits.push(`**${p.slicerCount}** slicer${p.slicerCount === 1 ? "" : "s"}`);
    if (p.measureCount > 0) statBits.push(`**${p.measureCount}** measure${p.measureCount === 1 ? "" : "s"}`);
    if (p.columnCount > 0) statBits.push(`**${p.columnCount}** column${p.columnCount === 1 ? "" : "s"}`);
    lines.push(statBits.join(" · "));
    lines.push("");

    if (p.typeCounts && Object.keys(p.typeCounts).length > 0) {
      const types = Object.entries(p.typeCounts).sort((a, b) => b[1] - a[1]);
      lines.push(`_Visual types:_ ` + types.map(([t, n]) => `\`${esc(t)}\` × ${n}`).join(" · "));
      lines.push("");
    }

    if (p.visuals && p.visuals.length > 0) {
      lines.push(`<details><summary><b>Visuals (${p.visuals.length})</b></summary>`);
      lines.push("");
      lines.push("| # | Type | Title | Bindings |");
      lines.push("|--:|---|---|---|");
      p.visuals.forEach((v, i) => {
        const title = v.title && v.title !== v.type ? v.title : "_(no title)_";
        const bindings = v.bindings && v.bindings.length > 0
          ? v.bindings.map(b => {
              const kindIcon = b.fieldType === "measure" ? "ƒ" : "▦";
              return `${kindIcon} \`${esc(b.fieldTable)}[${esc(b.fieldName)}]\``;
            }).join("<br>")
          : "_(none)_";
        lines.push(`| ${i + 1} | \`${esc(v.type)}\` | ${esc(title)} | ${bindings} |`);
      });
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }

    // Combined fan-in list — collapsed by default to keep the section short
    if ((p.measures && p.measures.length > 0) || (p.columns && p.columns.length > 0)) {
      const totalRefs = (p.measures?.length || 0) + (p.columns?.length || 0);
      lines.push(`<details><summary>Fields referenced (${totalRefs})</summary>`);
      lines.push("");
      if (p.measures && p.measures.length > 0) {
        lines.push(`**Measures (${p.measures.length}):** ` +
          [...p.measures].sort().map(m => `\`${esc(m)}\``).join(", "));
        lines.push("");
      }
      if (p.columns && p.columns.length > 0) {
        lines.push(`**Columns (${p.columns.length}):** ` +
          [...p.columns].sort().map(c => `\`${esc(c)}\``).join(", "));
        lines.push("");
      }
      lines.push("</details>");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  // Hidden pages — appendix, collapsed by default
  if (hidden.length > 0) {
    lines.push(`## Appendix — Hidden pages (${hidden.length})`);
    lines.push("");
    lines.push(`<details><summary>Show ${hidden.length} hidden page${hidden.length === 1 ? "" : "s"} _(tooltip / drillthrough scaffolds)_</summary>`);
    lines.push("");
    lines.push(`These pages don't appear in the report's page-tab strip — usually tooltip pages, drillthrough targets, or text-only scaffolds. Listed for completeness.`);
    lines.push("");
    lines.push("| Page | Visuals | Slicers | Bindings (m + c) |");
    lines.push("|---|--:|--:|--:|");
    for (const p of hidden) {
      const totalBind = (p.measureCount || 0) + (p.columnCount || 0);
      lines.push(`| ${esc(p.name)} | ${p.visualCount} | ${p.slicerCount} | ${totalBind} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Model Glossary / Index — Tier-1 doc-generation addition
//
// Alphabetical reference of every named entity (table, column,
// measure, UDF, calc group, calc item) with its description and
// kind. Makes the MD docs genuinely searchable — readers jump to
// this doc to find any term and then follow the reference to its
// primary doc.
// ═══════════════════════════════════════════════════════════════════════════════

interface IndexEntry {
  name: string;
  kind: "Table" | "Column" | "Measure" | "UDF" | "Calc group" | "Calc item";
  parent?: string;
  description: string;
  note: string;
}

export function generateIndexMd(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const entries: IndexEntry[] = [];

  const isAutoName = (name: string) => /^LocalDateTable_|^DateTableTemplate_/.test(name);

  for (const t of data.tables) {
    if (isAutoName(t.name)) continue;
    const notes: string[] = [];
    if (t.isCalcGroup) notes.push("calc group");
    if (t.parameterKind === "field") notes.push("field parameter");
    if (t.parameterKind === "compositeModelProxy") notes.push("composite proxy");
    if (t.isCalculatedTable) notes.push("calculated table");
    entries.push({
      name: t.name,
      kind: t.isCalcGroup ? "Calc group" : "Table",
      description: t.description || "",
      note: notes.join(", "),
    });
  }

  const calcGroupTableNames = new Set(data.calcGroups.map(cg => cg.name));
  for (const c of data.columns) {
    if (isAutoName(c.table)) continue;
    if (calcGroupTableNames.has(c.table) && c.name === "Name") continue;
    const notes: string[] = [];
    if (c.isKey) notes.push("key");
    if (c.isCalculated) notes.push("calculated");
    if (c.isHidden) notes.push("hidden");
    entries.push({
      name: c.name,
      kind: "Column",
      parent: c.table,
      description: c.description || "",
      note: notes.join(", "),
    });
  }

  for (const m of data.measures) {
    if (isAutoName(m.table)) continue;
    const notes: string[] = [];
    if (m.externalProxy) notes.push(`external proxy → ${m.externalProxy.externalModel}[${m.externalProxy.remoteName}]`);
    if (m.status === "unused") notes.push("unused");
    else if (m.status === "indirect") notes.push("indirect");
    entries.push({
      name: m.name,
      kind: "Measure",
      parent: m.table,
      description: m.description || "",
      note: notes.join(", "),
    });
  }

  for (const f of data.functions) {
    if (f.name.endsWith(".About")) continue;
    entries.push({
      name: f.name,
      kind: "UDF",
      description: f.description || "",
      note: f.parameters || "",
    });
  }

  for (const cg of data.calcGroups) {
    for (const item of cg.items) {
      entries.push({
        name: item.name,
        kind: "Calc item",
        parent: cg.name,
        description: item.description || "",
        note: "",
      });
    }
  }

  const byLetter = new Map<string, IndexEntry[]>();
  for (const e of entries) {
    const first = e.name.charAt(0).toUpperCase();
    const bucket = /[A-Z]/.test(first) ? first : "#";
    if (!byLetter.has(bucket)) byLetter.set(bucket, []);
    byLetter.get(bucket)!.push(e);
  }
  const letters = [...byLetter.keys()].sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b);
  });
  for (const l of letters) {
    byLetter.get(l)!.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
  }

  const byKind: Record<string, number> = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;

  const lines: string[] = [];
  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/Index -->`);
  lines.push(`# Model Glossary`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");

  // Front-matter triptych: elevator + at-a-glance + how-to-read
  lines.push(`> Look up any named entity in the model — tables, columns, measures, UDFs, calc groups, calc items — and find its parent + description in one place.`);
  lines.push("");

  lines.push("| At a glance | |");
  lines.push("|---|---|");
  lines.push(`| **Total entries** | ${entries.length} |`);
  for (const kind of ["Table", "Column", "Measure", "UDF", "Calc group", "Calc item"]) {
    if (byKind[kind]) lines.push(`| ${kind}s | ${byKind[kind]} |`);
  }
  lines.push(`| Letter groups | ${letters.length} |`);
  lines.push("");
  lines.push(`**How to read this:** Each letter section groups entries by Kind (Tables → Measures → Columns → Calc items → UDFs). Use the jump-bar — counts in parentheses tell you which letters are dense.`);
  lines.push("");

  // Jump-bar with per-letter density
  lines.push(`**Jump to:** ` +
    letters.map(l => {
      const target = adoSlug(l === "#" ? "other" : l);
      const count = byLetter.get(l)!.length;
      return `[${l} (${count})](#${target})`;
    }).join(" · "));
  lines.push("");
  lines.push("---");
  lines.push("");

  // Kind ordering inside each letter — Tables/Calc groups (anchors)
  // first, then user-facing Measures, then Columns (the bulk), then
  // Calc items + UDFs (smaller buckets).
  const KIND_ORDER: Record<string, number> = {
    "Table": 0, "Calc group": 1, "Measure": 2,
    "UDF": 3, "Calc item": 4, "Column": 5,
  };

  for (const l of letters) {
    const header = l === "#" ? "Other" : l;
    const letterEntries = byLetter.get(l)!;
    lines.push(`## ${header}`);
    lines.push("");

    // Group within letter by Kind
    const byKindLocal = new Map<string, IndexEntry[]>();
    for (const e of letterEntries) {
      if (!byKindLocal.has(e.kind)) byKindLocal.set(e.kind, []);
      byKindLocal.get(e.kind)!.push(e);
    }
    const orderedKinds = [...byKindLocal.keys()].sort(
      (a, b) => (KIND_ORDER[a] ?? 9) - (KIND_ORDER[b] ?? 9),
    );

    for (const kind of orderedKinds) {
      const items = byKindLocal.get(kind)!;
      // Pluralise the section header
      const label = kind === "Calc group" ? "Calc groups"
                  : kind === "Calc item"  ? "Calc items"
                  : kind + "s";
      lines.push(`### ${label} (${items.length})`);
      lines.push("");
      // Compact one-line entries — parent in italics, description trimmed
      for (const e of items) {
        const parent = e.parent ? ` _(in \`${esc(e.parent)}\`)_` : "";
        const note = e.note ? ` · _${esc(e.note)}_` : "";
        const desc = e.description
          ? " — " + esc(e.description).substring(0, 110) + (e.description.length > 110 ? "…" : "")
          : "";
        lines.push(`- **\`${esc(e.name)}\`**${parent}${note}${desc}`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}
