import { PbirProject } from "./pbir-reader.js";

export interface RawBinding {
  fieldType: "measure" | "column" | "aggregation";
  fieldName: string;
  tableName: string;
  bindingRole: string;
  pageId: string;
  pageName: string;
  visualId: string;
  visualType: string;
  visualTitle: string;
}

function extractFieldRef(field: any): { fieldType: "measure" | "column" | "aggregation"; fieldName: string; tableName: string } | null {
  if (field.Measure) {
    return { fieldType: "measure", fieldName: field.Measure.Property, tableName: field.Measure.Expression?.SourceRef?.Entity || "" };
  } else if (field.Column) {
    return { fieldType: "column", fieldName: field.Column.Property, tableName: field.Column.Expression?.SourceRef?.Entity || "" };
  } else if (field.Aggregation) {
    const col = field.Aggregation.Expression?.Column;
    if (col) return { fieldType: "aggregation", fieldName: col.Property, tableName: col.Expression?.SourceRef?.Entity || "" };
  } else if (field.HierarchyLevel) {
    const h = field.HierarchyLevel;
    const entity = h.Expression?.Hierarchy?.Expression?.SourceRef?.Entity;
    const level = h.Level;
    if (entity && level) return { fieldType: "column", fieldName: level, tableName: entity };
  }
  return null;
}

function extractVisualTitle(visual: any): string {
  try {
    const vco = visual.visual?.visualContainerObjects;
    if (vco?.title) {
      for (const item of vco.title) {
        const textProp = item?.properties?.text;
        if (textProp?.expr?.Literal?.Value) {
          return textProp.expr.Literal.Value.replace(/^'(.*)'$/, "$1");
        }
      }
    }
  } catch { /* fallback */ }
  return "";
}

export interface PageMeta {
  name: string;
  hidden: boolean;
  visualCount: number;
  /** Canvas width in PBI coordinate space (default 1280 for 16:9). */
  width: number;
  /** Canvas height (default 720). */
  height: number;
}

/** Position of a visual on its page, in the same coordinate space as the page width/height. */
export interface VisualPosition {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

/** Per-visual structure used by the page-layout wireframe renderer. */
export interface ScannedVisual {
  pageId: string;
  pageName: string;
  visualId: string;
  visualType: string;
  visualTitle: string;
  position: VisualPosition;
}

const DEFAULT_PAGE_WIDTH = 1280;
const DEFAULT_PAGE_HEIGHT = 720;

export function scanReportBindings(reportPath: string): { bindings: RawBinding[]; pageCount: number; visualCount: number; hiddenPages: string[]; allPages: PageMeta[]; scannedVisuals: ScannedVisual[] } {
  const project = new PbirProject(reportPath);
  const pageIds = project.listPageIds();
  const bindings: RawBinding[] = [];
  const hiddenPages: string[] = [];
  const allPages: PageMeta[] = [];
  const scannedVisuals: ScannedVisual[] = [];
  let totalVisuals = 0;

  for (const pageId of pageIds) {
    const page = project.getPage(pageId);
    const pageName = page.displayName || pageId;
    const isHidden = page.visibility === "HiddenInViewMode";
    if (isHidden) hiddenPages.push(pageName);
    const visualIds = project.listVisualIds(pageId);
    const pageWidth = typeof (page as any).width === "number" && (page as any).width > 0 ? (page as any).width : DEFAULT_PAGE_WIDTH;
    const pageHeight = typeof (page as any).height === "number" && (page as any).height > 0 ? (page as any).height : DEFAULT_PAGE_HEIGHT;
    allPages.push({ name: pageName, hidden: isHidden, visualCount: visualIds.length, width: pageWidth, height: pageHeight });

    for (const visualId of visualIds) {
      totalVisuals++;
      try {
        const visual = project.getVisual(pageId, visualId);
        const visualType = (visual as any).visual?.visualType || "unknown";
        const visualTitle = extractVisualTitle(visual) || visualType;
        const vId = (visual as any).name || visualId;
        const ctx = { pageId, pageName, visualId: vId, visualType, visualTitle };

        // Capture position for the wireframe view. Defaults place a
        // small marker at origin if position is missing so the visual
        // still appears in the layout.
        const pos = (visual as any).position || {};
        scannedVisuals.push({
          pageId, pageName, visualId: vId, visualType, visualTitle,
          position: {
            x: typeof pos.x === "number" ? pos.x : 0,
            y: typeof pos.y === "number" ? pos.y : 0,
            z: typeof pos.z === "number" ? pos.z : 0,
            width:  typeof pos.width  === "number" && pos.width  > 0 ? pos.width  : 100,
            height: typeof pos.height === "number" && pos.height > 0 ? pos.height : 60,
          },
        });

        // Scan queryState projections
        const queryState = (visual as any).visual?.query?.queryState;
        if (queryState) {
          for (const [bucket, bucketData] of Object.entries(queryState)) {
            const projections = (bucketData as any).projections || [];
            for (const proj of projections) {
              if (!proj.field) continue;
              const ref = extractFieldRef(proj.field);
              if (ref) bindings.push({ ...ref, bindingRole: bucket, ...ctx });
            }
          }
        }

        // Scan filter bindings
        const filters = (visual as any).filterConfig?.filters || [];
        for (const f of filters) {
          if (!f.field) continue;
          const ref = extractFieldRef(f.field);
          if (ref) bindings.push({ ...ref, bindingRole: "Filter", ...ctx });
        }

        // Scan objects section (conditional formatting: images, reference labels, colors, icons, etc.)
        const objects = (visual as any).visual?.objects;
        if (objects && typeof objects === "object") {
          const walkExpr = (obj: any, role: string) => {
            if (!obj || typeof obj !== "object") return;
            if (obj.expr) {
              const ref = extractFieldRef(obj.expr);
              if (ref) bindings.push({ ...ref, bindingRole: role, ...ctx });
            }
            if (Array.isArray(obj)) {
              for (const item of obj) walkExpr(item, role);
            } else {
              for (const val of Object.values(obj)) walkExpr(val, role);
            }
          };
          for (const [objectType, objectArr] of Object.entries(objects)) {
            walkExpr(objectArr, objectType);
          }
        }
      } catch { /* skip unreadable visuals */ }
    }
  }

  return { bindings, pageCount: pageIds.length, visualCount: totalVisuals, hiddenPages, allPages, scannedVisuals };
}
