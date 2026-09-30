import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

// Keep Node domain tests separate from JSX component and Playwright suites.
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return discover(path);
      return /\.test\.(?:js|mjs|ts)$/.test(entry.name) ? [path] : [];
    }),
  );
  return paths.flat();
}

const files = (await Promise.all(["src", "scripts"].map(discover)))
  .flat()
  .sort();
if (!files.length) throw new Error("No Node unit tests were discovered.");
const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  env: {
    ...process.env,
    KARMA_113_ORDER_DOMAIN_MODULE:
      process.env.KARMA_113_ORDER_DOMAIN_MODULE ||
      resolve("src/domain/order-domain.js"),
  },
});
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
