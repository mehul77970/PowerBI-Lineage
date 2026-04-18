/**
 * Cross-platform test runner for Node 18 / 20 / 22.
 *
 * Passing a bare directory to `node --test <dir>/` works on 18 and
 * 20 but Node 22 changed the semantics and raises "Cannot find
 * module". Passing a shell glob (`<dir>/*.test.js`) doesn't work
 * either because npm scripts don't expand globs on Windows —
 * the `*` gets passed through literally and Node searches for a
 * file with a star in its name.
 *
 * This runner enumerates test files via `fs.readdirSync` and
 * invokes `node --test` with explicit file paths. Works on every
 * supported Node version and every shell.
 */

import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import * as path from "node:path";

const TEST_DIR = "dist-test/tests";

let entries;
try {
  entries = readdirSync(TEST_DIR);
} catch (err) {
  console.error(`Test runner: ${TEST_DIR} not found — run \`tsc -p tsconfig.test.json\` first.`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const testFiles = entries
  .filter(f => f.endsWith(".test.js"))
  .map(f => path.join(TEST_DIR, f));

if (testFiles.length === 0) {
  console.error(`No *.test.js files found under ${TEST_DIR}.`);
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));
child.on("error", err => {
  console.error("Failed to spawn test runner:", err);
  process.exit(1);
});
