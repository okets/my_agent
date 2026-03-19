/**
 * Transport Manager
 *
 * Central registry for transport plugins with lifecycle management,
 * resilience features (reconnection, dedup, debounce),
 * and message routing.
 */

import type {
  Plugin,
  TransportPlugin,
  TransportPluginFactory,
  TransportConfig,
  TransportStatus,
  TransportInfo,
  IncomingMessage,
  OutgoingMessage,
  ReconnectPolicy,
} from "@my-agent/core";
import {
  toDisplayStatus,
  initialStatus,
  computeBackoff,
  DEFAULT_BACKOFF,
  DedupCache,
  MessageDebouncer,
} from "@my-agent/core";

/** Internal transport entry */
interface TransportEntry {
  config: TransportConfig;
  plugin: TransportPlugin;
  status: TransportStatus;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  debouncer: MessageDebouncer<IncomingMessage> | null;
  /** Flag to suppress reconnects during QR pairing */
  pairing: boolean;
}

/** Message handler signature */
type MessageHandler = (transportId: string, messages: IncomingMessage[]) => void;

/** Status change handler signature */
type StatusChangeHandler = (transportId: string, status: TransportStatus) => void;

/** QR code handler signature */
type QrCodeHandler = (transportId: string, qrDataUrl: string) => void;

/** Pairing success handler signature */
type PairedHandler = (transportId: string) => void;

/** Pairing code handler signature (phone number pairing) */
type PairingCodeHandler = (transportId: string, pairingCode: string) => void;

export class TransportManager {
  private transports = new Map<string, TransportEntry>();
  private pluginFactories = new Map<string, TransportPluginFactory>();
  private dedup = new DedupCache();
  private messageHandler: MessageHandler | null = null;
  private statusChangeHandlers: StatusChangeHandler[] = [];
  private qrCodeHandler: QrCodeHandler | null = null;
  private pairingHandler: PairedHandler | null = null;
  private pairingCodeHandler: PairingCodeHandler | null = null;
  private phonePairingTransports = new Set<string>();

  /**
   * Register a plugin factory by name.
   */
  registerPlugin(name: string, factory: TransportPluginFactory): void {
    this.pluginFactories.set(name, factory);
  }

  /**
   * Set the message handler (called after dedup + debounce).
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Register a status change listener.
   */
  onStatusChange(handler: StatusChangeHandler): void {
    this.statusChangeHandlers.push(handler);
  }

  /**
   * Register a QR code handler (called when a plugin emits a 'qr' event).
   */
  onQrCode(handler: QrCodeHandler): void {
    this.qrCodeHandler = handler;
  }

  /**
   * Register a pairing success handler (called when a transport transitions to connected).
   */
  onPaired(handler: PairedHandler): void {
    this.pairingHandler = handler;
  }

  /**
   * Register a pairing code handler (called when phone number pairing returns a code).
   */
  onPairingCode(handler: PairingCodeHandler): void {
    this.pairingCodeHandler = handler;
  }

  /**
   * Suppress QR code emissions for a transport (used during phone number pairing).
   */
  suppressQrForTransport(transportId: string): void {
    this.phonePairingTransports.add(transportId);
  }

  /**
   * Add and initialize a single transport at runtime.
   * Returns the TransportInfo for the newly created transport.
   */
  async addTransport(
    config: TransportConfig,
    options?: { skipConnect?: boolean },
  ): Promise<TransportInfo> {
    const id = config.id;
    if (this.transports.has(id)) {
      throw new Error(`Transport already exists: ${id}`);
    }

    await this.initTransport(id, config, options?.skipConnect);

    const info = this.getTransportInfo(id);
    if (!info) throw new Error(`Failed to get info for transport: ${id}`);
    return info;
  }

  /**
   * Initialize all transports from config.
   */
  async initAll(configs: Record<string, TransportConfig>): Promise<void> {
    for (const [id, config] of Object.entries(configs)) {
      if (!config.id) config.id = id;
      try {
        await this.initTransport(id, config);
      } catch (err) {
        console.error(
          `[TransportManager] Plugin factory not found: ${config.plugin} for transport ${id}`,
        );
      }
    }
  }

  /**
   * Initialize a single transport: create plugin, wire events, connect if immediate.
   * @param skipConnect - If true, skip auto-connect (for newly created transports that need explicit pairing)
   */
  private async initTransport(
    id: string,
    config: TransportConfig,
    skipConnect?: boolean,
  ): Promise<void> {
    const factory = this.pluginFactories.get(config.plugin);
    if (!factory) {
      throw new Error(`Plugin factory not found: ${config.plugin}`);
    }

    const plugin = factory(config);

    const entry: TransportEntry = {
      config,
      plugin,
      status: initialStatus(),
      reconnectTimer: null,
      debouncer: null,
      pairing: false,
    };

    // Wire up event handlers
    plugin.on("message", (msg) => this.handlePluginMessage(id, msg));
    plugin.on("error", (err) => {
      console.error(`[TransportManager] Error from ${id}:`, err);
      entry.status.lastError = err.message;
    });
    plugin.on("status", (status) => this.handlePluginStatus(id, status));
    plugin.on("qr", (qrDataUrl: string) => {
      // Set pairing flag to suppress reconnects while waiting for QR scan
      entry.pairing = true;
      // Suppress QR codes during phone number pairing
      if (this.phonePairingTransports.has(id)) {
        console.log(
          `[TransportManager] QR suppressed for ${id} — phone pairing active`,
        );
        return;
      }
      console.log(
        `[TransportManager] QR received for ${id}, entering pairing mode`,
      );
      if (this.qrCodeHandler) {
        this.qrCodeHandler(id, qrDataUrl);
      }
    });

    this.transports.set(id, entry);

    try {
      await plugin.init(config);
      console.log(`[TransportManager] Initialized transport: ${id}`);
    } catch (err) {
      console.error(`[TransportManager] Failed to initialize ${id}:`, err);
      entry.status.lastError = err instanceof Error ? err.message : String(err);
      return;
    }

    // Auto-connect on startup ONLY if credentials exist
    // Skip auto-connect for newly created transports or transports without credentials
    if (config.processing === "immediate" && !skipConnect) {
      // Check if plugin has valid credentials before auto-connecting
      const hasCredentials =
        "hasValidCredentials" in plugin &&
        typeof plugin.hasValidCredentials === "function"
          ? await (
              plugin as { hasValidCredentials: () => Promise<boolean> }
            ).hasValidCredentials()
          : true; // Default to true for plugins that don't implement this

      if (hasCredentials) {
        // Enter pairing mode before connect to suppress reconnect loops during QR display.
        entry.pairing = true;
        console.log(
          `[TransportManager] Auto-connecting ${id} (credentials found)`,
        );
        try {
          await plugin.connect();
          console.log(`[TransportManager] Connected transport: ${id}`);
        } catch (err) {
          console.error(`[TransportManager] Failed to connect ${id}:`, err);
          entry.status.lastError =
            err instanceof Error ? err.message : String(err);
        }
      } else {
        // No credentials — wait for user to choose pairing method
        console.log(
          `[TransportManager] Transport ${id} needs pairing (no credentials)`,
        );
        entry.status = {
          ...entry.status,
          running: false,
          connected: false,
        };
        // Notify handlers of the initial disconnected status
        this.handlePluginStatus(id, entry.status);
      }
    }

    // Create debouncer if configured
    if (config.debounceMs && config.debounceMs > 0) {
      entry.debouncer = new MessageDebouncer(
        { flushMs: config.debounceMs },
        (key, messages) => {
          if (this.messageHandler) {
            this.messageHandler(id, messages);
          }
        },
      );
    }
  }

  /**
   * Send a message through a transport.
   */
  async send(
    transportId: string,
    to: string,
    message: OutgoingMessage,
  ): Promise<void> {
    const entry = this.transports.get(transportId);
    if (!entry) {
      throw new Error(`Transport not found: ${transportId}`);
    }

    if (!entry.status.connected) {
      throw new Error(`Transport not connected: ${transportId}`);
    }

    await entry.plugin.send(to, message);
  }

  /**
   * Send typing indicator through a transport (if supported by the plugin).
   */
  async sendTypingIndicator(transportId: string, to: string): Promise<void> {
    const entry = this.transports.get(transportId);
    if (!entry?.status.connected) return;
    if ("sendTypingIndicator" in entry.plugin) {
      await (entry.plugin as any).sendTypingIndicator(to);
    }
  }

  /**
   * Extract phone number from JID if it's a phone-based JID (not a LID).
   * Returns formatted number or undefined for LIDs.
   */
  private extractOwnerNumber(ownerJid?: string): string | undefined {
    if (!ownerJid) return undefined;
    // LIDs end with @lid, phone JIDs end with @s.whatsapp.net
    if (ownerJid.endsWith("@lid")) return undefined;
    const match = ownerJid.match(/^(\d+)@/);
    if (!match) return undefined;
    // Format: +1 234 567 8901
    const digits = match[1];
    if (digits.length >= 10) {
      return "+" + digits;
    }
    return digits;
  }

  /**
   * Get all transport infos for REST API.
   */
  getTransportInfos(): TransportInfo[] {
    const infos: TransportInfo[] = [];
    for (const [id, entry] of this.transports.entries()) {
      const hasOwner = !!(
        entry.config.ownerIdentities && entry.config.ownerIdentities.length > 0
      );
      const ownerNumber = this.extractOwnerNumber(entry.config.ownerJid);
      infos.push({
        id,
        plugin: entry.config.plugin,
        role: entry.config.role,
        identity: entry.config.identity,
        status: toDisplayStatus(entry.status),
        statusDetail: entry.status,
        icon: entry.plugin.icon,
        hasOwner,
        ownerNumber,
      });
    }
    return infos;
  }

  /**
   * Get single transport info.
   */
  getTransportInfo(id: string): TransportInfo | null {
    const entry = this.transports.get(id);
    if (!entry) return null;

    const hasOwner = !!(
      entry.config.ownerIdentities && entry.config.ownerIdentities.length > 0
    );
    const ownerNumber = this.extractOwnerNumber(entry.config.ownerJid);
    return {
      id,
      plugin: entry.config.plugin,
      role: entry.config.role,
      identity: entry.config.identity,
      status: toDisplayStatus(entry.status),
      statusDetail: entry.status,
      icon: entry.plugin.icon,
      hasOwner,
      ownerNumber,
    };
  }

  /**
   * Get raw transport config (used by routing to look up ownerIdentities).
   */
  getTransportConfig(id: string): TransportConfig | undefined {
    return this.transports.get(id)?.config;
  }

  /**
   * Get all transport plugin instances (for HealthMonitor registration).
   */
  getPlugins(): Plugin[] {
    return Array.from(this.transports.values()).map((entry) => entry.plugin);
  }

  /**
   * Update a transport's runtime config (e.g., adding ownerIdentities after token auth).
   */
  updateTransportConfig(
    id: string,
    update: Partial<TransportConfig>,
  ): void {
    const entry = this.transports.get(id);
    if (!entry) return;
    Object.assign(entry.config, update);
  }

  /**
   * Initiate connection for a single transport (triggers QR pairing flow for WhatsApp).
   * Clears any pending reconnect timer first.
   * If clearAuth is true, clears stored credentials to force fresh QR pairing.
   */
  async connectTransport(id: string, clearAuth = false): Promise<void> {
    const entry = this.transports.get(id);
    if (!entry) throw new Error(`Transport not found: ${id}`);
    if (entry.status.connected)
      throw new Error(`Transport already connected: ${id}`);

    // Clear any pending reconnect timer to avoid conflicts
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
      console.log(`[TransportManager] Cleared reconnect timer for ${id}`);
    }

    // Clear auth if requested (for fresh QR pairing)
    if (clearAuth && "clearAuth" in entry.plugin) {
      console.log(`[TransportManager] Clearing auth for ${id}`);
      await (entry.plugin as { clearAuth: () => Promise<void> }).clearAuth();
    }

    // Clear phone pairing suppression from any previous attempt
    this.phonePairingTransports.delete(id);

    // ALWAYS enter pairing mode when connecting a non-connected transport.
    // This suppresses reconnect logic during QR display. If the transport has
    // valid credentials, it will connect immediately and clear this flag.
    // If it needs QR pairing, this prevents rapid reconnect loops.
    entry.pairing = true;
    console.log(`[TransportManager] Entering pairing mode for ${id}`);

    // Reset reconnect attempts for fresh pairing
    entry.status.reconnectAttempts = 0;
    entry.status.lastError = null;

    await entry.plugin.connect();
  }

  /**
   * Request a phone number pairing code for a transport.
   * Connects the socket, waits for readiness, requests the code,
   * and emits it via the pairing code handler.
   *
   * This is async fire-and-forget from the caller's perspective —
   * the pairing code is delivered via the pairingCodeHandler (WebSocket broadcast).
   */
  async requestPairingCode(
    transportId: string,
    phoneNumber: string,
  ): Promise<void> {
    const entry = this.transports.get(transportId);
    if (!entry) throw new Error(`Transport not found: ${transportId}`);

    if (!("requestPairingCode" in entry.plugin)) {
      throw new Error(`Transport plugin does not support phone number pairing`);
    }

    try {
      const code = await (entry.plugin as any).requestPairingCode(phoneNumber);
      if (this.pairingCodeHandler) {
        this.pairingCodeHandler(transportId, code);
      }
    } catch (err) {
      console.error(
        `[TransportManager] requestPairingCode failed for ${transportId}:`,
        err,
      );
      // Emit status change with error so frontend can show it
      entry.status.lastError = err instanceof Error ? err.message : String(err);
      for (const handler of this.statusChangeHandlers) {
        handler(transportId, entry.status);
      }
    } finally {
      // Keep suppression until pairing completes or transport connects
      // (cleared on successful connect via status change)
    }
  }

  /**
   * Disconnect a single transport and clear its reconnect timer.
   * If clearAuth is true (default), clears stored credentials so re-pairing is required.
   */
  async disconnectTransport(id: string, clearAuth = true): Promise<void> {
    const entry = this.transports.get(id);
    if (!entry) throw new Error(`Transport not found: ${id}`);

    // Clear any pending reconnect timer
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    // Disconnect the socket first
    await entry.plugin.disconnect();

    // Clear auth credentials if requested (default: yes)
    if (clearAuth && "clearAuth" in entry.plugin) {
      console.log(`[TransportManager] Clearing auth for ${id}`);
      await (entry.plugin as { clearAuth: () => Promise<void> }).clearAuth();
    }
  }

  /**
   * Remove a transport entirely (disconnect + clear auth + remove from manager).
   * Does NOT remove from config.yaml — caller should do that separately.
   */
  async removeTransport(id: string): Promise<void> {
    const entry = this.transports.get(id);
    if (!entry) throw new Error(`Transport not found: ${id}`);

    // Clear reconnect timer
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    // Disconnect and clear auth
    try {
      await entry.plugin.disconnect();
      if ("clearAuth" in entry.plugin) {
        await (entry.plugin as { clearAuth: () => Promise<void> }).clearAuth();
      }
    } catch {
      // Ignore errors during cleanup
    }

    // Remove from internal map
    this.transports.delete(id);
    console.log(`[TransportManager] Removed transport: ${id}`);
  }

  /**
   * Active liveness probe for a single transport.
   */
  async checkHealth(transportId: string): Promise<boolean> {
    const entry = this.transports.get(transportId);
    if (!entry) return false;

    try {
      const result = await entry.plugin.healthCheck();
      return result.healthy;
    } catch {
      return false;
    }
  }

  /**
   * Active liveness probe for all transports (parallel).
   * Returns a map of transportId → healthy (boolean).
   */
  async checkAllHealth(): Promise<Map<string, boolean>> {
    const ids = Array.from(this.transports.keys());
    const checks = ids.map(async (id) => {
      const healthy = await this.checkHealth(id);
      return [id, healthy] as const;
    });
    const settled = await Promise.allSettled(checks);
    const results = new Map<string, boolean>();
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.set(result.value[0], result.value[1]);
      }
    }
    return results;
  }

  /**
   * Disconnect all transports and clear timers.
   */
  async disconnectAll(): Promise<void> {
    for (const [id, entry] of this.transports.entries()) {
      // Clear reconnect timer
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }

      // Flush and clear debouncer
      if (entry.debouncer) {
        entry.debouncer.flushAll();
        entry.debouncer.clear();
      }

      // Disconnect plugin
      try {
        await entry.plugin.disconnect();
        console.log(`[TransportManager] Disconnected transport: ${id}`);
      } catch (err) {
        console.error(`[TransportManager] Error disconnecting ${id}:`, err);
      }
    }
  }

  /**
   * Handle incoming message from a plugin (dedup → debounce → handler).
   */
  private handlePluginMessage(transportId: string, msg: IncomingMessage): void {
    const entry = this.transports.get(transportId);
    if (!entry) {
      console.warn(
        `[TransportManager] Received message for unknown transport: ${transportId}`,
      );
      return;
    }

    // Build dedup key
    const dedupKey = `${transportId}:${msg.from}:${msg.id}`;

    // Check for duplicate
    if (this.dedup.isDuplicate(dedupKey)) {
      console.log(
        `[TransportManager] Duplicate message filtered: ${msg.id} from ${msg.from}`,
      );
      return;
    }

    // Update last message timestamp
    entry.status.lastMessageAt = new Date();

    // Reset reconnect attempts on real message receipt.
    // This ensures the 50-attempt cap is only reset by genuine activity,
    // not by a successful reconnect (which could enable infinite reconnect loops).
    entry.status.reconnectAttempts = 0;

    // Handle debouncing
    if (entry.debouncer) {
      // Determine if message should bypass debouncing
      const bypass =
        (msg.attachments && msg.attachments.length > 0) ||
        msg.replyTo !== undefined ||
        !msg.content;

      entry.debouncer.add({
        message: msg,
        bypass,
        key: `${transportId}:${msg.from}`,
      });
    } else {
      // No debouncer — deliver immediately
      if (this.messageHandler) {
        this.messageHandler(transportId, [msg]);
      }
    }
  }

  /**
   * Handle status change from a plugin.
   */
  private handlePluginStatus(
    transportId: string,
    newStatus: TransportStatus,
  ): void {
    const entry = this.transports.get(transportId);
    if (!entry) {
      console.warn(
        `[TransportManager] Status update for unknown transport: ${transportId}`,
      );
      return;
    }

    // Update stored status
    entry.status = newStatus;

    // Notify all status change handlers
    for (const handler of this.statusChangeHandlers) {
      try {
        handler(transportId, newStatus);
      } catch (err) {
        console.error(`[TransportManager] Error in status change handler:`, err);
      }
    }

    // Handle reconnection logic
    // Only consider reconnecting if there's an actual disconnect event
    // (not just a status update during QR display or initial connection)
    if (
      !newStatus.connected &&
      newStatus.running &&
      newStatus.lastDisconnect !== null
    ) {
      // Disconnected but still running - check the disconnect type
      // Check if it's a logout (should NOT reconnect)
      if (newStatus.lastDisconnect.loggedOut) {
        console.log(
          `[TransportManager] Transport ${transportId} logged out — not reconnecting`,
        );
        entry.pairing = false;
        return;
      }

      // In pairing mode - suppress all reconnects
      // During QR pairing, Baileys closes and reopens the connection multiple times
      // as QR codes refresh. This is normal behavior. We should:
      // 1. NOT treat these as failures
      // 2. NOT trigger reconnection (Baileys handles this internally)
      // 3. Wait for either success (connection: "open") or definitive failure (loggedOut)
      if (entry.pairing) {
        // restartRequired (error is null/undefined) means pairing succeeded - proceed to reconnect
        // Note: plugin sets error to undefined (not null) for 515 restartRequired
        const isRestartRequired = newStatus.lastDisconnect.error == null;

        if (isRestartRequired) {
          // Pairing succeeded - clear flag and reconnect to establish session
          console.log(
            `[TransportManager] Transport ${transportId} pairing complete (restartRequired), reconnecting...`,
          );
          entry.pairing = false;
          // Fall through to start reconnection
        } else {
          // During pairing, any other disconnect is likely a QR refresh or timeout.
          // Let Baileys handle the QR refresh internally - don't trigger our reconnect logic.
          // The plugin will emit a new QR code when ready.
          console.log(
            `[TransportManager] Transport ${transportId} disconnect during pairing (likely QR refresh), waiting for new QR...`,
          );
          return;
        }
      }

      // Start reconnection
      this.startReconnect(transportId);
    } else if (newStatus.connected) {
      // Successfully connected — reset reconnect state and pairing flag
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      entry.pairing = false;
      this.phonePairingTransports.delete(transportId);
      console.log(
        `[TransportManager] Transport ${transportId} connected successfully`,
      );

      // Notify pairing success handler
      if (this.pairingHandler) {
        this.pairingHandler(transportId);
      }
    }
  }

  /**
   * Start reconnection loop with exponential backoff.
   */
  private startReconnect(transportId: string): void {
    const entry = this.transports.get(transportId);
    if (!entry) return;

    // Clear any existing timer
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    // Get reconnect policy
    const policy = this.getReconnectPolicy(entry.config);

    // Compute backoff delay
    const delay = computeBackoff(policy, entry.status.reconnectAttempts);

    if (delay === null) {
      console.log(
        `[TransportManager] Max reconnect attempts reached for ${transportId}`,
      );
      return;
    }

    // Increment attempt counter
    entry.status.reconnectAttempts++;

    console.log(
      `[TransportManager] Reconnecting ${transportId} in ${delay}ms (attempt ${entry.status.reconnectAttempts})`,
    );

    // Schedule reconnection
    entry.reconnectTimer = setTimeout(async () => {
      try {
        console.log(`[TransportManager] Attempting reconnect for ${transportId}`);
        await entry.plugin.connect();
      } catch (err) {
        console.error(
          `[TransportManager] Reconnect failed for ${transportId}:`,
          err,
        );
        entry.status.lastError =
          err instanceof Error ? err.message : String(err);
        // Status handler will be called by plugin, which will trigger another reconnect
      }
    }, delay);
  }

  /**
   * Get merged reconnect policy for a transport.
   */
  private getReconnectPolicy(config: TransportConfig): ReconnectPolicy {
    return {
      ...DEFAULT_BACKOFF,
      ...config.reconnect,
    };
  }
}
