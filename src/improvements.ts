/**
 * Areas of Improvement — a prioritized, link-cross-referenced action
 * list derived from existing FullData signals.
 *
 * Not a scorecard. No numeric grade, no letter rank. Every item is a
 * concrete observation + rationale, grouped by severity so reviewers
 * can pick what to work on next.
 *
 * Severity tiers:
 *   🔴 High    — breaks correctness, wastes runtime resources, or
 *                  creates a clear user-visible risk
 *   🟡 Medium  — maintenance burden; reviewers will friction on it
 *   🟢 Low     — polish; nice-to-haves
 *   ℹ️  Info    — characteristics worth knowing, not issues
 *   ✅ Good   — positive callouts (what this model gets right)
 *
 * Public entry point: `generateImprovementsMd(data, reportName)` →
 * a full MD document. Individual check functions are also exported
 * so tests can pin specific rules without re-running the renderer.
 */

import type { FullData, ModelMeasure } from "./data-builder.js";
import type { ModelRelationship } from "./model-parser.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type ImprovementSeverity = "high" | "medium" | "low" | "info" | "good";

export interface Improvement {
  severity: ImprovementSeverity;
  title: string;
  /** One-line summary suitable for bullet-list display. */
  summary: string;
  /** Why this matters — shown under the summary when the item has detail. */
  rationale?: string;
  /** Affected entities — rendered as a capped inline list. */
  items?: string[];
  /** Cap for inline `items` rendering (default 10). */
  maxListed?: number;
  /** Optional cross-reference hint pointing at another doc / tab. */
  crossRef?: string;
}

// ─────────────────────────────────────────────────────────────────────
// MD helpers — self-contained so this module can stand alone
// ─────────────────────────────────────────────────────────────────────

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// ─────────────────────────────────────────────────────────────────────
// Individual checks — each returns either null or a single Improvement
// ─────────────────────────────────────────────────────────────────────

/**
 * Transitively-unused measures. A measure is dead-chain when it's
 * never reachable by walking the measure→measure dep graph starting
 * from every status:"direct" measure. Distinct from status:"unused"
 * (which means not consumed directly) — dead-chain measures ARE
 * consumed, but only by other dead measures.
 */
export function deadChainMeasures(data: FullData): string[] {
  const byName = new Map<string, ModelMeasure>(data.measures.map(m => [m.name, m]));
  const reachable = new Set<string>();
  const queue: string[] = data.measures
    .filter(m => m.status === "direct")
    .map(m => m.name);
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const m = byName.get(current);
    if (!m) continue;
    for (const dep of m.daxDependencies) {
      if (!reachable.has(dep)) queue.push(dep);
    }
  }
  return data.measures
    .filter(m => !reachable.has(m.name) && m.status !== "unused")
    .map(m => m.name);
}

/**
 * Cycle detection on the measure→measure dep graph. Iterative DFS
 * with a recursion stack so we can recover the cycle path, not just
 * its existence. Returns one loop per discovered cycle.
 */
export function circularMeasures(data: FullData): string[][] {
  const byName = new Map<string, ModelMeasure>(data.measures.map(m => [m.name, m]));
  const cycles: string[][] = [];
  const seen = new Set<string>();
  for (const start of data.measures) {
    if (seen.has(start.name)) continue;
    const stack: Array<{ name: string; idx: number }> = [{ name: start.name, idx: 0 }];
    const onPath = new Set<string>([start.name]);
    const path: string[] = [start.name];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const m = byName.get(top.name);
      const deps = m?.daxDependencies ?? [];
      if (top.idx >= deps.length) {
        onPath.delete(top.name);
        path.pop();
        seen.add(top.name);
        stack.pop();
        continue;
      }
      const next = deps[top.idx++];
      if (onPath.has(next)) {
        const startIdx = path.indexOf(next);
        if (startIdx >= 0) cycles.push(path.slice(startIdx).concat(next));
        continue;
      }
      if (seen.has(next)) continue;
      onPath.add(next);
      path.push(next);
      stack.push({ name: next, idx: 0 });
    }
  }
  return cycles;
}

/** Measures with a DAX body at or above `threshold` non-blank lines. */
export function longDaxMeasures(data: FullData, threshold = 30): ModelMeasure[] {
  return data.measures.filter(m => {
    const lines = (m.daxExpression || "").split("\n").filter(l => l.trim().length > 0);
    return lines.length >= threshold;
  });
}

/**
 * Groups of measures sharing identical DAX (whitespace-normalised).
 * Trivially short bodies (< 10 chars after normalisation) are skipped
 * so `0` or `[M1]` don't spuriously match.
 */
export function duplicateDaxMeasures(data: FullData): Array<{ body: string; names: string[] }> {
  const byBody = new Map<string, string[]>();
  for (const m of data.measures) {
    const norm = (m.daxExpression || "").replace(/\s+/g, " ").trim();
    if (norm.length < 10) continue;
    const key = norm;
    if (!byBody.has(key)) byBody.set(key, []);
    byBody.get(key)!.push(m.table + "[" + m.name + "]");
  }
  const dups: Array<{ body: string; names: string[] }> = [];
  for (const [body, names] of byBody) {
    if (names.length > 1) dups.push({ body, names });
  }
  return dups;
}

/**
 * Inactive relationships not referenced by any measure's DAX via
 * USERELATIONSHIP(). The ones that ARE referenced are legitimately
 * inactive (used via explicit CALCULATE override); the rest are
 * probably dead legacy.
 */
export function deadInactiveRelationships(data: FullData): ModelRelationship[] {
  const inactive = data.relationships.filter(r => !r.isActive);
  if (inactive.length === 0) return [];
  const allDax = data.measures.map(m => m.daxExpression || "").join("\n");
  const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return inactive.filter(r => {
    const rx = new RegExp(
      `USERELATIONSHIP\\s*\\([^)]*\\b${escRx(r.fromColumn)}\\b[^)]*\\b${escRx(r.toColumn)}\\b`,
      "i",
    );
    const rxRev = new RegExp(
      `USERELATIONSHIP\\s*\\([^)]*\\b${escRx(r.toColumn)}\\b[^)]*\\b${escRx(r.fromColumn)}\\b`,
      "i",
    );
    return !(rx.test(allDax) || rxRev.test(allDax));
  });
}

// ─────────────────────────────────────────────────────────────────────
// Broken-reference detection — DAX that mentions symbols which no
// longer exist in the model. Common after table/column renames or
// measure deletions where callers were missed.
// ─────────────────────────────────────────────────────────────────────

/**
 * Strip DAX comments + string literals so the subsequent regex scan
 * can't be tripped up by content inside them. DAX uses C-style
 * `/* … *\/` and `// …` comments, and `"…"` string literals with
 * `""` as the embedded-quote escape.
 */
function stripDaxCommentsAndStrings(dax: string): string {
  let out = "";
  let i = 0;
  while (i < dax.length) {
    const c = dax[i];
    if (c === "/" && dax[i + 1] === "*") {
      const end = dax.indexOf("*/", i + 2);
      i = end < 0 ? dax.length : end + 2;
      continue;
    }
    if (c === "/" && dax[i + 1] === "/") {
      const end = dax.indexOf("\n", i + 2);
      i = end < 0 ? dax.length : end;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < dax.length) {
        if (dax[i] === '"') {
          if (dax[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Pull every `Table[Column]` / `'Table Name'[Column]` qualified ref
 * and every bare `[Name]` measure-or-column ref out of a DAX body.
 *
 * Deduplicated per expression. Bare refs are collected *after* masking
 * qualified ones so the regex doesn't double-count the bracket on the
 * right-hand side of `Sales[Amount]`.
 */
export function extractDaxRefs(dax: string): {
  columnRefs: Array<{ table: string; column: string }>;
  measureRefs: string[];
} {
  const clean = stripDaxCommentsAndStrings(dax || "");
  const columnRefs: Array<{ table: string; column: string }> = [];
  const measureRefs: string[] = [];
  const seenCol = new Set<string>();
  const seenMeas = new Set<string>();

  // Qualified ref: optional 'quoted name' OR unquoted identifier (no
  // spaces — DAX requires quoting for spaced names) directly followed
  // by `[column]`.
  const qualRx = /(?:'([^']+)'|([A-Za-z_]\w*))\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = qualRx.exec(clean)) !== null) {
    const table = (m[1] || m[2] || "").trim();
    const column = (m[3] || "").trim();
    if (!table || !column) continue;
    const key = `${table}|${column}`;
    if (seenCol.has(key)) continue;
    seenCol.add(key);
    columnRefs.push({ table, column });
  }

  // Bare ref: `[Name]` with the preceding qualifier stripped out so we
  // don't re-match the column side of a qualified ref.
  const masked = clean.replace(qualRx, " ");
  const bareRx = /\[([^\]]+)\]/g;
  while ((m = bareRx.exec(masked)) !== null) {
    const name = (m[1] || "").trim();
    if (!name || seenMeas.has(name)) continue;
    seenMeas.add(name);
    measureRefs.push(name);
  }

  return { columnRefs, measureRefs };
}

export interface BrokenRefFinding {
  /** Which expression contains the broken reference. */
  where: string;
  /** The broken ref itself, rendered as it appears in DAX. */
  broken: string;
  /** Human-readable reason. */
  reason: string;
}

/**
 * Scan every DAX-carrying expression in the model (measures, calc
 * group items, user-defined DAX functions) and report refs that don't
 * resolve to anything in the model.
 *
 * Three resolution rules:
 *   - `Table[X]` needs the table to exist. If it does, `X` must resolve
 *     to either a column on that table OR a measure anywhere in the
 *     model (DAX accepts `Table[Measure]` as a qualifier too).
 *   - Bare `[X]` must match either a measure name or a column name
 *     somewhere in the model — row context means a column on the
 *     iterating table is valid without qualification.
 *   - EXTERNALMEASURE-proxy measures are skipped; their DAX body is a
 *     string literal pointing at an external model, which we can't
 *     cross-check without that model in hand.
 */
export function brokenReferences(data: FullData): BrokenRefFinding[] {
  // DAX identifiers are case-insensitive at query time, so our
  // resolution index must be too. We normalise once here, then
  // lowercase every ref we test against it. Display strings (the
  // `broken` field in findings) still use the ref's original casing —
  // this is purely about resolution, not presentation.
  const lc = (s: string): string => s.toLowerCase();
  const tableSet = new Set(data.tables.map(t => lc(t.name)));
  const columnSet = new Set<string>();
  for (const c of data.columns) columnSet.add(`${lc(c.table)}|${lc(c.name)}`);
  const measureNames = new Set(data.measures.map(m => lc(m.name)));
  const columnNamesAny = new Set(data.columns.map(c => lc(c.name)));

  const findings: BrokenRefFinding[] = [];

  const check = (expression: string, where: string): void => {
    if (!expression) return;
    const { columnRefs, measureRefs } = extractDaxRefs(expression);
    for (const cr of columnRefs) {
      const t = lc(cr.table);
      const c = lc(cr.column);
      if (!tableSet.has(t)) {
        findings.push({ where, broken: `${cr.table}[${cr.column}]`, reason: "table not in model" });
        continue;
      }
      const hasColumn = columnSet.has(`${t}|${c}`);
      const hasMeasure = measureNames.has(c);
      if (!hasColumn && !hasMeasure) {
        findings.push({ where, broken: `${cr.table}[${cr.column}]`, reason: "column not on table" });
      }
    }
    for (const mr of measureRefs) {
      const k = lc(mr);
      if (!measureNames.has(k) && !columnNamesAny.has(k)) {
        findings.push({ where, broken: `[${mr}]`, reason: "measure/column not found" });
      }
    }
  };

  for (const m of data.measures) {
    if (m.externalProxy) continue;
    check(m.daxExpression, `${m.table}[${m.name}]`);
  }
  for (const cg of data.calcGroups) {
    for (const it of cg.items) {
      check(it.expression, `${cg.name} · ${it.name}`);
    }
  }
  for (const fn of data.functions) {
    check(fn.expression, `Function ${fn.name}`);
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────
// Pipeline — run every check, collect Improvement entries
// ─────────────────────────────────────────────────────────────────────

export function runImprovementChecks(data: FullData): Improvement[] {
  const out: Improvement[] = [];

  // Filter to user-authored content throughout. Auto-date noise
  // doesn't deserve complaints about missing descriptions.
  const userTables   = data.tables.filter(t => t.origin !== "auto-date");
  const autoDate     = data.tables.filter(t => t.origin === "auto-date");
  const userMeasures = data.measures.filter(m => {
    const t = data.tables.find(t => t.name === m.table);
    return !t || t.origin !== "auto-date";
  });
  const userColumns  = data.columns.filter(c => {
    const t = data.tables.find(t => t.name === c.table);
    return !t || t.origin !== "auto-date";
  });

  // ── 🔴 High-priority checks ────────────────────────────────────────
  if (autoDate.length > 0) {
    out.push({
      severity: "high",
      title: "Auto-Date/Time is enabled",
      summary: `${autoDate.length} auto-generated date table${autoDate.length === 1 ? "" : "s"} detected (LocalDateTable_*, DateTableTemplate_*).`,
      rationale: "Auto Date/Time creates one hidden date table per date column, bloating the model and sometimes interfering with an intentional Date dimension. Turn it off in Power BI Desktop (File → Options → Current File → Data Load → Auto Date/Time) and rely on a single dedicated Date dimension instead.",
    });
  }
  const cycles = circularMeasures(data);
  if (cycles.length > 0) {
    out.push({
      severity: "high",
      title: "Circular measure dependencies",
      summary: `${cycles.length} cycle${cycles.length === 1 ? "" : "s"} found in the measure dependency graph.`,
      rationale: "Circular DAX dependencies cause infinite-recursion errors at query time. Each cycle below shows the path that loops back on itself.",
      items: cycles.map(c => c.join(" → ")),
      maxListed: 5,
    });
  }
  const broken = brokenReferences(data);
  if (broken.length > 0) {
    // Group by (where) so a measure with several broken refs reports
    // once with the refs inlined — cleaner than N duplicate rows.
    const byWhere = new Map<string, BrokenRefFinding[]>();
    for (const f of broken) {
      if (!byWhere.has(f.where)) byWhere.set(f.where, []);
      byWhere.get(f.where)!.push(f);
    }
    const items: string[] = [];
    for (const [where, fs] of byWhere) {
      const refs = fs.map(f => `${f.broken} _(${f.reason})_`).join(", ");
      items.push(`**${esc(where)}** → ${refs}`);
    }
    out.push({
      severity: "high",
      title: `${broken.length} broken DAX reference${broken.length === 1 ? "" : "s"}`,
      summary: `${byWhere.size} expression${byWhere.size === 1 ? "" : "s"} reference${byWhere.size === 1 ? "s" : ""} a table / column / measure that doesn't exist in the model.`,
      rationale: "Broken references fire a runtime error the moment the measure is evaluated. Common cause: a table or column was renamed and not every caller was updated. Fix each ref below by pointing it at the new name, or remove the expression if it's dead.",
      items,
      maxListed: 20,
    });
  }
  const calcInDQ = userTables.filter(
    t => t.isCalculatedTable && t.partitions.some(p => p.mode === "directQuery"),
  );
  if (calcInDQ.length > 0) {
    out.push({
      severity: "high",
      title: "Calculated tables with DirectQuery partitions",
      summary: `${calcInDQ.length} table${calcInDQ.length === 1 ? "" : "s"} declared as calculated but stored in DirectQuery mode.`,
      rationale: "Calculated tables materialise at refresh via DAX; DirectQuery storage makes the combination awkward and usually indicates the table should be converted to Import or re-expressed as an entity partition.",
      items: calcInDQ.map(t => t.name),
    });
  }

  // ── 🟡 Medium-priority checks ───────────────────────────────────────
  const unusedMeasures = userMeasures.filter(m => m.status === "unused");
  if (unusedMeasures.length > 0) {
    out.push({
      severity: "medium",
      title: `${unusedMeasures.length} unused measure${unusedMeasures.length === 1 ? "" : "s"}`,
      summary: "Not referenced by any visual and not depended on by any other measure.",
      rationale: "Safe to remove unless they're intentionally held as private helpers. Reducing the measure catalogue shrinks the end-user picker and the maintenance surface.",
      items: unusedMeasures.map(m => m.table + "[" + m.name + "]"),
      maxListed: 15,
      crossRef: "The dashboard's **Unused** tab shows the same list with full per-entity lineage context.",
    });
  }
  const deadChainRaw = deadChainMeasures(data);
  const deadChain = deadChainRaw.filter(n => {
    const m = userMeasures.find(x => x.name === n);
    return m && m.status !== "unused";
  });
  if (deadChain.length > 0) {
    out.push({
      severity: "medium",
      title: `${deadChain.length} measure${deadChain.length === 1 ? "" : "s"} only reachable through unused chains`,
      summary: "These are used by other measures, but those measures are never on a visual themselves.",
      rationale: "The chain terminates in nothing — these measures are effectively dead. Remove the top of the chain (the directly-unused measures) and these become unused in turn.",
      items: deadChain.slice(0, 20),
    });
  }
  const unusedColumns = userColumns.filter(c => c.status === "unused" && !c.isKey);
  if (unusedColumns.length > 0) {
    out.push({
      severity: "medium",
      title: `${unusedColumns.length} unused column${unusedColumns.length === 1 ? "" : "s"}`,
      summary: "Columns not referenced by any measure or visual. Non-key only.",
      rationale: "Unused columns contribute to model size and hide the fields that matter. Keys are excluded — they're load-bearing structurally even if nothing visually binds them.",
      items: unusedColumns.map(c => c.table + "[" + c.name + "]"),
      maxListed: 15,
    });
  }
  const deadRels = deadInactiveRelationships(data);
  if (deadRels.length > 0) {
    out.push({
      severity: "medium",
      title: `${deadRels.length} inactive relationship${deadRels.length === 1 ? "" : "s"} with no USERELATIONSHIP() caller`,
      summary: "Inactive relationships exist, but no measure's DAX references them via USERELATIONSHIP(). Likely dead.",
      rationale: "Inactive relationships are normally used by USERELATIONSHIP() inside a CALCULATE — if no measure references a given pair, the relationship is probably forgotten legacy. Delete it or re-activate it (whichever is intended).",
      items: deadRels.map(r => `${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`),
    });
  }
  const tablesNoDesc = userTables.filter(t => !t.description || t.description.trim() === "");
  if (tablesNoDesc.length > 0 && tablesNoDesc.length >= userTables.length * 0.3) {
    out.push({
      severity: "medium",
      title: `${tablesNoDesc.length} of ${userTables.length} tables lack descriptions`,
      summary: `${Math.round((tablesNoDesc.length / userTables.length) * 100)}% of user tables have no table-level description.`,
      rationale: "Table descriptions surface in tooltips + the Data Dictionary doc. Without them, anyone new to the model has to reverse-engineer intent from column names.",
      items: [...tablesNoDesc.map(t => t.name)].sort(),
      maxListed: 15,
    });
  }
  const measuresNoDesc = userMeasures.filter(m => !m.description || m.description.trim() === "");
  if (measuresNoDesc.length > 0 && measuresNoDesc.length >= userMeasures.length * 0.3) {
    out.push({
      severity: "medium",
      title: `${measuresNoDesc.length} of ${userMeasures.length} measures lack descriptions`,
      summary: `${Math.round((measuresNoDesc.length / userMeasures.length) * 100)}% of measures have no description.`,
      rationale: "Measure descriptions appear in the Power BI UI measure-picker tooltip. Business users pick measures from that list; unlabelled ones are just names.",
      items: [...measuresNoDesc.map(m => m.table + "[" + m.name + "]")].sort(),
      maxListed: 15,
    });
  }
  const longDax = longDaxMeasures(data, 30);
  if (longDax.length > 0) {
    out.push({
      severity: "medium",
      title: `${longDax.length} measure${longDax.length === 1 ? "" : "s"} with ≥30 lines of DAX`,
      summary: "Likely candidates for decomposition into helper measures.",
      rationale: "Past ~30 lines a DAX body stops being reviewable in a code review. If it's genuinely that complex, factor out intermediate CALCULATE steps as named helper measures (prefix with _ to hide from consumers) so each piece is individually testable.",
      items: longDax.map(m => m.table + "[" + m.name + "]"),
      maxListed: 10,
    });
  }
  const dupDax = duplicateDaxMeasures(data);
  if (dupDax.length > 0) {
    out.push({
      severity: "medium",
      title: `${dupDax.length} group${dupDax.length === 1 ? "" : "s"} of measures with identical DAX`,
      summary: "Different names, same body. Refactor candidates.",
      rationale: "Duplicate DAX is a maintenance trap — a fix applied to one copy silently fails to propagate to the duplicates. Consolidate into a single measure + aliases, or rename if the duplication is intentional.",
      items: dupDax.map(g => g.names.join(" ≡ ")),
      maxListed: 10,
    });
  }
  // Orphan pages: VISIBLE pages with zero data bindings. Hidden
  // pages are excluded because they're usually intentional
  // tooltip / drillthrough scaffolds that bind via
  // visual-level filters rather than fields. Complaining about
  // those produces a lot of false positives on real models.
  const hiddenSet = new Set(data.hiddenPages || []);
  const orphanPages = data.pages.filter(
    p => p.measureCount === 0 && p.columnCount === 0 && !hiddenSet.has(p.name),
  );
  if (orphanPages.length > 0) {
    out.push({
      severity: "medium",
      title: `${orphanPages.length} visible page${orphanPages.length === 1 ? "" : "s"} with no data-bound visuals`,
      summary: "Pages that are visible to consumers but have zero measure + zero column bindings.",
      rationale: "Hidden pages are skipped (those are usually intentional tooltip/drillthrough scaffolds). The pages listed here are visible in the page-tab strip but contain nothing data-bound — likely text-only cover pages or abandoned work.",
      items: orphanPages.map(p => p.name),
      maxListed: 10,
    });
  }

  // Data-category / type mismatch — a URL-typed category on a non-string
  // column is almost always a modelling slip (the category was set but
  // the underlying type is numeric or date, so Power BI can't render it
  // as a link).
  const urlCategories = new Set(["webUrl", "imageUrl"]);
  const categoryMismatches = userColumns
    .filter(c => c.dataCategory && urlCategories.has(c.dataCategory))
    .filter(c => (c.dataType || "").toLowerCase() !== "string");
  if (categoryMismatches.length > 0) {
    out.push({
      severity: "medium",
      title: `${categoryMismatches.length} data-category / type mismatch${categoryMismatches.length === 1 ? "" : "es"}`,
      summary: "Columns tagged with a URL data category that aren't string-typed.",
      rationale: "URL data categories (`WebUrl`, `ImageUrl`) tell Power BI to render the column as a clickable link or image source. Only string-typed columns can carry that semantic — a numeric or date column with a URL category is a broken configuration.",
      items: categoryMismatches.map(c => `${c.table}[${c.name}] (category=${c.dataCategory}, type=${c.dataType})`),
    });
  }

  // ── 🟢 Low-priority checks ─────────────────────────────────────────
  const columnsNoDesc = userColumns.filter(c => !c.description || c.description.trim() === "");
  if (columnsNoDesc.length > 0 && columnsNoDesc.length >= userColumns.length * 0.5) {
    out.push({
      severity: "low",
      title: `${columnsNoDesc.length} of ${userColumns.length} columns lack descriptions`,
      summary: `${Math.round((columnsNoDesc.length / userColumns.length) * 100)}% of columns have no description.`,
      rationale: "Less critical than table / measure descriptions — column names usually carry enough meaning on their own for a data dictionary reader.",
      items: [...columnsNoDesc.map(c => c.table + "[" + c.name + "]")].sort(),
      maxListed: 20,
    });
  }
  if (!data.modelProperties.description || data.modelProperties.description.trim() === "") {
    out.push({
      severity: "low",
      title: "Model has no top-level description",
      summary: "`modelProperties.description` is empty.",
      rationale: "The model description renders as a blockquote at the top of the generated Model doc. A one-sentence elevator pitch here makes it clear what the model is for.",
    });
  }
  // Numeric columns without a format string — cosmetic, but means
  // visuals show "12345.678" unformatted. Keys excluded (they're not
  // meant to be formatted for display).
  const numericTypes = new Set(["int64", "decimal", "double", "currency"]);
  const numericNoFormat = userColumns.filter(c =>
    numericTypes.has((c.dataType || "").toLowerCase()) &&
    !c.formatString &&
    !c.isKey
  );
  if (numericNoFormat.length > 0) {
    out.push({
      severity: "low",
      title: `${numericNoFormat.length} numeric column${numericNoFormat.length === 1 ? "" : "s"} without a format string`,
      summary: "These will render as raw numbers in visuals.",
      rationale: "Without a `formatString`, numeric columns show as \"12345.678\" with full decimal precision. Setting one (e.g. `\"#,0\"`, `\"0.00\"`, `\"0%\"`) keeps visuals consistent across the report and matches the domain semantics.",
      items: numericNoFormat.map(c => `${c.table}[${c.name}] (${c.dataType})`),
      maxListed: 15,
    });
  }

  // ── ℹ️ Info callouts ────────────────────────────────────────────────
  // External proxy protection — `EXTERNALMEASURE(...)` measures often
  // show `status: "unused"` because the binding scan only sees visuals
  // in this report, not the remote cube's consumers. If any are flagged
  // as unused above, the user is at risk of deleting them based on the
  // Unused tab. Call them out prominently so the "do not remove"
  // warning is visible right next to the unused-measures finding.
  const proxyMeasures = userMeasures.filter(m => m.externalProxy);
  if (proxyMeasures.length > 0) {
    const byRemote = new Map<string, string[]>();
    for (const m of proxyMeasures) {
      const key = m.externalProxy!.externalModel;
      if (!byRemote.has(key)) byRemote.set(key, []);
      byRemote.get(key)!.push(m.table + "[" + m.name + "]");
    }
    const summary = proxyMeasures.length === 1
      ? "1 EXTERNALMEASURE proxy detected — do NOT remove even if it appears in the Unused list."
      : `${proxyMeasures.length} EXTERNALMEASURE proxies detected across ${byRemote.size} remote model${byRemote.size === 1 ? "" : "s"} — do NOT remove even if they appear in the Unused list.`;
    out.push({
      severity: "info",
      title: `${proxyMeasures.length} external proxy measure${proxyMeasures.length === 1 ? "" : "s"} — DO NOT REMOVE`,
      summary,
      rationale: "EXTERNALMEASURE re-exposes a measure from a remote Analysis Services cube. The binding-scan rule marks them `status: unused` because no visual in THIS report binds them directly — but visuals in the remote model do. Deleting one breaks the composite-model contract. Listed here for protection.",
      items: proxyMeasures.map(m => `${m.table}[${m.name}] → ${m.externalProxy!.externalModel}[${m.externalProxy!.remoteName}]`),
      maxListed: 20,
    });
  }

  const fieldParams = userTables.filter(t => t.parameterKind === "field");
  if (fieldParams.length > 0) {
    out.push({
      severity: "info",
      title: `${fieldParams.length} field parameter${fieldParams.length === 1 ? "" : "s"} in use`,
      summary: `Tables: ${fieldParams.map(t => t.name).join(", ")}.`,
      rationale: "Field parameters drive slicer-controlled measure / field switching. Worth knowing because they can be confusing to debug when a visual's content depends on a slicer selection.",
    });
  }
  const proxies = userTables.filter(t => t.parameterKind === "compositeModelProxy");
  if (proxies.length > 0) {
    const bySource = new Set<string>();
    for (const t of proxies) {
      const p = t.partitions.find(p => p.expressionSource);
      if (p?.expressionSource) bySource.add(p.expressionSource);
    }
    out.push({
      severity: "info",
      title: `${proxies.length} composite-model proxy table${proxies.length === 1 ? "" : "s"}`,
      summary: `This is a composite model referencing ${bySource.size} remote Analysis Services cube${bySource.size === 1 ? "" : "s"}.`,
      rationale: "Composite-model proxies are stubs that point at a remote AS cube. They look disconnected locally but carry cross-model joins at query time. See the Sources doc for the remote-model breakdown.",
    });
  }

  // ── ✅ Good callouts ───────────────────────────────────────────────
  if (userMeasures.length > 0) {
    const directCount = userMeasures.filter(m => m.status === "direct").length;
    const directPct = directCount / userMeasures.length;
    if (directPct >= 0.85) {
      out.push({
        severity: "good",
        title: "High measure utilisation",
        summary: `${Math.round(directPct * 100)}% of measures (${directCount} of ${userMeasures.length}) are consumed by at least one visual.`,
      });
    }
  }
  if (userColumns.length > 0) {
    const colDirectCount = userColumns.filter(c => c.status === "direct").length;
    const colDirectPct = colDirectCount / userColumns.length;
    if (colDirectPct >= 0.75) {
      out.push({
        severity: "good",
        title: "Healthy column usage",
        summary: `${Math.round(colDirectPct * 100)}% of columns (${colDirectCount} of ${userColumns.length}) are referenced by visuals or measures.`,
      });
    }
  }
  if (cycles.length === 0 && userMeasures.length > 5) {
    out.push({
      severity: "good",
      title: "No circular measure dependencies",
      summary: "The measure dependency graph is acyclic.",
    });
  }
  if (data.calcGroups.length > 0) {
    out.push({
      severity: "good",
      title: `${data.calcGroups.length} calculation group${data.calcGroups.length === 1 ? "" : "s"} configured`,
      summary: "Time intelligence and consistent formatting generally benefit from calc groups.",
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Renderer — Improvement[] → Markdown
// ─────────────────────────────────────────────────────────────────────

const SEVERITY_META: Record<ImprovementSeverity, { icon: string; label: string; order: number }> = {
  high:   { icon: "🔴", label: "High priority",   order: 0 },
  medium: { icon: "🟡", label: "Medium priority", order: 1 },
  low:    { icon: "🟢", label: "Low priority",    order: 2 },
  info:   { icon: "ℹ️",  label: "Info",            order: 3 },
  good:   { icon: "✅", label: "Strengths",       order: 4 },
};

function renderImprovementItem(it: Improvement): string[] {
  const lines: string[] = [];
  lines.push(`### ${it.title}`);
  lines.push("");
  lines.push(it.summary);
  lines.push("");
  if (it.rationale) {
    lines.push(`_${it.rationale}_`);
    lines.push("");
  }
  if (it.items && it.items.length > 0) {
    const cap = it.maxListed ?? 10;
    const shown = it.items.slice(0, cap);
    for (const s of shown) lines.push(`- \`${esc(s)}\``);
    if (it.items.length > cap) {
      lines.push(`- _…and ${it.items.length - cap} more._`);
    }
    lines.push("");
  }
  if (it.crossRef) {
    lines.push(`> ${it.crossRef}`);
    lines.push("");
  }
  return lines;
}

/** Output mode toggle. Improvements is identical in lite vs detailed
 *  per the design doc — the audit is already paced for stakeholders.
 *  Param accepted for symmetry with the other generators. */
export type ImprovementsMdMode = "lite" | "detailed";

export function generateImprovementsMd(data: FullData, reportName: string, _mode: ImprovementsMdMode = "detailed"): string {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const items = runImprovementChecks(data);

  // Note: unlike Functions / Calc Groups, an empty Improvements list
  // is a meaningful signal (clean model — no flags). Keep the doc
  // emitted with the "No improvement items flagged" note instead of
  // returning empty.
  const bySev = new Map<ImprovementSeverity, Improvement[]>();
  for (const sev of Object.keys(SEVERITY_META) as ImprovementSeverity[]) {
    bySev.set(sev, []);
  }
  for (const it of items) {
    bySev.get(it.severity)!.push(it);
  }
  const counts: Record<ImprovementSeverity, number> = {
    high:   bySev.get("high")!.length,
    medium: bySev.get("medium")!.length,
    low:    bySev.get("low")!.length,
    info:   bySev.get("info")!.length,
    good:   bySev.get("good")!.length,
  };

  const lines: string[] = [];
  lines.push(`<!-- Suggested ADO Wiki page name: ${reportName}/Improvements -->`);
  lines.push(`# Areas of Improvement`);
  lines.push("");
  lines.push(`## ${reportName}`);
  lines.push("");
  lines.push("> This is a starting point, not a verdict. Items below are derived from existing model + report signals — each one explains why it's called out and what the fix looks like. Use the list to pick what to work on first, not to judge past decisions.");
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|---|--:|");
  for (const sev of ["high", "medium", "low"] as ImprovementSeverity[]) {
    const c = counts[sev];
    if (c > 0) lines.push(`| ${SEVERITY_META[sev].icon} ${SEVERITY_META[sev].label} | ${c} |`);
  }
  if (counts.info > 0) lines.push(`| ${SEVERITY_META.info.icon} Info | ${counts.info} |`);
  if (counts.good > 0) lines.push(`| ${SEVERITY_META.good.icon} Strengths | ${counts.good} |`);
  lines.push("");

  if (counts.high === 0 && counts.medium === 0 && counts.low === 0) {
    lines.push("_No improvement items flagged — every rule the checker knows about came back clean._");
    lines.push("");
  }

  // Sections per tier
  for (const sev of ["high", "medium", "low", "info", "good"] as ImprovementSeverity[]) {
    const group = bySev.get(sev)!;
    if (group.length === 0) continue;
    lines.push(`## ${SEVERITY_META[sev].icon} ${SEVERITY_META[sev].label} (${group.length})`);
    lines.push("");
    for (const it of group) {
      for (const ln of renderImprovementItem(it)) lines.push(ln);
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(`_Generated by powerbi-lineage · ${ts}_`);
  lines.push("");
  return lines.join("\n");
}
