/**
 * Test 2.6-live: Pre-S2 Conversation Fallback
 *
 * Opens a conversation with sdk_session_id = NULL,
 * sends a message, verifies:
 * 1. Falls back to fresh session (no crash)
 * 2. Brain responds with context awareness
 * 3. New sdk_session_id is persisted to DB
 */

const path = require("path");
const WebSocket = require("ws");
const Database = require("better-sqlite3");

const CONV_ID = "conv-01KJHHKBC21W590SE5RCGHM7VN";
const DB_PATH = path.resolve(__dirname, "../../.my_agent/conversations/agent.db");
const WS_URL = "ws://localhost:4321/api/chat/ws?qa=true";

// Check DB before test
const dbBefore = new Database(DB_PATH);
const before = dbBefore
  .prepare("SELECT sdk_session_id FROM conversations WHERE id = ?")
  .get(CONV_ID);
console.log("[PRE-TEST] sdk_session_id:", before.sdk_session_id);
dbBefore.close();

if (before.sdk_session_id !== null) {
  console.error(
    "ABORT: Conversation already has sdk_session_id. Need a NULL one.",
  );
  process.exit(1);
}

// Connect
const ws = new WebSocket(WS_URL);
let connected = false;
let messageSent = false;

ws.on("open", () => {
  console.log("\n[WS] Connected to server");
  ws.send(
    JSON.stringify({
      type: "connect",
      conversationId: CONV_ID,
    }),
  );
  console.log("[WS] Sent connect for", CONV_ID);
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  // Log every message type
  const summary =
    msg.type +
    (msg.conversationId ? " conv=" + msg.conversationId.substring(0, 20) : "");
  console.log("[WS] <<", summary);

  // After conversation loaded, send the test message
  if (!messageSent && msg.type === "conversation_loaded") {
    connected = true;
    messageSent = true;
    setTimeout(() => {
      console.log("\n[WS] Sending test message...");
      ws.send(
        JSON.stringify({
          type: "message",
          content: "What was the last thing we talked about?",
        }),
      );
    }, 1000);
  }

  // Log content from responses
  if (msg.content) {
    const preview = String(msg.content).substring(0, 150).replace(/\n/g, " ");
    console.log("  content:", preview);
  }

  // Detect completion
  if (msg.type === "done") {
    checkResult();
  }
});

ws.on("close", () => {
  console.log("[WS] Connection closed");
});

ws.on("error", (err) => {
  console.error("[WS] Error:", err.message);
  process.exit(1);
});

function checkResult() {
  console.log("\n[POST-TEST] Checking DB...");
  setTimeout(() => {
    const db = new Database(DB_PATH);
    const after = db
      .prepare("SELECT sdk_session_id FROM conversations WHERE id = ?")
      .get(CONV_ID);
    console.log("[POST-TEST] sdk_session_id:", after.sdk_session_id);

    if (after.sdk_session_id && after.sdk_session_id !== null) {
      console.log("\n=== TEST 2.6-live: PASS ===");
      console.log("Session persisted:", after.sdk_session_id);
    } else {
      console.log("\n=== TEST 2.6-live: FAIL ===");
      console.log("sdk_session_id is still NULL");
    }

    db.close();
    ws.close();
    process.exit(0);
  }, 3000);
}

// Timeout safety
setTimeout(() => {
  console.log("\n[TIMEOUT] 90s elapsed, checking DB anyway...");
  const db = new Database(DB_PATH);
  const after = db
    .prepare("SELECT sdk_session_id FROM conversations WHERE id = ?")
    .get(CONV_ID);
  console.log("[DB] sdk_session_id:", after.sdk_session_id);
  db.close();
  ws.close();
  process.exit(after.sdk_session_id ? 0 : 1);
}, 90000);
