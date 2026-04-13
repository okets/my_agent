/**
 * WebSocket client with auto-reconnect and exponential backoff
 */
class NinaWebSocket {
  constructor(url, callbacks) {
    this.url = url;
    this.callbacks = callbacks || {};
    this.ws = null;
    this.reconnectDelay = 1000; // Start at 1s
    this.maxReconnectDelay = 30000; // Cap at 30s
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.shouldReconnect = true;
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn("[WS] Already connected");
      return;
    }

    console.log(`[WS] Connecting to ${this.url}...`);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("[WS] Connected");
      this.reconnectDelay = 1000; // Reset delay on successful connection
      this.reconnectAttempts = 0;
      if (typeof Alpine !== "undefined" && Alpine.store("connection")) {
        Alpine.store("connection").status = "connected";
      }
      if (this.callbacks.onOpen) {
        this.callbacks.onOpen();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle state sync messages — update Alpine stores directly
        if (typeof Alpine !== "undefined") {
          switch (data.type) {
            case "state:calendar":
              if (Alpine.store("calendar")) {
                // Transform WebSocket format to REST API format for timeline compatibility
                const events = (data.events || []).map((e) => ({
                  id: e.uid,
                  title: e.title,
                  start: e.start,
                  end: e.end,
                  allDay: e.allDay,
                  color: "#89b4fa",
                  textColor: "#ffffff",
                  extendedProps: {
                    calendarId: e.calendarId,
                    description: e.description,
                    location: e.location,
                    status: e.status,
                    transparency: e.transparency,
                    action: e.action,
                    rrule: e.rrule,
                  },
                }));
                Alpine.store("calendar").events = events;
                if (data.configs !== undefined) {
                  Alpine.store("calendar").configs = data.configs;
                }
              }
              break;
            case "state:conversations":
              if (Alpine.store("conversations")) {
                const all = data.conversations || [];
                Alpine.store("conversations").items = all;
                // Track server's current conversation ID for sync
                const current = all.find((c) => c.status === "current");
                Alpine.store("conversations").serverCurrentId = current
                  ? current.id
                  : null;
              }
              break;
            case "state:memory":
              if (Alpine.store("memory")) {
                Alpine.store("memory").stats = data.stats || null;
                Alpine.store("memory").loading = false;
              }
              break;
            case "state:spaces":
              if (Alpine.store("spaces")) {
                Alpine.store("spaces").items = data.spaces || [];
                Alpine.store("spaces").loading = false;
              }
              break;
            case "state:automations":
              if (Alpine.store("automations")) {
                Alpine.store("automations").update(data.automations || []);
              }
              break;
            case "state:jobs":
              if (Alpine.store("jobs")) {
                Alpine.store("jobs").update(data.jobs || []);
              }
              break;
            case "state:screenshot":
              if (Alpine.store("screenshots")) {
                Alpine.store("screenshots").add(data.screenshot);
              }
              break;
            case "capabilities":
              if (Alpine.store("capabilities")) {
                Alpine.store("capabilities").update(data.capabilities);
              }
              // Notify settings card so it refetches /v2 — flat broadcast
              // doesn't carry per-type label/multiInstance/icon metadata.
              window.dispatchEvent(new CustomEvent("capability:changed"));
              break;
            case "model_changed":
              if (Alpine.store("model")) {
                Alpine.store("model").set(data.model);
              }
              break;
          }
        }

        // M9.4-S5: emit DOM events for progress-card handoff wiring.
        // These must fire whether Alpine is loaded or not.
        if (data.type === "start" && data.triggerJobId) {
          // Only tag-carrying start events fire the handoff. Untagged
          // user/model turns are ignored (spec I1).
          window.dispatchEvent(
            new CustomEvent("assistant-turn-start", {
              detail: { triggerJobId: data.triggerJobId },
            }),
          );
        } else if (data.type === "handoff_pending") {
          // Always dispatch — frontend handler decides which cards to refresh.
          window.dispatchEvent(
            new CustomEvent("handoff-pending", {
              detail: { jobId: data.jobId },
            }),
          );
        }

        if (this.callbacks.onMessage) {
          this.callbacks.onMessage(data);
        }
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };

    this.ws.onerror = (error) => {
      console.error("[WS] Error:", error);
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[WS] Closed (code: ${event.code}, reason: ${event.reason})`);
      if (this.callbacks.onClose) {
        this.callbacks.onClose(event);
      }

      // Attempt to reconnect if not explicitly closed by user
      if (
        this.shouldReconnect &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        this.reconnectAttempts++;
        console.log(
          `[WS] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
        );
        if (typeof Alpine !== "undefined" && Alpine.store("connection")) {
          Alpine.store("connection").status = "reconnecting";
        }
        setTimeout(() => this.connect(), this.reconnectDelay);

        // Exponential backoff: double delay, cap at 30s
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error("[WS] Max reconnect attempts reached. Giving up.");
        if (typeof Alpine !== "undefined" && Alpine.store("connection")) {
          Alpine.store("connection").status = "offline";
        }
      }
    };
  }

  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[WS] Cannot send: WebSocket is not open");
      return false;
    }

    try {
      const message = typeof data === "string" ? data : JSON.stringify(data);
      this.ws.send(message);
      return true;
    } catch (err) {
      console.error("[WS] Failed to send message:", err);
      return false;
    }
  }

  close() {
    this.shouldReconnect = false; // Disable auto-reconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
