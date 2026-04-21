/**
 * M9.6-S21 BUG-6: system-prompt "Currently Degraded" section tests.
 *
 * Verifies that the SystemPromptBuilder injects the degraded-capabilities
 * section into Layer 3 when capabilities are unhealthy, and omits it
 * entirely when everything is healthy — so the brain never falsely claims
 * a capability works when it is broken.
 */

import { describe, it, expect } from "vitest";
import { SystemPromptBuilder } from "../../src/agent/system-prompt-builder.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use the real brainDir if present; otherwise fall back to a minimal stub path.
// The stable-prompt build will fail gracefully for a missing brainDir —
// we only assert on the dynamic layer content, not the stable prompt.
const BRAIN_DIR = path.resolve(__dirname, "../../../../.my_agent/brain");
const AGENT_DIR = path.resolve(__dirname, "../../../../.my_agent");

function makeBuilder(
  getDegradedCapabilities: () => { type: string; name: string; friendlyName: string }[],
): SystemPromptBuilder {
  return new SystemPromptBuilder({
    brainDir: BRAIN_DIR,
    agentDir: AGENT_DIR,
    getDegradedCapabilities,
  });
}

const BASE_CONTEXT = {
  channel: "test",
  conversationId: "test-conv-1",
  messageIndex: 1,
};

async function getDynamicLayer(builder: SystemPromptBuilder): Promise<string> {
  const blocks = await builder.build(BASE_CONTEXT);
  // Block[0] = stable prompt (cached). Block[1] = dynamic layer.
  return blocks[1]?.text ?? "";
}

describe("M9.6-S21 BUG-6: system-prompt degraded-capabilities section", () => {
  it("section absent when all capabilities healthy", async () => {
    const builder = makeBuilder(() => []);
    const dynamic = await getDynamicLayer(builder);
    expect(dynamic).not.toContain("[Currently Degraded Capabilities]");
  });

  it("section present with friendly name when one capability is degraded", async () => {
    const builder = makeBuilder(() => [
      { type: "text-to-audio", name: "tts-edge-tts", friendlyName: "Voice synthesis" },
    ]);
    const dynamic = await getDynamicLayer(builder);
    expect(dynamic).toContain("[Currently Degraded Capabilities]");
    expect(dynamic).toContain("Voice synthesis");
    expect(dynamic).toContain("[End Currently Degraded Capabilities]");
  });

  it("section absent again after capabilities recover (next prompt assembly)", async () => {
    let degraded: { type: string; name: string; friendlyName: string }[] = [
      { type: "text-to-audio", name: "tts-edge-tts", friendlyName: "Voice synthesis" },
    ];
    const builder = makeBuilder(() => degraded);

    // First build — degraded
    const dynamic1 = await getDynamicLayer(builder);
    expect(dynamic1).toContain("[Currently Degraded Capabilities]");

    // Capability recovers
    degraded = [];

    // Next build — section must be gone
    const dynamic2 = await getDynamicLayer(builder);
    expect(dynamic2).not.toContain("[Currently Degraded Capabilities]");
  });
});
