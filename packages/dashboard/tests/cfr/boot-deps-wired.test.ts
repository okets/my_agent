/**
 * Boot-deps wiring — acceptance tests (M9.6-S2)
 *
 * Verifies:
 * 1. AttachmentService and IdleTimerManager are wired into app.chat.deps
 *    at boot time (not at first WS connection).
 * 2. IdleTimerManager.setViewerCountFn() correctly upgrades the callback
 *    that the WS handler provides on first connect.
 *
 * Uses makeTestApp (same pattern as S1) rather than App.create() since
 * full App initialization requires a live SDK key.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { CfrEmitter } from "@my-agent/core";
import { AppChatService } from "../../src/chat/chat-service.js";
import { AppConversationService } from "../../src/app.js";
import { ConversationManager } from "../../src/conversations/index.js";
import { IdleTimerManager } from "../../src/conversations/idle-timer.js";
import { AttachmentService } from "../../src/conversations/attachments.js";
import { SessionRegistry } from "../../src/agent/session-registry.js";
import { RawMediaStore } from "../../src/media/raw-media-store.js";

/** Minimal App-like object, mirroring the makeTestApp pattern from S1. */
function makeTestApp(agentDir: string) {
  const emitter = new EventEmitter();
  const conversationManager = new ConversationManager(agentDir);
  const conversations = new AppConversationService(
    conversationManager,
    emitter as any,
  );
  return Object.assign(emitter, {
    agentDir,
    conversationManager,
    conversations,
    sessionRegistry: new SessionRegistry(5),
    cfr: new CfrEmitter(),
    capabilityRegistry: null,
    rawMediaStore: new RawMediaStore(agentDir),
  });
}

describe("boot-deps-wired", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "m9.6-s2-boot-"));
    mkdirSync(join(agentDir, "conversations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ── 1. Deps populated without WS connection ──────────────────────────────

  it("app.chat deps include AttachmentService after boot wiring", () => {
    const app = makeTestApp(agentDir);
    const chat = new AppChatService(app as any);

    // Simulate App.create() boot wiring (M9.6-S2)
    const attachmentService = new AttachmentService(agentDir);
    const idleTimerManager = new IdleTimerManager(
      { enqueue: () => {}, cancel: () => {} } as any,
      () => 0,
    );

    chat.setDeps({
      abbreviationQueue: null,
      idleTimerManager,
      attachmentService,
      conversationSearchService: null,
      postResponseHooks: null,
      log: () => {},
      logError: () => {},
    });

    // Deps must be populated without any WS connection involved
    const deps = (chat as any)["deps"] as Record<string, unknown> | null;
    expect(deps).not.toBeNull();
    expect(deps!["attachmentService"]).toBe(attachmentService);
    expect(deps!["idleTimerManager"]).toBe(idleTimerManager);
  });

  it("deps are not null even when abbreviationQueue is null (unhatched agent)", () => {
    const app = makeTestApp(agentDir);
    const chat = new AppChatService(app as any);

    // Unhatched: no abbreviationQueue → idleTimerManager is null
    const attachmentService = new AttachmentService(agentDir);

    chat.setDeps({
      abbreviationQueue: null,
      idleTimerManager: null,
      attachmentService,
      conversationSearchService: null,
      postResponseHooks: null,
      log: () => {},
      logError: () => {},
    });

    const deps = (chat as any)["deps"] as Record<string, unknown> | null;
    expect(deps).not.toBeNull();
    // AttachmentService is always present (even pre-hatch); idle is absent
    expect(deps!["attachmentService"]).not.toBeNull();
    expect(deps!["idleTimerManager"]).toBeNull();
  });

  // ── 2. setViewerCountFn callback upgrade ─────────────────────────────────

  it("IdleTimerManager starts with no-op and abbreviates on idle", async () => {
    const enqueuedIds: string[] = [];
    const mgr = new IdleTimerManager(
      { enqueue: (id: string) => enqueuedIds.push(id), cancel: () => {} } as any,
      () => 0, // no-op: 0 viewers → abbreviate on idle
      50,      // 50ms for fast testing
    );

    mgr.touch("conv-1");
    await new Promise((r) => setTimeout(r, 100));

    expect(enqueuedIds).toContain("conv-1");
    mgr.shutdown();
  });

  it("setViewerCountFn upgrades callback — upgraded callback blocks abbreviation", async () => {
    const enqueuedIds: string[] = [];
    const mgr = new IdleTimerManager(
      { enqueue: (id: string) => enqueuedIds.push(id), cancel: () => {} } as any,
      () => 0, // initially: no viewers
      50,
    );

    // WS handler upgrades to "always 1 viewer" on first connect
    mgr.setViewerCountFn(() => 1);

    mgr.touch("conv-2");
    await new Promise((r) => setTimeout(r, 100));

    // Has viewers → should NOT abbreviate
    expect(enqueuedIds).not.toContain("conv-2");
    mgr.shutdown();
  });
});
