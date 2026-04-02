/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms) {
  if (ms < 1000) return ms + "ms";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return secs + "s";
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return mins + "m " + remSecs + "s";
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return hrs + "h " + remMins + "m";
}

/**
 * Alpine.js secrets panel component (Settings > Secrets Management)
 */
function secretsPanel() {
  return {
    secrets: [],
    loading: true,
    showAddModal: false,
    newKeyName: "",
    newKeyValue: "",
    deleteTarget: null,

    async init() {
      await this.loadSecrets();
    },

    async loadSecrets() {
      this.loading = true;
      try {
        const res = await fetch("/api/settings/secrets");
        const data = await res.json();
        this.secrets = (data.secrets || []).map((s) => ({
          ...s,
          revealed: false,
          value: "",
        }));
      } catch (e) {
        console.error("Failed to load secrets:", e);
      }
      this.loading = false;
    },

    async toggleReveal(secret) {
      if (secret.revealed) {
        secret.revealed = false;
        return;
      }
      // Fetch actual value from server
      try {
        const res = await fetch(`/api/settings/secrets/${encodeURIComponent(secret.key)}/value`);
        const data = await res.json();
        if (data.value) {
          secret.value = data.value;
          secret.revealed = true;
        }
      } catch (e) {
        console.error('Failed to reveal secret:', e);
      }
    },

    async addSecret() {
      if (!this.newKeyName || !this.newKeyValue) return;
      try {
        await fetch(
          `/api/settings/secrets/${encodeURIComponent(this.newKeyName)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: this.newKeyValue }),
          },
        );
        this.showAddModal = false;
        this.newKeyName = "";
        this.newKeyValue = "";
        await this.loadSecrets();
      } catch (e) {
        console.error("Failed to add secret:", e);
      }
    },

    confirmDelete(secret) {
      this.deleteTarget = secret;
    },

    async deleteSecret() {
      if (!this.deleteTarget) return;
      try {
        await fetch(
          `/api/settings/secrets/${encodeURIComponent(this.deleteTarget.key)}`,
          {
            method: "DELETE",
          },
        );
        this.deleteTarget = null;
        await this.loadSecrets();
      } catch (e) {
        console.error("Failed to delete secret:", e);
      }
    },
  };
}

/**
 * Alpine.js chat component
 */
function chat() {
  return {
    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────
    messages: [],
    inputText: "",
    isResponding: false,
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    dragOver: false,
    wsConnected: false,
    ws: null,
    messageIdCounter: 0,
    currentAssistantMessage: null, // Track the message being streamed
    interimMessage: null, // Ephemeral status message shown while brain is thinking
    currentThinkingText: "", // Accumulates thinking deltas for current message
    isThinking: false, // True while thinking block is active
    agentName: "Agent", // Full name, loaded from server in init()
    agentNickname: "Agent", // Short name for casual use (e.g., buttons)
    isHatching: false, // True during hatching flow
    needsAuth: false, // True when auth gate is active
    _authTransitioning: false, // True during auth success display (buffers messages)
    _authMessageQueue: [], // Buffered messages during auth transition
    pendingControlMsgId: null, // Message ID that has active controls

    // Compose bar dynamic state
    composeHintControlId: null, // When set, Enter sends control_response
    composePlaceholder: "", // Dynamic placeholder from server
    composePasswordMode: false, // Toggles password masking

    // Conversation state
    conversations: [],
    currentConversationId: null,

    // Title editing
    editingTitle: false,
    editTitleValue: "",

    // Action bar state
    selectedModel: localStorage.getItem("selectedModel") || "claude-sonnet-4-6",
    reasoningEnabled: false,
    attachments: [], // Will hold {file, preview, type} objects

    // Delete confirmation
    deleteConfirmOpen: false,
    deleteTargetId: null,
    deleteTargetTitle: null,

    // Channel state
    channels: [],

    // ─────────────────────────────────────────────────────────────────
    // Tab system (workspace layout)
    // ─────────────────────────────────────────────────────────────────
    openTabs: [
      {
        id: "home",
        type: "home",
        title: "Home",
        icon: ICONS.home,
        closeable: false,
      },
    ],
    activeTab: "home",

    // Conversations widget state
    convWidgetSearchOpen: false,
    convSearchQuery: "",
    convSearchResults: [],
    convSearchLoading: false,

    // Chat context (pinned tab context, sent to Nina with messages)
    chatContext: null, // { type, title, icon, file?, conversationId? }

    // Chat panel (right side)
    chatWidth: 400,
    chatResizing: false,

    // QR pairing state
    pairingChannelId: null,
    qrCodeDataUrl: null,
    // Per-channel QR codes for auto-pairing: { channelId: "data:image/png..." }
    channelQrCodes: {},
    // Per-channel QR countdown timers: { channelId: secondsRemaining }
    qrCountdowns: {},
    // Internal countdown interval IDs
    _qrCountdownIntervals: {},
    // Per-channel connecting duration timers: { channelId: secondsElapsed }
    connectingTimers: {},
    // Internal connecting timer interval IDs
    _connectingIntervals: {},

    // Add channel form state
    showAddChannel: false,
    addingChannel: false,
    addChannelError: null,
    newChannel: { id: "", role: "dedicated" },

    // Authorization tokens: { channelId: "TOKEN" }
    authTokens: {},
    // Channel bindings from /api/channels: [{ id, transport, ownerIdentity, ownerJid, previousOwner? }]
    channelBindings: [],
    // Phone number pairing state
    pairingPhoneNumber: {}, // { channelId: "entered number" }
    pairingCodes: {}, // { channelId: "ABCD-1234" }
    pairingByPhone: {}, // { channelId: true } — tracks which method is active
    pairingTab: {}, // { channelId: 'phone' | 'qr' } — selected pairing method tab
    pairingStarted: {}, // { channelId: true } — whether pairing process has been explicitly started

    // Image lightbox
    lightboxImage: null,

    // Theme: 'dark' or 'light'
    theme: "dark",

    // Input history (shell-style up/down arrow)
    inputHistory: [],
    historyIndex: -1, // -1 = not browsing, 0 = most recent, etc.
    inputDraft: "", // Preserves typed text before browsing history

    // ─────────────────────────────────────────────────────────────────
    // Calendar state
    // ─────────────────────────────────────────────────────────────────
    calendar: null, // FullCalendar instance
    miniCalendar: null, // Mini calendar instance
    calendarList: [], // Available calendars from config
    calendarVisibility: {}, // { calendarId: boolean }
    todayEvents: [], // Events for today (mini calendar list)
    upcomingEvents: [], // Events for next 7 days (timeline)

    // Event modal
    eventModalOpen: false,
    editingEvent: null, // Event being edited (null = creating new)
    eventForm: {
      title: "",
      start: "",
      end: "",
      allDay: false,
      calendarId: "user",
      description: "",
    },

    // Inline event editing (event detail tab)
    isEditingEvent: false,
    eventEditForm: {
      title: "",
      start: "",
      end: "",
      allDay: false,
      description: "",
    },

    // ─────────────────────────────────────────────────────────────────
    // Notification state (M5-S4)
    // ─────────────────────────────────────────────────────────────────
    notifications: [], // All notifications
    pendingNotificationCount: 0, // Count of pending notifications
    showNotificationPanel: false, // Toggle notification panel visibility

    // Calendar view range (for context)
    calendarViewStart: null,
    calendarViewEnd: null,
    calendarViewType: null, // 'dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek'

    // ─────────────────────────────────────────────────────────────────
    // Timeline traversal state (M5-S10)
    // ─────────────────────────────────────────────────────────────────
    timelinePastDays: 1, // How far back to show (days)
    timelineFutureDays: 7, // How far forward to show (days)
    noMoreFutureEvents: true, // Pessimistic default; set false when events are found
    nowMarkerDirection: null, // null = visible, 'up' = above viewport, 'down' = below
    timelineProjections: [], // Future projected runs from cron schedules
    timelineOlderJobs: [], // Jobs fetched via pagination (older than WebSocket range)
    canLoadEarlierJobs: true, // Whether more older jobs might exist
    timelineLoading: false, // Loading state for timeline data

    // Computed-like getters used by timeline templates
    get timelineItems() {
      const now = new Date();
      const items = [];

      // 1. Jobs from WebSocket store + older paginated jobs
      const wsJobs = Alpine.store("jobs")?.items || [];
      const allJobs = [...wsJobs, ...this.timelineOlderJobs];
      const seenJobIds = new Set();
      const automationItems = Alpine.store("automations")?.items || [];
      for (const job of allJobs) {
        if (seenJobIds.has(job.id)) continue;
        seenJobIds.add(job.id);
        const created = new Date(job.created);
        const automation = automationItems.find(
          (a) => a.id === job.automationId,
        );
        items.push({
          id: `job-${job.id}`,
          sortDate: created,
          date: created.toDateString(),
          isPast: created < now,
          itemType: "job",
          status: job.status,
          title: job.automationName || job.automationId,
          summary: job.summary,
          triggerType: job.triggerType,
          automationId: job.automationId,
          isOneOff: automation?.once === true || automation?.once === 1,
          screenshots: Alpine.store("screenshots")?.forJob(job.id) || [],
          job: job,
        });
      }

      // 2. Calendar events
      for (const evt of this.upcomingEvents || []) {
        const start = new Date(evt.start);
        items.push({
          id: `cal-${evt.id}`,
          sortDate: start,
          date: start.toDateString(),
          isPast: start < now,
          itemType: "calendar",
          status: start < now ? "completed" : "scheduled",
          title: evt.title,
          summary: null,
          triggerType: null,
          event: evt,
        });
      }

      // 3. Future projections
      for (const proj of this.timelineProjections || []) {
        const projDate = new Date(
          proj.scheduledFor || proj.date || proj.nextRun,
        );
        items.push({
          id: `proj-${proj.automationId}-${projDate.getTime()}`,
          sortDate: projDate,
          date: projDate.toDateString(),
          isPast: false,
          itemType: "projected",
          status: "scheduled",
          title: proj.automationName || proj.automationId,
          summary: null,
          triggerType: "schedule",
          automationId: proj.automationId,
          isOneOff: false,
        });
      }

      // Sort chronologically
      items.sort((a, b) => a.sortDate - b.sortDate);

      // Add date separators
      let lastDate = null;
      for (const item of items) {
        if (item.date !== lastDate) {
          item.showDateSeparator = true;
          lastDate = item.date;
        } else {
          item.showDateSeparator = false;
        }
      }

      return items;
    },

    get canLoadEarlier() {
      return this.canLoadEarlierJobs;
    },

    get canLoadLater() {
      return !this.noMoreFutureEvents;
    },

    formatTimeNow() {
      return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    },

    formatDateTimeNow() {
      const now = new Date();
      const date = now.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const time = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${date}, ${time}`;
    },

    modelOptions: [
      { id: "claude-sonnet-4-6", name: "Sonnet" },
      { id: "claude-haiku-4-5", name: "Haiku" },
      { id: "claude-opus-4-6", name: "Opus" },
    ],

    // ─────────────────────────────────────────────────────────────────
    // Memory state (M6-S3)
    // ─────────────────────────────────────────────────────────────────
    memoryStatus: null, // { index, embeddings, pluginState }
    // M6-S9: Inline action buttons (no zone switching)
    showPluginSelector: false, // For active state: expand plugin options
    showOllamaSetup: false, // For not_set_up/error: show Ollama config form
    showErrorReconfigure: false, // For error state: show reconfigure options
    ollamaHost: "http://localhost:11434", // Ollama server URL for embeddings
    ollamaModel: "", // Ollama model name (selected from list)
    ollamaModels: [], // Available models from Ollama server
    ollamaModelsLoading: false, // Loading state for model list
    embeddingsActivating: false,
    embeddingsError: null,
    memoryRebuilding: false,
    memoryRebuildResult: null,
    localModelDeleting: false,
    localModelDeleteResult: null,

    // Debrief preferences (M6.9-S2)
    briefTime: "08:00",
    briefTimezone: "UTC",
    briefModel: "sonnet",
    briefOutboundChannel: "web",
    savingPreferences: false,
    preferencesStatus: null, // null | "saved" | "error"
    availableChannels: [], // populated from /api/transports

    // Model configuration
    configuredModels: {
      sonnet: "claude-sonnet-4-6",
      haiku: "claude-haiku-4-5",
      opus: "claude-opus-4-6",
    },
    availableModels: [],
    savingModels: false,
    modelsStatus: null, // "saved" | "error"

    notebookTree: [], // { path, name, type, children?, size?, modified? }
    notebookLoading: false,
    selectedNotebookFile: null, // { path, name, content, loading }
    memorySearchQuery: "",
    memorySearchResults: null, // { notebook: [], daily: [], totalResults }
    memorySearching: false,

    // Notebook widget (homepage tabbed mini-notebook)
    notebookTab: sessionStorage.getItem("notebookTab") || "orders", // orders | lists | daily | knowledge | skills
    notebookWidgetContent: {
      orders: null, // standing-orders + external-communications content
      lists: null, // reminders + contacts content
      daily: null, // today's daily log
      knowledge: null, // knowledge files summary
    },
    notebookWidgetLoading: false,

    // Skills (M6.8-S6)
    skillsList: [], // Array of { name, description, origin, disabled, audience }
    get userSkills() {
      return this.skillsList.filter((s) => s.origin === "user");
    },
    get systemSkills() {
      return this.skillsList.filter((s) => s.origin !== "user");
    },
    skillsLoading: false,
    selectedSkill: null, // Full skill object when viewing detail
    skillEditMode: false, // true when editing a skill
    skillEditDesc: "", // description field while editing
    skillEditBody: "", // body field while editing

    // Notebook browser sections (collapsed/expanded state)
    notebookSections: {
      orders: true, // expanded by default
      lists: true,
      daily: false,
      knowledge: false,
      skills: true, // expanded by default
    },

    // ─────────────────────────────────────────────────────────────────
    // Channel error UI state
    // ─────────────────────────────────────────────────────────────────
    expandedChannelErrors: {}, // { channelId: true/false }
    // ─────────────────────────────────────────────────────────────────
    // Computed
    // ─────────────────────────────────────────────────────────────────
    get canSend() {
      const hasContent =
        this.inputText.trim().length > 0 || this.attachments.length > 0;
      return (
        hasContent &&
        this.wsConnected &&
        (!this.isResponding || this.isHatching || this.composeHintControlId)
      );
    },

    get currentPlaceholder() {
      if (this.composePlaceholder) return this.composePlaceholder;
      return "Message " + this.agentName + "...";
    },

    get headerName() {
      return this.isHatching ? "My Agent" : this.agentName;
    },

    get headerInitial() {
      if (this.isHatching) return "A";
      // Get initials from agent name (first letter of each word, max 2)
      const words = this.agentName.trim().split(/\s+/);
      if (words.length === 1) return words[0].charAt(0).toUpperCase();
      return (
        words[0].charAt(0).toUpperCase() + words[1].charAt(0).toUpperCase()
      );
    },

    get agentFirstName() {
      // Use nickname if available, otherwise parse first name from full name
      return this.agentNickname !== "Agent"
        ? this.agentNickname
        : this.agentName.split(/\s+/)[0];
    },

    get modelDisplayName() {
      const model = this.modelOptions.find((m) => m.id === this.selectedModel);
      return model ? model.name : "Sonnet 4.5";
    },

    get isHaikuModel() {
      return this.selectedModel.includes("haiku");
    },

    get isCurrentConversationReadOnly() {
      return false;
    },

    // Notebook categories (for 4-category browser)
    get notebookCategoryFiles() {
      const tree = this.notebookTree || [];

      // Helper to get files from a folder
      const getFiles = (folderName) => {
        const folder = tree.find(
          (f) => f.name === folderName && f.type === "folder",
        );
        return folder?.children?.filter((c) => c.type === "file") || [];
      };

      return {
        orders: getFiles("operations"),
        lists: [...getFiles("lists"), ...getFiles("reference")],
        daily: getFiles("daily"),
        knowledge: getFiles("knowledge"),
      };
    },

    // ─────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────
    get greetingText() {
      if (this.isHatching) {
        return "Let's get started!";
      }
      return "Hey! I\u2019m " + this.agentName + ".";
    },

    get currentTitle() {
      if (!this.currentConversationId) return null;
      const conv = this.conversations.find(
        (c) => c.id === this.currentConversationId,
      );
      return conv?.title || null;
    },

    init() {
      console.log("[App] Initializing chat component...");

      // Image lightbox — delegate click on .chat-md img
      document.addEventListener("click", (e) => {
        const img = e.target.closest(".chat-md img");
        if (!img) return;
        e.preventDefault();
        const overlay = document.createElement("div");
        overlay.className = "image-lightbox";
        const fullImg = document.createElement("img");
        fullImg.src = img.src;
        fullImg.alt = img.alt || "";
        overlay.appendChild(fullImg);
        overlay.addEventListener("click", () => overlay.remove());
        document.addEventListener(
          "keydown",
          (ev) => {
            if (ev.key === "Escape") overlay.remove();
          },
          { once: true },
        );
        document.body.appendChild(overlay);
      });

      // Load UI state from localStorage (tabs, chat width)
      this.loadUIState();

      // Load input history from sessionStorage
      this.loadInputHistory();

      // Initialize theme
      this.initTheme();

      // Initialize mobile viewport reset (fixes zoom lock issue)
      this.initViewportReset();

      // Load agent name and check hatching status
      fetch("/api/hatching/status")
        .then((r) => r.json())
        .then((data) => {
          if (data.hatched && data.agentName) {
            this.agentName = data.agentName;
            this.agentNickname = data.agentNickname || data.agentName;
          } else {
            this.isHatching = true;
          }
        })
        .catch(() => {});

      // Load channels and channel bindings
      this.fetchChannels();
      this.fetchChannelBindings();

      // Load calendar config and events
      this.loadCalendarConfig();
      this.loadTodayEvents();
      this.loadUpcomingEvents();
      this.loadTimelineProjections();

      // Watch stores for live updates from WebSocket (M5-S10)
      // ws-client.js updates Alpine stores — sync to local state for reactivity
      const self = this;
      Alpine.effect(() => {
        const store = Alpine.store("calendar");
        if (store && store.events) {
          self.upcomingEvents = store.events;
        }
      });
      Alpine.effect(() => {
        const store = Alpine.store("conversations");
        if (store && store.items) {
          self.conversations = store.items;
        }
      });
      // Sync active conversation from server (multi-window + channel support).
      // Uses "connect" (not "switch_conversation") to avoid deleteIfEmpty races.
      Alpine.effect(() => {
        const store = Alpine.store("conversations");
        if (
          store &&
          store.serverCurrentId &&
          store.serverCurrentId !== self.currentConversationId &&
          !self._pendingNewConversation
        ) {
          self.ws.send({
            type: "connect",
            conversationId: store.serverCurrentId,
          });
        }
      });
      Alpine.effect(() => {
        const store = Alpine.store("memory");
        if (store && store.stats) {
          const prevState = self.memoryStatus?.pluginState;
          const newState = store.stats.pluginState;

          // Convert WebSocket stats format to REST API format
          self.memoryStatus = {
            initialized: store.stats.initialized,
            pluginState: newState, // M6-S9: 4-state status
            activePlugin: store.stats.activePlugin, // M6-S9: For header icon
            index: {
              filesIndexed: store.stats.filesIndexed,
              totalChunks: store.stats.totalChunks,
              lastSync: store.stats.lastSync,
              hasVectorIndex: store.stats.hasVectorIndex,
            },
            embeddings: {
              active: store.stats.activePlugin,
              degraded: store.stats.degraded || null,
              available:
                store.stats.availablePlugins ||
                self.memoryStatus?.embeddings?.available ||
                [],
              ready: store.stats.embeddingsReady,
              localModelCached: store.stats.localModelCached,
            },
            degraded: store.stats.degraded || null, // M6-S9: For error panel
          };

          // M6-S9: Reset inline UI state on state transitions
          if (newState !== prevState) {
            // Reset inline UI when state changes
            self.showPluginSelector = false;
            self.showOllamaSetup = false;
            self.showErrorReconfigure = false;
            self.embeddingsError = null;
          }
        }
      });

      // Sync mobile popover state to chatContext
      Alpine.effect(() => {
        const mobile = Alpine.store("mobile");
        if (!mobile?.isMobile) return;
        const popover = mobile.popover;
        if (!popover) {
          // Popover closed — clear context
          self.chatContext = null;
          return;
        }
        // Map popover types to chat context
        const type = popover.type;
        if (type === "automations-browser") {
          // If an automation is auto-selected via data, use it
          const autoId = popover.data?.autoSelectId;
          const automation = autoId
            ? Alpine.store("automations").items.find((a) => a.id === autoId)
            : null;
          self.chatContext = automation
            ? {
                type: "automation",
                title: automation.name,
                icon: ICONS.fire,
                automationId: automation.id,
                automationName: automation.name,
              }
            : { type: "automations", title: "Automations", icon: ICONS.fire };
        } else if (type === "notebook-file") {
          self.chatContext = {
            type: "notebook",
            title: popover.data?.name || "Notebook",
            icon: ICONS.notebook,
            file: popover.data?.path,
          };
        } else if (type === "notebook-browser") {
          self.chatContext = {
            type: "notebook",
            title: "Notebook",
            icon: ICONS.notebook,
          };
        } else if (type === "conversation") {
          self.chatContext = {
            type: "conversation",
            title: popover.data?.title || "Conversation",
            icon: ICONS.chat,
            conversationId: popover.data?.conversationId,
          };
        } else if (type === "conversations-browser") {
          self.chatContext = {
            type: "conversations",
            title: "Conversations",
            icon: ICONS.chat,
          };
        } else if (type === "spaces-browser") {
          self.chatContext = {
            type: "spaces",
            title: "Spaces",
            icon: ICONS.folder,
          };
        } else if (type === "calendar" || type === "event") {
          self.chatContext = {
            type: "calendar",
            title: "Calendar",
            icon: ICONS.calendar,
          };
        } else if (type === "skill-detail") {
          self.chatContext = {
            type: "skill",
            title: popover.data?.name || "Skill",
            icon: ICONS.sparkle,
          };
        }
      });

      // Load memory data (M6-S3)
      this.loadNotebookTree();
      this.loadSkills();
      this.loadMemoryStatus();
      this.loadPreferences();
      this.loadNotebookWidgetContent();

      // Configure marked.js
      marked.setOptions({
        gfm: true, // GitHub Flavored Markdown
        breaks: true, // Convert \n to <br>
      });

      // Initialize WebSocket connection
      const wsUrl = `ws://${window.location.host}/api/chat/ws`;
      this.ws = new NinaWebSocket(wsUrl, {
        onOpen: () => {
          console.log("[App] WebSocket connected");
          this.wsConnected = true;
          this.isResponding = false;
          this.currentAssistantMessage = null;
          this.currentThinkingText = "";
          this.isThinking = false;
          this.needsAuth = false;
          // Refresh channels + bindings on reconnect to get current status
          this.fetchChannels();
          this.fetchChannelBindings();
        },
        onClose: () => {
          console.log("[App] WebSocket disconnected");
          this.wsConnected = false;
        },
        onError: (error) => {
          console.error("[App] WebSocket error:", error);
          this.wsConnected = false;
        },
        onMessage: (data) => {
          this.handleWsMessage(data);
        },
      });
      this.ws.connect();

      // Focus the input field
      this.$nextTick(() => {
        const input = this.$refs.chatInput;
        if (input) {
          input.focus();
        }
      });

      // Listen for control submissions from chat-controls.js (buttons/cards)
      window.addEventListener("control-submit", (e) => {
        const { controlId, value, displayValue } = e.detail;
        this.submitControl(controlId, value, displayValue);
      });

      // Initialize calendars after DOM is ready
      // Use requestAnimationFrame to ensure layout is complete
      this.$nextTick(() => {
        requestAnimationFrame(() => {
          // Initialize mini calendar on Home tab (always visible initially or after restore)
          if (this.activeTab === "home") {
            this.initMiniCalendarView();
          }
          // Initialize main calendar if it was the active tab on refresh
          if (this._pendingCalendarInit) {
            this._pendingCalendarInit = false;
            this.initCalendarView();
          }
        });
      });
    },

    // ─────────────────────────────────────────────────────────────────
    // Methods
    // ─────────────────────────────────────────────────────────────────

    resetChatState() {
      this.messages = [];
      this.currentAssistantMessage = null;
      this.currentThinkingText = "";
      this.isThinking = false;
      this.isResponding = false;
      this.pendingControlMsgId = null;
      this.composeHintControlId = null;
      this.composePlaceholder = "";
      this.composePasswordMode = false;
      this.attachments = [];
    },

    touchCurrentConversation() {
      if (!this.currentConversationId) return;
      const conv = this.conversations.find(
        (c) => c.id === this.currentConversationId,
      );
      if (conv) {
        conv.updated = new Date().toISOString();
        this.conversations.sort(
          (a, b) => new Date(b.updated) - new Date(a.updated),
        );
      }
    },

    createNewConversation() {
      if (!this.wsConnected) return;

      // Send /new as a slash command — same path as WhatsApp /new
      this.resetChatState();
      this.currentConversationId = null;
      this._pendingNewConversation = true;
      this.ws.send({ type: "message", content: "/new" });
      this.$nextTick(() => {
        this.$refs.chatInput?.focus();
      });
    },

    switchConversation(conversationId) {
      if (!this.wsConnected || conversationId === this.currentConversationId)
        return;

      this.ws.send({ type: "switch_conversation", conversationId });
    },

    async searchConversations() {
      const q = this.convSearchQuery.trim();
      if (!q) {
        this.convSearchResults = [];
        return;
      }
      this.convSearchLoading = true;
      try {
        const res = await fetch(
          `/api/conversations/search?q=${encodeURIComponent(q)}&limit=20`,
        );
        const data = await res.json();
        this.convSearchResults = (data.results || data || [])
          .map((r) => ({
            id: r.conversationId || r.id,
            title: r.conversationTitle || r.title || "Conversation",
            preview: r.snippet || r.preview || "",
            timestamp: r.timestamp,
          }))
          .filter((r) => r.id !== this.currentConversationId);
      } catch (err) {
        console.error("[App] Conversation search failed:", err);
        this.convSearchResults = [];
      } finally {
        this.convSearchLoading = false;
      }
    },

    formatRelativeTime(isoString) {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    },

    groupConversationsByDate(conversations) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 86400000);
      const groups = { today: [], thisWeek: [], earlier: [] };
      for (const conv of conversations) {
        if (!conv.turnCount || conv.turnCount === 0) continue;
        const d = new Date(conv.updated);
        if (d >= today) groups.today.push(conv);
        else if (d >= weekAgo) groups.thisWeek.push(conv);
        else groups.earlier.push(conv);
      }
      return groups;
    },

    getLastAssistantSnippet() {
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const msg = this.messages[i];
        if (msg.role === "assistant" && msg.text) {
          const plain = msg.text.replace(/[#*_`~\[\]]/g, "").trim();
          return plain.length > 60 ? plain.substring(0, 60) + "..." : plain;
        }
      }
      return "Start a conversation...";
    },

    async toggleRecording() {
      if (this.isRecording) {
        // Stop recording
        this.mediaRecorder?.stop();
        this.isRecording = false;
        return;
      }

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "HTTPS required for microphone access. Voice recording is not available over HTTP.",
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm",
        });

        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.audioChunks.push(e.data);
        };

        this.mediaRecorder.onstop = async () => {
          // Stop all tracks
          stream.getTracks().forEach((t) => t.stop());

          const blob = new Blob(this.audioChunks, {
            type: this.mediaRecorder.mimeType,
          });

          // Convert to base64 and send as attachment
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(",")[1];
            this.ws.send({
              type: "message",
              content: "[Voice message]",
              inputMedium: "audio",
              attachments: [
                {
                  filename: "voice-message.webm",
                  mimeType: this.mediaRecorder.mimeType,
                  base64Data: base64,
                },
              ],
            });

            // Add user message to chat
            this.messages.push({
              id: ++this.messageIdCounter,
              role: "user",
              content: "[Voice message]",
              renderedContent: this.renderMarkdown("[Voice message]"),
              timestamp: this.formatTime(new Date()),
            });
            this.touchCurrentConversation();
            this.isResponding = true;
          };
          reader.readAsDataURL(blob);
        };

        this.mediaRecorder.start();
        this.isRecording = true;
      } catch (err) {
        console.error("Failed to start recording:", err);
        const firstName = this.agentName?.split(/\s+/)[0] || "your agent";
        if (err.message?.includes("HTTPS")) {
          const helpPrompt = `Help me set up HTTPS for the dashboard so I can use voice recording.`;
          this.messages.push({
            id: ++this.messageIdCounter,
            role: "assistant",
            content: err.message,
            renderedContent: this.renderMarkdown(
              `${err.message}\n\nI can help you set this up.`,
            ),
            actionLabel: `Ask ${firstName}`,
            actionPrompt: helpPrompt,
            timestamp: this.formatTime(new Date()),
          });
        } else {
          this.messages.push({
            id: ++this.messageIdCounter,
            role: "system",
            content:
              "Microphone access denied. Please allow microphone access to use voice messages.",
            renderedContent: this.renderMarkdown(
              "Microphone access denied. Please allow microphone access to use voice messages.",
            ),
            timestamp: this.formatTime(new Date()),
          });
        }
      }
    },

    async sendMessage() {
      const text = this.inputText.trim();
      const hasAttachments = this.attachments.length > 0;

      // Need either text or attachments
      if (!text && !hasAttachments) {
        return;
      }
      if (!this.wsConnected) {
        return;
      }

      // During normal chat, block while responding
      if (this.isResponding && !this.isHatching && !this.composeHintControlId) {
        return;
      }

      // Show masked or actual text in user bubble
      const displayText = this.composePasswordMode
        ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
        : text;

      // Add user message to the chat
      const userMessage = {
        id: ++this.messageIdCounter,
        role: "user",
        content: displayText,
        renderedContent: this.renderMarkdown(displayText),
        timestamp: this.formatTime(new Date()),
        attachmentPreviews: hasAttachments
          ? this.attachments.map((a) => ({
              type: a.type,
              preview: a.preview,
              name: a.file.name,
            }))
          : null,
      };
      this.messages.push(userMessage);

      // If compose bar is linked to a control, send control_response
      if (this.composeHintControlId) {
        this.ws.send({
          type: "control_response",
          controlId: this.composeHintControlId,
          value: text,
        });
      } else {
        // Convert attachments to base64 for WebSocket
        let wsAttachments = null;
        if (hasAttachments) {
          wsAttachments = await Promise.all(
            this.attachments.map(async (att) => ({
              filename: att.file.name,
              mimeType: att.file.type || "application/octet-stream",
              base64Data: await this.fileToBase64(att.file),
            })),
          );
        }

        // Include reasoning flag (only if not Haiku)
        const reasoning =
          this.reasoningEnabled && !this.selectedModel.includes("haiku");
        // Include model so server can set it on new conversations
        // Include context so Nina knows what user is viewing
        const context = this.getCurrentTabContext();
        const msg = {
          type: "message",
          content: text,
          reasoning,
          model: this.selectedModel,
          context, // { type, title, file?, conversationId? } or null
        };
        if (wsAttachments) {
          msg.attachments = wsAttachments;
        }
        this.ws.send(msg);
      }

      // Update sidebar timestamp for current conversation
      this.touchCurrentConversation();

      // Save to input history (only non-empty text, avoid duplicates)
      if (text && this.inputHistory[this.inputHistory.length - 1] !== text) {
        this.inputHistory.push(text);
        this.saveInputHistory();
      }

      // Reset compose bar state
      this.inputText = "";
      this.attachments = [];
      this.composeHintControlId = null;
      this.composePlaceholder = "";
      this.composePasswordMode = false;
      this.isResponding = true;
      this.historyIndex = -1;
      this.inputDraft = "";

      // Reset textarea height
      const input = this.$refs.chatInput;
      if (input) {
        input.style.height = "auto";
      }

      // Scroll to bottom
      this.$nextTick(() => {
        this.scrollToBottom();
      });
    },

    handleWsMessage(data) {
      console.log("[App] Received WS message:", data);

      // Buffer messages during auth success transition (except auth_ok itself)
      if (this._authTransitioning && data.type !== "auth_ok") {
        this._authMessageQueue.push(data);
        return;
      }

      switch (data.type) {
        case "start":
          // Response is starting — show typing dots, defer bubble creation
          this.isResponding = true;
          this.currentThinkingText = "";
          this.isThinking = false;
          this.currentAssistantMessage = null;
          this.interimMessage = null;
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "interim_status":
          // Ephemeral status message while brain is still thinking
          this.interimMessage = data.message;
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "text_delta":
          // First token arrived — clear interim message
          this.interimMessage = null;
          // Create assistant bubble on first text delta (replaces typing dots)
          if (!this.currentAssistantMessage) {
            this.currentAssistantMessage = {
              id: ++this.messageIdCounter,
              role: "assistant",
              content: "",
              renderedContent: "",
              thinkingText: "",
              thinkingExpanded: true,
              timestamp: this.formatTime(new Date()),
            };
            this.messages.push(this.currentAssistantMessage);
          }
          this.currentAssistantMessage.content += data.content;
          this.currentAssistantMessage.renderedContent = this.renderMarkdown(
            this.currentAssistantMessage.content,
          );
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "thinking_delta":
          // Create assistant bubble on first thinking delta
          if (!this.currentAssistantMessage) {
            this.currentAssistantMessage = {
              id: ++this.messageIdCounter,
              role: "assistant",
              content: "",
              renderedContent: "",
              thinkingText: "",
              thinkingExpanded: true,
              timestamp: this.formatTime(new Date()),
            };
            this.messages.push(this.currentAssistantMessage);
          }
          this.currentThinkingText += data.content;
          this.currentAssistantMessage.thinkingText = this.currentThinkingText;
          this.isThinking = true;
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "thinking_end":
          // Thinking block complete, collapse it
          if (this.currentAssistantMessage) {
            this.isThinking = false;
            this.currentAssistantMessage.thinkingExpanded = false;
            this.$nextTick(() => {
              this.scrollToBottom();
            });
          }
          break;

        case "controls": {
          // Attach controls (buttons/cards) to current or last assistant message
          const target =
            this.currentAssistantMessage ||
            [...this.messages].reverse().find((m) => m.role === "assistant");
          if (target) {
            const controlsHtml = renderControls(data.controls, target.id);
            target.controlsHtml = controlsHtml;
            this.pendingControlMsgId = target.id;
            this.$nextTick(() => {
              this.scrollToBottom();
            });
          }
          break;
        }

        case "compose_hint":
          // Server wants the user to type in the compose bar
          this.composeHintControlId = data.controlId;
          this.composePlaceholder = data.placeholder || "";
          this.composePasswordMode = data.password || false;
          this.isResponding = false; // Unlock compose bar
          this.$nextTick(() => {
            // Focus the appropriate input
            if (this.composePasswordMode) {
              this.$refs.chatInputPassword?.focus();
            } else {
              this.$refs.chatInput?.focus();
            }
          });
          break;

        case "auth_required":
          this.needsAuth = true;
          this.isHatching = true;
          // On mobile, expand chat to full screen for auth flow
          if (Alpine.store("mobile").isMobile) {
            Alpine.store("mobile").expandChat("full");
          }
          break;

        case "auth_ok":
          // Show green success, buffer incoming messages, then transition
          {
            this._authTransitioning = true;
            this._authMessageQueue = [];

            const successMsg = {
              id: ++this.messageIdCounter,
              role: "assistant",
              content: "Connected successfully!",
              renderedContent:
                '<p><span style="color: #a6e3a1; font-weight: 600;">&#10003; Connected successfully!</span></p>',
              timestamp: this.formatTime(new Date()),
            };
            this.messages.push(successMsg);
            this.$nextTick(() => this.scrollToBottom());

            setTimeout(() => {
              this.needsAuth = false;
              this._authTransitioning = false;
              // On mobile, collapse chat back to peek (return to dashboard view)
              if (Alpine.store("mobile").isMobile) {
                Alpine.store("mobile").collapseChat();
              }
              // Flush buffered messages (conversation_loaded, state syncs, etc.)
              const queued = this._authMessageQueue;
              this._authMessageQueue = [];
              for (const msg of queued) {
                this.handleWsMessage(msg);
              }
              // Re-check hatching status — if already hatched, load agent name
              fetch("/api/hatching/status")
                .then((r) => r.json())
                .then((statusData) => {
                  if (statusData.hatched && statusData.agentName) {
                    this.agentName = statusData.agentName;
                    this.agentNickname =
                      statusData.agentNickname || statusData.agentName;
                    this.isHatching = false;
                  }
                })
                .catch(() => {});
            }, 1500);
          }
          break;

        case "hatching_complete":
          // Transition from hatching to normal chat
          this.agentName = data.agentName;
          this.agentNickname = data.agentNickname || data.agentName;
          this.isHatching = false;
          this.isResponding = false;
          this.currentAssistantMessage = null;
          this.currentThinkingText = "";
          this.composeHintControlId = null;
          this.composePlaceholder = "";
          this.composePasswordMode = false;
          document.title = data.agentName + " \u2014 Dashboard";

          // Add welcome message
          const welcomeMsg = {
            id: ++this.messageIdCounter,
            role: "assistant",
            content: `All set! I'm ${data.agentName}, ready to help. What shall we work on?`,
            renderedContent: this.renderMarkdown(
              `All set! I'm **${data.agentName}**, ready to help. What shall we work on?`,
            ),
            timestamp: this.formatTime(new Date()),
          };
          this.messages.push(welcomeMsg);
          this.$nextTick(() => {
            this.scrollToBottom();
            this.$refs.chatInput?.focus();
          });
          break;

        case "done":
          // Response complete
          console.log("[App] Response complete");
          if (data.audioUrl && this.currentAssistantMessage) {
            this.currentAssistantMessage.audioUrl = data.audioUrl;
          }
          this.isResponding = false;
          this.isThinking = false;
          this.currentAssistantMessage = null;
          this.currentThinkingText = "";
          this.interimMessage = null;
          this.touchCurrentConversation();
          if (data.usage && this.messages.length > 0) {
            // Store usage on the last message
            const lastMsg = this.messages[this.messages.length - 1];
            if (lastMsg.role === "assistant") {
              lastMsg.usage = data.usage;
              lastMsg.cost = data.cost;
            }
          }
          // Auto-refresh calendar after agent completes calendar-related response
          if (this._isCalendarConversation && this.calendar) {
            console.log("[App] Calendar conversation done, refreshing events");
            this.calendar.refetchEvents();
            if (this.miniCalendar) this.miniCalendar.refetchEvents();
          }
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "error":
          // Error occurred
          console.error("[App] Server error:", data.message);
          this.isResponding = false;
          this.isThinking = false;
          this.currentAssistantMessage = null;
          this.currentThinkingText = "";

          // Add error message to chat
          const errorMessage = {
            id: ++this.messageIdCounter,
            role: "assistant",
            content: `**Error:** ${data.message}`,
            renderedContent: this.renderMarkdown(`**Error:** ${data.message}`),
            timestamp: this.formatTime(new Date()),
          };
          this.messages.push(errorMessage);
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "conversation_loaded":
          // Conversation loaded (on connect or switch)
          this.resetChatState();
          if (data.conversation) {
            this.currentConversationId = data.conversation.id;
            // Sync model from conversation (use persisted selection as fallback)
            this.selectedModel =
              data.conversation.model ||
              localStorage.getItem("selectedModel") ||
              "claude-sonnet-4-6";
          } else {
            this.currentConversationId = null;
            // Preserve user's last model selection for new conversations
            this.selectedModel =
              localStorage.getItem("selectedModel") || "claude-sonnet-4-6";
          }
          // Sync model store for header badge
          if (Alpine.store("model")) {
            const m = this.selectedModel || "";
            Alpine.store("model").set(
              m.includes("opus")
                ? "opus"
                : m.includes("haiku")
                  ? "haiku"
                  : "sonnet",
            );
          }

          // Convert turns to messages
          if (data.turns && data.turns.length > 0) {
            this.messages = data.turns.map((turn) => ({
              id: ++this.messageIdCounter,
              role: turn.role,
              content: turn.content,
              renderedContent: this.renderMarkdown(turn.content),
              thinkingText: turn.thinkingText || "",
              thinkingExpanded: false,
              timestamp: this.formatTime(new Date(turn.timestamp)),
              usage: turn.usage,
              cost: turn.cost,
              attachmentPreviews: this.buildAttachmentPreviews(
                turn.attachments,
              ),
              channel: turn.channel || null,
              channelIcon: this.getChannelBadgeIcon(turn.channel),
              channelName: this.getChannelBadgeName(turn.channel),
            }));
          }

          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "conversation_list":
          this.conversations = data.conversations;
          if (typeof Alpine !== "undefined" && Alpine.store("conversations")) {
            Alpine.store("conversations").items = this.conversations;
            const current = this.conversations.find(
              (c) => c.status === "current",
            );
            Alpine.store("conversations").serverCurrentId = current
              ? current.id
              : null;
          }
          break;

        case "conversation_created": {
          this.conversations.unshift(data.conversation);

          // Switch to it if:
          // 1. THIS client created it (_pendingNewConversation)
          // 2. No active conversation
          // 3. Server says it's current (channel-originated, e.g. WhatsApp /new)
          if (
            this._pendingNewConversation ||
            this.currentConversationId === null ||
            data.conversation.status === "current"
          ) {
            this.currentConversationId = data.conversation.id;
            this._pendingNewConversation = false;

            // If there's a pending event prompt, send it now
            if (this._pendingEventPrompt) {
              this.inputText = this._pendingEventPrompt;
              this._pendingEventPrompt = null;
              this.$nextTick(() => this.sendMessage());
            }
          }
          break;
        }

        case "conversation_updated": {
          // Update sidebar timestamp for the conversation
          const updatedConv = this.conversations.find(
            (c) => c.id === data.conversationId,
          );
          if (updatedConv) {
            updatedConv.updated = data.turn.timestamp;
            // Re-sort conversations by updated time
            this.conversations.sort(
              (a, b) => new Date(b.updated) - new Date(a.updated),
            );
          }

          // If another tab updated the current conversation, render the new turn
          // For user turns with attachments from this tab, just update the attachment URLs
          if (data.conversationId === this.currentConversationId) {
            // Check if this is a user turn with attachments - find matching message
            if (
              data.turn.role === "user" &&
              data.turn.attachments &&
              data.turn.attachments.length > 0
            ) {
              // Find the most recent user message with blob/data URL attachments
              for (let i = this.messages.length - 1; i >= 0; i--) {
                const msg = this.messages[i];
                if (
                  msg.role === "user" &&
                  msg.attachmentPreviews &&
                  msg.attachmentPreviews.some(
                    (att) =>
                      att.preview &&
                      (att.preview.startsWith("data:") ||
                        att.preview.startsWith("blob:")),
                  )
                ) {
                  // Update with server URLs
                  msg.attachmentPreviews = this.buildAttachmentPreviews(
                    data.turn.attachments,
                  );
                  break;
                }
              }
              // Don't add duplicate message for user turns from same tab
              break;
            }

            // Skip assistant turns we already received via streaming
            // (channel messages broadcast both streaming deltas AND conversation_updated)
            if (data.turn.role === "assistant" && this.messages.length > 0) {
              const lastMsg = this.messages[this.messages.length - 1];
              if (
                lastMsg.role === "assistant" &&
                lastMsg.content === data.turn.content
              ) {
                // Already have this message from streaming — just update metadata
                if (data.turn.usage) lastMsg.usage = data.turn.usage;
                if (data.turn.cost) lastMsg.cost = data.turn.cost;
                break;
              }
            }

            const msg = {
              id: ++this.messageIdCounter,
              role: data.turn.role,
              content: data.turn.content,
              renderedContent: this.renderMarkdown(data.turn.content),
              thinkingText: data.turn.thinkingText || "",
              thinkingExpanded: false,
              timestamp: this.formatTime(new Date(data.turn.timestamp)),
              usage: data.turn.usage,
              cost: data.turn.cost,
              attachmentPreviews: this.buildAttachmentPreviews(
                data.turn.attachments,
              ),
              channel: data.turn.channel || null,
              channelIcon: this.getChannelBadgeIcon(data.turn.channel),
              channelName: this.getChannelBadgeName(data.turn.channel),
            };
            this.messages.push(msg);
            this.$nextTick(() => {
              this.scrollToBottom();
            });
          }
          break;
        }

        case "turns_loaded":
          // Older turns loaded (pagination)
          if (data.turns && data.turns.length > 0) {
            const olderMessages = data.turns.map((turn) => ({
              id: ++this.messageIdCounter,
              role: turn.role,
              content: turn.content,
              renderedContent: this.renderMarkdown(turn.content),
              thinkingText: turn.thinkingText || "",
              thinkingExpanded: false,
              timestamp: this.formatTime(new Date(turn.timestamp)),
              usage: turn.usage,
              cost: turn.cost,
              attachmentPreviews: this.buildAttachmentPreviews(
                turn.attachments,
              ),
              channel: turn.channel || null,
              channelIcon: this.getChannelBadgeIcon(turn.channel),
              channelName: this.getChannelBadgeName(turn.channel),
            }));
            this.messages.unshift(...olderMessages);
          }
          break;

        case "conversation_renamed":
          // Conversation title updated
          const convToRename = this.conversations.find(
            (c) => c.id === data.conversationId,
          );
          if (convToRename) {
            convToRename.title = data.title;
          }
          break;

        case "conversation_deleted":
          this.conversations = this.conversations.filter(
            (c) => c.id !== data.conversationId,
          );
          // If it was the current conversation, show empty state
          if (this.currentConversationId === data.conversationId) {
            this.currentConversationId = null;
            this.resetChatState();
          }
          break;

        case "conversation_unpinned": {
          const unpinnedConv = this.conversations.find(
            (c) => c.id === data.conversationId,
          );
          if (unpinnedConv) {
            unpinnedConv.isPinned = false;
          }
          break;
        }

        case "conversation_model_changed":
          // Update model if this is current conversation
          if (data.conversationId === this.currentConversationId) {
            this.selectedModel = data.model;
            // Sync model store for header badge
            if (Alpine.store("model")) {
              const m = data.model || "";
              Alpine.store("model").set(
                m.includes("opus")
                  ? "opus"
                  : m.includes("haiku")
                    ? "haiku"
                    : "sonnet",
              );
            }
          }
          const convToUpdateModel = this.conversations.find(
            (c) => c.id === data.conversationId,
          );
          if (convToUpdateModel) {
            convToUpdateModel.model = data.model;
          }
          break;

        case "transport_status_changed": {
          // Update channel status dot in real-time
          const ch = this.channels.find((c) => c.id === data.transportId);
          if (ch) {
            ch.status = data.status;
            ch.reconnectAttempts = data.reconnectAttempts;

            // Manage connecting timer
            if (data.status === "connecting") {
              this.startConnectingTimer(data.transportId);
            } else {
              // Clear timer when no longer connecting (connected, error, stopped)
              this.clearConnectingTimer(data.transportId);
            }

            // Clear QR state if channel connected
            if (data.status === "connected") {
              delete this.channelQrCodes[data.transportId];
              this.clearQrCountdown(data.transportId);
              if (this.pairingChannelId === data.transportId) {
                this.pairingChannelId = null;
                this.qrCodeDataUrl = null;
              }
            }
          }
          break;
        }

        case "transport_qr_code": {
          // QR code received from server during pairing
          // Ignore QR codes if we're in phone pairing mode
          if (
            this.pairingByPhone[data.transportId] ||
            this.pairingCodes[data.transportId]
          ) {
            console.log(
              `[App] Ignoring QR code for ${data.transportId} - phone pairing active`,
            );
            break;
          }
          // Store per-channel for auto-display when connecting
          this.channelQrCodes[data.transportId] = data.qrDataUrl;
          // Start/reset countdown timer (QR codes expire in ~20 seconds)
          this.startQrCountdown(data.transportId, 20);
          // Also update legacy single QR if explicitly pairing this channel
          if (data.transportId === this.pairingChannelId) {
            this.qrCodeDataUrl = data.qrDataUrl;
          }
          break;
        }

        case "transport_paired": {
          // Channel successfully paired — clear all pairing state
          if (data.transportId === this.pairingChannelId) {
            this.pairingChannelId = null;
            this.qrCodeDataUrl = null;
          }
          this.resetPairingState(data.transportId);
          this.clearQrCountdown(data.transportId);
          // Refresh channel list to get updated status
          this.fetchChannels();
          // Auto-trigger auth token for dedicated channels
          const pairedCh = this.channels.find((c) => c.id === data.transportId);
          if (pairedCh && pairedCh.role === "dedicated") {
            setTimeout(() => this.requestAuthToken(data.transportId), 500);
          }
          break;
        }

        case "transport_pairing_code": {
          // Phone number pairing code received via WebSocket
          this.pairingCodes[data.transportId] = data.pairingCode;
          this.pairingByPhone[data.transportId] = true;
          break;
        }

        case "transport_owner_removed": {
          // Owner was removed — refresh channels + bindings
          this.fetchChannels();
          this.fetchChannelBindings();
          break;
        }

        case "transport_authorized": {
          // Owner verified via token — clear token, refresh channels + bindings
          delete this.authTokens[data.transportId];
          this.fetchChannels();
          this.fetchChannelBindings();
          break;
        }

        case "calendar_refresh": {
          // Calendar was modified (e.g., Nina created an event)
          console.log("[App] Calendar refresh triggered");
          if (this.calendar) {
            this.calendar.refetchEvents();
          }
          if (this.miniCalendar) {
            this.miniCalendar.refetchEvents();
          }
          this.loadTodayEvents();
          this.loadUpcomingEvents();
          break;
        }

        // Notification events (M5-S4)
        case "notification": {
          // New or updated notification
          const notification = data.notification;
          if (!notification || !notification.id) break;
          const existing = this.notifications.findIndex(
            (n) => n.id === notification.id,
          );
          if (existing >= 0) {
            this.notifications[existing] = notification;
          } else {
            this.notifications.unshift(notification);
          }
          this.updatePendingCount();
          break;
        }

        case "notification_list": {
          // Full notification list (on request)
          this.notifications = data.notifications || [];
          this.pendingNotificationCount = data.pendingCount || 0;
          break;
        }

        // State push messages (M5-S10 Live Dashboard)
        case "state:calendar":
        case "state:conversations":
        case "state:memory":
          // Silently handled — state is already synced via Alpine stores
          break;

        case "state:skills":
          // Skills changed (MCP create/update/delete or REST toggle/update/delete)
          this.loadSkills();
          break;

        case "state:spaces":
          // Handled by ws-client.js → Alpine store
          break;

        case "state:automations":
        case "state:jobs":
          // Handled by ws-client.js → Alpine store
          break;

        default:
          console.warn("[App] Unknown message type:", data.type);
      }
    },

    // Notification methods (M5-S4)
    updatePendingCount() {
      this.pendingNotificationCount = this.notifications.filter(
        (n) => n.status === "pending" || n.status === "delivered",
      ).length;
    },

    requestNotifications() {
      if (this.ws && this.wsConnected) {
        this.ws.send(JSON.stringify({ type: "get_notifications" }));
      }
    },

    markNotificationRead(notificationId) {
      if (this.ws && this.wsConnected) {
        this.ws.send(
          JSON.stringify({ type: "notification_read", notificationId }),
        );
      }
      // Optimistic update
      const notification = this.notifications.find(
        (n) => n.id === notificationId,
      );
      if (notification) {
        notification.status = "read";
        this.updatePendingCount();
      }
    },

    respondToNotification(notificationId, response) {
      if (this.ws && this.wsConnected) {
        this.ws.send(
          JSON.stringify({
            type: "notification_respond",
            notificationId,
            response,
          }),
        );
      }
      // Optimistic update
      const notification = this.notifications.find(
        (n) => n.id === notificationId,
      );
      if (notification) {
        notification.response = response;
        notification.status = "read";
        this.updatePendingCount();
      }
    },

    dismissNotification(notificationId) {
      if (this.ws && this.wsConnected) {
        this.ws.send(
          JSON.stringify({ type: "notification_dismiss", notificationId }),
        );
      }
      // Optimistic update
      const notification = this.notifications.find(
        (n) => n.id === notificationId,
      );
      if (notification) {
        notification.status = "dismissed";
        this.updatePendingCount();
      }
    },

    getPendingNotifications() {
      return this.notifications.filter(
        (n) => n.status === "pending" || n.status === "delivered",
      );
    },

    renderMarkdown(text) {
      try {
        // Parse markdown and sanitize, allowing links to open in new tabs
        const html = marked.parse(text);
        const clean = DOMPurify.sanitize(html, {
          ADD_TAGS: ["img"],
          ADD_ATTR: ["target", "rel", "src", "alt", "width", "height"],
        });
        // Add target="_blank" to links, graceful 404 for images
        return clean
          .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')
          .replace(
            /<img /g,
            "<img onerror=\"this.classList.add('img-broken')\" ",
          );
      } catch (err) {
        console.error("[App] Markdown rendering error:", err);
        // Fallback: escape HTML and preserve line breaks
        return DOMPurify.sanitize(
          text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>"),
        );
      }
    },

    autoResize(el) {
      if (!el) return;

      // Reset height to auto to get the correct scrollHeight
      el.style.height = "auto";

      // Set height to scrollHeight, capped at 7.5rem (120px)
      const maxHeight = 120; // 7.5rem = 120px
      el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
    },

    scrollToBottom() {
      requestAnimationFrame(() => {
        for (const ref of ["messagesContainer", "mobileMessagesContainer"]) {
          const container = this.$refs[ref];
          if (container) {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: "smooth",
            });
          }
        }
      });
    },

    formatTime(date) {
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    },

    formatFileSize(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    },

    stopResponse() {
      this.ws.send({ type: "abort" });
      this.isResponding = false;
      this.isThinking = false;
      this.currentAssistantMessage = null;
      this.currentThinkingText = "";
    },

    submitControl(controlId, value, displayValue) {
      // Send control_response to server
      this.ws.send({
        type: "control_response",
        controlId: controlId,
        value: value,
      });

      // Add user bubble with the display value
      const userMsg = {
        id: ++this.messageIdCounter,
        role: "user",
        content: displayValue,
        renderedContent: this.renderMarkdown(displayValue),
        timestamp: this.formatTime(new Date()),
      };
      this.messages.push(userMsg);
      this.pendingControlMsgId = null;

      this.$nextTick(() => {
        this.scrollToBottom();
      });
    },

    startTitleEdit() {
      if (!this.currentConversationId || !this.wsConnected) return;
      this.editingTitle = true;
      this.editTitleValue = this.currentTitle || "";
      this.$nextTick(() => {
        this.$refs.titleInput?.focus();
        this.$refs.titleInput?.select();
      });
    },

    confirmTitleEdit() {
      const title = this.editTitleValue.trim();
      if (title && this.wsConnected && this.currentConversationId) {
        this.ws.send({
          type: "rename_conversation",
          title: title,
        });
      }
      this.editingTitle = false;
    },

    cancelTitleEdit() {
      this.editingTitle = false;
    },

    // ─────────────────────────────────────────────────────────────────
    // Model selection
    // ─────────────────────────────────────────────────────────────────
    onModelChange(model) {
      this.selectedModel = model;
      // Sync model store for header badge
      if (Alpine.store("model")) {
        Alpine.store("model").set(
          model.includes("opus")
            ? "opus"
            : model.includes("haiku")
              ? "haiku"
              : "sonnet",
        );
      }
      // Persist selection so it survives new conversations and page reloads
      localStorage.setItem("selectedModel", model);
      // Haiku doesn't support extended thinking — disable reasoning if switching to Haiku
      if (model.includes("haiku")) {
        this.reasoningEnabled = false;
      }
      // Persist to server if we have an active conversation
      if (this.wsConnected && this.currentConversationId) {
        this.ws.send({ type: "set_model", model: model });
      }
    },

    // ─────────────────────────────────────────────────────────────────
    // Conversation deletion
    // ─────────────────────────────────────────────────────────────────
    confirmDeleteConversation(id, title) {
      this.deleteTargetId = id;
      this.deleteTargetTitle = title || "New conversation";
      this.deleteConfirmOpen = true;
    },

    cancelDelete() {
      this.deleteConfirmOpen = false;
      this.deleteTargetId = null;
      this.deleteTargetTitle = null;
    },

    executeDelete() {
      if (!this.deleteTargetId || !this.wsConnected) return;

      this.ws.send({
        type: "delete_conversation",
        conversationId: this.deleteTargetId,
      });
      this.deleteConfirmOpen = false;
      this.deleteTargetId = null;
      this.deleteTargetTitle = null;
    },

    // ─────────────────────────────────────────────────────────────────
    // Tab system methods
    // ─────────────────────────────────────────────────────────────────

    switchTab(id) {
      this.activeTab = id;

      // Clear context when switching to Home or Settings tabs
      if (id === "home" || id === "settings") {
        this.chatContext = null;
      }
      // Calendar tab: use date range context
      else if (id === "calendar") {
        // Context will be set by updateCalendarContext after calendar initializes
        // If calendar already initialized, update context immediately
        if (this.calendar && this.calendarViewStart) {
          this.updateCalendarContext();
        }
      }
      // Auto-set chat context for other content tabs
      else {
        const tab = this.openTabs.find((t) => t.id === id);
        if (tab) {
          this.chatContext = {
            type: tab.type,
            title: tab.title,
            icon: tab.icon,
            file: tab.data?.file,
            conversationId: tab.data?.conversationId,
          };

          // Add space name to chat context for space tabs
          if (tab.type === "space" && tab.data?.name) {
            this.chatContext.spaceName = tab.data.name;
          }

          // Add automation context for automation tabs
          if (tab.type === "automation" && tab.data?.automationId) {
            this.chatContext.automationId = tab.data.automationId;
            this.chatContext.automationName = tab.title;
          }
        }
      }

      // Initialize calendar when switching to calendar tab
      if (id === "calendar") {
        this.$nextTick(() => this.initCalendarView());
      }
      // Initialize mini calendar when switching to home tab
      else if (id === "home") {
        this.$nextTick(() => this.initMiniCalendarView());
      }
      // Load memory status when switching to settings tab
      else if (id === "settings") {
        this.loadMemoryStatus();
        this.loadPreferences();
      }
      // Load notebook tree when switching to notebook tab
      else if (id === "notebook") {
        this.loadNotebookTree();
      }

      this.saveUIState();
    },

    clearChatContext() {
      this.chatContext = null;
    },

    openTab(tab) {
      // Check if tab already exists
      const existing = this.openTabs.find((t) => t.id === tab.id);
      if (existing) {
        this.switchTab(tab.id);
        return;
      }
      this.openTabs.push(tab);
      this.switchTab(tab.id);
      this.saveUIState();
    },

    closeTab(id) {
      const tab = this.openTabs.find((t) => t.id === id);
      if (!tab || !tab.closeable) return;

      // Check for unsaved changes (future use)
      if (tab.contentChanged && !confirm("Discard unsaved changes?")) {
        return;
      }

      this.openTabs = this.openTabs.filter((t) => t.id !== id);

      // If closing active tab, switch to last remaining tab (also updates chatContext)
      if (this.activeTab === id) {
        const newActiveTab =
          this.openTabs[this.openTabs.length - 1]?.id || "home";
        this.switchTab(newActiveTab);
      }
      this.saveUIState();
    },

    async openNotebookTab(name) {
      const tabId = `notebook-${name}`;
      const titles = {
        "external-communications": "External Rules",
        reminders: "Reminders",
        "standing-orders": "Standing Orders",
      };

      // Load file content from server
      let content = "";
      try {
        const res = await fetch(`/api/notebook/${name}`);
        if (res.ok) {
          const data = await res.json();
          content = data.content || "";
        }
      } catch (err) {
        console.error(`[App] Failed to load notebook file ${name}:`, err);
      }

      this.openTab({
        id: tabId,
        type: "notebook",
        title: titles[name] || name,
        icon: ICONS.edit,
        closeable: true,
        data: {
          file: name,
          content,
        },
      });
    },

    openConversationTab(conv) {
      this.openTab({
        id: `conv-${conv.id}`,
        type: "conversation",
        title: conv.title || "External Chat",
        icon: ICONS.chat,
        closeable: true,
        data: {
          conversationId: conv.id,
        },
      });
    },

    openConversationPreview(conv) {
      if (this.$store.mobile.isMobile) {
        // Mobile: open popover with loading state
        const popoverData = {
          conversationId: conv.id,
          title: conv.title || "Conversation",
          turns: [],
          loading: true,
        };
        this.$store.mobile.openPopoverWithFocus(
          "conversation",
          popoverData,
          null,
        );
        // Fetch and update with full object reassignment for Alpine reactivity
        this._fetchConversationTabData({ data: popoverData }).then(() => {
          this.$store.mobile.popover = {
            type: "conversation",
            data: { ...popoverData },
          };
        });
      } else {
        // Desktop: open left-panel tab
        const tabId = `conv-${conv.id}`;
        const tab = {
          id: tabId,
          type: "conversation",
          title: conv.title || "Conversation",
          icon: ICONS.chat,
          closeable: true,
          data: {
            conversationId: conv.id,
            title: conv.title || "Conversation",
            turns: [],
            loading: true,
          },
        };
        this.openTab(tab);
        // Fetch the proxied tab from openTabs so Alpine reactivity works
        this.$nextTick(() => {
          const proxyTab = this.openTabs.find((t) => t.id === tabId);
          if (proxyTab) this._fetchConversationTabData(proxyTab);
        });
      }
    },

    async _fetchConversationTabData(tab) {
      try {
        const res = await fetch(
          `/api/conversations/${tab.data.conversationId}`,
        );
        const data = await res.json();
        const turns = data.turns || data.messages || [];
        // Mutate properties IN PLACE on the existing tab.data proxy so Alpine
        // reactive bindings (x-show="tab.data?.loading") pick up the change.
        // Replacing tab.data with a new object breaks the proxy chain.
        tab.data.turns = turns;
        tab.data.loading = false;
        // Also trigger openTabs array reactivity to force x-for re-render
        this.openTabs = [...this.openTabs];
      } catch (err) {
        console.error("[App] Failed to load conversation:", err);
        tab.data.loading = false;
        this.openTabs = [...this.openTabs];
      }
    },

    resumeConversation(conversationId) {
      if (!conversationId) return;
      this.switchConversation(conversationId);
      if (this.$store.mobile.isMobile) {
        this.$store.mobile.expandChat("half");
      }
    },

    getCurrentTabContext() {
      // Return pinned chat context (set when user views a tab)
      return this.chatContext;
    },

    // ─────────────────────────────────────────────────────────────────
    // Chat panel resize
    // ─────────────────────────────────────────────────────────────────

    startChatResize(e) {
      e.preventDefault();
      this.chatResizing = true;
      document.body.classList.add("chat-resizing");
      const onMove = (ev) => {
        const newWidth = window.innerWidth - ev.clientX;
        // Allow chat panel to grow up to 85% of viewport width
        const maxWidth = Math.floor(window.innerWidth * 0.85);
        this.chatWidth = Math.max(300, Math.min(maxWidth, newWidth));
      };
      const onUp = () => {
        this.chatResizing = false;
        document.body.classList.remove("chat-resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this.saveUIState();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },

    // ─────────────────────────────────────────────────────────────────
    // UI State persistence (localStorage for preferences)
    // ─────────────────────────────────────────────────────────────────

    saveUIState() {
      const state = {
        openTabs: this.openTabs.map((t) => ({
          id: t.id,
          type: t.type,
          title: t.title,
          icon: t.icon,
          closeable: t.closeable,
          data: t.data,
        })),
        activeTab: this.activeTab,
        chatWidth: this.chatWidth,
      };
      localStorage.setItem("dashboardUIState", JSON.stringify(state));
    },

    loadUIState() {
      const saved = localStorage.getItem("dashboardUIState");
      if (!saved) return;

      try {
        const state = JSON.parse(saved);
        if (state.openTabs && Array.isArray(state.openTabs)) {
          // Ensure home tab always exists (only home is permanent)
          const hasHome = state.openTabs.some((t) => t.id === "home");
          if (!hasHome) {
            state.openTabs.unshift({
              id: "home",
              type: "home",
              title: "Home",
              icon: ICONS.home,
              closeable: false,
            });
          }
          // Migrate: Calendar tab should now be closeable
          state.openTabs = state.openTabs.map((t) => {
            if (t.id === "calendar") {
              return { ...t, closeable: true };
            }
            return t;
          });
          this.openTabs = state.openTabs;
          // Re-fetch conversation tab transcripts after restore (nextTick avoids race with x-for render)
          this.$nextTick(() => {
            for (const tab of this.openTabs) {
              if (tab.type === "conversation" && tab.data) {
                tab.data.loading = true;
                tab.data.turns = [];
                this._fetchConversationTabData(tab);
              }
            }
          });
        }
        if (state.activeTab) {
          // Verify active tab exists in openTabs
          if (this.openTabs.some((t) => t.id === state.activeTab)) {
            this.activeTab = state.activeTab;
            // Schedule calendar initialization after DOM is ready
            // This handles the case when page is refreshed while calendar tab was active
            if (state.activeTab === "calendar") {
              this._pendingCalendarInit = true;
            }
          }
        }
        if (state.chatWidth) {
          const maxWidth = Math.floor(window.innerWidth * 0.85);
          this.chatWidth = Math.max(300, Math.min(maxWidth, state.chatWidth));
        }
      } catch (e) {
        console.error("[App] Failed to load UI state:", e);
      }
    },

    // ─────────────────────────────────────────────────────────────────
    // Theme
    // ─────────────────────────────────────────────────────────────────

    initTheme() {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") {
        this.theme = saved;
      }
      this.applyTheme();
    },

    setTheme(value) {
      this.theme = value;
      localStorage.setItem("theme", value);
      this.applyTheme();
    },

    async logout() {
      if (
        !confirm(
          "Disconnect AI? You'll need to re-enter credentials to reconnect.",
        )
      )
        return;
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        console.error("[App] Logout failed:", res.status);
        return;
      }
      // Force reconnect so the server creates a fresh connection with auth gate
      this.messages = [];
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      window.location.reload();
    },

    applyTheme() {
      const root = document.documentElement;
      if (this.theme === "light") {
        root.classList.add("light");
        root.classList.remove("dark");
      } else {
        root.classList.add("dark");
        root.classList.remove("light");
      }
    },

    // ─────────────────────────────────────────────────────────────────
    // Mobile Viewport Reset (fixes zoom lock issue)
    // ─────────────────────────────────────────────────────────────────

    initViewportReset() {
      // Debounce helper
      const debounce = (fn, ms) => {
        let timeout;
        return (...args) => {
          clearTimeout(timeout);
          timeout = setTimeout(() => fn.apply(this, args), ms);
        };
      };

      // Handle viewport reset
      const handleViewportReset = () => {
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
          // Force reset to 1.0 scale
          viewport.content =
            "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
          // Then restore normal behavior
          setTimeout(() => {
            viewport.content = "width=device-width, initial-scale=1.0";
          }, 100);
        }
        // Ensure body fills viewport
        document.body.style.minHeight = window.innerHeight + "px";
      };

      // Listen for orientation changes (immediate)
      window.addEventListener("orientationchange", handleViewportReset);

      // Listen for resize (debounced)
      window.addEventListener("resize", debounce(handleViewportReset, 100));

      // Initial call
      handleViewportReset();
    },

    // ─────────────────────────────────────────────────────────────────
    // Haptic Feedback (subtle vibration on button clicks)
    // ─────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────
    // Input History (shell-style up/down arrows)
    // ─────────────────────────────────────────────────────────────────

    loadInputHistory() {
      try {
        const saved = sessionStorage.getItem("inputHistory");
        if (saved) {
          this.inputHistory = JSON.parse(saved);
        }
      } catch (e) {
        console.error("[App] Failed to load input history:", e);
      }
    },

    saveInputHistory() {
      try {
        // Keep last 100 entries max
        const toSave = this.inputHistory.slice(-100);
        sessionStorage.setItem("inputHistory", JSON.stringify(toSave));
      } catch (e) {
        console.error("[App] Failed to save input history:", e);
      }
    },

    /**
     * Handle up/down arrow keys for input history navigation.
     * Only triggers when cursor is on first line (up) or last line (down).
     */
    handleInputKeydown(event) {
      const el = event.target;
      const text = el.value;
      const pos = el.selectionStart;

      if (event.key === "ArrowUp") {
        // Check if cursor is on first line (before first newline or no newlines)
        const firstNewline = text.indexOf("\n");
        const onFirstLine = firstNewline === -1 || pos <= firstNewline;

        if (onFirstLine && this.inputHistory.length > 0) {
          event.preventDefault();

          // Save draft on first up-arrow press
          if (this.historyIndex === -1) {
            this.inputDraft = this.inputText;
            this.historyIndex = 0;
          } else if (this.historyIndex < this.inputHistory.length - 1) {
            this.historyIndex++;
          }

          // Show history entry (newest is at end of array)
          const idx = this.inputHistory.length - 1 - this.historyIndex;
          this.inputText = this.inputHistory[idx];

          // Move cursor to start and resize textarea
          this.$nextTick(() => {
            el.setSelectionRange(0, 0);
            this.autoResize(el);
          });
        }
      } else if (event.key === "ArrowDown") {
        // Check if cursor is on last line (after last newline or no newlines)
        const lastNewline = text.lastIndexOf("\n");
        const onLastLine = lastNewline === -1 || pos > lastNewline;

        if (onLastLine && this.historyIndex >= 0) {
          event.preventDefault();

          this.historyIndex--;

          if (this.historyIndex < 0) {
            // Restore draft
            this.inputText = this.inputDraft;
            this.inputDraft = "";
          } else {
            // Show history entry
            const idx = this.inputHistory.length - 1 - this.historyIndex;
            this.inputText = this.inputHistory[idx];
          }

          // Move cursor to end and resize textarea
          this.$nextTick(() => {
            el.setSelectionRange(this.inputText.length, this.inputText.length);
            this.autoResize(el);
          });
        }
      }
    },

    // ─────────────────────────────────────────────────────────────────
    // Attachment handling
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle file selection from file picker
     */
    handleFileSelect(event) {
      const files = event.target.files;
      if (!files || files.length === 0) return;
      for (const file of files) {
        this.addAttachment(file);
      }
      // Clear the input so the same file can be selected again
      event.target.value = "";
    },

    /**
     * Handle paste event (for images)
     */
    handlePaste(event) {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            this.addAttachment(file);
          }
        }
      }
    },

    /**
     * Handle drop event for drag-and-drop
     */
    handleDrop(event) {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;

      for (const file of files) {
        this.addAttachment(file);
      }
    },

    /**
     * Add a file as attachment
     */
    async addAttachment(file) {
      // Validate file type
      const allowedImageTypes = [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
      ];
      const allowedTextExts = [
        ".txt",
        ".md",
        ".json",
        ".yaml",
        ".yml",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".py",
        ".sh",
        ".css",
        ".html",
        ".xml",
        ".csv",
        ".sql",
        ".rs",
        ".go",
        ".rb",
        ".java",
        ".c",
        ".cpp",
        ".h",
      ];

      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      const isImage = allowedImageTypes.includes(file.type);
      const isText =
        file.type.startsWith("text/") || allowedTextExts.includes(ext);

      if (!isImage && !isText) {
        console.warn("[App] File type not allowed:", file.type, file.name);
        return;
      }

      // Validate size (5MB max)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        console.warn(
          "[App] File too large:",
          (file.size / 1024 / 1024).toFixed(1) + "MB",
        );
        return;
      }

      // For images > 2MB, resize to max 1920px
      let processedFile = file;
      let preview = null;
      if (isImage) {
        if (file.size > 2 * 1024 * 1024) {
          console.log(
            "[App] Resizing large image:",
            (file.size / 1024 / 1024).toFixed(1) + "MB",
          );
          const resized = await this.resizeImage(file, 1920);
          processedFile = resized.file;
          preview = resized.dataUrl;
          console.log(
            "[App] Resized to:",
            (processedFile.size / 1024 / 1024).toFixed(1) + "MB",
          );
        } else {
          preview = await this.fileToDataUrl(file);
        }
      }

      this.attachments.push({
        file: processedFile,
        preview,
        type: isImage ? "image" : "text",
      });
    },

    /**
     * Resize image to max dimension using canvas
     */
    async resizeImage(file, maxDimension) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // Calculate new dimensions
          let width = img.width;
          let height = img.height;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          // Draw to canvas
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob (JPEG for compression)
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Canvas to blob failed"));
                return;
              }
              const resizedFile = new File(
                [blob],
                file.name.replace(/\.[^.]+$/, ".jpg"),
                { type: "image/jpeg" },
              );
              const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
              resolve({ file: resizedFile, dataUrl });
            },
            "image/jpeg",
            0.85,
          );
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    },

    /**
     * Remove attachment at index
     */
    removeAttachment(index) {
      this.attachments.splice(index, 1);
    },

    /**
     * Convert file to data URL for preview
     */
    fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    /**
     * Convert file to base64 (without data URL prefix)
     */
    fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          // Remove the data URL prefix (e.g., "data:image/png;base64,")
          const base64 = reader.result.split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    // ─────────────────────────────────────────────────────────────────
    // Channel helpers
    // ─────────────────────────────────────────────────────────────────

    fetchChannels() {
      fetch("/api/transports")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            this.channels = data.map((ch) => ({
              ...ch,
              reconnectAttempts: ch.statusDetail?.reconnectAttempts ?? 0,
              lastError: ch.statusDetail?.lastError ?? null,
            }));
            // Clear help task tags for channels that reconnected
            // Start connecting timers for channels already in connecting state
            for (const ch of this.channels) {
              if (ch.status === "connected" && this.channelHelpTasks[ch.id]) {
                delete this.channelHelpTasks[ch.id];
              }
              // Start timer for any channel currently connecting (e.g., on page load)
              if (
                ch.status === "connecting" &&
                !this._connectingIntervals[ch.id]
              ) {
                this.startConnectingTimer(ch.id);
              }
            }
          }
        })
        .catch(() => {});
    },

    channelDotClass(status) {
      switch (status) {
        case "connected":
          return "bg-green-400";
        case "connecting":
          return "bg-yellow-400 animate-pulse";
        case "error":
          return "bg-red-400";
        case "logged_out":
          return "bg-gray-500";
        case "disconnected":
        default:
          return "bg-gray-400";
      }
    },

    /**
     * Convert technical role to user-friendly text
     */
    friendlyRole(role) {
      return role === "dedicated" ? "Agent-owned" : "Your account";
    },

    /**
     * Get display title for a channel (fallback to ID)
     */
    channelTitle(ch) {
      // Could add ch.title support later; for now use ID with formatting
      return ch.id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    },

    /**
     * Get friendly status text
     */
    friendlyStatus(status) {
      switch (status) {
        case "connected":
          return "Connected";
        case "connecting":
          return "Connecting...";
        case "error":
          return "Error";
        case "logged_out":
          return "Logged out";
        case "disconnected":
          return "Disconnected";
        default:
          return status;
      }
    },

    /**
     * Get action button label based on status
     */
    channelActionLabel(status) {
      switch (status) {
        case "disconnected":
          return "Connect";
        case "error":
        case "logged_out":
          return "Reconnect";
        default:
          return null;
      }
    },

    channelTooltip(ch) {
      let tip = ch.status || "unknown";
      if (ch.reconnectAttempts > 0) {
        tip += ` (attempt ${ch.reconnectAttempts})`;
      }
      return tip;
    },

    /**
     * Toggle expanded error panel for a channel
     */
    toggleChannelError(channelId) {
      this.expandedChannelErrors[channelId] =
        !this.expandedChannelErrors[channelId];
    },

    /**
     * Check if channel error panel is expanded
     */
    isChannelErrorExpanded(channelId) {
      return !!this.expandedChannelErrors[channelId];
    },

    /**
     * Create a help task for Nina to fix channel error
     */
    async askNinaAboutChannel(channelId) {
      const channel = this.channels.find((ch) => ch.id === channelId);
      if (!channel) return;

      const errorMsg = channel.lastError || "Unknown error";
      const title = `Fix ${channelId} connection`;
      const instructions = `The WhatsApp channel "${channelId}" has an error: "${errorMsg}"\n\nPlease help diagnose and fix this connection issue.`;

      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "immediate",
            sourceType: "manual",
            title,
            instructions,
            createdBy: "user",
          }),
        });

        if (res.ok) {
          const task = await res.json();
          this.channelHelpTasks[channelId] = task.id;
          // Refresh tasks list
          this.fetchTasks();
        }
      } catch (err) {
        console.error("[App] Failed to create help task:", err);
      }
    },

    /** Get channel badge icon for a transcript message */
    getChannelBadgeIcon(channel) {
      if (!channel || channel === "web") return null;
      const ch = this.channels.find((c) => c.id === channel);
      return ch?.icon || null;
    },

    /** Get channel badge name for a transcript message */
    getChannelBadgeName(channel) {
      if (!channel || channel === "web") return null;
      return channel;
    },

    /** Find a conversation by ID */
    findConversation(id) {
      return this.conversations.find((c) => c.id === id) || null;
    },

    // ─────────────────────────────────────────────────────────────────
    // Debrief Preferences (M6.9-S2)
    // ─────────────────────────────────────────────────────────────────

    async loadChannels() {
      try {
        const res = await fetch("/api/transports");
        if (!res.ok) return;
        const channels = await res.json();
        // Use channel ID as both value and label — these are user-defined names
        const PLUGIN_LABELS = { baileys: "WhatsApp" };
        this.availableChannels = channels.map((ch) => ({
          value: ch.id,
          label: ch.id,
          pluginLabel: PLUGIN_LABELS[ch.plugin] || ch.plugin,
          connected: ch.statusDetail?.connected ?? false,
        }));
      } catch (err) {
        console.error("[App] Failed to load channels:", err);
      }
    },

    async loadPreferences() {
      try {
        const res = await fetch("/api/settings/preferences");
        if (!res.ok) return;
        const data = await res.json();
        this.briefTime = data.debrief?.time ?? "08:00";
        this.briefTimezone = data.timezone ?? "UTC";
        this.briefModel = data.debrief?.model ?? "sonnet";
        this.briefOutboundChannel = data.outboundChannel ?? "web";
      } catch (err) {
        console.error("[App] Failed to load preferences:", err);
      }
      await this.loadChannels();

      // Load configured model IDs (may be user-overridden)
      try {
        const res = await fetch("/api/settings/models");
        if (res.ok) {
          const models = await res.json();
          this.configuredModels = models;
          this.modelOptions = [
            { id: models.sonnet, name: "Sonnet" },
            { id: models.haiku, name: "Haiku" },
            { id: models.opus, name: "Opus" },
          ];
          // Update selected model if it's not in the new list
          if (!this.modelOptions.some((m) => m.id === this.selectedModel)) {
            this.selectedModel = models.sonnet;
          }
        }
      } catch (err) {
        console.error("[App] Failed to load models:", err);
      }

      // Load available models from Anthropic API
      try {
        const res = await fetch("/api/settings/available-models");
        if (res.ok) {
          const data = await res.json();
          this.availableModels = data.models || [];
        }
      } catch (err) {
        console.error("[App] Failed to load available models:", err);
      }
    },

    /**
     * Filter and sort available models for a role's dropdown.
     * - Only shows models matching the role family (sonnet/haiku/opus)
     * - Undated models first (sorted newest version to oldest)
     * - Then dated models (sorted newest date to oldest)
     */
    modelsForRole(role) {
      const keyword = role.toLowerCase();
      const filtered = this.availableModels.filter(
        (m) => m.includes(keyword) && m !== this.configuredModels[role],
      );

      const undated = [];
      const dated = [];
      for (const m of filtered) {
        // Dated models end with -YYYYMMDD
        if (/\d{8}$/.test(m)) {
          dated.push(m);
        } else {
          undated.push(m);
        }
      }

      // Sort undated: extract version numbers, higher first
      // e.g. claude-sonnet-4-6 > claude-sonnet-4-6 > claude-sonnet-4-0
      undated.sort((a, b) => {
        const va = a.match(/(\d+(?:-\d+)*)/g) || [];
        const vb = b.match(/(\d+(?:-\d+)*)/g) || [];
        const na = va.map(Number).join(".");
        const nb = vb.map(Number).join(".");
        return nb.localeCompare(na, undefined, { numeric: true });
      });

      // Sort dated: newest date first
      dated.sort((a, b) => {
        const da = a.match(/(\d{8})$/)?.[1] || "0";
        const db = b.match(/(\d{8})$/)?.[1] || "0";
        return db.localeCompare(da);
      });

      return [...undated, ...dated];
    },

    async saveModels() {
      this.savingModels = true;
      this.modelsStatus = null;
      try {
        const res = await fetch("/api/settings/models", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.configuredModels),
        });
        if (!res.ok) {
          this.modelsStatus = "error";
        } else {
          const updated = await res.json();
          this.configuredModels = updated;
          this.modelOptions = [
            { id: updated.sonnet, name: "Sonnet" },
            { id: updated.haiku, name: "Haiku" },
            { id: updated.opus, name: "Opus" },
          ];
          if (!this.modelOptions.some((m) => m.id === this.selectedModel)) {
            this.selectedModel = updated.sonnet;
          }
          this.modelsStatus = "saved";
          setTimeout(() => (this.modelsStatus = null), 2000);
        }
      } catch (err) {
        console.error("[App] Failed to save models:", err);
        this.modelsStatus = "error";
      } finally {
        this.savingModels = false;
      }
    },

    async savePreferences() {
      this.savingPreferences = true;
      this.preferencesStatus = null;
      try {
        const res = await fetch("/api/settings/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            debrief: {
              time: this.briefTime,
              model: this.briefModel,
            },
            timezone: this.briefTimezone,
            outboundChannel: this.briefOutboundChannel,
          }),
        });
        if (!res.ok) {
          this.preferencesStatus = "error";
          return;
        }
        this.preferencesStatus = "saved";
        setTimeout(() => {
          this.preferencesStatus = null;
        }, 3000);
      } catch (err) {
        console.error("[App] Failed to save preferences:", err);
        this.preferencesStatus = "error";
      } finally {
        this.savingPreferences = false;
      }
    },

    // ─────────────────────────────────────────────────────────────────
    // Settings / Channel actions
    // ─────────────────────────────────────────────────────────────────

    async addChannel() {
      if (!this.newChannel.id) return;
      this.addingChannel = true;
      this.addChannelError = null;

      try {
        const res = await fetch("/api/transports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: this.newChannel.id.trim().replace(/\s+/g, "_").toLowerCase(),
            plugin: "baileys",
            role: this.newChannel.role || "dedicated",
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          this.addChannelError = data.error || "Failed to create transport";
          return;
        }

        // Add to local channels list
        this.channels.push(data);

        // Reset form — don't auto-trigger pairing, let user choose method
        this.showAddChannel = false;
        this.newChannel = { id: "", role: "dedicated" };
      } catch (err) {
        console.error("[App] Add channel failed:", err);
        this.addChannelError = "Network error. Is the server running?";
      } finally {
        this.addingChannel = false;
      }
    },

    async pairChannel(channelId, phoneNumber) {
      this.pairingChannelId = channelId;
      this.qrCodeDataUrl = null;
      delete this.pairingCodes[channelId];

      try {
        const body = phoneNumber ? { phoneNumber } : undefined;
        const res = await fetch(`/api/transports/${channelId}/pair`, {
          method: "POST",
          ...(body && {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("[App] Pair failed:", data.error || res.statusText);
          this.pairingChannelId = null;
          alert(data.error || "Pairing failed. Try again.");
          return;
        }
        // Pairing code (or QR code) will arrive via WebSocket
      } catch (err) {
        console.error("[App] Pair request failed:", err);
        this.pairingChannelId = null;
      }
    },

    async pairByPhone(channelId) {
      const number = this.pairingPhoneNumber[channelId];
      if (!number || number.trim().length < 7) {
        alert("Enter a valid phone number with country code");
        return;
      }
      this.pairingByPhone[channelId] = true;
      await this.pairChannel(channelId, number.trim());
    },

    /**
     * Check if we're on a mobile device (viewport-based)
     */
    isMobile() {
      return window.innerWidth < 768;
    },

    /**
     * Get the default pairing tab based on device type
     */
    getDefaultPairingTab() {
      return this.isMobile() ? "phone" : "qr";
    },

    /**
     * Get the current pairing tab for a channel (or default)
     */
    getPairingTab(channelId) {
      return this.pairingTab[channelId] || this.getDefaultPairingTab();
    },

    /**
     * Set the pairing tab for a channel
     */
    setPairingTab(channelId, tab) {
      this.pairingTab[channelId] = tab;
      // Clear the started state when switching tabs
      delete this.pairingStarted[channelId];
    },

    /**
     * Start the pairing process for the current tab method
     */
    async startPairingProcess(channelId) {
      const tab = this.getPairingTab(channelId);
      this.pairingStarted[channelId] = true;

      if (tab === "phone") {
        // For phone tab, just show the input - don't start pairing yet
        // The actual pairing happens when they enter number and click Pair
      } else {
        // For QR tab, generate QR code
        await this.pairChannel(channelId);
      }
    },

    /**
     * Reset pairing state for a channel
     */
    resetPairingState(channelId) {
      delete this.pairingTab[channelId];
      delete this.pairingStarted[channelId];
      delete this.pairingPhoneNumber[channelId];
      delete this.pairingCodes[channelId];
      delete this.pairingByPhone[channelId];
      this.codeCopied = { ...this.codeCopied, [channelId]: false };
    },

    // Track which channels are showing "Copied" animation
    codeCopied: {},

    /**
     * Format pairing code as 4+4 (e.g., "QZFV 132L")
     */
    formatPairingCode(code) {
      if (!code || code.length !== 8) return code || "";
      return code.slice(0, 4) + " " + code.slice(4);
    },

    /**
     * Copy pairing code to clipboard with animation
     */
    async copyPairingCode(channelId) {
      const code = this.pairingCodes[channelId];
      if (!code) return;

      // Show "Copied" animation immediately
      this.codeCopied = { ...this.codeCopied, [channelId]: true };
      setTimeout(() => {
        this.codeCopied = { ...this.codeCopied, [channelId]: false };
      }, 1000);

      // Copy to clipboard - try modern API first, fallback to execCommand
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code);
        } else {
          // Fallback for HTTP or older browsers
          const textarea = document.createElement("textarea");
          textarea.value = code;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
      } catch (err) {
        // Last resort fallback
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
    },

    /**
     * Start a countdown timer for QR code expiration
     */
    startQrCountdown(channelId, seconds) {
      // Clear any existing countdown for this channel
      this.clearQrCountdown(channelId);
      // Set initial countdown value
      this.qrCountdowns[channelId] = seconds;
      // Start interval to decrement
      this._qrCountdownIntervals[channelId] = setInterval(() => {
        if (this.qrCountdowns[channelId] > 0) {
          this.qrCountdowns[channelId]--;
        } else {
          this.clearQrCountdown(channelId);
          // QR expired - check if channel is still connecting and request new QR
          // BUT don't auto-refresh if phone number pairing is active
          const ch = this.channels.find((c) => c.id === channelId);
          const isPhonePairing =
            this.pairingByPhone[channelId] || this.pairingCodes[channelId];
          if (ch && ch.status === "connecting" && !isPhonePairing) {
            console.log(`[App] QR expired for ${channelId}, requesting new QR`);
            this.pairChannel(channelId);
          }
        }
      }, 1000);
    },

    /**
     * Clear QR countdown timer for a channel
     */
    clearQrCountdown(channelId) {
      if (this._qrCountdownIntervals[channelId]) {
        clearInterval(this._qrCountdownIntervals[channelId]);
        delete this._qrCountdownIntervals[channelId];
      }
      delete this.qrCountdowns[channelId];
    },

    /**
     * Start a countdown timer for connecting phase
     * WhatsApp generates ~4 QR codes at ~20s each = ~80s total before timeout
     */
    startConnectingTimer(channelId, seconds = 80) {
      // Clear any existing timer for this channel
      this.clearConnectingTimer(channelId);
      // Start countdown
      this.connectingTimers[channelId] = seconds;
      // Decrement every second
      this._connectingIntervals[channelId] = setInterval(() => {
        if (this.connectingTimers[channelId] > 0) {
          this.connectingTimers[channelId]--;
        } else {
          this.clearConnectingTimer(channelId);
        }
      }, 1000);
    },

    /**
     * Clear connecting timer for a channel
     */
    clearConnectingTimer(channelId) {
      if (this._connectingIntervals[channelId]) {
        clearInterval(this._connectingIntervals[channelId]);
        delete this._connectingIntervals[channelId];
      }
      delete this.connectingTimers[channelId];
    },

    fetchChannelBindings() {
      fetch("/api/channels")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            this.channelBindings = data;
          }
        })
        .catch(() => {});
    },

    /**
     * Get the channel binding for a transport (if any)
     */
    getBinding(transportId) {
      return this.channelBindings.find((b) => b.transport === transportId);
    },

    async requestAuthToken(channelId) {
      try {
        const res = await fetch(`/api/transports/${channelId}/authorize`, {
          method: "POST",
        });
        if (res.ok) {
          const data = await res.json();
          this.authTokens[channelId] = data.token;
        }
      } catch (err) {
        console.error("[App] Auth token request failed:", err);
      }
    },

    async reauthorizeTransport(channelId) {
      if (!confirm("This will suspend the current owner. Continue?")) {
        return;
      }
      try {
        const res = await fetch(`/api/transports/${channelId}/reauthorize`, {
          method: "POST",
        });
        if (res.ok) {
          const data = await res.json();
          this.authTokens[channelId] = data.token;
        }
      } catch (err) {
        console.error("[App] Re-authorize failed:", err);
      }
    },

    async removeOwner(channelId) {
      try {
        const res = await fetch(`/api/transports/${channelId}/remove-owner`, {
          method: "POST",
        });
        if (!res.ok) {
          console.error("[App] Remove owner failed");
        }
        // Owner removal broadcast will arrive via WebSocket
      } catch (err) {
        console.error("[App] Remove owner failed:", err);
      }
    },

    async disconnectChannel(channelId) {
      try {
        const res = await fetch(`/api/transports/${channelId}/disconnect`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error(
            "[App] Disconnect failed:",
            data.error || res.statusText,
          );
        }
      } catch (err) {
        console.error("[App] Disconnect request failed:", err);
      }
    },

    async removeChannel(channelId) {
      if (
        !confirm(
          `Remove transport "${channelId}"? This will delete all auth data.`,
        )
      ) {
        return;
      }

      try {
        const res = await fetch(`/api/transports/${channelId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("[App] Remove failed:", data.error || res.statusText);
          return;
        }
        // Remove from local state
        this.channels = this.channels.filter((ch) => ch.id !== channelId);
      } catch (err) {
        console.error("[App] Remove request failed:", err);
      }
    },

    /**
     * Build attachment previews from server attachment metadata
     */
    buildAttachmentPreviews(attachments) {
      if (!attachments || attachments.length === 0) return null;
      return attachments.map((att) => ({
        type: att.mimeType.startsWith("image/") ? "image" : "text",
        name: att.filename,
        url: `/attachments/${att.localPath}`,
        size: att.size,
      }));
    },

    // ─────────────────────────────────────────────────────────────────
    // Calendar methods
    // ─────────────────────────────────────────────────────────────────

    /**
     * Load calendar configuration and set up visibility defaults
     */
    async loadCalendarConfig() {
      try {
        const config = await CalendarModule.fetchCalendarConfig();
        this.calendarList = config.calendars || [];

        // Set default visibility
        for (const cal of this.calendarList) {
          if (!(cal.id in this.calendarVisibility)) {
            this.calendarVisibility[cal.id] = cal.defaultVisible;
          }
        }
      } catch (err) {
        console.error("[App] Failed to load calendar config:", err);
      }
    },

    /**
     * Load today's events for the Home tab mini calendar
     */
    async loadTodayEvents() {
      try {
        this.todayEvents = await CalendarModule.fetchTodayEvents();
      } catch (err) {
        console.error("[App] Failed to load today's events:", err);
        this.todayEvents = [];
      }
    },

    /**
     * Load upcoming events for the timeline using current timelineFutureDays range
     */
    async loadUpcomingEvents() {
      try {
        const prevCount = this.upcomingEvents.length;
        this.upcomingEvents = await CalendarModule.fetchUpcomingEvents(
          this.timelineFutureDays,
        );
        // If count increased, there might be more beyond the window
        // If count stayed same, nothing more to load
        this.noMoreFutureEvents = this.upcomingEvents.length === prevCount;
      } catch (err) {
        console.error("[App] Failed to load upcoming events:", err);
        this.upcomingEvents = [];
      }
    },

    /**
     * Load projected future runs from the timeline API
     */
    async loadTimelineProjections() {
      try {
        const res = await fetch("/api/timeline/future?hours=168");
        const data = await res.json();
        this.timelineProjections = data.futureRuns || [];
      } catch (err) {
        console.error("[App] Failed to load timeline projections:", err);
        this.timelineProjections = [];
      }
    },

    /**
     * Reload both tasks and calendar events for the current timeline range
     */
    async loadTimelineData() {
      await Promise.all([
        this.loadUpcomingEvents(),
        this.loadTimelineProjections(),
      ]);
    },

    /**
     * Expand the timeline range backward — fetch older jobs from API
     */
    async loadEarlierTimeline() {
      this.timelinePastDays += 7;

      // Find the oldest job/item in the current timeline to use as cursor
      const allItems = this.timelineItems;
      const pastItems = allItems.filter(
        (i) => i.isPast && i.itemType === "job",
      );
      const oldest =
        pastItems.length > 0 ? pastItems[pastItems.length - 1] : null;

      if (oldest && oldest.job) {
        try {
          const res = await fetch(
            `/api/timeline?before=${encodeURIComponent(oldest.job.created)}&limit=20`,
          );
          const data = await res.json();
          if (data.pastJobs && data.pastJobs.length > 0) {
            // Merge with existing older jobs, avoiding duplicates
            const existingIds = new Set(
              this.timelineOlderJobs.map((j) => j.id),
            );
            const newJobs = data.pastJobs.filter((j) => !existingIds.has(j.id));
            this.timelineOlderJobs = [...this.timelineOlderJobs, ...newJobs];
            this.canLoadEarlierJobs = data.pastJobs.length === 20;
          } else {
            this.canLoadEarlierJobs = false;
          }
        } catch (err) {
          console.error("[App] Failed to load earlier jobs:", err);
        }
      }

      await this.loadTimelineData();
    },

    /**
     * Format time for a timeline item
     */
    formatTimelineTime(item) {
      const d =
        item.sortDate || new Date(item.job?.created || item.event?.start || 0);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    },

    /**
     * Format a date string for timeline date separators
     */
    formatDateSeparator(dateStr) {
      const d = new Date(dateStr);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return "Today";
      if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    },

    /**
     * Format job duration from created to completed timestamps
     */
    formatJobDuration(item) {
      if (!item.job?.created || !item.job?.completed) return null;
      const ms = new Date(item.job.completed) - new Date(item.job.created);
      if (ms < 1000) return "<1s";
      if (ms < 60000) return `${Math.round(ms / 1000)}s`;
      if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
      return `${Math.round(ms / 3600000)}h`;
    },

    /**
     * Expand the timeline range forward by 7 days and reload
     */
    async loadLaterTimeline() {
      this.timelineFutureDays += 7;
      await this.loadTimelineData();
    },

    /**
     * Set up IntersectionObserver to track NOW marker visibility
     * relative to the scroll container. Called via x-effect whenever
     * timelineItems changes.
     */
    setupNowMarkerObserver() {
      if (this._nowObserver) {
        this._nowObserver.disconnect();
        this._nowObserver = null;
      }

      const scrollRoot = document.getElementById("main-scroll");
      const marker = document.querySelector(".now-marker");

      if (!marker || !scrollRoot) {
        this.nowMarkerDirection = null;
        return;
      }

      this._nowObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              this.nowMarkerDirection = null;
            } else {
              const rect = entry.boundingClientRect;
              const rootBounds = entry.rootBounds;
              this.nowMarkerDirection =
                rect.top < rootBounds.top ? "up" : "down";
            }
          }
        },
        { root: scrollRoot, threshold: 0 },
      );

      this._nowObserver.observe(marker);
    },

    /**
     * Smooth-scroll the NOW marker into the center of the viewport.
     */
    scrollToNow() {
      const marker = document.querySelector(".now-marker");
      if (marker) {
        marker.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },

    /**
     * Initialize main calendar view (called when Calendar tab becomes active)
     */
    initCalendarView() {
      const el = this.$refs.calendarEl;
      if (!el) {
        console.error("[App] Calendar element not found");
        return;
      }

      // If already initialized, refresh and update size (handles window resize on refresh)
      if (this.calendar) {
        this.calendar.updateSize();
        this.calendar.refetchEvents();
        return;
      }

      // Ensure the element is visible and has dimensions before initializing
      // FullCalendar needs a properly sized container
      if (el.offsetWidth === 0 || el.offsetHeight === 0) {
        // Element not visible yet, retry after a short delay
        console.log("[App] Calendar element not sized yet, deferring init");
        requestAnimationFrame(() => this.initCalendarView());
        return;
      }

      // Get visible calendars
      const visibleCalendars = Object.entries(this.calendarVisibility)
        .filter(([_, visible]) => visible)
        .map(([id]) => id);

      this.calendar = CalendarModule.initCalendar(el, {
        visibleCalendars,
        onEventClick: (event, el) => {
          this.openEventTab(event);
        },
        onDateSelect: (selection) => {
          this.openEventModal(selection);
        },
        onEventDrop: async (event) => {
          return await this.updateEventFromDrag(event);
        },
        onEventResize: async (event) => {
          return await this.updateEventFromDrag(event);
        },
        onDatesSet: (dateInfo) => {
          // Track visible date range and view type for context
          this.calendarViewStart = dateInfo.start;
          this.calendarViewEnd = dateInfo.end;
          this.calendarViewType = dateInfo.view.type;
          // Update context if calendar tab is active
          if (this.activeTab === "calendar") {
            this.updateCalendarContext();
          }
        },
      });

      // Set initial view range
      if (this.calendar) {
        const view = this.calendar.view;
        this.calendarViewStart = view.activeStart;
        this.calendarViewEnd = view.activeEnd;
        this.calendarViewType = view.type;
        this.updateCalendarContext();
      }
    },

    /**
     * Initialize mini calendar on Home tab
     */
    initMiniCalendarView() {
      const el = this.$refs.miniCalendarEl;
      if (!el) return;

      // If already initialized, just update size
      if (this.miniCalendar) {
        this.miniCalendar.updateSize();
        return;
      }

      // Ensure the element is visible and has dimensions before initializing
      if (el.offsetWidth === 0) {
        // Element not visible yet, retry after a short delay
        console.log(
          "[App] Mini calendar element not sized yet, deferring init",
        );
        requestAnimationFrame(() => this.initMiniCalendarView());
        return;
      }

      this.miniCalendar = CalendarModule.initMiniCalendar(el, (date) => {
        // Open calendar tab and navigate to that date
        this.openCalendar(date);
      });
    },

    /**
     * Initialize calendar inside the mobile calendar popover.
     * Clicking a date selects it and shows that day's items below the calendar.
     */
    initMobileCalendar(el) {
      if (!el) return;
      // Clean up previous instance
      if (window._mobileCalendar) {
        window._mobileCalendar.destroy();
        window._mobileCalendar = null;
      }
      // Defer until element has dimensions
      if (el.offsetWidth === 0) {
        requestAnimationFrame(() => this.initMobileCalendar(el));
        return;
      }
      // Default selected date to today
      this.mobileCalendarSelectedDate = new Date().toDateString();
      this.updateMobileCalendarItems();

      window._mobileCalendar = CalendarModule.initMiniCalendar(el, (date) => {
        this.mobileCalendarSelectedDate = date.toDateString();
        this.updateMobileCalendarItems();
      });
    },

    /** Selected date in mobile calendar popover (toDateString format) */
    mobileCalendarSelectedDate: null,
    /** Items for the selected date */
    mobileCalendarDayItems: [],

    /** Update the day items list for the selected mobile calendar date */
    updateMobileCalendarItems() {
      if (!this.mobileCalendarSelectedDate) {
        this.mobileCalendarDayItems = [];
        return;
      }
      const target = this.mobileCalendarSelectedDate;
      this.mobileCalendarDayItems = this.timelineItems.filter(
        (item) => item.date === target,
      );
    },

    /**
     * Scroll the timeline to a specific date by finding its date separator.
     * Falls back to expanding the timeline range if the date isn't loaded yet.
     */
    scrollTimelineToDate(date) {
      if (!date) return;
      const target = date.toDateString();
      // Find the timeline item with a matching date separator
      const items = this.timelineItems;
      const match = items.find(
        (item) => item.showDateSeparator && item.date === target,
      );
      if (!match) return; // Date not in current timeline range

      // Find the separator button in the DOM by its text content
      this.$nextTick(() => {
        const timelineEl = document.querySelector(".timeline-scroll-area");
        if (!timelineEl) return;
        const separators = timelineEl.querySelectorAll("button");
        for (const btn of separators) {
          const span = btn.querySelector("span");
          if (span && span.textContent === this.formatDateSeparator(target)) {
            btn.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
        }
      });
    },

    /**
     * Open the Calendar tab (create if needed) and optionally navigate to a date
     */
    openCalendar(date = null) {
      // Check if calendar tab exists
      const existing = this.openTabs.find((t) => t.id === "calendar");
      if (existing) {
        this.switchTab("calendar");
      } else {
        // Create calendar tab
        this.openTab({
          id: "calendar",
          type: "calendar",
          title: "Calendar",
          icon: ICONS.calendar,
          closeable: true,
        });
      }

      // Navigate to date after tab is ready
      if (date) {
        this.$nextTick(() => {
          if (this.calendar) {
            this.calendar.gotoDate(date);
          }
        });
      }
    },

    /**
     * Update chat context with calendar view range
     */
    updateCalendarContext() {
      if (!this.calendarViewStart || !this.calendarViewEnd) return;

      const start = this.calendarViewStart;
      const end = new Date(this.calendarViewEnd);
      // FullCalendar end is exclusive, so subtract 1 day for display
      end.setDate(end.getDate() - 1);

      let rangeText;

      // Month view: show "February 2026" (the month containing most visible days)
      if (this.calendarViewType === "dayGridMonth") {
        // Use the 15th of the range to get the primary month
        const midDate = new Date(start);
        midDate.setDate(midDate.getDate() + 15);
        rangeText = midDate.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        });
      } else {
        const opts = { month: "short", day: "numeric" };

        // Check if it's a single day view
        const isSingleDay =
          start.toDateString() === end.toDateString() ||
          (end.getTime() - start.getTime() < 2 * 24 * 60 * 60 * 1000 &&
            start.getDate() === end.getDate());

        if (isSingleDay) {
          // Single day: "Feb 19"
          rangeText = start.toLocaleDateString(undefined, opts);
        } else if (start.getMonth() === end.getMonth()) {
          // Same month: "Feb 15-21"
          rangeText = `${start.toLocaleDateString(undefined, opts)}-${end.getDate()}`;
        } else {
          // Different months: "Feb 28 - Mar 6"
          rangeText = `${start.toLocaleDateString(undefined, opts)} - ${end.toLocaleDateString(undefined, opts)}`;
        }
      }

      this.chatContext = {
        type: "calendar",
        title: rangeText,
        icon: ICONS.calendar,
        dateRange: {
          start: this.calendarViewStart.toISOString(),
          end: this.calendarViewEnd.toISOString(),
        },
      };
    },

    /**
     * Refresh calendar when visibility changes
     */
    refreshCalendar() {
      if (!this.calendar) return;

      const visibleCalendars = Object.entries(this.calendarVisibility)
        .filter(([_, visible]) => visible)
        .map(([id]) => id);

      // Update event source with new filter
      this.calendar.getEventSources().forEach((s) => s.remove());
      this.calendar.addEventSource({
        url: "/api/calendar/events",
        method: "GET",
        extraParams: {
          calendars: visibleCalendars.join(","),
        },
      });

      // Re-add timeline source if visible
      this.calendar.addEventSource({
        events: fetchTimelineEvents,
      });
    },

    /**
     * Open event modal for creating/editing
     */
    openEventModal(selection = null) {
      this.editingEvent = null;

      // Default to user calendar if available
      const defaultCalendar =
        this.calendarList.find((c) => c.id === "user") ||
        this.calendarList.find((c) => c.role === "owned") ||
        this.calendarList[0];

      if (selection) {
        // Pre-fill from date selection
        this.eventForm = {
          title: "",
          start: this.toDateTimeLocal(selection.start),
          end: this.toDateTimeLocal(selection.end),
          allDay: selection.allDay,
          calendarId: defaultCalendar?.id || "user",
          description: "",
        };
      } else {
        // Default: start now, end in 1 hour
        const now = new Date();
        const end = new Date(now.getTime() + 60 * 60 * 1000);
        this.eventForm = {
          title: "",
          start: this.toDateTimeLocal(now),
          end: this.toDateTimeLocal(end),
          allDay: false,
          calendarId: defaultCalendar?.id || "user",
          description: "",
        };
      }

      this.eventModalOpen = true;
      this.$nextTick(() => {
        this.$refs.eventTitleInput?.focus();
      });
    },

    /**
     * Close event modal
     */
    closeEventModal() {
      this.eventModalOpen = false;
      this.editingEvent = null;
    },

    /**
     * Save event (create or update)
     */
    async saveEvent() {
      if (!this.eventForm.title) return;

      const eventData = {
        calendarId: this.eventForm.calendarId,
        title: this.eventForm.title,
        start: new Date(this.eventForm.start).toISOString(),
        end: this.eventForm.end
          ? new Date(this.eventForm.end).toISOString()
          : null,
        allDay: this.eventForm.allDay,
        description: this.eventForm.description || undefined,
      };

      if (this.editingEvent) {
        // Update existing event
        const result = await CalendarModule.updateCalendarEvent(
          this.editingEvent.id,
          eventData,
        );
        if (result) {
          this.calendar?.refetchEvents();
          this.loadTodayEvents();
          this.loadUpcomingEvents();
        }
      } else {
        // Create new event
        const result = await CalendarModule.createCalendarEvent(eventData);
        if (result) {
          this.calendar?.refetchEvents();
          this.loadTodayEvents();
          this.loadUpcomingEvents();
        }
      }

      this.closeEventModal();
    },

    /**
     * Update event after drag-drop or resize
     */
    async updateEventFromDrag(event) {
      const updates = {
        start: event.start.toISOString(),
        end: event.end ? event.end.toISOString() : event.start.toISOString(),
        allDay: event.allDay,
      };

      const result = await CalendarModule.updateCalendarEvent(
        event.id,
        updates,
      );
      if (result) {
        this.loadTodayEvents();
        this.loadUpcomingEvents();
      }
      return !!result;
    },

    /**
     * Open event in a dedicated tab (Outlook-style appointment view)
     * Opens the relevant detail view for the event type
     */
    async openEventTab(event) {
      // Automation events: open automation detail tab
      const extProps = event.extendedProps || {};
      if (extProps.type === "automation" && extProps.automationId) {
        this.openAutomationDetail(extProps.automationId);
        return;
      }

      // Normalize event data (FullCalendar event or raw API format)
      const eventData = {
        id: event.id,
        title: event.title,
        start:
          event.start instanceof Date ? event.start : new Date(event.start),
        end: event.end
          ? event.end instanceof Date
            ? event.end
            : new Date(event.end)
          : null,
        allDay: event.allDay,
        color: event.color || event.backgroundColor,
        extendedProps: event.extendedProps || {},
      };

      const tabId = `event-${eventData.id}`;

      // Check if tab already open
      const existing = this.openTabs.find((t) => t.id === tabId);
      if (existing) {
        this.switchTab(tabId);
        return;
      }

      // Open new event tab
      this.openTab({
        id: tabId,
        type: "event",
        title: eventData.title,
        icon: ICONS.calendar,
        closeable: true,
        data: { event: eventData },
      });
    },

    /**
     * Open event tab from Home page today's events list
     */
    openEventFromList(event) {
      this.openEventTab(event);
    },

    /**
     * Get the currently viewed event (for tab content)
     */
    getCurrentEvent() {
      const tab = this.openTabs.find((t) => t.id === this.activeTab);
      return tab?.type === "event" ? tab.data?.event : null;
    },

    /**
     * Edit event from its tab (inline mode)
     */
    editCurrentEvent() {
      this.startInlineEventEdit();
    },

    /**
     * Enter inline edit mode for current event
     */
    startInlineEventEdit() {
      const tab = this.openTabs.find((t) => t.id === this.activeTab);
      if (!tab?.data?.event) return;

      const event = tab.data.event;
      this.eventEditForm = {
        title: event.title,
        start: this.toDateTimeLocal(event.start),
        end: event.end ? this.toDateTimeLocal(event.end) : "",
        allDay: event.allDay || false,
        description: event.extendedProps?.description || "",
      };
      this.isEditingEvent = true;
    },

    /**
     * Cancel inline edit and revert to read mode
     */
    cancelInlineEventEdit() {
      this.isEditingEvent = false;
      this.eventEditForm = {
        title: "",
        start: "",
        end: "",
        allDay: false,
        description: "",
      };
    },

    /**
     * Save inline edits via API
     */
    async saveInlineEventEdit() {
      const tab = this.openTabs.find((t) => t.id === this.activeTab);
      if (!tab?.data?.event) return;

      try {
        await CalendarModule.updateCalendarEvent(tab.data.event.id, {
          title: this.eventEditForm.title,
          start: this.eventEditForm.start,
          end: this.eventEditForm.end || undefined,
          allDay: this.eventEditForm.allDay,
          description: this.eventEditForm.description,
        });

        // Update cached event in tab
        const evt = tab.data.event;
        evt.title = this.eventEditForm.title;
        evt.start = this.eventEditForm.start;
        evt.end = this.eventEditForm.end;
        evt.allDay = this.eventEditForm.allDay;
        evt.extendedProps = {
          ...evt.extendedProps,
          description: this.eventEditForm.description,
        };
        tab.title = this.eventEditForm.title;

        // Refresh calendar
        this.calendar?.refetchEvents();
        this.miniCalendar?.refetchEvents();

        this.isEditingEvent = false;
      } catch (err) {
        console.error("Failed to save event:", err);
      }
    },

    /**
     * Delete event from its tab
     */
    async deleteCurrentEvent() {
      const event = this.getCurrentEvent();
      if (!event) return;

      const confirmed = confirm(`Delete "${event.title}"?`);
      if (!confirmed) return;

      const calendarId = event.extendedProps?.calendarId;
      const success = await CalendarModule.deleteCalendarEvent(
        event.id,
        calendarId,
      );

      if (success) {
        // Close the event tab
        this.closeTab(this.activeTab);
        // Refresh calendars
        this.refreshCalendar();
        this.loadTodayEvents();
        this.loadUpcomingEvents();
      }
    },

    /**
     * Ask agent to help create an event (from modal)
     */
    askAgentToCreateEvent() {
      // Capture timeframe from form before closing
      const start = this.eventForm.start;
      const end = this.eventForm.end;
      const allDay = this.eventForm.allDay;

      this.closeEventModal();
      this.startEventConversation("create", { start, end, allDay });
    },

    /**
     * Ask agent to help edit current event (from event tab)
     */
    askAgentToEditEvent() {
      const event = this.getCurrentEvent();
      if (!event) return;

      this.startEventConversation("edit", {
        uid: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        description: event.extendedProps?.description,
      });
    },

    /**
     * Start a new conversation with event context
     */
    startEventConversation(mode, eventData) {
      // Create new conversation (don't interrupt current)
      this.createNewConversation();

      // Build clean slash command prompt (skill has full instructions)
      let prompt;
      if (mode === "create") {
        const timeInfo = this.formatEventDateTime(eventData);
        const startISO = new Date(eventData.start).toISOString().slice(0, 19);
        const endISO = eventData.end
          ? new Date(eventData.end).toISOString().slice(0, 19)
          : "";
        prompt = `/my-agent:calendar

**Create new entry**
Time: ${timeInfo}
Start: ${startISO}${endISO ? `\nEnd: ${endISO}` : ""}${eventData.allDay ? "\nAll day: yes" : ""}`;
      } else {
        // Edit mode
        prompt = `/my-agent:calendar

**Edit existing entry**
Title: ${eventData.title}
UID: ${eventData.uid}
Current time: ${this.formatEventDateTime(eventData)}${eventData.description ? `\nNotes: ${eventData.description}` : ""}`;
      }

      // Queue to send once conversation is created
      this._pendingEventPrompt = prompt;
      // Track that this is a calendar conversation (for auto-refresh)
      this._isCalendarConversation = true;
    },

    /**
     * Edit event from popover
     */
    editEventFromPopover() {
      if (!this.selectedEvent) return;

      this.editingEvent = this.selectedEvent;
      this.eventForm = {
        title: this.selectedEvent.title,
        start: this.toDateTimeLocal(this.selectedEvent.start),
        end: this.selectedEvent.end
          ? this.toDateTimeLocal(this.selectedEvent.end)
          : "",
        allDay: this.selectedEvent.allDay,
        calendarId: this.selectedEvent.extendedProps?.calendarId || "user",
        description: this.selectedEvent.extendedProps?.description || "",
      };

      this.closeEventPopover();
      this.eventModalOpen = true;
      this.$nextTick(() => {
        this.$refs.eventTitleInput?.focus();
      });
    },

    /**
     * Delete event from popover
     */
    async deleteEventFromPopover() {
      if (!this.selectedEvent) return;

      const confirmed = confirm(`Delete "${this.selectedEvent.title}"?`);
      if (!confirmed) return;

      const calendarId = this.selectedEvent.extendedProps?.calendarId;
      const success = await CalendarModule.deleteCalendarEvent(
        this.selectedEvent.id,
        calendarId,
      );

      if (success) {
        this.calendar?.refetchEvents();
        this.loadTodayEvents();
        this.loadUpcomingEvents();
      }

      this.closeEventPopover();
    },

    /**
     * Set chat context to selected event and focus chat
     */
    askNinaAboutEvent() {
      if (!this.selectedEvent) return;

      this.chatContext = {
        type: "event",
        icon: ICONS.calendar,
        title: this.selectedEvent.title,
        data: {
          uid: this.selectedEvent.id,
          calendarId: this.selectedEvent.extendedProps?.calendarId,
        },
      };

      this.closeEventPopover();
      this.$nextTick(() => {
        this.$refs.chatInput?.focus();
      });
    },

    /**
     * Format event date/time for popover display
     */
    formatEventDateTime(event) {
      if (!event) return "";

      // Ensure we have Date objects (may be strings from localStorage)
      const start =
        event.start instanceof Date ? event.start : new Date(event.start);
      const end = event.end
        ? event.end instanceof Date
          ? event.end
          : new Date(event.end)
        : null;

      if (event.allDay) {
        const opts = { weekday: "short", month: "short", day: "numeric" };
        return start.toLocaleDateString(undefined, opts);
      }

      const dateOpts = { weekday: "short", month: "short", day: "numeric" };
      const timeOpts = { hour: "2-digit", minute: "2-digit" };

      const dateStr = start.toLocaleDateString(undefined, dateOpts);
      const startTime = start.toLocaleTimeString(undefined, timeOpts);
      const endTime = end ? end.toLocaleTimeString(undefined, timeOpts) : "";

      return endTime
        ? `${dateStr}, ${startTime} - ${endTime}`
        : `${dateStr}, ${startTime}`;
    },

    /**
     * Format event time for mini calendar list
     */
    formatEventTimeShort(event) {
      if (!event) return "";
      if (event.allDay) return "All day";

      const start = new Date(event.start);
      const hours = start.getHours().toString().padStart(2, "0");
      const minutes = start.getMinutes().toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    },

    /**
     * Convert Date to datetime-local input format
     */
    toDateTimeLocal(date) {
      const d = new Date(date);
      const offset = d.getTimezoneOffset();
      const local = new Date(d.getTime() - offset * 60 * 1000);
      return local.toISOString().slice(0, 16);
    },

    // ═══════════════════════════════════════════════════════════════════
    // Memory Methods (M6-S3)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Check if memory embeddings are in degraded mode.
     */
    isMemoryDegraded() {
      return (
        !this.memoryStatus?.embeddings?.active &&
        !!this.memoryStatus?.embeddings?.degraded
      );
    },

    /**
     * Get degraded state info (or null if not degraded).
     */
    memoryDegradedInfo() {
      return this.memoryStatus?.embeddings?.degraded || null;
    },

    /**
     * Navigate to a settings section by scrolling to its anchor.
     * On mobile, opens the settings popover and scrolls within it.
     */
    openSettingsSection(sectionId) {
      const mobile = Alpine.store("mobile");
      if (mobile && mobile.isMobile) {
        mobile.openPopoverWithFocus("settings");
        this.$nextTick(() => {
          setTimeout(() => {
            document
              .getElementById("mobile-" + sectionId)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 150);
        });
      } else {
        // Open settings tab properly (adds to tab bar)
        this.openTab({
          id: "settings",
          type: "settings",
          title: "Settings",
          icon: ICONS.gear,
          closeable: true,
        });
        this.$nextTick(() => {
          document
            .getElementById(sectionId)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    },

    /**
     * Load memory system status
     */
    async loadMemoryStatus() {
      try {
        const res = await fetch("/api/memory/status");
        if (res.ok) {
          this.memoryStatus = await res.json();
          // Sync selected plugin with active plugin
          if (this.memoryStatus.embeddings?.active) {
            this.selectedEmbeddingsPlugin =
              this.memoryStatus.embeddings.active.id;
          } else {
            this.selectedEmbeddingsPlugin = "none";
          }
          // Sync Ollama settings from backend
          const ollamaPlugin = this.memoryStatus.embeddings?.available?.find(
            (p) => p.id === "embeddings-ollama",
          );
          if (ollamaPlugin?.settings?.host) {
            this.ollamaHost = ollamaPlugin.settings.host;
          }
          if (ollamaPlugin?.settings?.model) {
            this.ollamaModel = ollamaPlugin.settings.model;
          }
          // If Ollama is active and we have host, auto-load models (if not already loaded)
          if (
            this.selectedEmbeddingsPlugin === "embeddings-ollama" &&
            this.ollamaHost &&
            this.ollamaModels.length === 0
          ) {
            this.loadOllamaModels();
          }
        }
      } catch (err) {
        console.error("[App] Failed to load memory status:", err);
        this.memoryStatus = null;
      }
    },

    /**
     * Rebuild memory index
     */
    async rebuildMemoryIndex() {
      this.memoryRebuilding = true;
      this.memoryRebuildResult = null;

      try {
        const res = await fetch("/api/memory/rebuild", { method: "POST" });
        const data = await res.json();

        if (res.ok) {
          this.memoryRebuildResult = {
            success: true,
            message: `Indexed ${data.filesIndexed} files in ${data.durationMs}ms`,
          };
          // Refresh status
          await this.loadMemoryStatus();
        } else {
          this.memoryRebuildResult = {
            success: false,
            message: data.error || "Rebuild failed",
          };
        }
      } catch (err) {
        console.error("[App] Failed to rebuild memory index:", err);
        this.memoryRebuildResult = {
          success: false,
          message: err.message || "Request failed",
        };
      } finally {
        this.memoryRebuilding = false;
      }
    },

    /**
     * Retry connection to Ollama (M6-S9: Error recovery)
     */
    async retryOllama() {
      this.embeddingsActivating = true;
      try {
        // Re-activate the Ollama plugin (triggers health check + init)
        const res = await fetch("/api/memory/embeddings/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pluginId: "embeddings-ollama",
            ollamaHost: this.ollamaHost,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Retry failed");

        // Close config on success
        this.resetMemoryUI();
      } catch (err) {
        console.error("[App] Retry Ollama failed:", err);
        this.embeddingsError = err.message || "Retry failed";
      } finally {
        this.embeddingsActivating = false;
      }
    },

    /**
     * Switch to local embeddings (M6-S9: Error fallback)
     */
    async useLocalEmbeddings() {
      // Use activatePlugin which handles save + activate + close
      await this.activatePlugin("embeddings-local");
    },

    /**
     * Load available models from Ollama server (M6-S9: Setup flow)
     */
    async loadOllamaModels() {
      this.ollamaModelsLoading = true;
      this.embeddingsError = null;
      this.ollamaModels = [];

      try {
        const res = await fetch(
          `/api/memory/embeddings/ollama/models?host=${encodeURIComponent(this.ollamaHost)}`,
        );
        const data = await res.json();

        if (!res.ok) {
          this.embeddingsError = data.error || "Failed to load models";
          return;
        }

        this.ollamaModels = data.models || [];
        if (this.ollamaModels.length === 0) {
          this.embeddingsError =
            "No models found on server. Run 'ollama pull <model>' first.";
        }
      } catch (err) {
        console.error("[App] Failed to load Ollama models:", err);
        this.embeddingsError = err.message || "Failed to connect to Ollama";
      } finally {
        this.ollamaModelsLoading = false;
      }
    },

    /**
     * Reset all inline Memory UI state (M6-S9)
     */
    resetMemoryUI() {
      this.showPluginSelector = false;
      this.showOllamaSetup = false;
      this.showErrorReconfigure = false;
      this.embeddingsError = null;
      this.ollamaModels = [];
      this.ollamaModel = "";
    },

    /**
     * Select a plugin from inline options (M6-S9)
     */
    selectPlugin(pluginId) {
      if (pluginId === "embeddings-ollama") {
        // Show Ollama setup form inline
        this.showOllamaSetup = true;
        this.showPluginSelector = false;
        this.showErrorReconfigure = false;
        this.ollamaModels = [];
        this.ollamaModel = "";
      } else {
        // Activate immediately for non-Ollama plugins
        this.activatePlugin(pluginId);
      }
    },

    /**
     * Activate a plugin (disabled/local) and close config
     */
    async activatePlugin(pluginId) {
      this.embeddingsActivating = true;
      this.embeddingsError = null;

      try {
        // Save config
        const configPayload =
          pluginId === "none"
            ? { plugin: "disabled" }
            : pluginId === "embeddings-local"
              ? { plugin: "local" }
              : null;

        if (configPayload) {
          const configRes = await fetch("/api/memory/embeddings/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(configPayload),
          });
          if (!configRes.ok) {
            throw new Error("Failed to save config");
          }
        }

        // Activate plugin
        const res = await fetch("/api/memory/embeddings/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pluginId }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Activation failed");

        // Close config on success
        this.resetMemoryUI();
      } catch (err) {
        console.error("[App] Plugin activation failed:", err);
        this.embeddingsError = err.message || "Activation failed";
      } finally {
        this.embeddingsActivating = false;
      }
    },

    /**
     * Set up Ollama with current host/model settings (M6-S9: Setup form)
     */
    async setupOllama() {
      if (!this.ollamaModel) {
        this.embeddingsError = "Please select a model";
        return;
      }

      this.embeddingsActivating = true;
      this.embeddingsError = null;

      try {
        // Save config first
        const configRes = await fetch("/api/memory/embeddings/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plugin: "ollama",
            host: this.ollamaHost,
            model: this.ollamaModel,
          }),
        });

        if (!configRes.ok) {
          const data = await configRes.json();
          throw new Error(data.error || "Failed to save config");
        }

        // Then activate
        const res = await fetch("/api/memory/embeddings/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pluginId: "embeddings-ollama",
            ollamaHost: this.ollamaHost,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Activation failed");

        // Close config on success
        this.resetMemoryUI();
      } catch (err) {
        console.error("[App] Setup Ollama failed:", err);
        this.embeddingsError = err.message || "Setup failed";
      } finally {
        this.embeddingsActivating = false;
      }
    },

    /**
     * Test model load by performing a search (M6-S9: Active state action)
     */
    async testModelLoad() {
      try {
        const res = await fetch("/api/memory/search?q=test&maxResults=1");
        if (res.ok) {
          this.showNotification?.("Model loaded successfully!", "success");
        } else {
          this.showNotification?.("Model load test failed", "error");
        }
      } catch (err) {
        this.showNotification?.(
          "Model load test failed: " + err.message,
          "error",
        );
      }
    },

    /**
     * Delete downloaded local embeddings model to free disk space
     */
    async deleteLocalModel() {
      if (
        !confirm(
          "Delete the local embeddings model? You can re-download it later by activating the local plugin.",
        )
      )
        return;
      this.localModelDeleting = true;
      this.localModelDeleteResult = null;
      try {
        const res = await fetch("/api/admin/memory/embeddings/local-model", {
          method: "DELETE",
          headers: { "X-Confirm-Destructive": "true" },
        });
        const data = await res.json();
        if (res.ok) {
          this.localModelDeleteResult = {
            success: true,
            message: `Deleted — freed ${data.freedMB || 0} MB`,
          };
        } else {
          this.localModelDeleteResult = {
            success: false,
            message: data.error || "Delete failed",
          };
        }
      } catch (err) {
        this.localModelDeleteResult = {
          success: false,
          message: err.message || "Request failed",
        };
      } finally {
        this.localModelDeleting = false;
      }
    },

    /**
     * Load notebook tree
     */
    async loadNotebookTree() {
      this.notebookLoading = true;
      try {
        const res = await fetch("/api/notebook");
        if (res.ok) {
          const data = await res.json();
          this.notebookTree = data.tree || [];
        }
      } catch (err) {
        console.error("[App] Failed to load notebook tree:", err);
        this.notebookTree = [];
      } finally {
        this.notebookLoading = false;
      }
    },

    /**
     * Load skills list (M6.8-S6)
     */
    async loadSkills() {
      this.skillsLoading = true;
      try {
        const res = await fetch("/api/skills");
        if (res.ok) {
          const data = await res.json();
          this.skillsList = data.skills || [];
        }
      } catch (err) {
        console.error("[App] Failed to load skills:", err);
        this.skillsList = [];
      } finally {
        this.skillsLoading = false;
      }
    },

    async toggleSkill(name) {
      try {
        const res = await fetch(
          `/api/skills/${encodeURIComponent(name)}/toggle`,
          { method: "POST" },
        );
        if (res.ok) {
          const data = await res.json();
          const skill = this.skillsList.find((s) => s.name === name);
          if (skill) skill.disabled = data.disabled;
          if (this.selectedSkill?.name === name)
            this.selectedSkill.disabled = data.disabled;
        }
      } catch (err) {
        console.error("[App] Failed to toggle skill:", err);
      }
    },

    async deleteSkill(name) {
      if (!confirm(`Delete skill "${name}"? This cannot be undone.`)) return;
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        if (res.ok) {
          this.skillsList = this.skillsList.filter((s) => s.name !== name);
          if (this.selectedSkill?.name === name) this.selectedSkill = null;
        }
      } catch (err) {
        console.error("[App] Failed to delete skill:", err);
      }
    },

    async viewSkill(name) {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
        if (res.ok) {
          this.selectedSkill = await res.json();
          this.skillEditMode = false;
          this.selectedNotebookFile = null;
          if (this.activeTab !== "notebook-browser") {
            this.openNotebookBrowser();
          }
        }
      } catch (err) {
        console.error("[App] Failed to load skill:", err);
      }
    },

    async saveSkill(name, description, content) {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description, content }),
        });
        if (res.ok) {
          const updated = await res.json();
          this.selectedSkill = updated;
          this.skillEditMode = false;
          const idx = this.skillsList.findIndex((s) => s.name === name);
          if (idx >= 0) {
            this.skillsList[idx].description = updated.description;
            this.skillsList[idx].disabled = updated.disabled;
          }
        }
      } catch (err) {
        console.error("[App] Failed to save skill:", err);
      }
    },

    /**
     * Set notebook widget tab and persist to sessionStorage
     */
    setNotebookTab(tab) {
      this.notebookTab = tab;
      sessionStorage.setItem("notebookTab", tab);
    },

    /**
     * Load notebook widget content for homepage tabbed view
     * Fetches content for each category tab
     */
    async loadNotebookWidgetContent() {
      this.notebookWidgetLoading = true;
      try {
        // Fetch notebook tree first to know which files exist (avoids 404 spam)
        let existingPaths = new Set();
        try {
          const treeRes = await fetch("/api/notebook");
          if (treeRes.ok) {
            const tree = await treeRes.json();
            const collectPaths = (items) => {
              for (const item of items || []) {
                if (item.type === "file" && item.path)
                  existingPaths.add(item.path);
                if (item.children) collectPaths(item.children);
              }
            };
            // Response shape: { tree: [...], summary: {...}, notebookDir }
            collectPaths(tree.tree || []);
          }
        } catch (_) {
          // Tree fetch failed — fall back to fetching all (will get 404s but handle gracefully)
        }

        const todayPath = `daily/${new Date().toISOString().slice(0, 10)}.md`;
        const filesToFetch = [
          "operations/standing-orders.md",
          "operations/external-communications.md",
          "lists/reminders.md",
          "reference/contacts.md",
          todayPath,
        ];

        // Only fetch files that are known to exist (if tree loaded), otherwise fetch all
        const fetchFile = async (path) => {
          if (existingPaths.size > 0 && !existingPaths.has(path)) return null;
          try {
            // Do NOT encodeURIComponent — the route is a wildcard /*
            // and the server expects the raw path with forward slashes intact
            const res = await fetch(`/api/notebook/${path}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.content || null;
          } catch (_) {
            return null;
          }
        };

        const [
          standingOrdersRes,
          externalCommsRes,
          remindersRes,
          contactsRes,
          todayRes,
        ] = await Promise.all(filesToFetch.map(fetchFile));

        // Results are already string | null from fetchFile()
        const standingOrders = standingOrdersRes;
        const externalComms = externalCommsRes;
        const reminders = remindersRes;
        const contacts = contactsRes;
        const dailyLog = todayRes;

        // Combine content for each tab
        // Orders: standing-orders + external-communications
        let ordersContent = "";
        if (standingOrders) {
          ordersContent += standingOrders;
        }
        if (externalComms) {
          if (ordersContent) ordersContent += "\n\n---\n\n";
          ordersContent += externalComms;
        }

        // Lists: reminders + contacts
        let listsContent = "";
        if (reminders) {
          listsContent += reminders;
        }
        if (contacts) {
          if (listsContent) listsContent += "\n\n---\n\n";
          listsContent += contacts;
        }

        this.notebookWidgetContent = {
          orders: ordersContent || null,
          lists: listsContent || null,
          daily: dailyLog || null,
          knowledge: null, // TODO: Load knowledge files
        };

        // Load knowledge files separately (may have multiple files)
        this.loadNotebookKnowledge();
      } catch (err) {
        console.error("[App] Failed to load notebook widget content:", err);
      } finally {
        this.notebookWidgetLoading = false;
      }
    },

    /**
     * Load knowledge files for widget
     */
    async loadNotebookKnowledge() {
      try {
        const res = await fetch("/api/notebook");
        if (!res.ok) return;

        const data = await res.json();
        const knowledgeFolder = (data.tree || []).find(
          (f) => f.name === "knowledge" && f.type === "folder",
        );

        if (knowledgeFolder && knowledgeFolder.children?.length > 0) {
          // Get content from first knowledge file
          const firstFile = knowledgeFolder.children.find(
            (f) => f.type === "file",
          );
          if (firstFile) {
            const fileRes = await fetch(
              `/api/notebook/${encodeURIComponent(firstFile.path)}`,
            );
            if (fileRes.ok) {
              const fileData = await fileRes.json();
              this.notebookWidgetContent.knowledge = fileData.content || null;
            }
          }
        }
      } catch (err) {
        console.error("[App] Failed to load knowledge files:", err);
      }
    },

    /**
     * Open notebook file from current widget tab
     */
    openNotebookFileFromTab() {
      // Map tab to file path
      const tabToPath = {
        orders: "operations/standing-orders.md",
        lists: "lists/reminders.md",
        daily: `daily/${new Date().toISOString().slice(0, 10)}.md`,
        knowledge: null, // Will find first knowledge file
      };

      const path = tabToPath[this.notebookTab];
      if (path) {
        this.openNotebookBrowser();
        // Slight delay to let tab open
        setTimeout(() => {
          this.openNotebookFile(path, path.split("/").pop());
        }, 100);
      } else if (this.notebookTab === "knowledge") {
        // Open notebook browser to knowledge section
        this.openNotebookBrowser();
      }
    },

    /**
     * Search memory (notebook + daily)
     */
    async searchMemory() {
      if (!this.memorySearchQuery.trim()) {
        this.memorySearchResults = null;
        return;
      }

      this.memorySearching = true;
      try {
        const q = encodeURIComponent(this.memorySearchQuery.trim());
        const res = await fetch(`/api/memory/search?q=${q}&maxResults=20`);
        if (res.ok) {
          this.memorySearchResults = await res.json();
        }
      } catch (err) {
        console.error("[App] Failed to search memory:", err);
        this.memorySearchResults = { notebook: [], daily: [], totalResults: 0 };
      } finally {
        this.memorySearching = false;
      }
    },

    /**
     * Open notebook browser tab
     */
    openSpaceDetail(name) {
      const tabId = `space-${name}`;
      this.openTab({
        id: tabId,
        type: "space",
        title: name,
        icon: ICONS.folder,
        closeable: true,
        data: { name },
      });
    },

    openSpacesBrowser() {
      this.openTab({
        id: "spaces-browser",
        type: "spaces-browser",
        title: "Spaces",
        icon: ICONS.folder,
        closeable: true,
      });
    },

    async loadSpaceDetail(name) {
      const tab = this.openTabs.find((t) => t.id === `space-${name}`);
      if (!tab) return;
      tab.loading = true;
      this.openTabs = [...this.openTabs];
      try {
        const resp = await fetch(`/api/spaces/${encodeURIComponent(name)}`);
        const data = await resp.json();
        tab.data = { ...tab.data, ...data, loaded: true };
        tab.selectedFile = null;
        tab.fileContent = null;
      } catch (err) {
        console.error("Failed to load space:", err);
      }
      tab.loading = false;
      this.openTabs = [...this.openTabs];
    },

    runToolSpace(spaceName) {
      this.sendMessage(`Run ${spaceName}`);
    },

    async updateSpaceField(name, field, value) {
      try {
        const resp = await fetch(`/api/spaces/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        const data = await resp.json();
        // Update local tab data with new manifest
        const tab = this.openTabs.find((t) => t.id === `space-${name}`);
        if (tab && data.manifest) {
          tab.data.manifest = data.manifest;
          this.openTabs = [...this.openTabs];
        }
      } catch (err) {
        console.error("Failed to update space:", err);
      }
    },

    async addSpaceTag(name, tag) {
      const tab = this.openTabs.find((t) => t.id === `space-${name}`);
      const currentTags = tab?.data?.manifest?.tags || [];
      if (tag && !currentTags.includes(tag)) {
        await this.updateSpaceField(name, "tags", [...currentTags, tag]);
      }
    },

    async removeSpaceTag(name, tag) {
      const tab = this.openTabs.find((t) => t.id === `space-${name}`);
      const currentTags = tab?.data?.manifest?.tags || [];
      await this.updateSpaceField(
        name,
        "tags",
        currentTags.filter((t) => t !== tag),
      );
    },

    async updateMaintenancePolicy(tab, newPolicy) {
      const maintenance = {
        ...tab.data.manifest.maintenance,
        on_failure: newPolicy,
      };
      tab.data.manifest.maintenance = maintenance;
      await this.updateSpaceField(tab.data.name, "maintenance", maintenance);
    },

    async loadSpaceFile(tabId, filePath) {
      const tab = this.openTabs.find((t) => t.id === tabId);
      if (!tab) return;
      const name = tab.data.name;
      try {
        const resp = await fetch(
          `/api/spaces/${encodeURIComponent(name)}/file?path=${encodeURIComponent(filePath)}`,
        );
        const data = await resp.json();
        tab.selectedFile = filePath;
        tab.fileContent = data.content;
        tab.fileExtension = data.extension;
        this.openTabs = [...this.openTabs];
      } catch (err) {
        console.error("Failed to load file:", err);
      }
    },

    // ─── Timeline Navigation ──────────────────────────────────────────

    openTimelineItem(item) {
      if (item.itemType === "event") {
        // Calendar events — open calendar tab or popover
        if (this.$store.mobile.isMobile) {
          this.$store.mobile.openPopoverWithFocus("calendar", null);
        } else {
          this.switchTab("calendar");
        }
        return;
      }
      // Jobs and projected items — open parent automation detail
      if (item.automationId) {
        if (this.$store.mobile.isMobile) {
          // Open automations popover with this automation pre-selected
          this.$store.mobile.openPopoverWithFocus("automations-browser", {
            autoSelectId: item.automationId,
          });
        } else {
          this.openAutomationDetail(item.automationId);
        }
      }
    },

    // ─── Automations ───────────────────────────────────────────────────

    openAutomationDetail(id) {
      const tabId = `automation-${id}`;
      const automation = Alpine.store("automations").items.find(
        (a) => a.id === id,
      );
      this.openTab({
        id: tabId,
        type: "automation",
        title: automation?.name || id,
        icon: ICONS.fire,
        closeable: true,
        data: { automationId: id },
      });
    },

    openAutomationsBrowser() {
      this.openTab({
        id: "automations-browser",
        type: "automations-browser",
        title: "Automations",
        icon: ICONS.fire,
        closeable: true,
      });
    },

    async loadAutomationDetail(id) {
      const tab = this.openTabs.find((t) => t.id === `automation-${id}`);
      if (!tab) return;
      tab.loading = true;
      this.openTabs = [...this.openTabs];
      try {
        const resp = await fetch(`/api/automations/${encodeURIComponent(id)}`);
        const data = await resp.json();
        // Restructure flat API response into the shape the template expects:
        // tab.data.manifest.{name,status,...} and tab.data.instructions
        tab.data = {
          ...tab.data,
          automationId: data.id || id,
          manifest: {
            name: data.name,
            status: data.status,
            trigger: data.trigger,
            spaces: data.spaces,
            model: data.model,
            notify: data.notify,
            autonomy: data.autonomy,
            once: data.once,
            delivery: data.delivery,
            created: data.created,
          },
          instructions: data.instructions,
          jobs: data.jobs,
          jobHistory: [],
          jobHistoryLoading: true,
          loaded: true,
        };
        this.openTabs = [...this.openTabs];

        // Fetch job history from timeline API
        this.loadAutomationJobHistory(id);
      } catch (err) {
        console.error("Failed to load automation:", err);
      }
      tab.loading = false;
      this.openTabs = [...this.openTabs];
    },

    async loadAutomationJobHistory(automationId) {
      const tab = this.openTabs.find(
        (t) => t.id === `automation-${automationId}`,
      );
      if (!tab) return;
      try {
        const resp = await fetch(
          `/api/timeline?automationId=${encodeURIComponent(automationId)}&limit=20`,
        );
        const data = await resp.json();
        const history = [];

        // Past jobs
        for (const job of data.pastJobs || []) {
          const duration =
            job.completed && job.created
              ? formatDuration(new Date(job.completed) - new Date(job.created))
              : null;
          history.push({
            id: job.id,
            automationName: job.automationName,
            status: job.status,
            created: job.created,
            completed: job.completed,
            summary: job.summary,
            duration,
          });
        }

        // Future projected runs
        for (const run of data.futureRuns || []) {
          history.push({
            id: run.id,
            automationName: run.automationName,
            status: "scheduled",
            scheduledFor: run.scheduledFor,
            summary: "Scheduled run",
          });
        }

        tab.data.jobHistory = history;
        tab.data.jobHistoryLoading = false;
        this.openTabs = [...this.openTabs];
      } catch (err) {
        console.error("Failed to load job history:", err);
        tab.data.jobHistoryLoading = false;
        this.openTabs = [...this.openTabs];
      }
    },

    async fireAutomation(id) {
      try {
        const resp = await fetch(
          `/api/automations/${encodeURIComponent(id)}/fire`,
          {
            method: "POST",
          },
        );
        if (!resp.ok) {
          console.error("Failed to fire automation:", await resp.text());
        }
      } catch (err) {
        console.error("Failed to fire automation:", err);
      }
    },

    // ─── Notebook ────────────────────────────────────────────────────────

    openNotebookBrowser() {
      // Check if already open
      const existing = this.openTabs.find((t) => t.id === "notebook-browser");
      if (existing) {
        this.switchTab("notebook-browser");
        return;
      }

      // Open new notebook browser tab
      this.openTab({
        id: "notebook-browser",
        type: "notebook-browser",
        title: "Notebook",
        icon: ICONS.notebook,
        closeable: true,
      });

      // Load tree when opening
      this.loadNotebookTree();
    },

    /**
     * Open a notebook file in the preview panel
     */
    async openNotebookFile(path, name) {
      this.selectedNotebookFile = {
        path,
        name,
        content: null,
        loading: true,
      };

      try {
        const res = await fetch(`/api/notebook/${encodeURIComponent(path)}`);
        if (res.ok) {
          const data = await res.json();
          this.selectedNotebookFile = {
            path,
            name,
            content: data.content || "",
            loading: false,
          };
        } else {
          this.selectedNotebookFile = {
            path,
            name,
            content: null,
            loading: false,
          };
        }
      } catch (err) {
        console.error("[App] Failed to load notebook file:", err);
        this.selectedNotebookFile = {
          path,
          name,
          content: null,
          loading: false,
        };
      }
    },

    /**
     * Open memory search tab
     */
    openMemorySearch() {
      // Check if already open
      const existing = this.openTabs.find((t) => t.id === "memory-search");
      if (existing) {
        this.switchTab("memory-search");
        return;
      }

      // Open new memory search tab
      this.openTab({
        id: "memory-search",
        type: "memory-search",
        title: "Memory Search",
        icon: ICONS.search,
        closeable: true,
      });
    },

    /**
     * Save notebook file content
     */
    async saveNotebookFile(path, content) {
      try {
        const res = await fetch(`/api/notebook/${encodeURIComponent(path)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save");
        }

        console.log("[App] Notebook file saved:", path);
        return true;
      } catch (err) {
        console.error("[App] Failed to save notebook file:", err);
        alert("Failed to save: " + err.message);
        return false;
      }
    },
  };
}
