/**
 * M9.4-S3: Job Progress Card component
 * M9.4-S5: Three-phase handoff (running → handing-off → fading) with
 *          sibling-aware safety net for handing-off cards.
 *
 * Sticky card above compose box showing real-time job step progress.
 * Reads from Alpine.store("jobs").activeCards.
 */

const HANDING_OFF_SAFETY_MS = 10_000;

function progressCard() {
  return {
    expanded: {},          // { [jobId]: boolean }
    fading: {},            // { [jobId]: "done" | "fading" }
    confirming: {},        // { [jobId]: true } — stop confirmation pending
    phase: {},             // M9.4-S5: { [jobId]: "running" | "handing-off" | "fading" }
    safetyTimers: {},      // M9.4-S5: { [jobId]: timeoutHandle }
    frozenSnapshot: {},    // M9.4-S5: { [jobId]: jobSnapshot } captured at handoff entry

    get cards() {
      const store = Alpine.store("jobs");
      return [...store.activeCards, ...store.completedCards.filter(c => !store.dismissed.includes(c.id))];
    },

    isExpanded(jobId) {
      return this.expanded[jobId] || false;
    },

    toggle(jobId) {
      this.expanded[jobId] = !this.expanded[jobId];
    },

    dismiss(jobId) {
      Alpine.store("jobs").dismiss(jobId);
      delete this.expanded[jobId];
      delete this.confirming[jobId];
      // M9.4-S5: clean up handoff state on user-driven dismiss
      this._clearSafetyTimer(jobId);
      delete this.phase[jobId];
      delete this.frozenSnapshot[jobId];
    },

    isConfirming(jobId) {
      return this.confirming[jobId] || false;
    },

    requestStop(jobId) {
      this.confirming[jobId] = true;
    },

    cancelStop(jobId) {
      delete this.confirming[jobId];
    },

    async confirmStop(jobId) {
      delete this.confirming[jobId];
      const store = Alpine.store("jobs");
      store.dismiss(jobId);
      delete this.expanded[jobId];
      this._clearSafetyTimer(jobId);
      delete this.phase[jobId];
      delete this.frozenSnapshot[jobId];
      try {
        const res = await fetch(`/api/jobs/${jobId}/stop`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        console.error("[progress-card] stop failed, restoring card:", e);
        store.dismissed = store.dismissed.filter(id => id !== jobId);
      }
    },

    isFading(jobId) {
      return this.fading[jobId] === "fading";
    },

    isDone(jobId) {
      const f = this.fading[jobId];
      return f === "done" || f === "fading";
    },

    statusIcon(status) {
      switch (status) {
        case "done": return "\u2713";
        case "in_progress": return "\u21bb";
        case "blocked": return "\u2298";
        default: return "\u25cb";
      }
    },

    statusClass(status) {
      switch (status) {
        case "done": return "text-green-400/60";
        case "in_progress": return "text-blue-400";
        case "blocked": return "text-orange-400/60";
        default: return "text-gray-500";
      }
    },

    currentStepText(job) {
      // M9.4-S5: prefer frozen snapshot when the card is in handing-off so the
      // live state:jobs broadcast can't overwrite the displayed step.
      const snap = this.frozenSnapshot[job.id] || job;
      if (!snap.todoProgress?.items) return "";
      const current = snap.todoProgress.items.find(i => i.status === "in_progress");
      return current ? current.text : "";
    },

    /**
     * M9.4-S5: enter handing-off phase. Card stays at full opacity in "Done"
     * state, with a 10s safety timer. Push to completedCards so the card
     * keeps rendering even after state:jobs no longer reports running.
     */
    enterHandingOff(job) {
      const store = Alpine.store("jobs");
      if (store.dismissed.includes(job.id)) return;
      if (!job.todoProgress?.items?.length) return;
      if (this.phase[job.id] !== undefined) return;  // idempotent

      this.phase[job.id] = "handing-off";
      this.frozenSnapshot[job.id] = JSON.parse(JSON.stringify(job));
      this.fading[job.id] = "done";  // Re-uses existing isDone() check for label

      // Push to completedCards (preserves M9.4-S3 mechanism that keeps the
      // card rendering after state:jobs broadcasts no longer report running)
      if (!store.completedCards.find(c => c.id === job.id)) {
        store.completedCards.push(this.frozenSnapshot[job.id]);
      }

      this._armSafetyTimer(job.id);
    },

    /**
     * M9.4-S5: enter fading phase. Runs the existing 1.5s "Done" → 0.5s fade
     * → remove timeline. Does NOT push to completedCards (already pushed in
     * enterHandingOff for the M9.4-S5 path).
     */
    enterFading(jobId) {
      if (this.phase[jobId] === "fading") return;  // idempotent
      this.phase[jobId] = "fading";
      this._clearSafetyTimer(jobId);

      const store = Alpine.store("jobs");
      this.fading[jobId] = "done";

      setTimeout(() => {
        this.fading[jobId] = "fading";
      }, 1500);

      setTimeout(() => {
        store.completedCards = store.completedCards.filter(c => c.id !== jobId);
        delete this.fading[jobId];
        delete this.phase[jobId];
        delete this.frozenSnapshot[jobId];
      }, 2000);
    },

    /**
     * Legacy fade for notify=none/debrief jobs. Called instead of
     * enterHandingOff so these jobs skip the handing-off phase entirely
     * and fade after the standard 2 seconds (matches pre-M9.4-S5 behavior).
     */
    legacyFade(job) {
      const store = Alpine.store("jobs");
      if (store.dismissed.includes(job.id)) return;
      if (!job.todoProgress?.items?.length) return;

      store.completedCards.push(job);
      this.fading[job.id] = "done";

      setTimeout(() => {
        this.fading[job.id] = "fading";
      }, 1500);

      setTimeout(() => {
        store.completedCards = store.completedCards.filter(c => c.id !== job.id);
        delete this.fading[job.id];
      }, 2000);
    },

    _armSafetyTimer(jobId) {
      this._clearSafetyTimer(jobId);
      this.safetyTimers[jobId] = setTimeout(() => {
        if (this.phase[jobId] === "handing-off") {
          this.enterFading(jobId);
        }
      }, HANDING_OFF_SAFETY_MS);
    },

    _clearSafetyTimer(jobId) {
      if (this.safetyTimers[jobId]) {
        clearTimeout(this.safetyTimers[jobId]);
        delete this.safetyTimers[jobId];
      }
    },

    /**
     * M9.4-S5: when an assistant turn starts (tagged with the matching jobId),
     * fade the matching card AND reset every other handing-off card's safety
     * timer (sibling-aware reset).
     */
    _onAssistantTurnStart(triggerJobId) {
      if (this.phase[triggerJobId] === "handing-off") {
        this.enterFading(triggerJobId);
      }
      // Reset siblings
      for (const jobId of Object.keys(this.phase)) {
        if (jobId !== triggerJobId && this.phase[jobId] === "handing-off") {
          this._armSafetyTimer(jobId);
        }
      }
    },

    /**
     * M9.4-S5: when handoff_pending broadcasts (heartbeat is processing the
     * queue), reset every handing-off card's safety timer (including the
     * one matching jobId). Protects against >10s cold-start stalling card #1
     * before its real start arrives.
     */
    _onHandoffPending(_jobId) {
      for (const jobId of Object.keys(this.phase)) {
        if (this.phase[jobId] === "handing-off") {
          this._armSafetyTimer(jobId);
        }
      }
    },

    init() {
      // M9.4-S5: watch for jobs transitioning from running to terminal status.
      // Route based on the notify policy.
      this.$watch(() => Alpine.store("jobs").items, (newJobs, oldJobs) => {
        if (!oldJobs) return;
        for (const job of newJobs) {
          const isTerminal = job.status === "completed" || job.status === "failed" || job.status === "needs_review";
          if (!isTerminal) continue;
          const wasRunning = oldJobs.find(o => o.id === job.id && o.status === "running");
          if (!wasRunning || !wasRunning.todoProgress?.items?.length) continue;

          // notify default (NF5): undefined → "debrief" (mirrors backend
          // automation-processor.ts:201 default).
          const notify = job.notify ?? "debrief";
          if (notify === "none" || notify === "debrief") {
            this.legacyFade(job);
          } else {
            this.enterHandingOff(job);
          }
        }
      });

      // M9.4-S5: subscribe to handoff WS events.
      window.addEventListener("assistant-turn-start", (e) => {
        this._onAssistantTurnStart(e.detail.triggerJobId);
      });
      window.addEventListener("handoff-pending", (e) => {
        this._onHandoffPending(e.detail.jobId);
      });
    },
  };
}
