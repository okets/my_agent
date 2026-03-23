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
    update(jobs) {
      this.items = jobs;
      this.loading = false;
    },
  });

  // 'connected' | 'reconnecting' | 'offline'
  Alpine.store("connection", {
    status: "connected",
  });
});
