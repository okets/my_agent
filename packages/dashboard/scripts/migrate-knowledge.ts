/**
 * Knowledge Migration Script
 *
 * Reclassifies existing knowledge/*.md files (from S3 pipeline)
 * into the new M6.9 knowledge lifecycle structure.
 *
 * Usage: npx tsx scripts/migrate-knowledge.ts [agentDir]
 * Default agentDir: $HOME/.my_agent
 *
 * What it does:
 * 1. Reads knowledge/facts.md, knowledge/people.md, knowledge/preferences.md
 * 2. Writes all existing facts to staging for morning brief review
 * 3. Renames old files to *.md.bak (does not delete)
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { writeStagingFile } from "../src/conversations/knowledge-staging.js";

const agentDir = process.argv[2] || join(process.env.HOME!, ".my_agent");

async function migrate() {
  const knowledgeDir = join(agentDir, "notebook", "knowledge");

  if (!existsSync(knowledgeDir)) {
    console.log("No knowledge directory found. Nothing to migrate.");
    return;
  }

  const files = ["facts.md", "people.md", "preferences.md"];
  const allFacts: string[] = [];

  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      // Extract bullet points (facts)
      const lines = content.split("\n").filter((l) => l.startsWith("- "));
      const facts = lines.map((l) =>
        l.replace(/^- /, "").replace(/ _\(.*?\)_$/, "").trim()
      );
      allFacts.push(...facts);
      console.log(`Read: ${file} (${facts.length} facts)`);
    }
  }

  // Filter empty facts and deduplicate
  const uniqueFacts = [...new Set(allFacts.filter((f) => f.length > 0))];

  if (uniqueFacts.length === 0) {
    console.log("No facts found. Nothing to migrate.");
    return;
  }

  console.log(`\nFound ${uniqueFacts.length} unique facts to reclassify (${allFacts.length} total, ${allFacts.length - uniqueFacts.length} duplicates removed).`);

  // Write facts to staging for the morning brief to propose
  await writeStagingFile(
    agentDir,
    "migration",
    "Legacy Knowledge Migration",
    uniqueFacts.map((f) => ({ subcategory: "unclassified", text: f })),
  );
  console.log("Wrote to staging for morning brief review.");

  // Backup old files
  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    if (existsSync(filePath)) {
      await rename(filePath, filePath + ".bak");
      console.log(`Backed up: ${file} -> ${file}.bak`);
    }
  }

  console.log("\nMigration complete. Old files backed up as *.md.bak");
  console.log("Staged facts will be proposed in the next morning brief.");
}

migrate().catch(console.error);
