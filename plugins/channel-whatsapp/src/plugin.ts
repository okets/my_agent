import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import type {
  ChannelPlugin,
  ChannelInstanceConfig,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
  ChannelAttachment,
} from "@my-agent/core";
import { initialStatus } from "@my-agent/core";
import { CredentialSaveQueue } from "./auth.js";
import { qrToDataUrl } from "./qr.js";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type MessageHandler = (msg: IncomingMessage) => void;
type ErrorHandler = (err: Error) => void;
type StatusHandler = (status: ChannelStatus) => void;
type QrHandler = (qr: string) => void;

interface EventHandlers {
  message: MessageHandler[];
  error: ErrorHandler[];
  status: StatusHandler[];
  qr: QrHandler[];
}

// ─────────────────────────────────────────────────────────────────
// WhatsApp SVG icon
// ─────────────────────────────────────────────────────────────────

const WHATSAPP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>`;

// ─────────────────────────────────────────────────────────────────
// Message cache for reaction context
// ─────────────────────────────────────────────────────────────────

interface CachedMessage {
  content: string;
  fromMe: boolean;
}

const MESSAGE_CACHE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────
// Human-readable disconnect messages
// ─────────────────────────────────────────────────────────────────

const DISCONNECT_MESSAGES: Record<number, string> = {
  401: "Logged out from WhatsApp. Re-pair your device to reconnect.",
  403: "Access denied by WhatsApp.",
  408: "Connection timed out. Check your internet connection.",
  411: "Multi-device sync issue. Re-pair required.",
  428: "Connection closed unexpectedly. Try re-pairing.",
  440: "Logged in from another device. Re-pair to use here.",
  500: "Session corrupted. Re-pair required.",
  503: "WhatsApp service unavailable. Try again later.",
  515: "Reconnecting...", // Normal restart, not shown as error
};

function getDisconnectMessage(statusCode: number | undefined, fallbackError?: string): string {
  if (statusCode !== undefined && DISCONNECT_MESSAGES[statusCode]) {
    return DISCONNECT_MESSAGES[statusCode];
  }
  return fallbackError || "Connection error. Try re-pairing your device.";
}

// ─────────────────────────────────────────────────────────────────
// Plugin class
// ─────────────────────────────────────────────────────────────────

export class BaileysPlugin implements ChannelPlugin {
  name = "baileys";
  icon = WHATSAPP_ICON;

  private config: ChannelInstanceConfig | null = null;
  private sock: WASocket | null = null;
  private _status: ChannelStatus;
  private saveQueue = new CredentialSaveQueue();
  private messageCache = new Map<string, CachedMessage>();

  private handlers: EventHandlers = {
    message: [],
    error: [],
    status: [],
    qr: [],
  };

  constructor(config: ChannelInstanceConfig) {
    this.config = config;
    this._status = initialStatus();
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async init(config: ChannelInstanceConfig): Promise<void> {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config) {
      throw new Error("[channel-whatsapp] connect() called before init()");
    }

    const authDir = this.resolveAuthDir();
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Suppress Baileys verbose logging
    const logger = pino({ level: "silent" });

    // CRITICAL: Always create a FRESH socket on each connect() call.
    // The old socket is dead after disconnect and must not be reused.
    const sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
    });

    this.sock = sock;

    // ── Event: connection state changes ─────────────────────────
    sock.ev.on(
      "connection.update",
      (update: BaileysEventMap["connection.update"]) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code available — convert to data URL and emit
        if (qr) {
          qrToDataUrl(qr)
            .then((dataUrl) => {
              for (const handler of this.handlers.qr) {
                handler(dataUrl);
              }
            })
            .catch((err) => {
              this.emitError(
                err instanceof Error ? err : new Error(String(err)),
              );
            });
        }

        if (connection === "open") {
          this._status = {
            ...this._status,
            running: true,
            connected: true,
            lastConnectedAt: new Date(),
            reconnectAttempts: 0,
            lastError: null,
            lastDisconnect: null,
            lastEventAt: new Date(),
          };
          this.emitStatus();
        } else if (connection === "close") {
          const statusCode = (
            lastDisconnect?.error as { output?: { statusCode?: number } }
          )?.output?.statusCode;

          // Only 401 (loggedOut) is a true logout. 515 (restartRequired) means
          // "create a fresh socket and reconnect" — normal after QR pairing.
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          const errorMessage = getDisconnectMessage(
            statusCode,
            lastDisconnect?.error instanceof Error
              ? lastDisconnect.error.message
              : undefined
          );

          if (isLoggedOut) {
            // Logged out — do not reconnect, clear credentials signal
            this._status = {
              ...this._status,
              running: false,
              connected: false,
              lastError: errorMessage,
              lastEventAt: new Date(),
              lastDisconnect: {
                at: new Date(),
                status: "logged_out",
                error: errorMessage,
                loggedOut: true,
              },
            };
          } else {
            // Transient disconnect — signal manager to reconnect
            this._status = {
              ...this._status,
              connected: false,
              running: true,
              lastError: errorMessage,
              lastEventAt: new Date(),
              lastDisconnect: {
                at: new Date(),
                status: "disconnected",
                error: errorMessage,
                loggedOut: false,
              },
            };
          }

          this.emitStatus();
        } else if (connection === "connecting") {
          this._status = {
            ...this._status,
            running: true,
            connected: false,
            lastEventAt: new Date(),
          };
          this.emitStatus();
        }
      },
    );

    // ── Event: credential updates ────────────────────────────────
    sock.ev.on("creds.update", () => {
      this.saveQueue.enqueue(() => saveCreds());
    });

    // ── Event: incoming messages ─────────────────────────────────
    sock.ev.on(
      "messages.upsert",
      async (upsert: BaileysEventMap["messages.upsert"]) => {
        if (upsert.type !== "notify") return;

        for (const msg of upsert.messages) {
          // Skip messages sent by this account
          if (msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid;
          if (!remoteJid) continue;

          const isGroup = remoteJid.endsWith("@g.us");

          // Check for reaction message
          const reactionMsg = msg.message?.reactionMessage;
          if (reactionMsg) {
            // Reaction to a message — treat as a message
            const emoji = reactionMsg.text;
            // Empty emoji means reaction was removed
            if (!emoji) continue;

            // Look up the message being reacted to
            const reactedToId = reactionMsg.key?.id;
            const reactedToFromMe = reactionMsg.key?.fromMe;
            const cached = reactedToId
              ? this.messageCache.get(reactedToId)
              : null;

            let content: string;
            if (cached) {
              // We have the message content — include a snippet
              const snippet =
                cached.content.length > 50
                  ? cached.content.slice(0, 50) + "..."
                  : cached.content;
              content = `[Reacted with ${emoji} to: "${snippet}"]`;
            } else if (reactedToFromMe) {
              content = `[Reacted with ${emoji} to your earlier message]`;
            } else {
              content = `[Reacted with ${emoji} to an earlier message]`;
            }

            const timestamp = msg.messageTimestamp
              ? new Date(Number(msg.messageTimestamp) * 1000)
              : new Date();

            const incoming: IncomingMessage = {
              id: msg.key.id ?? `${Date.now()}`,
              from: isGroup ? (msg.key.participant ?? remoteJid) : remoteJid,
              content,
              timestamp,
              channelId: this.config!.id,
              ...(isGroup && { groupId: remoteJid }),
              ...(msg.pushName && { senderName: msg.pushName }),
            };

            this._status = {
              ...this._status,
              lastMessageAt: new Date(),
              lastEventAt: new Date(),
            };

            for (const handler of this.handlers.message) {
              handler(incoming);
            }
            continue;
          }

          // Extract text content (from regular text or image caption)
          const imageMsg = msg.message?.imageMessage;
          const content =
            msg.message?.conversation ??
            msg.message?.extendedTextMessage?.text ??
            imageMsg?.caption ??
            "";

          // Build attachments array for images
          const attachments: ChannelAttachment[] = [];
          if (imageMsg) {
            try {
              const buffer = (await downloadMediaMessage(
                msg,
                "buffer",
                {},
              )) as Buffer;
              const mimeType = imageMsg.mimetype || "image/jpeg";
              const ext = mimeType.split("/")[1] || "jpg";
              attachments.push({
                filename: `image-${Date.now()}.${ext}`,
                mimeType,
                data: buffer,
              });
            } catch (err) {
              console.error("[WhatsApp] Failed to download image:", err);
            }
          }

          // Skip messages with no content AND no attachments
          if (!content && attachments.length === 0) continue;

          const timestamp = msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date();

          const incoming: IncomingMessage = {
            id: msg.key.id ?? `${Date.now()}`,
            from: isGroup ? (msg.key.participant ?? remoteJid) : remoteJid,
            content,
            timestamp,
            channelId: this.config!.id,
            ...(isGroup && {
              groupId: remoteJid,
            }),
            ...(msg.pushName && { senderName: msg.pushName }),
            ...(attachments.length > 0 && { attachments }),
          };

          // Cache message for reaction context lookup
          if (msg.key.id && content) {
            this.cacheMessage(msg.key.id, content, false);
          }

          this._status = {
            ...this._status,
            lastMessageAt: new Date(),
            lastEventAt: new Date(),
          };

          for (const handler of this.handlers.message) {
            handler(incoming);
          }
        }
      },
    );
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }

    this._status = {
      ...this._status,
      running: false,
      connected: false,
      lastEventAt: new Date(),
    };

    this.emitStatus();
  }

  // ── Messaging ──────────────────────────────────────────────────

  async send(to: string, message: OutgoingMessage): Promise<void> {
    if (!this.sock) {
      throw new Error("[channel-whatsapp] send() called while disconnected");
    }

    const result = await this.sock.sendMessage(to, { text: message.content });
    // Cache outgoing message for reaction context
    if (result?.key?.id) {
      this.cacheMessage(result.key.id, message.content, true);
    }
  }

  // ── Event emitter ──────────────────────────────────────────────

  on(event: "message", handler: MessageHandler): void;
  on(event: "error", handler: ErrorHandler): void;
  on(event: "status", handler: StatusHandler): void;
  on(event: "qr", handler: QrHandler): void;
  on(
    event: string,
    handler: MessageHandler | ErrorHandler | StatusHandler | QrHandler,
  ): void {
    if (event === "message") {
      this.handlers.message.push(handler as MessageHandler);
    } else if (event === "error") {
      this.handlers.error.push(handler as ErrorHandler);
    } else if (event === "status") {
      this.handlers.status.push(handler as StatusHandler);
    } else if (event === "qr") {
      this.handlers.qr.push(handler as QrHandler);
    }
  }

  // ── Status ─────────────────────────────────────────────────────

  status(): ChannelStatus {
    return { ...this._status };
  }

  // ── Private helpers ────────────────────────────────────────────

  private resolveAuthDir(): string {
    if (this.config!.authDir) {
      return this.config!.authDir;
    }
    // Default: .my_agent/auth/{channelId}/
    return `.my_agent/auth/${this.config!.id}/`;
  }

  private emitStatus(): void {
    this._status.lastEventAt = new Date();
    for (const handler of this.handlers.status) {
      handler({ ...this._status });
    }
  }

  private emitError(err: Error): void {
    this._status = {
      ...this._status,
      lastError: err.message,
      lastEventAt: new Date(),
    };
    for (const handler of this.handlers.error) {
      handler(err);
    }
  }

  private cacheMessage(id: string, content: string, fromMe: boolean): void {
    // Evict oldest entries if cache is full
    if (this.messageCache.size >= MESSAGE_CACHE_SIZE) {
      const firstKey = this.messageCache.keys().next().value;
      if (firstKey) this.messageCache.delete(firstKey);
    }
    this.messageCache.set(id, { content, fromMe });
  }
}

// ─────────────────────────────────────────────────────────────────
// Factory function
// ─────────────────────────────────────────────────────────────────

export function createBaileysPlugin(
  config: ChannelInstanceConfig,
): BaileysPlugin {
  return new BaileysPlugin(config);
}
