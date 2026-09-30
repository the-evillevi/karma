import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = join(projectRoot, "src");
const testFilePattern = /\.test\.(?:js|mjs|ts)$/;

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const discovered = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return findTests(path);
      return entry.isFile() && testFilePattern.test(entry.name) ? [path] : [];
    }),
  );
  return discovered.flat();
}

const testFiles = (await findTests(sourceRoot)).sort();
if (testFiles.length === 0)
  throw new Error("No unit test files were discovered.");
console.log(`Running ${testFiles.length} Node test files under src.`);
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    ...testFiles.map((path) => relative(projectRoot, path)),
  ],
  { cwd: projectRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
