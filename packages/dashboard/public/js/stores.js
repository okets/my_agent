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
    /** v2 type-keyed list. Internal — public surface is has/get/list. */
    types: [],
    /** Last-known flat capability list (legacy WS broadcast shape). Used for
     *  has()/get() lookups so existing call-sites keep working without v2. */
    items: [],

    /**
     * Replace internal state from a v2 payload (array of CapabilityTypeV2).
     * Also populates a flat `items` view for legacy lookups.
     */
    updateV2(types) {
      this.types = types || [];
      const flat = [];
      for (const t of this.types) {
        for (const inst of t.instances || []) {
          flat.push({
            name: inst.name,
            provides: t.type,
            enabled: inst.enabled,
            status: inst.state === "unavailable" ? "unavailable" : "available",
            health: inst.health,
            iconSlug: inst.iconSlug,
            label: inst.label,
          });
        }
      }
      this.items = flat;
    },

    /**
     * Legacy WS broadcast handler: accepts the flat capability list emitted
     * by `app.emit('capability:changed', registry.list())`. Updates `items`
     * directly so `has()` keeps working; v2 `types` is left untouched and
     * the settings card refetches `/v2` on the `capability:changed` event.
     */
    update(caps) {
      this.items = (caps || []).map((c) => ({
        name: c.name,
        provides: c.provides,
        enabled: c.enabled !== false,
        status: c.status,
        health: c.health,
        iconSlug: c.iconSlug,
        label: c.name,
      }));
    },

    /** True if any installed instance of `type` is available + enabled. */
    has(type) {
      return this.items.some(
        (c) =>
          c.provides === type && c.status === "available" && c.enabled !== false,
      );
    },

    /** First available + enabled instance of `type`, or undefined. */
    get(type) {
      return this.items.find(
        (c) =>
          c.provides === type && c.status === "available" && c.enabled !== false,
      );
    },

    /** All known capability instances (flat). */
    list() {
      return this.items.slice();
    },

    /** v2 helpers — used only by the settings card. */
    listTypes() {
      return this.types;
    },

    typeFor(type) {
      return this.types.find((t) => t.type === type);
    },
  });

  // 'connected' | 'reconnecting' | 'offline'
  Alpine.store("connection", {
    status: "connected",
  });
});
