import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { SpaceSyncService, isToolSpace } from "@my-agent/core";
import type { SpaceSyncPayload } from "@my-agent/core";
import { ConversationDatabase } from "../../src/conversations/db.js";
import {
  buildToolCommand,
  classifyToolOutput,
} from "../../src/spaces/tool-invoker.js";
import { buildRepairContext } from "../../src/spaces/repair-context.js";
import {
  appendDecision,
  readDecisions,
} from "../../src/spaces/decisions.js";

describe("Tool Lifecycle Integration", () => {
  let spacesDir: string;
  let dbDir: string;
  let db: ConversationDatabase;
  let service: SpaceSyncService;
  let synced: SpaceSyncPayload[];

  beforeEach(() => {
    spacesDir = mkdtempSync(join(tmpdir(), "tool-lifecycle-spaces-"));
    dbDir = mkdtempSync(join(tmpdir(), "tool-lifecycle-db-"));
    db = new ConversationDatabase(dbDir);
    synced = [];
  });

  afterEach(async () => {
    if (service) await service.stop();
    db.close();
  });

  it("full tool lifecycle: create -> sync -> invoke -> fail -> repair -> log", async () => {
    // 1. Create a space directory with SPACE.md (tool fields)
    const spaceDir = join(spacesDir, "echo-tool");
    mkdirSync(spaceDir, { recursive: true });

    writeFileSync(
      join(spaceDir, "SPACE.md"),
      `---
name: echo-tool
tags:
  - tool
  - echo
runtime: bash
entry: echo.sh
io:
  input:
    message: string
  output:
    result: stdout
maintenance:
  on_failure: fix
  log: DECISIONS.md
created: "2026-03-23"
---

# Echo Tool

Echoes input as JSON.

## Maintenance Rules

- Check that input is valid JSON
- Verify echo.sh is executable
`,
    );

    // 2. Write a trivial echo.sh script that outputs valid JSON
    writeFileSync(
      join(spaceDir, "echo.sh"),
      '#!/bin/bash\necho \'{"result": "ok"}\'\n',
    );
    chmodSync(join(spaceDir, "echo.sh"), "755");

    // 3. Sync via SpaceSyncService -> verify indexed in DB
    service = new SpaceSyncService({
      spacesDir,
      onSpaceChanged: (payload) => {
        synced.push(payload);
        db.upsertSpace(payload);
      },
      onSpaceDeleted: (name) => db.deleteSpace(name),
      debounceMs: 50,
    });

    const count = await service.fullSync();
    expect(count).toBe(1);
    expect(synced).toHaveLength(1);

    // Verify DB has io/maintenance
    const dbSpace = db.getSpace("echo-tool");
    expect(dbSpace).not.toBeNull();
    expect(dbSpace!.io).toEqual({
      input: { message: "string" },
      output: { result: "stdout" },
    });
    expect(dbSpace!.maintenance).toEqual({
      on_failure: "fix",
      log: "DECISIONS.md",
    });

    // 4. buildToolCommand produces correct shell command
    const spaceEntity = {
      name: "echo-tool",
      manifestDir: spaceDir,
      tags: ["tool", "echo"],
      path: spaceDir,
      runtime: "bash",
      entry: "echo.sh",
      io: { input: { message: "string" }, output: { result: "stdout" } },
      maintenance: { on_failure: "fix" as const, log: "DECISIONS.md" },
      description: "Echoes input as JSON.",
      created: "2026-03-23",
      indexedAt: synced[0].indexedAt,
    };

    expect(isToolSpace(spaceEntity)).toBe(true);

    const cmd = buildToolCommand(spaceEntity, { message: "hello" });
    expect(cmd).toContain("bash echo.sh");
    expect(cmd).toContain(spaceDir);

    // 5. Execute command (safe: test-controlled, no user input), classifyToolOutput returns success
    const stdout = execSync(cmd, { encoding: "utf-8" });
    const successResult = classifyToolOutput(0, stdout, spaceEntity.io);
    expect(successResult.success).toBe(true);

    // 6. Simulate failure — classifyToolOutput with exit code 1
    const failResult = classifyToolOutput(1, "Error: something broke");
    expect(failResult.success).toBe(false);
    expect(failResult.errorType).toBe("exit_code");

    // 7. buildRepairContext with policy "fix" includes DECISIONS.md content
    appendDecision(spaceDir, {
      category: "created",
      summary: "Echo tool created for testing",
    });
    const repairCtx = buildRepairContext(spaceEntity, "Error: something broke");
    expect(repairCtx.shouldRepair).toBe(true);
    expect(repairCtx.policy).toBe("fix");
    expect(repairCtx.repairPrompt).toContain("Echo tool created for testing");
    expect(repairCtx.repairPrompt).toContain("Check that input is valid JSON");

    // 8. appendDecision logs the repair — verify in DECISIONS.md
    appendDecision(spaceDir, {
      category: "repaired",
      summary: "Fixed echo.sh quoting issue",
    });
    const decisions = readDecisions(spaceDir);
    expect(decisions).toContain("-- created");
    expect(decisions).toContain("-- repaired");
    expect(decisions).toContain("Fixed echo.sh quoting issue");

    // 9. list_spaces({ tag: "tool" }) returns the space
    const toolSpaces = db.listSpaces({ tag: "tool" });
    expect(toolSpaces).toHaveLength(1);
    expect(toolSpaces[0].name).toBe("echo-tool");
    expect(toolSpaces[0].entry).toBe("echo.sh");
  });
});
