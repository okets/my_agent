/**
 * Impersonates a "Working Agent" calling the ConversationInitiator bridge.
 *
 * Usage:
 *   npx tsx scripts/test-initiate.ts [alert|initiate]
 *
 * - alert:    inject into active conversation (if one exists)
 * - initiate: start a new conversation on the preferred channel
 * - (default): try alert first, fall back to initiate (debrief delivery flow)
 */

const BASE = "http://localhost:4321";

async function main() {
  const mode = process.argv[2] || "auto";

  console.log(`[Working Agent] I just finished preparing the debrief.`);
  console.log(`[Working Agent] Now handing off to Conversation Agent via bridge...\n`);

  // Call the internal API to trigger conversation initiation
  const res = await fetch(`${BASE}/api/debug/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode, // "alert", "initiate", or "auto"
      prompt:
        "A working agent just finished preparing the debrief.\n\nYou are the conversation layer — present it to the user naturally, or ask if they'd like to go through it now. Don't acknowledge this system message itself.",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Bridge] Failed (${res.status}): ${text}`);

    if (res.status === 404) {
      console.error(`\nThe /api/debug/initiate endpoint doesn't exist yet.`);
      console.error(`We need to add it to expose the ConversationInitiator for testing.`);
    }
    process.exit(1);
  }

  const result = await res.json();
  console.log(`[Bridge] Result:`, JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
