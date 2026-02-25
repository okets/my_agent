/**
 * Channel Manager
 *
 * Central registry for channel plugins with lifecycle management,
 * resilience features (reconnection, watchdog, dedup, debounce),
 * and message routing.
 */

import type {
  ChannelPlugin,
  PluginFactory,
  ChannelInstanceConfig,
  ChannelStatus,
  ChannelInfo,
  IncomingMessage,
  OutgoingMessage,
  ReconnectPolicy,
  WatchdogConfig,
} from "@my-agent/core";
import {
  toDisplayStatus,
  initialStatus,
  computeBackoff,
  DEFAULT_BACKOFF,
  DedupCache,
  MessageDebouncer,
} from "@my-agent/core";

/** Default watchdog configuration */
const DEFAULT_WATCHDOG: WatchdogConfig = {
  enabled: true,
  checkIntervalMs: 60000, // 1 minute
  timeoutMs: 1800000, // 30 minutes
};

/** Internal channel entry */
interface ChannelEntry {
  config: ChannelInstanceConfig;
  plugin: ChannelPlugin;
  status: ChannelStatus;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  debouncer: MessageDebouncer<IncomingMessage> | null;
}

/** Message handler signature */
type MessageHandler = (channelId: string, messages: IncomingMessage[]) => void;

/** Status change handler signature */
type StatusChangeHandler = (channelId: string, status: ChannelStatus) => void;

/** QR code handler signature */
type QrCodeHandler = (channelId: string, qrDataUrl: string) => void;

/** Pairing success handler signature */
type PairedHandler = (channelId: string) => void;

export class ChannelManager {
  private channels = new Map<string, ChannelEntry>();
  private pluginFactories = new Map<string, PluginFactory>();
  private dedup = new DedupCache();
  private messageHandler: MessageHandler | null = null;
  private statusChangeHandlers: StatusChangeHandler[] = [];
  private qrCodeHandler: QrCodeHandler | null = null;
  private pairingHandler: PairedHandler | null = null;

  /**
   * Register a plugin factory by name.
   */
  registerPlugin(name: string, factory: PluginFactory): void {
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
   * Register a pairing success handler (called when a channel transitions to connected).
   */
  onPaired(handler: PairedHandler): void {
    this.pairingHandler = handler;
  }

  /**
   * Add and initialize a single channel at runtime.
   * Returns the ChannelInfo for the newly created channel.
   */
  async addChannel(config: ChannelInstanceConfig): Promise<ChannelInfo> {
    const id = config.id;
    if (this.channels.has(id)) {
      throw new Error(`Channel already exists: ${id}`);
    }

    await this.initChannel(id, config);

    const info = this.getChannelInfo(id);
    if (!info) throw new Error(`Failed to get info for channel: ${id}`);
    return info;
  }

  /**
   * Initialize all channels from config.
   */
  async initAll(configs: Record<string, ChannelInstanceConfig>): Promise<void> {
    for (const [id, config] of Object.entries(configs)) {
      if (!config.id) config.id = id;
      try {
        await this.initChannel(id, config);
      } catch (err) {
        console.error(
          `[ChannelManager] Plugin factory not found: ${config.plugin} for channel ${id}`,
        );
      }
    }
  }

  /**
   * Initialize a single channel: create plugin, wire events, connect if immediate.
   */
  private async initChannel(
    id: string,
    config: ChannelInstanceConfig,
  ): Promise<void> {
    const factory = this.pluginFactories.get(config.plugin);
    if (!factory) {
      throw new Error(`Plugin factory not found: ${config.plugin}`);
    }

    const plugin = factory(config);

    const entry: ChannelEntry = {
      config,
      plugin,
      status: initialStatus(),
      reconnectTimer: null,
      watchdogTimer: null,
      debouncer: null,
    };

    // Wire up event handlers
    plugin.on("message", (msg) => this.handlePluginMessage(id, msg));
    plugin.on("error", (err) => {
      console.error(`[ChannelManager] Error from ${id}:`, err);
      entry.status.lastError = err.message;
    });
    plugin.on("status", (status) => this.handlePluginStatus(id, status));
    plugin.on("qr", (qrDataUrl: string) => {
      if (this.qrCodeHandler) {
        this.qrCodeHandler(id, qrDataUrl);
      }
    });

    this.channels.set(id, entry);

    try {
      await plugin.init(config);
      console.log(`[ChannelManager] Initialized channel: ${id}`);
    } catch (err) {
      console.error(`[ChannelManager] Failed to initialize ${id}:`, err);
      entry.status.lastError = err instanceof Error ? err.message : String(err);
      return;
    }

    // Connect if immediate processing
    if (config.processing === "immediate") {
      try {
        await plugin.connect();
        console.log(`[ChannelManager] Connected channel: ${id}`);
      } catch (err) {
        console.error(`[ChannelManager] Failed to connect ${id}:`, err);
        entry.status.lastError =
          err instanceof Error ? err.message : String(err);
      }
    }

    // Start watchdog if applicable
    if (config.role === "dedicated" && config.processing === "immediate") {
      const watchdogConfig = this.getWatchdogConfig(config);
      if (watchdogConfig.enabled) {
        this.startWatchdog(id, watchdogConfig);
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
   * Send a message through a channel.
   */
  async send(
    channelId: string,
    to: string,
    message: OutgoingMessage,
  ): Promise<void> {
    const entry = this.channels.get(channelId);
    if (!entry) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!entry.status.connected) {
      throw new Error(`Channel not connected: ${channelId}`);
    }

    await entry.plugin.send(to, message);
  }

  /**
   * Get all channel infos for REST API.
   */
  getChannelInfos(): ChannelInfo[] {
    const infos: ChannelInfo[] = [];
    for (const [id, entry] of this.channels.entries()) {
      infos.push({
        id,
        plugin: entry.config.plugin,
        role: entry.config.role,
        identity: entry.config.identity,
        status: toDisplayStatus(entry.status),
        statusDetail: entry.status,
        icon: entry.plugin.icon,
      });
    }
    return infos;
  }

  /**
   * Get single channel info.
   */
  getChannelInfo(id: string): ChannelInfo | null {
    const entry = this.channels.get(id);
    if (!entry) return null;

    return {
      id,
      plugin: entry.config.plugin,
      role: entry.config.role,
      identity: entry.config.identity,
      status: toDisplayStatus(entry.status),
      statusDetail: entry.status,
      icon: entry.plugin.icon,
    };
  }

  /**
   * Get raw channel config (used by routing to look up ownerIdentities).
   */
  getChannelConfig(id: string): ChannelInstanceConfig | undefined {
    return this.channels.get(id)?.config;
  }

  /**
   * Update a channel's runtime config (e.g., adding ownerIdentities after token auth).
   */
  updateChannelConfig(
    id: string,
    update: Partial<ChannelInstanceConfig>,
  ): void {
    const entry = this.channels.get(id);
    if (!entry) return;
    Object.assign(entry.config, update);
  }

  /**
   * Initiate connection for a single channel (triggers QR pairing flow for WhatsApp).
   * Clears any pending reconnect timer first.
   * If clearAuth is true, clears stored credentials to force fresh QR pairing.
   */
  async connectChannel(id: string, clearAuth = false): Promise<void> {
    const entry = this.channels.get(id);
    if (!entry) throw new Error(`Channel not found: ${id}`);
    if (entry.status.connected)
      throw new Error(`Channel already connected: ${id}`);

    // Clear any pending reconnect timer to avoid conflicts
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
      console.log(`[ChannelManager] Cleared reconnect timer for ${id}`);
    }

    // Clear auth if requested (for fresh QR pairing)
    if (clearAuth && "clearAuth" in entry.plugin) {
      console.log(`[ChannelManager] Clearing auth for ${id}`);
      await (entry.plugin as { clearAuth: () => Promise<void> }).clearAuth();
    }

    // Reset reconnect attempts for fresh pairing
    entry.status.reconnectAttempts = 0;
    entry.status.lastError = null;

    await entry.plugin.connect();
  }

  /**
   * Disconnect a single channel and clear its reconnect timer.
   */
  async disconnectChannel(id: string): Promise<void> {
    const entry = this.channels.get(id);
    if (!entry) throw new Error(`Channel not found: ${id}`);
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    await entry.plugin.disconnect();
  }

  /**
   * Disconnect all channels and clear timers.
   */
  async disconnectAll(): Promise<void> {
    for (const [id, entry] of this.channels.entries()) {
      // Clear reconnect timer
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }

      // Clear watchdog timer
      if (entry.watchdogTimer) {
        clearInterval(entry.watchdogTimer);
        entry.watchdogTimer = null;
      }

      // Flush and clear debouncer
      if (entry.debouncer) {
        entry.debouncer.flushAll();
        entry.debouncer.clear();
      }

      // Disconnect plugin
      try {
        await entry.plugin.disconnect();
        console.log(`[ChannelManager] Disconnected channel: ${id}`);
      } catch (err) {
        console.error(`[ChannelManager] Error disconnecting ${id}:`, err);
      }
    }
  }

  /**
   * Handle incoming message from a plugin (dedup → debounce → handler).
   */
  private handlePluginMessage(channelId: string, msg: IncomingMessage): void {
    const entry = this.channels.get(channelId);
    if (!entry) {
      console.warn(
        `[ChannelManager] Received message for unknown channel: ${channelId}`,
      );
      return;
    }

    // Build dedup key
    const dedupKey = `${channelId}:${msg.from}:${msg.id}`;

    // Check for duplicate
    if (this.dedup.isDuplicate(dedupKey)) {
      console.log(
        `[ChannelManager] Duplicate message filtered: ${msg.id} from ${msg.from}`,
      );
      return;
    }

    // Update last message timestamp
    entry.status.lastMessageAt = new Date();

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
        key: `${channelId}:${msg.from}`,
      });
    } else {
      // No debouncer — deliver immediately
      if (this.messageHandler) {
        this.messageHandler(channelId, [msg]);
      }
    }
  }

  /**
   * Handle status change from a plugin.
   */
  private handlePluginStatus(
    channelId: string,
    newStatus: ChannelStatus,
  ): void {
    const entry = this.channels.get(channelId);
    if (!entry) {
      console.warn(
        `[ChannelManager] Status update for unknown channel: ${channelId}`,
      );
      return;
    }

    // Update stored status
    entry.status = newStatus;

    // Notify all status change handlers
    for (const handler of this.statusChangeHandlers) {
      try {
        handler(channelId, newStatus);
      } catch (err) {
        console.error(`[ChannelManager] Error in status change handler:`, err);
      }
    }

    // Handle reconnection logic
    if (!newStatus.connected && newStatus.running) {
      // Disconnected but still running
      // Check if it's a logout (should NOT reconnect)
      if (newStatus.lastDisconnect?.loggedOut) {
        console.log(
          `[ChannelManager] Channel ${channelId} logged out — not reconnecting`,
        );
        return;
      }

      // Start reconnection
      this.startReconnect(channelId);
    } else if (newStatus.connected) {
      // Successfully connected — reset reconnect state
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      entry.status.reconnectAttempts = 0;
      console.log(
        `[ChannelManager] Channel ${channelId} connected successfully`,
      );

      // Notify pairing success handler
      if (this.pairingHandler) {
        this.pairingHandler(channelId);
      }
    }
  }

  /**
   * Start reconnection loop with exponential backoff.
   */
  private startReconnect(channelId: string): void {
    const entry = this.channels.get(channelId);
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
        `[ChannelManager] Max reconnect attempts reached for ${channelId}`,
      );
      return;
    }

    // Increment attempt counter
    entry.status.reconnectAttempts++;

    console.log(
      `[ChannelManager] Reconnecting ${channelId} in ${delay}ms (attempt ${entry.status.reconnectAttempts})`,
    );

    // Schedule reconnection
    entry.reconnectTimer = setTimeout(async () => {
      try {
        console.log(`[ChannelManager] Attempting reconnect for ${channelId}`);
        await entry.plugin.connect();
      } catch (err) {
        console.error(
          `[ChannelManager] Reconnect failed for ${channelId}:`,
          err,
        );
        entry.status.lastError =
          err instanceof Error ? err.message : String(err);
        // Status handler will be called by plugin, which will trigger another reconnect
      }
    }, delay);
  }

  /**
   * Start watchdog timer for a channel.
   */
  private startWatchdog(channelId: string, config: WatchdogConfig): void {
    const entry = this.channels.get(channelId);
    if (!entry) return;

    console.log(
      `[ChannelManager] Starting watchdog for ${channelId} (timeout: ${config.timeoutMs}ms)`,
    );

    entry.watchdogTimer = setInterval(() => {
      const status = entry.status;

      // Only check if connected
      if (!status.connected) return;

      // Check if last message is too old
      if (status.lastMessageAt) {
        const age = Date.now() - status.lastMessageAt.getTime();
        if (age > config.timeoutMs) {
          console.warn(
            `[ChannelManager] Watchdog timeout for ${channelId} (${age}ms since last message)`,
          );
          // Force disconnect (will trigger reconnection)
          entry.plugin.disconnect().catch((err) => {
            console.error(
              `[ChannelManager] Watchdog disconnect failed for ${channelId}:`,
              err,
            );
          });
        }
      }
    }, config.checkIntervalMs);
  }

  /**
   * Get merged reconnect policy for a channel.
   */
  private getReconnectPolicy(config: ChannelInstanceConfig): ReconnectPolicy {
    return {
      ...DEFAULT_BACKOFF,
      ...config.reconnect,
    };
  }

  /**
   * Get merged watchdog config for a channel.
   */
  private getWatchdogConfig(config: ChannelInstanceConfig): WatchdogConfig {
    return {
      ...DEFAULT_WATCHDOG,
      ...config.watchdog,
    };
  }
}
