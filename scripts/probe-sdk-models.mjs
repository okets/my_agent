#!/usr/bin/env node
// Probe: extract the Model literal union from @anthropic-ai/sdk types.
// Validates "option 2" — can we derive the current model list from the
// installed SDK package without hitting the Anthropic API?

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Direct node_modules lookup — robust to workspace hoisting
const candidates = [
  "packages/dashboard/node_modules/@anthropic-ai/sdk/package.json",
  "packages/core/node_modules/@anthropic-ai/sdk/package.json",
  "node_modules/@anthropic-ai/sdk/package.json",
].map((p) => resolve(repoRoot, p));

const pkgJsonPath = candidates.find((p) => existsSync(p));

if (!pkgJsonPath) {
  console.error("Could not find @anthropic-ai/sdk in any workspace.");
  console.error("Searched:\n  " + candidates.join("\n  "));
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
const sdkRoot = pkgJsonPath.replace(/\/package\.json$/, "");
const declPath = `${sdkRoot}/resources/messages/messages.d.ts`;
const source = readFileSync(declPath, "utf-8");

const match = source.match(/export type Model\s*=\s*([^;]+);/);
if (!match) {
  console.error("Could not find `export type Model` union in", declPath);
  process.exit(1);
}

const literals = [...match[1].matchAll(/'([^']+)'/g)]
  .map((m) => m[1])
  .filter((s) => s.startsWith("claude-"));

const families = { opus: [], sonnet: [], haiku: [], other: [] };
for (const id of literals) {
  if (id.includes("opus")) families.opus.push(id);
  else if (id.includes("sonnet")) families.sonnet.push(id);
  else if (id.includes("haiku")) families.haiku.push(id);
  else families.other.push(id);
}

const undatedOf = (ids) => ids.filter((id) => !/-\d{8}$/.test(id));
const datedOf = (ids) => ids.filter((id) => /-\d{8}$/.test(id));

const pickLatestUndated = (ids) => {
  const undated = undatedOf(ids).filter((id) => !id.endsWith("-latest"));
  if (undated.length === 0) return null;
  return [...undated].sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )[0];
};

console.log(`@anthropic-ai/sdk version: ${pkg.version}`);
console.log(`source: ${declPath.replace(process.cwd(), ".")}`);
console.log(`total model literals: ${literals.length}`);
console.log();

for (const family of ["opus", "sonnet", "haiku"]) {
  const ids = families[family];
  console.log(`${family.toUpperCase()} (${ids.length})`);
  console.log(`  undated: ${undatedOf(ids).join(", ") || "(none)"}`);
  console.log(`  dated:   ${datedOf(ids).join(", ") || "(none)"}`);
  console.log(`  → latest default: ${pickLatestUndated(ids) ?? "(none)"}`);
  console.log();
}

if (families.other.length) {
  console.log("other:", families.other.join(", "));
}
