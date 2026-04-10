/**
 * M9.4-S3: Job Progress Card component
 *
 * Sticky card above compose box showing real-time job step progress.
 * Reads from Alpine.store("jobs").activeCards.
 */

function progressCard() {
  return {
    expanded: {},     // { [jobId]: boolean }
    fading: {},       // { [jobId]: true } — cards in 2s fade-out

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
      if (!job.todoProgress?.items) return "";
      const current = job.todoProgress.items.find(i => i.status === "in_progress");
      return current ? current.text : "";
    },

    /**
     * Called when a job transitions to completed.
     * Shows "Done" at full opacity for 1.5s, then fades over 0.5s, then removes.
     */
    handleJobCompleted(job) {
      const store = Alpine.store("jobs");
      if (store.dismissed.includes(job.id)) return;
      if (!job.todoProgress?.items?.length) return;

      store.completedCards.push(job);
      // Phase 1: show "Done" at full opacity
      this.fading[job.id] = "done";

      // Phase 2: after 1.5s, start opacity fade
      setTimeout(() => {
        this.fading[job.id] = "fading";
      }, 1500);

      // Phase 3: after 2s total, remove card
      setTimeout(() => {
        store.completedCards = store.completedCards.filter(c => c.id !== job.id);
        delete this.fading[job.id];
      }, 2000);
    },

    init() {
      // Watch for jobs transitioning from running to completed
      this.$watch(() => Alpine.store("jobs").items, (newJobs, oldJobs) => {
        if (!oldJobs) return;
        for (const job of newJobs) {
          if (job.status === "completed" || job.status === "failed" || job.status === "needs_review") {
            const wasRunning = oldJobs.find(o => o.id === job.id && o.status === "running");
            if (wasRunning && wasRunning.todoProgress?.items?.length) {
              this.handleJobCompleted(job);
            }
          }
        }
      });
    },
  };
}
