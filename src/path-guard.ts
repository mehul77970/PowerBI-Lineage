import * as path from "path";
import * as fs from "fs";

/**
 * Validate a user-supplied `.Report` path before we act on it.
 *
 * The /generate endpoint takes a filesystem path from a query string.
 * It resolves that path and then opens files inside it. Without guards
 * a caller could supply:
 *
 *   - NUL bytes (POSIX path-truncation quirk, some Node versions still
 *     pass them through to fs which is a latent nuisance)
 *   - UNC paths (\\server\share\...) — pulls data from a remote SMB
 *     host, contradicting the "no data leaves your machine" promise
 *     and opening credential-capture / SMB-relay surface
 *   - Empty / whitespace-only input
 *
 * We also resolve the path to its absolute form and verify it exists
 * on disk. This function returns a discriminated union so callers can
 * render the specific reason in the error banner.
 *
 * Not in scope for this guard: checking whether the target is an
 * actually valid .Report folder — that's handled by
 * `findSemanticModelPath()` after this validator passes.
 */
export type PathValidation =
  | { ok: true; resolved: string }
  | { ok: false; reason: string };

export function validateReportPath(raw: unknown): PathValidation {
  if (typeof raw !== "string") {
    return { ok: false, reason: "Please enter a report path." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Please enter a report path." };
  }
  if (trimmed.indexOf("\0") !== -1) {
    return { ok: false, reason: "Path contains a NUL byte." };
  }
  // UNC on Windows: \\server\share\... or //server/share/...
  // This app runs against local .Report folders; a remote UNC target
  // contradicts the "no data leaves your machine" boundary and could
  // expose SMB credentials to a malicious host. Refuse them.
  if (/^\\\\/.test(trimmed) || /^\/\//.test(trimmed)) {
    return {
      ok: false,
      reason: "UNC / network paths are not supported — copy the folder to a local drive first.",
    };
  }

  const resolved = path.resolve(trimmed);

  // After resolve(), Windows may still have resolved a network drive to
  // a UNC-shaped path (e.g. if the caller passed a mapped drive letter
  // that points to \\server\share). Re-check the resolved form.
  if (/^\\\\/.test(resolved)) {
    return {
      ok: false,
      reason: "Resolved path is on a network share — copy the folder to a local drive first.",
    };
  }

  if (!fs.existsSync(resolved)) {
    return { ok: false, reason: `Path not found: ${resolved}` };
  }

  return { ok: true, resolved };
}
