import * as fs from "fs";
import * as path from "path";

// --- Types (read-only subset from pbir.ts) ---
export interface FieldRef {
  Column?: {
    Expression: { SourceRef: { Entity: string } };
    Property: string;
  };
  Aggregation?: {
    Expression: {
      Column: {
        Expression: { SourceRef: { Entity: string } };
        Property: string;
      };
    };
    Function: number;
  };
  Measure?: {
    Expression: { SourceRef: { Entity: string } };
    Property: string;
  };
}

export interface PageDefinition {
  $schema: string;
  name: string;
  displayName: string;
  displayOption: string;
  height: number;
  width: number;
  visibility?: string;
  type?: string;
  config?: Record<string, unknown>;
  filterConfig?: { filters: Array<{ name: string; field: FieldRef; type: string }> };
  objects?: Record<string, unknown>;
}

export interface VisualDefinition {
  $schema: string;
  name: string;
  visual: {
    visualType: string;
    query?: { queryState: Record<string, { projections: Array<{ field: FieldRef }> }> };
    objects?: Record<string, unknown>;
    visualContainerObjects?: Record<string, unknown>;
  };
  filterConfig?: { filters: Array<{ name: string; field: FieldRef; type: string }> };
}

export interface PagesMetadata {
  $schema: string;
  pageOrder: string[];
  activePageName: string;
}

// --- PBIR path helpers + read-only access ---
export class PbirProject {
  constructor(public reportPath: string) {}

  get definitionPath(): string {
    return path.join(this.reportPath, "definition");
  }

  get pagesPath(): string {
    return path.join(this.definitionPath, "pages");
  }

  get pagesJsonPath(): string {
    return path.join(this.pagesPath, "pages.json");
  }

  pagePath(pageId: string): string {
    return path.join(this.pagesPath, pageId);
  }

  pageJsonPath(pageId: string): string {
    return path.join(this.pagePath(pageId), "page.json");
  }

  visualsPath(pageId: string): string {
    return path.join(this.pagePath(pageId), "visuals");
  }

  visualPath(pageId: string, visualId: string): string {
    return path.join(this.visualsPath(pageId), visualId);
  }

  visualJsonPath(pageId: string, visualId: string): string {
    return path.join(this.visualPath(pageId, visualId), "visual.json");
  }

  // --- Read operations ---

  readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  getPagesMetadata(): PagesMetadata {
    return this.readJson(this.pagesJsonPath);
  }

  getPage(pageId: string): PageDefinition {
    return this.readJson(this.pageJsonPath(pageId));
  }

  getVisual(pageId: string, visualId: string): VisualDefinition {
    return this.readJson(this.visualJsonPath(pageId, visualId));
  }

  listPageIds(): string[] {
    return this.getPagesMetadata().pageOrder;
  }

  listVisualIds(pageId: string): string[] {
    const visualsDir = this.visualsPath(pageId);
    if (!fs.existsSync(visualsDir)) return [];
    return fs
      .readdirSync(visualsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }
}
