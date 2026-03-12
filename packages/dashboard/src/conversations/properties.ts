/**
 * Properties Utilities
 *
 * Read/write notebook/properties/status.yaml -- dynamic metadata
 * (location, timezone, availability) in YAML format.
 *
 * Design spec: docs/sprints/m6.6-s6-knowledge-lifecycle/design.md Section 6
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface PropertyEntry {
  value: string;
  confidence: "high" | "medium" | "low";
  updated: string;
  source: string;
}

export type PropertiesMap = Record<string, PropertyEntry>;

function getPropertiesPath(agentDir: string): string {
  return join(agentDir, "notebook", "properties", "status.yaml");
}

export async function readProperties(agentDir: string): Promise<PropertiesMap> {
  const filePath = getPropertiesPath(agentDir);

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function updateProperty(
  agentDir: string,
  key: string,
  entry: Omit<PropertyEntry, "updated">,
): Promise<void> {
  const filePath = getPropertiesPath(agentDir);
  const dir = join(agentDir, "notebook", "properties");

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const existing = await readProperties(agentDir);

  existing[key] = {
    ...entry,
    updated: new Date().toISOString().split("T")[0],
  };

  await writeFile(filePath, stringifyYaml(existing), "utf-8");
}
