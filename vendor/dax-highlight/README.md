# vendor/dax-highlight

Vendored copy of **dax-highlight** — a tiny, dependency-free DAX syntax highlighter.

## Source

Upstream: `C:\Users\jonathan\OneDrive\jonathan-pap.github.io\dist\dax-highlight\` (author: Jonathan Papworth, MIT).

## Why vendored (instead of a runtime npm dep)

The whole PowerBI-Lineage app has a strict *zero runtime dependencies* policy — only Node builtins in production. Vendoring keeps that intact. The highlighter is ~300 lines of plain JS + ~70 lines of CSS, reviewed into the repo, upgraded manually when a new version lands.

## Files

| File | Purpose |
|---|---|
| `dax-highlight.js` | UMD highlighter. Exposes `window.DaxHighlight` when loaded as a `<script>`. |
| `dax-highlight.css` | Default theme, all token colours exposed as CSS custom properties. |

## How it's wired in

`src/html-generator.ts` reads both files at generation time and inlines them into the generated dashboard HTML:

- The CSS is appended to the main `<style>` block.
- The JS is injected into its own `<script>` tag right before the main dashboard script.
- After every render that produces a `.lineage-dax` block (openLineage, renderFunctions, renderCalcGroups) we call `DaxHighlight.highlightAll(document, '.lineage-dax:not(.code-dax)')` to colourise it.

Our dark/light theme toggle overrides the `--dax-*` custom properties to blend with our `--clr-*` palette, see the `[data-theme="light"] .code-dax` rules at the bottom of the main stylesheet.

## Upgrading

1. Drop the new `dax-highlight.js` / `dax-highlight.css` into this folder.
2. Compute the new SHA-256 hashes:

   ```bash
   node -e "const fs=require('fs'),crypto=require('crypto');for(const f of ['vendor/dax-highlight/dax-highlight.js','vendor/dax-highlight/dax-highlight.css']){console.log(f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));}"
   ```

3. Update the `VENDOR_SHA256` map in `src/html-generator.ts` with the new hashes.
4. Update the test assertion in `tests/render-dax-highlight.test.ts` (the "vendor integrity hash matches" test) with the new JS hash so the two manifests stay in sync.
5. Run `npm test` — one test verifies the runtime integrity check, another re-computes the hash independently so desync between the two manifests fails loud.
6. If the upstream renames any `.dax-*` token classes, update the theme-bridge block in `src/styles/dashboard.css`.

## Integrity check

`src/html-generator.ts` computes the SHA-256 of every vendor file it reads at module load and compares against `VENDOR_SHA256`. Mismatch is fatal — a tampered `vendor/` can't silently inline malicious JS into the generated dashboard. Tests cover both the live check and the pinned hash value.
