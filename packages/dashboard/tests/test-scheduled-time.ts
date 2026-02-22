/**
 * Test: Verify scheduled time calculation
 */
import { WebSocket } from "ws";

const WS_URL = "ws://localhost:4321/api/chat/ws";
const BASE_URL = "http://localhost:4321";

async function test() {
  // Create conversation
  const convRes = await fetch(`${BASE_URL}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "dashboard" }),
  });
  const conv = await convRes.json();
  console.log("Created conversation:", conv.id);

  // Connect WebSocket
  const ws = new WebSocket(WS_URL);
  await new Promise<void>((resolve) => ws.on("open", resolve));
  
  // Connect to conversation
  ws.send(JSON.stringify({ type: "connect", conversationId: conv.id }));
  await new Promise((r) => setTimeout(r, 1000));

  // Send message
  const now = new Date();
  console.log("\n=== Timing Check ===");
  console.log("Now (UTC):", now.toISOString());
  console.log("Expected +5min:", new Date(now.getTime() + 5 * 60 * 1000).toISOString());
  
  ws.send(JSON.stringify({
    type: "message",
    content: "in 5 minutes send me a test message on whatsapp",
  }));

  // Wait for response and task creation
  await new Promise((r) => setTimeout(r, 15000));
  
  // Check tasks
  const tasksRes = await fetch(`${BASE_URL}/api/tasks`);
  const tasks = await tasksRes.json();
  
  if (tasks.tasks.length > 0) {
    const task = tasks.tasks[0];
    console.log("\n=== Task Created ===");
    console.log("Title:", task.title);
    console.log("Type:", task.type);
    console.log("Created:", task.created);
    console.log("Scheduled for:", task.scheduledFor);
    
    if (task.scheduledFor) {
      const scheduled = new Date(task.scheduledFor);
      const created = new Date(task.created);
      const diffMinutes = (scheduled.getTime() - created.getTime()) / 1000 / 60;
      console.log("\nDiff from created:", diffMinutes.toFixed(1), "minutes");
      
      if (Math.abs(diffMinutes - 5) < 1) {
        console.log("\n✅ PASS: Scheduled time is ~5 minutes from creation");
      } else {
        console.log("\n❌ FAIL: Scheduled time is", diffMinutes.toFixed(1), "minutes from creation (expected ~5)");
      }
    }
  } else {
    console.log("No tasks found");
  }

  ws.close();
  process.exit(0);
}

test().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
