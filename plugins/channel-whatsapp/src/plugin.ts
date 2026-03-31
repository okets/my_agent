import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  TransportPlugin,
  TransportConfig,
  TransportStatus,
  IncomingMessage,
  OutgoingMessage,
  TransportAttachment,
  HealthResult,
  PluginStatus,
} from "@my-agent/core";
import { initialStatus } from "@my-agent/core";
import { CredentialSaveQueue, CredentialBackupManager } from "./auth.js";
import { qrToDataUrl } from "./qr.js";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type MessageHandler = (msg: IncomingMessage) => void;
type ErrorHandler = (err: Error) => void;
type StatusHandler = (status: TransportStatus) => void;
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

function getDisconnectMessage(
  statusCode: number | undefined,
  fallbackError?: string,
): string {
  if (statusCode !== undefined && DISCONNECT_MESSAGES[statusCode]) {
    return DISCONNECT_MESSAGES[statusCode];
  }
  return fallbackError || "Connection error. Try re-pairing your device.";
}

// ─────────────────────────────────────────────────────────────────
// Version fetching with fallback
// ─────────────────────────────────────────────────────────────────

// Fallback version if dynamic fetch fails (known working version)
const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1033846690];

async function getWaVersion(): Promise<[number, number, number]> {
  try {
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[channel-whatsapp] Using WA version: ${version.join(".")}`);
    return version as [number, number, number];
  } catch (err) {
    console.warn(
      `[channel-whatsapp] Failed to fetch WA version, using fallback: ${FALLBACK_VERSION.join(".")}`,
    );
    return FALLBACK_VERSION;
  }
}

// ─────────────────────────────────────────────────────────────────
// Markdown image parsing helpers (exported for testability)
// ─────────────────────────────────────────────────────────────────

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export interface ParsedImage {
  alt: string;
  url: string;
}

/**
 * Extract markdown image references from text.
 * Returns an array of { alt, url } objects.
 */
export function extractMarkdownImages(text: string): ParsedImage[] {
  const images: ParsedImage[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex for safety (global regex)
  MD_IMAGE_RE.lastIndex = 0;
  while ((match = MD_IMAGE_RE.exec(text)) !== null) {
    images.push({ alt: match[1], url: match[2] });
  }
  return images;
}

/**
 * Strip markdown image syntax from text, trimming leftover whitespace.
 */
export function stripMarkdownImages(text: string): string {
  return text
    .replace(MD_IMAGE_RE, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Resolve a VAS asset URL to a local file path.
 * Extracts the filename (last path segment) and looks in {agentDir}/screenshots/.
 * Returns null if the file doesn't exist.
 */
export function resolveImagePath(
  url: string,
  agentDir: string,
): string | null {
  const filename = basename(url);
  if (!filename) return null;

  const filePath = join(agentDir, "screenshots", filename);
  if (!existsSync(filePath)) return null;
  return filePath;
}

// ─────────────────────────────────────────────────────────────────
// Plugin class
// ─────────────────────────────────────────────────────────────────

export class BaileysPlugin implements TransportPlugin {
  readonly id: string;
  readonly name = "baileys";
  readonly type = "transport" as const;
  readonly icon = WHATSAPP_ICON;

  private config: TransportConfig | null = null;
  private sock: WASocket | null = null;
  private _status: TransportStatus;
  private saveQueue = new CredentialSaveQueue();
  private messageCache = new Map<string, CachedMessage>();
  // Promise that resolves when the socket is ready for pairing code request
  private socketReady: { resolve: () => void; promise: Promise<void> } | null = null;

  private handlers: EventHandlers = {
    message: [],
    error: [],
    status: [],
    qr: [],
  };

  constructor(config: TransportConfig) {
    this.id = config.id;
    this.config = config;
    this._status = initialStatus();
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async init(config: TransportConfig): Promise<void> {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config) {
      throw new Error("[channel-whatsapp] connect() called before init()");
    }

    // Clean up any existing socket before creating a new one
    // This prevents old socket events from firing during reconnect
    if (this.sock) {
      console.log(
        "[channel-whatsapp] Cleaning up existing socket before reconnect",
      );
      this.sock.ev.removeAllListeners("connection.update");
      this.sock.ev.removeAllListeners("creds.update");
      this.sock.ev.removeAllListeners("messages.upsert");
      this.sock.end(undefined); // Close socket without triggering events
      this.sock = null;
      this.socketReady = null;

      // CRITICAL: Wait for any pending credential saves to complete before
      // creating a new socket. Without this, useMultiFileAuthState() may load
      // stale/empty credentials because the save from the previous socket
      // (e.g., after QR pairing) hasn't finished yet.
      console.log("[channel-whatsapp] Flushing credential save queue...");
      await this.saveQueue.flush();
      console.log("[channel-whatsapp] Credential save queue flushed");
    }

    const authDir = this.resolveAuthDir();

    // Ensure credentials are valid before loading — restore from backup if corrupted
    const backupManager = new CredentialBackupManager(authDir);
    await backupManager.ensureValidCredentials();

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Fetch WhatsApp version (with fallback)
    const version = await getWaVersion();

    // Debug logging for troubleshooting pairing
    const logger = pino({ level: "debug" });

    // CRITICAL: Always create a FRESH socket on each connect() call.
    // The old socket is dead after disconnect and must not be reused.
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        // Cache signal keys in memory to avoid filesystem race conditions
        // during encryption/decryption — prevents protocol violations that
        // cause WhatsApp to terminate the session.
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      // Custom client identity
      browser: ["My-Agent", "Desktop", "1.0.0"],
      // Explicit version to avoid dynamic fetch failures
      version,
      // Don't mark as "online" — avoids conflicts with phone app presence
      markOnlineOnConnect: false,
      // Don't sync full history on reconnect — heavy and can timeout
      syncFullHistory: false,
    });

    this.sock = sock;

    // Create a readiness signal for phone number pairing
    this.socketReady = (() => {
      let resolve: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      return { resolve: resolve!, promise };
    })();

    // Catch raw WebSocket errors to prevent unhandled exceptions
    // from crashing the process or leaving the socket in a broken state
    if (sock.ws && typeof (sock.ws as any).on === "function") {
      (sock.ws as any).on("error", (err: Error) => {
        console.error("[channel-whatsapp] WebSocket error:", err.message);
      });
    }

    // ── Event: connection state changes ─────────────────────────
    sock.ev.on(
      "connection.update",
      (update: BaileysEventMap["connection.update"]) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code available — convert to data URL and emit
        if (qr) {
          // Socket is ready for pairing code request (handshake complete)
          if (this.socketReady) {
            this.socketReady.resolve();
          }

          // Set running: true to indicate active pairing (waiting for QR scan)
          this._status = {
            ...this._status,
            running: true,
            connected: false,
            lastEventAt: new Date(),
            lastError: null,
          };
          this.emitStatus();

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
              : undefined,
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
            // Reconnect scenarios:
            // 1. restartRequired (515) = normal after QR pairing, MUST reconnect
            // 2. Previously connected = transient disconnect, should reconnect
            // 3. Transient error (408 timeout, 503 unavailable) = should retry even if never connected
            // 4. Never connected + non-transient = pairing failure, don't reconnect
            const isRestartRequired =
              statusCode === DisconnectReason.restartRequired;
            const hadPriorConnection = this._status.lastConnectedAt !== null;
            const isTransientError =
              statusCode === 408 || statusCode === 503 || statusCode === 500;
            const shouldReconnect =
              isRestartRequired || hadPriorConnection || isTransientError;

            this._status = {
              ...this._status,
              connected: false,
              running: shouldReconnect,
              lastError: isRestartRequired ? null : errorMessage, // Don't show error for normal restart
              lastEventAt: new Date(),
              lastDisconnect: {
                at: new Date(),
                status: "disconnected",
                error: isRestartRequired ? undefined : errorMessage,
                loggedOut: false,
              },
            };
          }

          this.emitStatus();
        } else if (connection === "connecting") {
          // Note: Don't set running: true here as it triggers reconnect logic
          // Only set running: true when actually connected or when QR is shown
          this._status = {
            ...this._status,
            connected: false,
            lastEventAt: new Date(),
          };
          this.emitStatus();
        }
      },
    );

    // ── Event: credential updates ────────────────────────────────
    sock.ev.on("creds.update", () => {
      this.saveQueue.enqueue(async () => {
        await saveCreds();
        // Backup credentials after each successful save
        await backupManager.createBackup();
      });
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

            // Mark as read on dedicated channels
            if (this.config?.role === "dedicated" && this.sock && msg.key) {
              this.sock.readMessages([msg.key]).catch(() => {});
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
          const attachments: TransportAttachment[] = [];
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

          // Mark as read on dedicated channels
          if (this.config?.role === "dedicated" && this.sock && msg.key) {
            this.sock.readMessages([msg.key]).catch(() => {});
          }
        }
      },
    );
  }

  async disconnect(): Promise<void> {
    // Flush any pending credential saves before closing the socket.
    // Without this, a systemctl restart can lose in-flight credential writes.
    // The saveQueue is already flushed in connect() (line 164) before creating
    // a new socket — this mirrors that pattern for disconnect.
    await this.saveQueue.flush();

    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.socketReady = null;

    this._status = {
      ...this._status,
      running: false,
      connected: false,
      lastEventAt: new Date(),
    };

    this.emitStatus();
  }

  /**
   * Check if valid credentials exist (can auto-connect without pairing).
   * Returns true if creds.json exists and contains valid JSON.
   */
  async hasValidCredentials(): Promise<boolean> {
    const authDir = this.resolveAuthDir();
    const backupManager = new CredentialBackupManager(authDir);
    // Check if creds are valid (this also restores from backup if needed)
    const fs = await import("fs/promises");
    const credsPath = `${authDir}/creds.json`;
    try {
      const content = await fs.readFile(credsPath, "utf8");
      if (!content || content.trim().length === 0) {
        return false;
      }
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear auth credentials to force fresh QR pairing.
   * Call this before connect() when re-pairing after logout/error.
   */
  async clearAuth(): Promise<void> {
    const authDir = this.resolveAuthDir();
    const fs = await import("fs/promises");
    try {
      await fs.rm(authDir, { recursive: true, force: true });
      console.log(`[channel-whatsapp] Cleared auth directory: ${authDir}`);
    } catch (err) {
      console.error(`[channel-whatsapp] Failed to clear auth:`, err);
    }
  }

  /**
   * Request a pairing code for phone number authentication.
   * Alternative to QR scanning — user enters the returned code
   * in WhatsApp app (Settings > Linked Devices > Link a Device).
   *
   * Must be called AFTER connect() creates the socket. Waits for
   * socket readiness (QR event = handshake complete) before requesting.
   *
   * @param phoneNumber — any format, normalized to digits only
   * @returns 8-character pairing code (e.g., "ABCD-1234")
   */
  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) {
      throw new Error("[channel-whatsapp] requestPairingCode() called while disconnected");
    }

    // Wait for socket to be ready (QR event = socket handshake complete)
    if (this.socketReady) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for socket readiness")), 15000)
      );
      await Promise.race([this.socketReady.promise, timeout]);
    }

    if (this.sock.authState.creds.registered) {
      throw new Error("[channel-whatsapp] Already registered — disconnect and clear auth first");
    }

    // Normalize: strip everything except digits
    const normalized = phoneNumber.replace(/[^\d]/g, "");
    if (normalized.length < 7) {
      throw new Error("Phone number too short — include country code");
    }

    console.log(`[channel-whatsapp] Requesting pairing code for ${normalized.slice(0, 4)}****`);
    const code = await this.sock.requestPairingCode(normalized);
    console.log(`[channel-whatsapp] Pairing code received`);
    return code;
  }

  // ── Messaging ──────────────────────────────────────────────────

  async send(to: string, message: OutgoingMessage): Promise<void> {
    if (!this.sock) {
      throw new Error("[channel-whatsapp] send() called while disconnected");
    }

    const images = extractMarkdownImages(message.content);
    const cleanText = stripMarkdownImages(message.content);

    if (images.length > 0) {
      const agentDir =
        (this.config?.agentDir as string | undefined) ??
        process.env.MY_AGENT_DIR ??
        ".my_agent";

      let firstImageSent = false;

      for (const img of images) {
        const filePath = resolveImagePath(img.url, agentDir);
        if (!filePath) {
          // File missing (expired VAS image) — skip gracefully
          console.warn(
            `[channel-whatsapp] Image file not found, skipping: ${img.url}`,
          );
          continue;
        }

        try {
          const buffer = readFileSync(filePath);
          if (!firstImageSent && cleanText) {
            // First image gets the caption (cleaned text)
            const result = await this.sock.sendMessage(to, {
              image: buffer,
              caption: cleanText,
            });
            if (result?.key?.id) {
              this.cacheMessage(result.key.id, cleanText, true);
            }
            firstImageSent = true;
          } else {
            const result = await this.sock.sendMessage(to, { image: buffer });
            if (result?.key?.id) {
              this.cacheMessage(result.key.id, img.alt || "[image]", true);
            }
            firstImageSent = true;
          }
        } catch (err) {
          // File read error — skip gracefully
          console.warn(
            `[channel-whatsapp] Failed to read image, skipping: ${filePath}`,
            err,
          );
        }
      }

      // If no images were successfully sent (all missing/failed),
      // fall back to sending text only
      if (!firstImageSent && cleanText) {
        const result = await this.sock.sendMessage(to, { text: cleanText });
        if (result?.key?.id) {
          this.cacheMessage(result.key.id, cleanText, true);
        }
      }
    } else {
      // No images — send plain text as before
      const result = await this.sock.sendMessage(to, {
        text: message.content,
      });
      if (result?.key?.id) {
        this.cacheMessage(result.key.id, message.content, true);
      }
    }
  }

  async sendTypingIndicator(to: string): Promise<void> {
    if (!this.sock) return;
    try {
      await this.sock.sendPresenceUpdate("composing", to);
    } catch (err) {
      // Non-critical — don't let typing indicator failure break message flow
      console.warn("[channel-whatsapp] Failed to send typing indicator:", err);
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

  transportStatus(): TransportStatus {
    return { ...this._status };
  }

  async healthCheck(): Promise<HealthResult> {
    if (this._status.connected) {
      return { healthy: true };
    }
    return {
      healthy: false,
      message: this._status.lastError ?? "Not connected",
      resolution: "Check WhatsApp connection in Settings.",
    };
  }

  status(): PluginStatus {
    if (this._status.connected) return { state: "active" };
    if (this._status.lastDisconnect?.loggedOut)
      return { state: "error", error: "Logged out" };
    if (this._status.running) return { state: "connecting" };
    return { state: "disconnected" };
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
  config: TransportConfig,
): BaileysPlugin {
  return new BaileysPlugin(config);
}
