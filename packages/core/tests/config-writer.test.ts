import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse, stringify } from "yaml";
import { ConfigWriter } from "../src/config-writer.js";

describe("ConfigWriter — serialized async write queue", () => {
  let tmpDir: string;
  let writer: ConfigWriter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "config-writer-"));
    writeFileSync(
      join(tmpDir, "config.yaml"),
      stringify({ agent: { nickname: "test" }, transports: {} }),
    );
    writer = new ConfigWriter(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function readConfig(): Record<string, unknown> {
    return parse(readFileSync(join(tmpDir, "config.yaml"), "utf-8"));
  }

  it("writes a single mutation", async () => {
    await writer.write((yaml) => {
      (yaml.transports as any).whatsapp = { plugin: "baileys" };
    });

    const config = readConfig();
    expect((config.transports as any).whatsapp.plugin).toBe("baileys");
  });

  it("preserves existing data", async () => {
    await writer.write((yaml) => {
      (yaml.transports as any).whatsapp = { plugin: "baileys" };
    });

    const config = readConfig();
    expect((config.agent as any).nickname).toBe("test");
  });

  it("two concurrent writes both succeed without data loss", async () => {
    const p1 = writer.write((yaml) => {
      (yaml.transports as any).transport_a = { plugin: "a" };
    });
    const p2 = writer.write((yaml) => {
      (yaml.transports as any).transport_b = { plugin: "b" };
    });

    await Promise.all([p1, p2]);

    const config = readConfig();
    expect((config.transports as any).transport_a.plugin).toBe("a");
    expect((config.transports as any).transport_b.plugin).toBe("b");
  });

  it("mutations are applied sequentially (read-modify-write safe)", async () => {
    // Write a counter field, increment it concurrently 10 times
    await writer.write((yaml) => {
      (yaml as any).counter = 0;
    });

    const promises = Array.from({ length: 10 }, () =>
      writer.write((yaml) => {
        (yaml as any).counter = ((yaml as any).counter ?? 0) + 1;
      }),
    );
    await Promise.all(promises);

    const config = readConfig();
    expect((config as any).counter).toBe(10);
  });

  it("saveTransport merges into transports section", async () => {
    await writer.saveTransport("whatsapp_main", {
      plugin: "baileys",
      role: "dedicated",
    });

    const config = readConfig();
    expect((config.transports as any).whatsapp_main.plugin).toBe("baileys");
    expect((config.transports as any).whatsapp_main.role).toBe("dedicated");
  });

  it("saveTransport merges with existing transport data", async () => {
    await writer.saveTransport("whatsapp_main", { plugin: "baileys" });
    await writer.saveTransport("whatsapp_main", { role: "dedicated" });

    const config = readConfig();
    expect((config.transports as any).whatsapp_main.plugin).toBe("baileys");
    expect((config.transports as any).whatsapp_main.role).toBe("dedicated");
  });

  it("removeTransport deletes from transports section", async () => {
    await writer.saveTransport("whatsapp_main", { plugin: "baileys" });
    await writer.removeTransport("whatsapp_main");

    const config = readConfig();
    expect((config.transports as any).whatsapp_main).toBeUndefined();
  });

  it("saveChannelBinding writes to channels section", async () => {
    await writer.saveChannelBinding("whatsapp_binding", {
      transport: "whatsapp_main",
      ownerIdentity: "12345",
      ownerJid: "12345@lid",
    });

    const config = readConfig();
    expect((config.channels as any).whatsapp_binding.transport).toBe("whatsapp_main");
    expect((config.channels as any).whatsapp_binding.ownerIdentity).toBe("12345");
  });

  it("removeChannelBinding deletes from channels section", async () => {
    await writer.saveChannelBinding("whatsapp_binding", {
      transport: "whatsapp_main",
      ownerIdentity: "12345",
    });
    await writer.removeChannelBinding("whatsapp_binding");

    const config = readConfig();
    expect((config.channels as any)?.whatsapp_binding).toBeUndefined();
  });
});
