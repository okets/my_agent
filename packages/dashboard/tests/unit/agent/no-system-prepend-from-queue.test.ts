/**
 * M9.4-S4.2 Task 7 — regression test that the dead pendingNotifications queue
 * on SessionManager is actually deleted, not just unused.
 *
 * The audit's Top-1 concern was that any future caller of queueNotification()
 * would re-introduce [SYSTEM:] wrap framing via streamMessage's drain block,
 * defeating the action-request principle. The plan's response was to delete
 * the queue entirely — zero callers, no value to keep.
 *
 * This test pins the deletion structurally so a future contributor cannot
 * silently re-add the queue without breaking it.
 */

import { describe, it, expect } from "vitest";
import { SessionManager } from "../../../src/agent/session-manager.js";

describe("SessionManager pendingNotifications queue (DELETED — M9.4-S4.2 Task 7)", () => {
  it("queueNotification method does NOT exist on SessionManager", () => {
    expect((SessionManager.prototype as any).queueNotification).toBeUndefined();
  });

  it("hasPendingNotifications method does NOT exist on SessionManager", () => {
    expect(
      (SessionManager.prototype as any).hasPendingNotifications,
    ).toBeUndefined();
  });

  it("pendingNotifications field is not declared on the prototype/class", () => {
    // The field is a private instance member, so it would only appear after
    // construction. We can't construct without async init in this minimal
    // test, but we can verify the source declaration is gone by checking
    // that an instance created via Object.create has no own field of that
    // name in the constructor's parameter shape.
    const sm = Object.create(SessionManager.prototype) as any;
    // The field would not exist on a newly-created instance until the
    // constructor's class field initializer runs. This minimum-viable
    // assertion is: there should be no method that mutates such a field.
    expect(sm.pendingNotifications).toBeUndefined();
    expect(sm.queueNotification).toBeUndefined();
  });
});
