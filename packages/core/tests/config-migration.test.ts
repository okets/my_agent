import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse, stringify } from "yaml";
import { migrateConfig } from "../src/config-migration.js";

describe("config migration: channels → transports", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "config-migration-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(yaml: Record<string, unknown>): void {
    writeFileSync(join(tmpDir, "config.yaml"), stringify(yaml));
  }

  function readConfig(): Record<string, unknown> {
    return parse(readFileSync(join(tmpDir, "config.yaml"), "utf-8"));
  }

  it("detects old format: channels entry with 'plugin' field", () => {
    writeConfig({
      channels: {
        whatsapp_main: {
          plugin: "baileys",
          role: "dedicated",
          identity: "+1555000000",
        },
      },
    });

    const result = migrateConfig(tmpDir);
    expect(result.migrated).toBe(true);
  });

  it("skips migration when transports section already exists", () => {
    writeConfig({
      transports: {
        whatsapp_main: {
          plugin: "baileys",
        },
      },
    });

    const result = migrateConfig(tmpDir);
    expect(result.migrated).toBe(false);
  });

  it("skips migration when no channels section exists", () => {
    writeConfig({ agent: { nickname: "test" } });

    const result = migrateConfig(tmpDir);
    expect(result.migrated).toBe(false);
  });

  it("skips migration when channels have 'transport' field (new format)", () => {
    writeConfig({
      channels: {
        my_channel: {
          transport: "whatsapp_main",
          ownerIdentity: "12345",
        },
      },
    });

    const result = migrateConfig(tmpDir);
    expect(result.migrated).toBe(false);
  });

  it("moves channel entries to transports section", () => {
    writeConfig({
      channels: {
        whatsapp_main: {
          plugin: "baileys",
          role: "dedicated",
          identity: "+1555000000",
          authDir: "auth/whatsapp_main",
          reconnect: { initialMs: 2000, maxMs: 30000 },
        },
      },
    });

    migrateConfig(tmpDir);

    const config = readConfig();
    expect(config.transports).toBeDefined();
    const transport = (config.transports as any).whatsapp_main;
    expect(transport.plugin).toBe("baileys");
    expect(transport.role).toBe("dedicated");
    expect(transport.identity).toBe("+1555000000");
    expect(transport.reconnect).toEqual({ initialMs: 2000, maxMs: 30000 });
  });

  it("creates channel binding when ownerIdentities exists", () => {
    writeConfig({
      channels: {
        whatsapp_main: {
          plugin: "baileys",
          role: "dedicated",
          identity: "+1555000000",
          ownerIdentities: ["41433650172129"],
          ownerJid: "41433650172129@lid",
        },
      },
    });

    migrateConfig(tmpDir);

    const config = readConfig();
    // ownerIdentities should be removed from transport
    const transport = (config.transports as any).whatsapp_main;
    expect(transport.ownerIdentities).toBeUndefined();
    expect(transport.ownerJid).toBeUndefined();

    // Channel binding should be created
    expect(config.channels).toBeDefined();
    const channels = config.channels as Record<string, any>;
    const bindingKeys = Object.keys(channels).filter((k) => k !== "defaults");
    expect(bindingKeys.length).toBe(1);
    const binding = channels[bindingKeys[0]];
    expect(binding.transport).toBe("whatsapp_main");
    expect(binding.ownerIdentity).toBe("41433650172129");
    expect(binding.ownerJid).toBe("41433650172129@lid");
  });

  it("collapses multi-entry ownerIdentities to first element", () => {
    writeConfig({
      channels: {
        whatsapp_main: {
          plugin: "baileys",
          role: "dedicated",
          ownerIdentities: ["first", "second", "third"],
          ownerJid: "first@lid",
        },
      },
    });

    migrateConfig(tmpDir);

    const config = readConfig();
    const channels = config.channels as Record<string, any>;
    const bindingKeys = Object.keys(channels).filter((k) => k !== "defaults");
    const binding = channels[bindingKeys[0]];
    expect(binding.ownerIdentity).toBe("first");
  });

  it("creates backup before migration", () => {
    writeConfig({
      channels: {
        whatsapp_main: { plugin: "baileys" },
      },
    });

    migrateConfig(tmpDir);

    expect(existsSync(join(tmpDir, "config.yaml.backup-pre-transport-split"))).toBe(true);
  });

  it("preserves defaults section", () => {
    writeConfig({
      channels: {
        defaults: {
          reconnect: { initialMs: 3000 },
        },
        whatsapp_main: {
          plugin: "baileys",
        },
      },
    });

    migrateConfig(tmpDir);

    const config = readConfig();
    const transports = config.transports as Record<string, any>;
    expect(transports.defaults).toBeDefined();
    expect(transports.defaults.reconnect.initialMs).toBe(3000);
  });

  it("preserves other config sections", () => {
    writeConfig({
      agent: { nickname: "test" },
      brain: { model: "sonnet" },
      channels: {
        whatsapp_main: { plugin: "baileys" },
      },
      embeddings: { plugin: "ollama" },
    });

    migrateConfig(tmpDir);

    const config = readConfig();
    expect((config.agent as any).nickname).toBe("test");
    expect((config.brain as any).model).toBe("sonnet");
    expect((config.embeddings as any).plugin).toBe("ollama");
  });
});
