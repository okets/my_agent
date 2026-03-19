import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { loadChannelBindings } from "../src/channels/index.js";

describe("ChannelBinding config parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "channel-binding-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(yaml: Record<string, unknown>): void {
    writeFileSync(join(tmpDir, "config.yaml"), stringify(yaml));
  }

  it("parses channel bindings from config.yaml", () => {
    writeConfig({
      channels: {
        whatsapp_binding: {
          transport: "whatsapp_main",
          ownerIdentity: "41433650172129",
          ownerJid: "41433650172129@lid",
        },
      },
    });

    const bindings = loadChannelBindings(tmpDir);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe("whatsapp_binding");
    expect(bindings[0].transport).toBe("whatsapp_main");
    expect(bindings[0].ownerIdentity).toBe("41433650172129");
    expect(bindings[0].ownerJid).toBe("41433650172129@lid");
  });

  it("returns empty array when no channels section", () => {
    writeConfig({ agent: { nickname: "test" } });

    const bindings = loadChannelBindings(tmpDir);
    expect(bindings).toEqual([]);
  });

  it("returns empty array when config.yaml missing", () => {
    const bindings = loadChannelBindings(tmpDir + "/nonexistent");
    expect(bindings).toEqual([]);
  });

  it("skips entries without transport field (old format remnants)", () => {
    writeConfig({
      channels: {
        old_entry: {
          plugin: "baileys",
          role: "dedicated",
        },
        valid_binding: {
          transport: "whatsapp_main",
          ownerIdentity: "12345",
          ownerJid: "12345@lid",
        },
      },
    });

    const bindings = loadChannelBindings(tmpDir);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].id).toBe("valid_binding");
  });

  it("handles snake_case aliases for owner fields", () => {
    writeConfig({
      channels: {
        binding1: {
          transport: "whatsapp_main",
          owner_identity: "12345",
          owner_jid: "12345@lid",
        },
      },
    });

    const bindings = loadChannelBindings(tmpDir);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].ownerIdentity).toBe("12345");
    expect(bindings[0].ownerJid).toBe("12345@lid");
  });

  it("parses multiple bindings", () => {
    writeConfig({
      channels: {
        whatsapp_binding: {
          transport: "whatsapp_main",
          ownerIdentity: "111",
          ownerJid: "111@lid",
        },
        telegram_binding: {
          transport: "telegram_main",
          ownerIdentity: "222",
          ownerJid: "222@telegram",
        },
      },
    });

    const bindings = loadChannelBindings(tmpDir);
    expect(bindings).toHaveLength(2);
  });

  it("includes previousOwner when present (re-auth state)", () => {
    writeConfig({
      channels: {
        binding1: {
          transport: "whatsapp_main",
          ownerIdentity: "new_owner",
          ownerJid: "new@lid",
          previousOwner: "old_owner",
        },
      },
    });

    const bindings = loadChannelBindings(tmpDir);
    expect(bindings[0].previousOwner).toBe("old_owner");
  });
});
