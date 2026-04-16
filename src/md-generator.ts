import type { FullData } from "./data-builder.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Semantic Model Documentation — Markdown
// No DAX expressions are included.
//
// Structure:
//   Title
//   Table of contents
//   1. Tables
//      <Table name>
//        1.1 Columns
//        1.2 Measures
//        1.3 Relationships
//   2. Relationships
//   3. Measures
//   4. Functions           (with fallback if empty)
//   5. Calculation Groups  (with fallback if empty)
//   6. Pages
//      <Page name>          (each page is its own subsection)
// ═══════════════════════════════════════════════════════════════════════════════

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function statusLabel(s: "direct" | "indirect" | "unused" | string): string {
  if (s === "direct") return "Direct";
  if (s === "indirect") return "Indirect";
  if (s === "unused") return "Unused";
  return String(s);
}

/**
 * Produce a GitHub-compatible slug for in-document anchor links.
 * Rules: lowercase, drop non-alphanumeric (except -), spaces → "-", collapse, trim.
 */
function slug(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateMarkdown(data: FullData, reportName: string): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const hiddenSet = new Set(data.hiddenPages || []);
  const lines: string[] = [];

  // Sort tables and pages up-front so TOC and bodies stay in sync.
  const tables = [...data.tables].sort((a, b) => a.name.localeCompare(b.name));
  const pages = [...data.pages].sort((a, b) => a.name.localeCompare(b.name));
  const functions = data.functions.filter(f => !f.name.endsWith(".About"));
  const calcGroups = data.calcGroups;

  // ── Title ─────────────────────────────────────────────────────────────────
  lines.push(`# Semantic Model: ${reportName}`);
  lines.push("");
  lines.push(`_Generated ${ts} · DAX expressions omitted._`);
  lines.push("");

  // ── Table of Contents ─────────────────────────────────────────────────────
  lines.push("## Table of Contents");
  lines.push("");
  lines.push(`1. [Tables](#1-tables)`);
  for (const t of tables) {
    lines.push(`    - [${t.name}](#${slug(t.name)})`);
  }
  lines.push(`2. [Relationships](#2-relationships)`);
  lines.push(`3. [Measures](#3-measures)`);
  lines.push(`4. [Functions](#4-functions)`);
  lines.push(`5. [Calculation Groups](#5-calculation-groups)`);
  lines.push(`6. [Pages](#6-pages)`);
  for (const p of pages) {
    lines.push(`    - [${p.name}](#${slug(p.name)})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── 1. Tables ─────────────────────────────────────────────────────────────
  lines.push("## 1. Tables");
  lines.push("");
  if (tables.length === 0) {
    lines.push("_No tables found in this model._");
    lines.push("");
  } else {
    for (const tbl of tables) {
      const cgTag = tbl.isCalcGroup ? " _(calculation group)_" : "";
      lines.push(`### ${tbl.name}${cgTag}`);
      lines.push("");
      if (tbl.description) {
        lines.push(`> ${tbl.description.replace(/\n/g, " ")}`);
        lines.push("");
      }
      lines.push(`**${tbl.columnCount}** columns · **${tbl.measureCount}** measures · **${tbl.keyCount}** keys · **${tbl.fkCount}** FKs · **${tbl.hiddenColumnCount}** hidden`);
      lines.push("");

      // 1.1 Columns
      lines.push(`#### 1.1 Columns`);
      lines.push("");
      if (tbl.columns.length === 0) {
        lines.push("_No columns._");
        lines.push("");
      } else {
        lines.push("| Name | Type | Keys | Relationship | Status | Notes | Description |");
        lines.push("|------|------|------|--------------|--------|-------|-------------|");
        for (const c of tbl.columns) {
          const keyParts: string[] = [];
          if (c.isKey) keyParts.push("PK");
          else if (c.isInferredPK) keyParts.push("PK*");
          if (c.isFK) keyParts.push("FK");
          const keys = keyParts.join(" ") || "—";

          const relParts: string[] = [];
          if (c.isFK && c.fkTarget) relParts.push(`→ ${c.fkTarget.table}[${c.fkTarget.column}]`);
          if (c.incomingRefs && c.incomingRefs.length > 0) {
            for (const r of c.incomingRefs) {
              relParts.push(`← ${r.table}[${r.column}]${r.isActive ? "" : " (inactive)"}`);
            }
          }
          const rel = relParts.join("<br>") || "—";

          const notes: string[] = [];
          if (c.isCalculated) notes.push("Calculated");
          if (c.isHidden) notes.push("Hidden");

          lines.push(`| ${esc(c.name)} | ${esc(c.dataType)} | ${keys} | ${rel} | ${statusLabel(c.status)} | ${notes.join(", ") || "—"} | ${esc(c.description) || "—"} |`);
        }
        lines.push("");
      }

      // 1.2 Measures (on this table)
      lines.push(`#### 1.2 Measures`);
      lines.push("");
      if (tbl.measures.length === 0) {
        lines.push("_No measures on this table._");
        lines.push("");
      } else {
        lines.push("| Name | Status | Visuals | Description |");
        lines.push("|------|--------|--------:|-------------|");
        for (const m of tbl.measures) {
          const full = data.measures.find(x => x.name === m.name && x.table === tbl.name);
          const desc = full?.description ? esc(full.description) : "—";
          lines.push(`| ${esc(m.name)} | ${statusLabel(m.status)} | ${m.usageCount} | ${desc} |`);
        }
        lines.push("");
      }

      // 1.3 Relationships (involving this table)
      lines.push(`#### 1.3 Relationships`);
      lines.push("");
      if (tbl.relationships.length === 0) {
        lines.push("_No relationships._");
        lines.push("");
      } else {
        for (const r of tbl.relationships) {
          const arrow = r.direction === "outgoing" ? "→" : "←";
          const self = r.direction === "outgoing" ? `[${r.fromColumn}]` : `[${r.toColumn}]`;
          const other = r.direction === "outgoing" ? `${r.toTable}[${r.toColumn}]` : `${r.fromTable}[${r.fromColumn}]`;
          const dir = r.direction === "outgoing" ? "FK" : "PK";
          const inactive = r.isActive ? "" : " _(inactive)_";
          lines.push(`- **${dir}** ${self} ${arrow} ${other}${inactive}`);
        }
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");

  // ── 2. Relationships ──────────────────────────────────────────────────────
  lines.push("## 2. Relationships");
  lines.push("");
  if (data.relationships.length === 0) {
    lines.push("_No relationships defined in this model._");
    lines.push("");
  } else {
    lines.push("| From | To | Active |");
    lines.push("|------|----|:------:|");
    for (const r of data.relationships) {
      lines.push(`| ${esc(r.fromTable)}[${esc(r.fromColumn)}] | ${esc(r.toTable)}[${esc(r.toColumn)}] | ${r.isActive ? "✓" : "—"} |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // ── 3. Measures ───────────────────────────────────────────────────────────
  lines.push("## 3. Measures");
  lines.push("");
  if (data.measures.length === 0) {
    lines.push("_No measures defined in this model._");
    lines.push("");
  } else {
    lines.push("| Measure | Table | Format | Status | Visuals | Pages | Depends On | Description |");
    lines.push("|---------|-------|--------|--------|--------:|------:|------------|-------------|");
    const sorted = [...data.measures].sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name));
    for (const m of sorted) {
      const deps = m.daxDependencies.length > 0 ? m.daxDependencies.map(esc).join(", ") : "—";
      lines.push(`| ${esc(m.name)} | ${esc(m.table)} | ${esc(m.formatString) || "—"} | ${statusLabel(m.status)} | ${m.usageCount} | ${m.pageCount} | ${deps} | ${esc(m.description) || "—"} |`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // ── 4. Functions ──────────────────────────────────────────────────────────
  lines.push("## 4. Functions");
  lines.push("");
  if (functions.length === 0) {
    lines.push("_No functions in this model._");
    lines.push("");
  } else {
    for (const f of functions) {
      lines.push(`### ${f.name}`);
      lines.push("");
      if (f.description) {
        lines.push(f.description);
        lines.push("");
      }
      lines.push("**Parameters:** " + (f.parameters ? "`" + f.parameters + "`" : "_none_"));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");

  // ── 5. Calculation Groups ─────────────────────────────────────────────────
  lines.push("## 5. Calculation Groups");
  lines.push("");
  if (calcGroups.length === 0) {
    lines.push("_No calculation groups in this model._");
    lines.push("");
  } else {
    for (const cg of calcGroups) {
      lines.push(`### ${cg.name}`);
      lines.push("");
      if (cg.description) {
        lines.push(cg.description);
        lines.push("");
      }
      lines.push(`Precedence: **${cg.precedence}** · ${cg.items.length} item${cg.items.length === 1 ? "" : "s"}`);
      lines.push("");
      if (cg.items.length > 0) {
        lines.push("| # | Item | Description |");
        lines.push("|--:|------|-------------|");
        for (const item of cg.items) {
          lines.push(`| ${item.ordinal} | ${esc(item.name)} | ${esc(item.description) || "—"} |`);
        }
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");

  // ── 6. Pages ──────────────────────────────────────────────────────────────
  lines.push("## 6. Pages");
  lines.push("");
  if (pages.length === 0) {
    lines.push("_No pages analysed._");
    lines.push("");
  } else {
    for (const p of pages) {
      const hid = hiddenSet.has(p.name) ? " _(hidden)_" : "";
      lines.push(`### ${p.name}${hid}`);
      lines.push("");
      lines.push(`**${p.visualCount}** visuals · **${p.measureCount}** measures · **${p.columnCount}** columns · **${p.slicerCount}** slicers · **${p.coverage}%** measure coverage`);
      lines.push("");

      const types = Object.entries(p.typeCounts).sort((a, b) => b[1] - a[1]);
      if (types.length > 0) {
        lines.push("**Visual types:** " + types.map(([k, v]) => `${v}× ${k}`).join(", "));
        lines.push("");
      }

      if (p.visuals.length > 0) {
        lines.push("**Visuals**");
        lines.push("");
        lines.push("| Type | Title | Fields |");
        lines.push("|------|-------|--------|");
        for (const v of p.visuals) {
          const fields = v.bindings.length > 0
            ? v.bindings.map(b => `${b.fieldTable}[${b.fieldName}]`).join(", ")
            : "—";
          lines.push(`| ${esc(v.type)} | ${esc(v.title)} | ${esc(fields)} |`);
        }
        lines.push("");
      }

      if (p.measures.length > 0) {
        lines.push("**Measures used:** " + p.measures.map(m => "`" + m + "`").join(", "));
        lines.push("");
      }
      if (p.columns.length > 0) {
        lines.push("**Columns used:** " + p.columns.map(c => "`" + c + "`").join(", "));
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");

  return lines.join("\n");
}
