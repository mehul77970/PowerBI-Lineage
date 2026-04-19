/**
 * Ambient declarations for globals that the server injects into the
 * embedded <script> block BEFORE main.ts runs. The generator in
 * src/html-generator.ts emits a single <script> that concatenates:
 *
 *   1. The server-injected data block (const DATA, MARKDOWN, …)
 *   2. The compiled contents of main.js (this module)
 *
 * These declarations keep TypeScript happy when main.ts references
 * those globals. They're typed loosely as `any` — tightening them
 * means importing types from ../data-builder.ts which would pull
 * server-only code into the client tree. A stricter typing pass can
 * land when we carve main.ts into smaller modules.
 *
 * DaxHighlight is defined by vendor/dax-highlight/dax-highlight.js
 * which loads in its own <script> tag earlier in the generated HTML.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const DATA: any;
declare const MARKDOWN: string;
declare const MARKDOWN_MEASURES: string;
declare const MARKDOWN_FUNCTIONS: string;
declare const MARKDOWN_CALCGROUPS: string;
declare const MARKDOWN_QUALITY: string;
declare const MARKDOWN_DATADICT: string;
declare const MARKDOWN_SOURCES: string;
declare const MARKDOWN_PAGES: string;
declare const MARKDOWN_INDEX: string;
declare const REPORT_NAME: string;
declare const APP_VERSION: string;
declare const GENERATED_AT: string;
declare const DaxHighlight: {
  highlightAll: (root?: ParentNode, selector?: string) => void;
  highlightElement: (el: Element) => void;
  highlightDax: (src: string) => string;
  addFunctions: (names: string[]) => void;
  addKeywords: (names: string[]) => void;
};
