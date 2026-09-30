import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const dist = resolve("dist");
const files = [];
async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) await collect(full);
    else files.push(full);
  }
}
await collect(dist);
const assets = await Promise.all(files.map((file) => readFile(file)));
const canaries = [process.env.KARMA_SECRET_SCAN_CANARY].filter(Boolean);
const fixturePath = resolve(".env.offline-test.local");
try {
  const fixture = await readFile(fixturePath, "utf8");
  const match = fixture.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
  if (match?.[1]) canaries.push(match[1].trim());
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const canary of canaries) {
  if (assets.some((asset) => asset.includes(Buffer.from(canary)))) {
    throw new Error(
      "A private build canary was found in dist; bundle check failed.",
    );
  }
}
if (
  assets.some((asset) =>
    /(?:sb_secret_[A-Za-z0-9_-]{20,}|SUPABASE_SERVICE_ROLE_KEY\s*=)/.test(
      asset.toString("utf8"),
    ),
  )
) {
  throw new Error(
    "A service-role credential marker was found in dist; bundle check failed.",
  );
}
console.log(
  `Client bundle secret scan passed (${files.length} output files; credential values suppressed).`,
);
