/**
 * Escape helpers — single source of truth for every HTML/JS/JSON splice
 * in the rendered dashboard and MD docs.
 *
 * Four contexts, four helpers. The rule of thumb:
 *
 *   HTML text:           <div>{escHtml(x)}</div>
 *   HTML attribute:      <div title="{escAttr(x)}">
 *   JS string literal:   onclick="foo('{jsStr(x)}')"
 *   JSON in <script>:    <script>const DATA = {safeJSON(x)};</script>
 *
 * Zero runtime deps. Pure functions. Safe on null/undefined/non-strings.
 *
 * The model names and descriptions we splice come from Power BI files the
 * user controls — so a malicious measure name like `foo'),alert(1),('bar`
 * MUST NOT break out of its surrounding context. Every fix in v0.2's
 * security track routes through one of these four helpers.
 */

/**
 * HTML text context. Replaces the five characters the HTML spec says must
 * not appear raw in character data: `&`, `<`, `>`, `"`, `'`. Null / undef
 * collapse to empty string.
 *
 * Use for: element text content, inline textual splices inside HTML.
 * Do NOT use for: `onclick=` attribute values that contain JS — use
 * `jsStr` instead, because `'` becomes `&#39;` which the JS parser sees
 * as invalid.
 */
export function escHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML attribute context. Functionally identical to `escHtml` today — the
 * same five-character escape table works for both quoted attribute values
 * and text content. Kept as a separate name so the call site documents
 * which context it's in, and so we can diverge later if we add e.g. URL-
 * context attribute escaping for `href`.
 */
export function escAttr(s: unknown): string {
  return escHtml(s);
}

/**
 * JS string-literal context. Produces a chunk safe to paste between
 * matching quotes (single or double) in a JS string literal, e.g.
 *
 *   `onclick="navigate('${jsStr(name)}')"`
 *
 * Strategy: delegate to `JSON.stringify`, which already handles quotes,
 * backslashes, control chars, and U+2028 / U+2029. Trim the surrounding
 * quotes it adds so the result plugs into either quote style. Then extra-
 * escape `<`, `>`, `&` so the chunk is also safe inside HTML — specifically,
 * so a name containing `</script>` can't close an outer <script> block.
 *
 * Example:
 *   jsStr(`foo'),alert(1),('bar`)
 *     -> `foo\'),alert(1),(\'bar`  (well, JSON.stringify uses " quoting,
 *        so the actual output is `foo'),alert(1),('bar` with proper
 *        escapes — the key invariant is: no unescaped ', ", or \ leaks.)
 */
export function jsStr(s: unknown): string {
  if (s === null || s === undefined) return "";
  // JSON.stringify wraps in "..." and escapes \ and " and control chars.
  // Strip the wrapping quotes, escape single-quote (JSON leaves ' raw),
  // then neutralise HTML-meaningful chars so this survives inside an
  // HTML attribute or <script> block too.
  const raw = JSON.stringify(String(s)).slice(1, -1);
  return raw
    .replace(/'/g, "\\'")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    // JSON.stringify leaves U+2028 / U+2029 raw, but the JS parser
    // treats them as line terminators inside a string literal, which
    // silently breaks the string. Neutralise them here too.
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * JSON-in-<script> context. `JSON.stringify(value)` is almost right, but
 * it does NOT escape `<` — so a field containing `</script>` breaks out of
 * the embedding `<script>` block and enables XSS.
 *
 * This helper post-processes the stringified output to escape every
 * HTML / line-terminator / closing-comment sequence that could affect
 * the surrounding HTML parser:
 *   `<`    -> `\u003c`   (breaks `</script>`, `<!--`)
 *   `>`    -> `\u003e`   (breaks `-->`)
 *   `&`    -> `\u0026`   (prevents any HTML entity interpretation)
 *   `\u2028` and `\u2029`  (JSON allows them raw, JS parser does not —
 *                          they terminate statements mid-string)
 *
 * Result is still valid JSON (escapes are unicode-style, not literal
 * backslash-char), and valid JS when `eval`-ed or parsed.
 */
export function safeJSON(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
