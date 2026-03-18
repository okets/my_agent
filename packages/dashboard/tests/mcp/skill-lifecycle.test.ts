import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleCreateSkill,
  handleGetSkill,
  handleUpdateSkill,
  handleDeleteSkill,
  handleListSkills,
} from "../../src/mcp/skill-server.js";

describe("skill lifecycle — create → get → update → list → delete", () => {
  const testDir = join(tmpdir(), `skill-lifecycle-${Date.now()}`);
  const skillsDir = join(testDir, ".claude", "skills");

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("complete lifecycle", async () => {
    // 1. Create
    const createResult = await handleCreateSkill(
      {
        name: "report-generator",
        description: "Generate formatted reports from data",
        content: "## Steps\n\n1. Gather data\n2. Format output",
      },
      testDir,
    );
    expect(createResult.isError).toBeFalsy();

    // 2. Get — verify content
    const getResult = await handleGetSkill(
      { name: "report-generator" },
      testDir,
    );
    expect(getResult.isError).toBeFalsy();
    expect(getResult.content[0].text).toContain("Generate formatted reports");
    expect(getResult.content[0].text).toContain("## Steps");

    // 3. Update — change description and content
    const updateResult = await handleUpdateSkill(
      {
        name: "report-generator",
        description: "Generate formatted PDF reports from data with charts",
        content:
          "## Steps\n\n1. Gather data\n2. Generate charts\n3. Format as PDF",
      },
      testDir,
    );
    expect(updateResult.isError).toBeFalsy();

    // 4. Get — verify update applied
    const getAfterUpdate = await handleGetSkill(
      { name: "report-generator" },
      testDir,
    );
    expect(getAfterUpdate.content[0].text).toContain("PDF reports");
    expect(getAfterUpdate.content[0].text).toContain("Generate charts");

    // 5. List — verify it appears
    const listResult = await handleListSkills(testDir);
    expect(listResult.content[0].text).toContain("report-generator");

    // 6. Delete
    const deleteResult = await handleDeleteSkill(
      { name: "report-generator" },
      testDir,
    );
    expect(deleteResult.isError).toBeFalsy();

    // 7. Verify gone
    const getAfterDelete = await handleGetSkill(
      { name: "report-generator" },
      testDir,
    );
    expect(getAfterDelete.isError).toBe(true);

    // 8. List — verify gone
    const listAfterDelete = await handleListSkills(testDir);
    expect(listAfterDelete.content[0].text).not.toContain("report-generator");
  });
});
