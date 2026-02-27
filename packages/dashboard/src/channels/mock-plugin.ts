import type {
  ChannelPlugin,
  ChannelInstanceConfig,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
} from "@my-agent/core";
import { initialStatus } from "@my-agent/core";

export class MockChannelPlugin implements ChannelPlugin {
  name = "mock";
  icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  private config: ChannelInstanceConfig | null = null;
  private _status: ChannelStatus;
  private handlers: {
    message: Array<(msg: IncomingMessage) => void>;
    error: Array<(err: Error) => void>;
    status: Array<(status: ChannelStatus) => void>;
  } = { message: [], error: [], status: [] };

  /** Sent messages are captured here for testing */
  sentMessages: Array<{ to: string; message: OutgoingMessage }> = [];

  constructor() {
    this._status = initialStatus();
  }

  async init(config: ChannelInstanceConfig): Promise<void> {
    this.config = config;
  }

  async connect(): Promise<void> {
    this._status = {
      ...this._status,
      running: true,
      connected: true,
      lastConnectedAt: new Date(),
      reconnectAttempts: 0,
      lastError: null,
    };
    this.emitStatus();
  }

  async disconnect(): Promise<void> {
    this._status = {
      ...this._status,
      running: false,
      connected: false,
    };
    this.emitStatus();
  }

  async send(to: string, message: OutgoingMessage): Promise<void> {
    this.sentMessages.push({ to, message });
  }

  on(event: "message", handler: (msg: IncomingMessage) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  on(event: "status", handler: (status: ChannelStatus) => void): void;
  on(event: "qr", handler: (qrDataUrl: string) => void): void;
  on(event: string, handler: (...args: any[]) => void): void {
    if (event === "message") this.handlers.message.push(handler as any);
    else if (event === "error") this.handlers.error.push(handler as any);
    else if (event === "status") this.handlers.status.push(handler as any);
  }

  status(): ChannelStatus {
    return { ...this._status };
  }

  async healthCheck(): Promise<boolean> {
    return this._status.connected;
  }

  // ── Test Methods ───────────────────────────────────────────────

  /** Simulate an incoming message */
  simulateIncoming(msg: IncomingMessage): void {
    this._status.lastMessageAt = new Date();
    this._status.lastEventAt = new Date();
    for (const handler of this.handlers.message) {
      handler(msg);
    }
  }

  /** Simulate a disconnect (should trigger manager reconnection) */
  simulateDisconnect(): void {
    this._status = {
      ...this._status,
      connected: false,
      lastDisconnect: {
        at: new Date(),
        status: "disconnected",
      },
    };
    this.emitStatus();
  }

  /** Simulate a logout (should NOT trigger reconnection) */
  simulateLogout(): void {
    this._status = {
      ...this._status,
      connected: false,
      running: false,
      lastDisconnect: {
        at: new Date(),
        status: "logged_out",
        loggedOut: true,
      },
    };
    this.emitStatus();
  }

  /** Simulate rapid messages for debounce testing */
  simulateRapidMessages(count: number, intervalMs: number): void {
    let sent = 0;
    const timer = setInterval(() => {
      if (sent >= count) {
        clearInterval(timer);
        return;
      }
      this.simulateIncoming({
        id: `rapid-${Date.now()}-${sent}`,
        from: "+1555000001",
        content: `Rapid message ${sent + 1}`,
        timestamp: new Date(),
        channelId: this.config?.id ?? "mock",
      });
      sent++;
    }, intervalMs);
  }

  /** Simulate a duplicate message (same ID twice) */
  simulateDuplicateMessage(msg: IncomingMessage): void {
    this.simulateIncoming(msg);
    // Send again with same ID after small delay
    setTimeout(() => this.simulateIncoming(msg), 50);
  }

  private emitStatus(): void {
    this._status.lastEventAt = new Date();
    for (const handler of this.handlers.status) {
      handler({ ...this._status });
    }
  }
}
