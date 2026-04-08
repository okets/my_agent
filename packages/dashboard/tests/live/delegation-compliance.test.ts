/**
 * M9.3-S3: Delegation Compliance — Live LLM Tests
 *
 * Sends the 4 prompts from docs/issues/2026-04-07-delegation-compliance.md
 * to the brain via headless App with a real LLM. Checks whether the brain
 * delegates (creates an automation) or answers inline.
 *
 * Gate: ANTHROPIC_API_KEY env var
 * Model: Sonnet 4.6 (default brain model)
 * Timeout: 120s per test
 *
 * NOTE: SDK subprocess may fail inside Claude Code (nested session).
 * Run outside Claude Code for full verification:
 *   cd packages/dashboard && npx vitest run tests/live/delegation-compliance.test.ts
 */

import { describe, it, expect, afterEach } from "vitest";
import { AppHarness } from "../integration/app-harness.js";
import { requireApiKey, allowNestedSessions, WAS_NESTED } from "./helpers.js";

const API_KEY_AVAILABLE = requireApiKey();
if (API_KEY_AVAILABLE) allowNestedSessions();

interface TestCase {
  id: string;
  prompt: string;
  expectedBehavior: "delegate" | "direct";
  description: string;
}

const DELEGATION_PROMPTS: TestCase[] = [
  {
    id: "A",
    prompt: "Check memory usage 2 minutes from now",
    expectedBehavior: "delegate",
    description: "Scheduled task — brain should create an automation, not hallucinate scheduling",
  },
  {
    id: "B",
    prompt: "Top 3 Thai restaurants in Chiang Mai",
    expectedBehavior: "delegate",
    description: "Multi-source research — should delegate, not inline with WebSearch",
  },
  {
    id: "C",
    prompt: "Research best noise-canceling headphones under $300",
    expectedBehavior: "delegate",
    description: "Explicit research request — should delegate to a worker",
  },
  {
    id: "D",
    prompt: "What time is it in Tokyo?",
    expectedBehavior: "direct",
    description: "Single factual question — should answer directly, no delegation",
  },
];

describe.skipIf(!API_KEY_AVAILABLE)(
  "M9.3-S3: Delegation Compliance",
  () => {
    let harness: AppHarness;

    afterEach(async () => {
      await harness?.shutdown();
    });

    for (const testCase of DELEGATION_PROMPTS) {
      it(
        `Test ${testCase.id}: ${testCase.prompt}`,
        { timeout: 120_000 },
        async () => {
          harness = await AppHarness.create({ withAutomations: true });

          // Count automations before
          const beforeCount = harness.automationManager!.list().length;

          // Create a conversation and send the prompt
          const { conversation } = await harness.chat.newConversation();
          let responseText = "";

          for await (const event of harness.chat.sendMessage(
            conversation.id,
            testCase.prompt,
            1,
          )) {
            if (event.type === "text_delta") {
              responseText += event.text;
            }
          }

          // SDK subprocess may fail when run inside Claude Code
          if (!responseText && WAS_NESTED) {
            console.warn(
              `[S3] Test ${testCase.id}: No response (likely nested session). Run outside Claude Code.`,
            );
            return;
          }

          // Count automations after
          const afterCount = harness.automationManager!.list().length;
          const delegated = afterCount > beforeCount;

          // Check for delegation indicators in response text
          const responseIndicatesDelegation =
            responseText.includes("created and fired") ||
            responseText.includes("delegating") ||
            responseText.includes("research agent") ||
            responseText.includes("working agent");

          const actualBehavior = delegated || responseIndicatesDelegation
            ? "delegate"
            : "direct";

          console.log(
            `[S3] Test ${testCase.id}: expected=${testCase.expectedBehavior}, ` +
            `actual=${actualBehavior}, delegated=${delegated}, ` +
            `automations=${beforeCount}→${afterCount}`,
          );
          console.log(
            `[S3] Response preview: ${responseText.substring(0, 200)}`,
          );

          if (testCase.expectedBehavior === "delegate") {
            expect(
              delegated || responseIndicatesDelegation,
              `Expected delegation for "${testCase.prompt}" but brain answered inline. ` +
              `Response: ${responseText.substring(0, 300)}`,
            ).toBe(true);
          } else {
            // For direct prompts — should NOT create an automation
            expect(
              delegated,
              `Should NOT delegate for "${testCase.prompt}" but an automation was created`,
            ).toBe(false);
          }
        },
      );
    }
  },
);
