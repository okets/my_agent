/**
 * M6.5-S4 Test 7.1-7.3: Compaction Test
 *
 * Sends 20+ substantive messages to a single conversation via WebSocket,
 * filling context toward the 200K token limit to trigger server-side compaction.
 *
 * Usage: npx tsx packages/dashboard/tests/test-compaction.ts
 */

import WebSocket from "ws";

const WS_URL = "ws://localhost:4321/api/chat/ws";
const TARGET_MESSAGES = 25;

// Long content blocks to fill context faster
const LONG_PROMPTS = [
  // 1-5: Establish unique topics we can verify later
  "Let's start a conversation about space exploration. Tell me about the Voyager 1 mission - when was it launched, what has it discovered, and where is it now? I want a detailed answer.",

  "Now let's talk about something completely different: the history of coffee. How did coffee spread from Ethiopia to the rest of the world? What were the key historical moments?",

  "Tell me about the mathematics of fractals. Explain the Mandelbrot set, Julia sets, and how self-similarity works. Include the key formulas and who discovered them.",

  "Let's discuss marine biology. Explain how bioluminescence works in deep-sea creatures. What are the main chemical pathways? Name at least 5 species that use it.",

  "Tell me about the architecture of Gothic cathedrals. What engineering innovations made them possible? Explain flying buttresses, ribbed vaults, and pointed arches in detail.",

  // 6-10: More unique topics
  "Explain the complete process of how a book was made in medieval times - from preparing parchment to binding. What tools did scribes use? How long did it take?",

  "Describe the ecology of coral reefs. What is coral bleaching? How do symbiotic relationships work between coral polyps and zooxanthellae? What's the current state of the Great Barrier Reef?",

  "Tell me about the history and science of fermentation. How does yeast convert sugar to alcohol? What cultures independently discovered fermentation? Cover beer, wine, bread, kimchi, and miso.",

  "Explain quantum entanglement in detail. What did Einstein call it? How was it experimentally verified? What are the practical applications being developed today?",

  "Describe the complete water cycle of Earth, including lesser-known processes like sublimation and transpiration. How much water exists on Earth and in what forms?",

  // 11-15: Even more topics with requests for long responses
  "Write a detailed comparison of three programming paradigms: functional, object-oriented, and procedural. Give real-world examples of each, their strengths and weaknesses, and when to use each one. Be thorough - at least 500 words.",

  "Explain the complete lifecycle of a star, from nebula to either white dwarf, neutron star, or black hole. What determines which path a star takes? Include specific mass thresholds and timescales.",

  "Describe the entire process of plate tectonics. How do we know the plates move? What evidence did Alfred Wegener present? How do mid-ocean ridges, subduction zones, and transform faults work?",

  "Tell me about the history of cryptography from ancient times to modern day. Cover the Caesar cipher, Enigma machine, RSA algorithm, and quantum cryptography. Explain how each works.",

  "Explain how the human immune system works in detail. Cover innate immunity, adaptive immunity, T-cells, B-cells, antibodies, and memory cells. How do vaccines leverage this system?",

  // 16-20: Fill more context
  "Describe the complete history of the Internet, from ARPANET to today. Cover TCP/IP, DNS, HTTP, the World Wide Web, and the key people and organizations involved. Be comprehensive.",

  "Explain how neural networks and deep learning work. Cover perceptrons, backpropagation, convolutional neural networks, recurrent neural networks, and transformers. Include the math behind gradient descent.",

  "Tell me about the history and science of cartography. How did ancient civilizations map the world? What projections are used today? Explain the Mercator projection's distortions.",

  "Describe the complete process of photosynthesis, both light-dependent and light-independent reactions. Include the Calvin cycle, electron transport chain, and ATP synthesis. What makes C4 plants different from C3?",

  "Explain the principles of music theory. Cover scales, intervals, chords, harmony, counterpoint, and rhythm. How does the circle of fifths work? What makes certain combinations sound consonant or dissonant?",

  // 21-25: Final push
  "Now I want you to write a very detailed essay (at least 800 words) comparing and contrasting the civilizations of ancient Rome and ancient China during the period 200 BCE to 200 CE. Cover government, military, trade, technology, philosophy, and daily life.",

  "Write a comprehensive technical guide (at least 600 words) on database indexing strategies. Cover B-tree indexes, hash indexes, GiST, GIN, full-text search indexes, and partial indexes. Include when to use each one and performance implications.",

  "Explain the complete physics of flight. Cover Bernoulli's principle, Newton's laws as applied to airfoils, lift, drag, thrust, weight, angle of attack, stall conditions, and how different wing shapes affect performance. At least 500 words.",

  "Write a detailed analysis of the causes, key events, and consequences of the Industrial Revolution. Cover textile manufacturing, steam power, iron and steel, transportation, labor conditions, urbanization, and its lasting impact. At least 700 words.",

  "Finally, let me ask you something that references our earlier conversation: What were the five main topics we discussed at the beginning of this conversation? Can you list them with a brief summary of what you told me about each one?",
];

interface ServerMsg {
  type: string;
  content?: string;
  conversation?: { id: string };
  turns?: Array<{ role: string; content: string }>;
  cost?: number;
  usage?: { input: number; output: number };
  [key: string]: unknown;
}

function connectWS(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(
  ws: WebSocket,
  type: string,
  timeout = 120_000,
): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${type}`)),
      timeout,
    );
    const handler = (data: WebSocket.Data) => {
      const msg: ServerMsg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function waitForDone(ws: WebSocket, timeout = 180_000): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for done")),
      timeout,
    );
    let fullText = "";
    const handler = (data: WebSocket.Data) => {
      const msg: ServerMsg = JSON.parse(data.toString());
      if (msg.type === "text_delta" && msg.content) {
        fullText += msg.content;
      }
      if (msg.type === "done") {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve({ ...msg, _fullText: fullText } as ServerMsg);
      }
      if (msg.type === "error") {
        clearTimeout(timer);
        ws.off("message", handler);
        reject(new Error(`Server error: ${msg.message}`));
      }
    };
    ws.on("message", handler);
  });
}

async function main() {
  console.log("=== M6.5-S4 Compaction Test ===\n");
  console.log(`Target: ${TARGET_MESSAGES} messages\n`);

  // Connect
  const ws = await connectWS();
  console.log("Connected to WebSocket");

  // Create new conversation
  ws.send(JSON.stringify({ type: "new_conversation" }));
  const loaded = await waitForMessage(ws, "conversation_loaded");
  const convId = loaded.conversation?.id;
  console.log(`Conversation: ${convId}\n`);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  for (let i = 0; i < TARGET_MESSAGES; i++) {
    const prompt = LONG_PROMPTS[i] || `Message ${i + 1}: Tell me more about topic ${i % 5 + 1} from earlier. Expand with new information I haven't heard yet. Be detailed.`;

    console.log(
      `[${i + 1}/${TARGET_MESSAGES}] Sending (${prompt.length} chars)...`,
    );
    const startTime = Date.now();

    ws.send(JSON.stringify({ type: "message", content: prompt }));

    const done = await waitForDone(ws);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const input = done.usage?.input ?? 0;
    const output = done.usage?.output ?? 0;
    const cost = done.cost ?? 0;
    totalInputTokens += input;
    totalOutputTokens += output;
    totalCost += cost;

    const responsePreview = ((done as any)._fullText || "").slice(0, 80);
    console.log(
      `  Done in ${elapsed}s | input=${input} output=${output} | cost=$${cost.toFixed(4)}`,
    );
    console.log(
      `  Response: ${responsePreview}...`,
    );
    console.log(
      `  Cumulative: input=${totalInputTokens} output=${totalOutputTokens} cost=$${totalCost.toFixed(4)}`,
    );
    console.log();

    // Check if we're approaching compaction territory
    if (totalInputTokens > 150_000) {
      console.log(
        ">>> APPROACHING 200K TOKEN LIMIT — compaction should trigger soon",
      );
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Messages sent: ${TARGET_MESSAGES}`);
  console.log(`Total input tokens: ${totalInputTokens}`);
  console.log(`Total output tokens: ${totalOutputTokens}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Conversation: ${convId}`);

  // Test 7.3: Ask about early topics
  console.log("\n=== Test 7.3: Memory Retention Check ===");
  console.log("Asking about early conversation topics...\n");

  ws.send(
    JSON.stringify({
      type: "message",
      content:
        "What was the very first topic we discussed in this conversation? And what specific details did you share about it? Also, what was the second topic?",
    }),
  );

  const retentionDone = await waitForDone(ws);
  const retentionResponse = (retentionDone as any)._fullText || "";
  console.log("Memory retention response:");
  console.log(retentionResponse.slice(0, 500));
  console.log("\n---");

  // Check for key terms from early messages
  const earlyTopics = [
    "voyager",
    "coffee",
    "fractal",
    "mandelbrot",
    "bioluminescence",
    "gothic",
    "cathedral",
  ];
  const found = earlyTopics.filter((t) =>
    retentionResponse.toLowerCase().includes(t),
  );
  console.log(
    `\nEarly topic keywords found in response: ${found.length}/${earlyTopics.length}`,
  );
  console.log(`Keywords found: ${found.join(", ") || "none"}`);
  console.log(
    `Keywords missing: ${earlyTopics.filter((t) => !found.includes(t)).join(", ") || "none"}`,
  );

  ws.close();
  console.log("\nDone. Check server logs for compaction indicators:");
  console.log("  grep -i compact /tmp/dashboard.log");
  console.log("  grep -i compaction /tmp/dashboard.log");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
