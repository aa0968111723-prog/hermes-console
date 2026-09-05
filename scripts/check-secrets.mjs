import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// Compare old committed secret literals without printing or using them as credentials.
// Git history is read-only; this check does not rewrite history or revoke credentials.
let baseline = "";
try {
  baseline = execFileSync("git", ["show", "origin/main:lib/hermes-config.ts"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {}
const exposed = [];
for (const line of baseline.split(/\r?\n/)) {
  if (!/(KEY|PASSWORD|PASSWD)/i.test(line)) continue;
  const values = [...line.matchAll(/["'`]([^"'`]{6,})["'`]/g)].map((m) => m[1]);
  for (const value of values)
    if (!/process\.env|hermes\.|DEFAULT_|API_|PASSWORD|^[A-Z_]+$/.test(value))
      exposed.push(value);
}
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/);
async function walk(path) {
  try {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const full = join(path, item.name);
      if (item.isDirectory()) await walk(full);
      else if (/\.(js|json|html|css)$/.test(item.name)) files.push(full);
    }
  } catch {}
}
await walk(".next/static");
let matches = 0,
  scanned = 0;
for (const file of new Set(files)) {
  if (!/\.(tsx?|mjs|js|json|md|ya?ml|css|html)$|\.env\.example$/.test(file))
    continue;
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    continue;
  }
  scanned++;
  if (exposed.some((value) => text.includes(value))) {
    matches++;
    console.error("Exposed legacy secret still present in: " + file);
  }
  if (/(?:sk-proj-|sk-live-)[a-zA-Z0-9_-]{20,}/.test(text)) {
    matches++;
    console.error("Potential secret token in: " + file);
  }
}
if (matches) process.exitCode = 1;
else
  console.log(
    "PASS: " +
      scanned +
      " source/build files checked; no detected legacy secret literals. History/deployment rotation NOT verified.",
  );
