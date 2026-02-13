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
      if (this.callbacks.onOpen) {
        this.callbacks.onOpen();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
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
        setTimeout(() => this.connect(), this.reconnectDelay);

        // Exponential backoff: double delay, cap at 30s
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error("[WS] Max reconnect attempts reached. Giving up.");
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
