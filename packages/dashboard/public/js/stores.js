/**
 * Alpine.js reactive stores for live dashboard state (M5-S10)
 *
 * Stores are initialized on 'alpine:init' so they are available before
 * any x-data component initializes.
 */
document.addEventListener("alpine:init", () => {
  Alpine.store("calendar", {
    events: [],
    configs: [],
  });

  Alpine.store("conversations", {
    items: [],
    serverCurrentId: null,
  });

  Alpine.store("memory", {
    stats: null,
    loading: false,
  });

  Alpine.store("spaces", {
    items: [],
    loading: false,
  });

  Alpine.store("automations", {
    items: [],
    loading: true,
    update(automations) {
      this.items = automations;
      this.loading = false;
    },
  });

  Alpine.store("jobs", {
    items: [],
    loading: true,
    dismissed: [],  // job IDs the user closed with ✕

    update(jobs) {
      this.items = jobs;
      this.loading = false;
    },

    /**
     * Running jobs with todoProgress, sorted newest first, max 2.
     * Excludes dismissed cards.
     */
    get activeCards() {
      return this.items
        .filter(j => j.status === "running" && j.todoProgress && j.todoProgress.items?.length > 0 && !this.dismissed.includes(j.id))
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
        .slice(0, 2);
    },

    /**
     * Recently completed jobs (for fade-out), max 2.
     * Cleared from this list after 2s timeout in the component.
     */
    completedCards: [],

    dismiss(jobId) {
      if (!this.dismissed.includes(jobId)) {
        this.dismissed.push(jobId);
      }
    },
  });

  Alpine.store("screenshots", {
    items: [],

    add(screenshot) {
      this.items.push(screenshot);
    },

    forJob(jobId) {
      return this.items.filter(
        (s) =>
          s.refs &&
          s.refs.some((r) => r.startsWith("job/") && r.endsWith("/" + jobId)),
      );
    },

    allForJob(jobId) {
      return this.forJob(jobId);
    },

    forConversation(conversationId) {
      return this.items.filter(
        (s) =>
          s.refs && s.refs.some((r) => r.startsWith("conv/" + conversationId)),
      );
    },
  });

  Alpine.store("model", {
    current: "sonnet",
    set(model) {
      this.current = model;
    },
  });

  Alpine.store("capabilities", {
    items: [],
    update(caps) {
      this.items = caps || [];
    },
    has(type) {
      return this.items.some(
        (c) => c.provides === type && c.status === "available",
      );
    },
  });

  // 'connected' | 'reconnecting' | 'offline'
  Alpine.store("connection", {
    status: "connected",
  });
});
