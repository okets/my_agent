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
    wsConnected: false,
    ws: null,
    messageIdCounter: 0,
    currentAssistantMessage: null, // Track the message being streamed
    currentThinkingText: "", // Accumulates thinking deltas for current message
    isThinking: false, // True while thinking block is active
    agentName: "Agent", // Full name, loaded from server in init()
    agentNickname: "Agent", // Short name for casual use (e.g., buttons)
    isHatching: false, // True during hatching flow
    pendingControlMsgId: null, // Message ID that has active controls

    // Compose bar dynamic state
    composeHintControlId: null, // When set, Enter sends control_response
    composePlaceholder: "", // Dynamic placeholder from server
    composePasswordMode: false, // Toggles password masking

    // Conversation state
    conversations: [],
    channelConversations: [],
    currentConversationId: null,

    // Title editing
    editingTitle: false,
    editTitleValue: "",

    // Action bar state
    selectedModel: "claude-sonnet-4-5-20250929",
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
      { id: "home", type: "home", title: "Home", icon: "🏠", closeable: false },
    ],
    activeTab: "home",

    // Chat context (pinned tab context, sent to Nina with messages)
    chatContext: null, // { type, title, icon, file?, conversationId? }

    // Chat panel (right side)
    chatWidth: 400,
    chatResizing: false,

    // QR pairing state
    pairingChannelId: null,
    qrCodeDataUrl: null,

    // Add channel form state
    showAddChannel: false,
    addingChannel: false,
    addChannelError: null,
    newChannel: { id: "" },

    // Authorization tokens: { channelId: "TOKEN" }
    authTokens: {},

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
    // Task state (M5-S6)
    // ─────────────────────────────────────────────────────────────────
    tasks: [], // All tasks (loaded from API)
    tasksLoading: false, // Loading indicator
    tasksFilter: { status: null, type: null }, // Active filters
    showCreateTaskForm: false, // Create task modal
    createTaskForm: {
      title: "",
      instructions: "",
      type: "immediate",
      scheduledFor: "",
    },

    modelOptions: [
      { id: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5" },
      { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5" },
      { id: "claude-opus-4-6", name: "Opus 4.6" },
    ],

    // ─────────────────────────────────────────────────────────────────
    // Computed
    // ─────────────────────────────────────────────────────────────────
    get canSend() {
      const hasContent =
        this.inputText.trim().length > 0 || this.attachments.length > 0;
      // Can't send in read-only channel conversations
      const conv = this.findConversation(this.currentConversationId);
      if (conv && this.isReadOnlyConversation(conv)) {
        return false;
      }
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
      if (!this.currentConversationId) return false;
      const conv = this.findConversation(this.currentConversationId);
      return conv ? this.isReadOnlyConversation(conv) : false;
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

      // Load UI state from localStorage (tabs, chat width)
      this.loadUIState();

      // Load input history from sessionStorage
      this.loadInputHistory();

      // Initialize theme
      this.initTheme();

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

      // Load channels
      this.fetchChannels();

      // Load calendar config and today's events
      this.loadCalendarConfig();
      this.loadTodayEvents();

      // Load tasks (M5-S6)
      this.loadTasks();

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

          // Send connect message to get conversation list
          this.ws.send({ type: "connect" });
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
      // Reset chat immediately so the UI switches to the empty state
      this.resetChatState();
      this.currentConversationId = null;
      this._pendingNewConversation = true;
      this.ws.send({ type: "new_conversation" });
      this.$nextTick(() => {
        this.$refs.chatInput?.focus();
      });
    },

    switchConversation(conversationId) {
      if (!this.wsConnected || conversationId === this.currentConversationId)
        return;
      this.ws.send({ type: "switch_conversation", conversationId });
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

      switch (data.type) {
        case "start":
          // Response is starting — show typing dots, defer bubble creation
          this.isResponding = true;
          this.currentThinkingText = "";
          this.isThinking = false;
          this.currentAssistantMessage = null;
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "text_delta":
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
          this.isResponding = false;
          this.isThinking = false;
          this.currentAssistantMessage = null;
          this.currentThinkingText = "";
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
            // Sync model from conversation (use default if not set)
            this.selectedModel =
              data.conversation.model || "claude-sonnet-4-5-20250929";
          } else {
            this.currentConversationId = null;
            // Reset to default model for new conversations
            this.selectedModel = "claude-sonnet-4-5-20250929";
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
            }));
          }

          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "conversation_list":
          // Update sidebar conversation list (web only)
          this.conversations = data.conversations;
          // Channel conversations shown under their channel
          if (data.channelConversations) {
            this.channelConversations = data.channelConversations;
          }
          break;

        case "conversation_created": {
          // Route to correct list based on channel and isPinned
          const isChannelConv =
            data.conversation.channel && data.conversation.channel !== "web";
          if (isChannelConv && data.conversation.isPinned !== false) {
            // Pinned channel conversation → channelConversations
            this.channelConversations.unshift(data.conversation);
          } else {
            // Web conversation OR unpinned channel conversation → conversations
            this.conversations.unshift(data.conversation);
          }

          // Only switch to it if THIS client created it
          if (
            this._pendingNewConversation ||
            this.currentConversationId === null
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
          // Remove from sidebar
          this.conversations = this.conversations.filter(
            (c) => c.id !== data.conversationId,
          );
          this.channelConversations = this.channelConversations.filter(
            (c) => c.id !== data.conversationId,
          );
          // If it was the current conversation, show empty state
          if (this.currentConversationId === data.conversationId) {
            this.currentConversationId = null;
            this.resetChatState();
          }
          break;

        case "conversation_unpinned": {
          // Move conversation from channelConversations to conversations
          const unpinnedConv = this.channelConversations.find(
            (c) => c.id === data.conversationId,
          );
          if (unpinnedConv) {
            unpinnedConv.isPinned = false;
            this.channelConversations = this.channelConversations.filter(
              (c) => c.id !== data.conversationId,
            );
            this.conversations.unshift(unpinnedConv);
          }
          break;
        }

        case "conversation_model_changed":
          // Update model if this is current conversation
          if (data.conversationId === this.currentConversationId) {
            this.selectedModel = data.model;
          }
          // Update in conversation lists
          const convToUpdateModel =
            this.conversations.find((c) => c.id === data.conversationId) ||
            this.channelConversations.find((c) => c.id === data.conversationId);
          if (convToUpdateModel) {
            convToUpdateModel.model = data.model;
          }
          break;

        case "channel_status_changed": {
          // Update channel status dot in real-time
          const ch = this.channels.find((c) => c.id === data.channelId);
          if (ch) {
            ch.status = data.status;
            ch.reconnectAttempts = data.reconnectAttempts;
            // Clear QR state if channel connected
            if (
              data.status === "connected" &&
              this.pairingChannelId === data.channelId
            ) {
              this.pairingChannelId = null;
              this.qrCodeDataUrl = null;
            }
          }
          break;
        }

        case "channel_qr_code": {
          // QR code received from server during pairing
          if (data.channelId === this.pairingChannelId) {
            this.qrCodeDataUrl = data.qrDataUrl;
          }
          break;
        }

        case "channel_paired": {
          // Channel successfully paired — clear QR, request auth token
          if (data.channelId === this.pairingChannelId) {
            this.pairingChannelId = null;
            this.qrCodeDataUrl = null;
          }
          // Refresh channel list to get updated status
          this.fetchChannels();
          // Auto-request authorization token if channel has no owner yet
          this.requestAuthToken(data.channelId);
          break;
        }

        case "channel_authorized": {
          // Owner verified via token — clear token, refresh channels
          delete this.authTokens[data.channelId];
          this.fetchChannels();
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
          break;
        }

        // Notification events (M5-S4)
        case "notification": {
          // New or updated notification
          const notification = data.notification;
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
          this.notifications = data.notifications;
          this.pendingNotificationCount = data.pendingCount;
          break;
        }

        // Task events (M5-S6)
        case "task:created":
        case "task:updated":
        case "task:completed":
        case "task:deleted": {
          // Refresh task list when tasks change
          this.loadTasks();

          // Update task in open tab if applicable
          if (data.task) {
            const tabId = `task-${data.task.id}`;
            const tab = this.openTabs.find((t) => t.id === tabId);
            if (tab) {
              tab.data.task = data.task;
              tab.title = data.task.title;
            }
          }
          break;
        }

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
          ADD_ATTR: ["target", "rel"],
        });
        // Add target="_blank" to all links
        return clean.replace(
          /<a /g,
          '<a target="_blank" rel="noopener noreferrer" ',
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
        const container = this.$refs.messagesContainer;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
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
        icon: "📝",
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
        icon: "💬",
        closeable: true,
        data: {
          conversationId: conv.id,
        },
      });
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
              icon: "🏠",
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
      fetch("/api/channels")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            this.channels = data.map((ch) => ({
              ...ch,
              reconnectAttempts: ch.statusDetail?.reconnectAttempts ?? 0,
            }));
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

    channelTooltip(ch) {
      let tip = ch.status || "unknown";
      if (ch.reconnectAttempts > 0) {
        tip += ` (attempt ${ch.reconnectAttempts})`;
      }
      return tip;
    },

    /** Get channel info for a conversation (returns null for web conversations) */
    getConversationChannel(conv) {
      if (!conv.channel || conv.channel === "web") return null;
      return this.channels.find((ch) => ch.id === conv.channel) || null;
    },

    /** Check if a conversation is read-only (pinned channel conversations only) */
    isReadOnlyConversation(conv) {
      // Only pinned channel conversations are read-only
      // Unpinned channel conversations can be continued via dashboard
      return conv.channel && conv.channel !== "web" && conv.isPinned !== false;
    },

    /** Get channel conversations for a specific channel */
    getChannelConversations(channelId) {
      return this.channelConversations.filter((c) => c.channel === channelId);
    },

    /** Find a conversation by ID across both web and channel lists */
    findConversation(id) {
      return (
        this.conversations.find((c) => c.id === id) ||
        this.channelConversations.find((c) => c.id === id) ||
        null
      );
    },

    // ─────────────────────────────────────────────────────────────────
    // Settings / Channel actions
    // ─────────────────────────────────────────────────────────────────

    async addChannel() {
      if (!this.newChannel.id) return;
      this.addingChannel = true;
      this.addChannelError = null;

      try {
        const res = await fetch("/api/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: this.newChannel.id.trim().replace(/\s+/g, "_").toLowerCase(),
            plugin: "baileys",
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          this.addChannelError = data.error || "Failed to create channel";
          return;
        }

        // Add to local channels list
        this.channels.push(data);

        // Reset form and trigger pairing
        const channelId = data.id;
        this.showAddChannel = false;
        this.newChannel = { id: "" };

        // Auto-trigger QR pairing
        await this.pairChannel(channelId);
      } catch (err) {
        console.error("[App] Add channel failed:", err);
        this.addChannelError = "Network error. Is the server running?";
      } finally {
        this.addingChannel = false;
      }
    },

    async pairChannel(channelId) {
      this.pairingChannelId = channelId;
      this.qrCodeDataUrl = null;
      try {
        const res = await fetch(`/api/channels/${channelId}/pair`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("[App] Pair failed:", data.error || res.statusText);
          this.pairingChannelId = null;
        }
        // QR code will arrive via WebSocket channel_qr_code event
      } catch (err) {
        console.error("[App] Pair request failed:", err);
        this.pairingChannelId = null;
      }
    },

    async requestAuthToken(channelId) {
      try {
        const res = await fetch(`/api/channels/${channelId}/authorize`, {
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

    async disconnectChannel(channelId) {
      try {
        const res = await fetch(`/api/channels/${channelId}/disconnect`, {
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
          icon: "📅",
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
        icon: "📅",
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
        }
      } else {
        // Create new event
        const result = await CalendarModule.createCalendarEvent(eventData);
        if (result) {
          this.calendar?.refetchEvents();
          this.loadTodayEvents();
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
      }
      return !!result;
    },

    /**
     * Open event in a dedicated tab (Outlook-style appointment view)
     */
    openEventTab(event) {
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
        icon: "📅",
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
        icon: "📅",
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
    // Task Methods (M5-S6)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Load tasks from API
     */
    async loadTasks() {
      this.tasksLoading = true;
      try {
        let url = "/api/tasks?";
        const params = [];

        if (this.tasksFilter.status) {
          params.push(`status=${this.tasksFilter.status}`);
        }
        if (this.tasksFilter.type) {
          params.push(`type=${this.tasksFilter.type}`);
        }

        url += params.join("&");

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          this.tasks = data.tasks || [];
        }
      } catch (err) {
        console.error("[App] Failed to load tasks:", err);
      } finally {
        this.tasksLoading = false;
      }
    },

    /**
     * Get filtered tasks for display
     */
    get filteredTasks() {
      return this.tasks;
    },

    /**
     * Open task in a detail tab
     */
    openTaskTab(task) {
      const tabId = `task-${task.id}`;

      // Check if already open
      const existing = this.openTabs.find((t) => t.id === tabId);
      if (existing) {
        this.switchTab(tabId);
        return;
      }

      // Open new task tab
      this.openTab({
        id: tabId,
        type: "task",
        title: task.title,
        icon: "📋",
        closeable: true,
        data: { task },
      });

      // Set chat context to this task
      this.chatContext = {
        type: "task",
        icon: "📋",
        title: task.title,
        taskId: task.id,
      };
    },

    /**
     * Get current task from active tab
     */
    getCurrentTask() {
      const tab = this.openTabs.find((t) => t.id === this.activeTab);
      return tab?.type === "task" ? tab.data?.task : null;
    },

    /**
     * Mark task as completed
     */
    async completeTask(taskId) {
      try {
        const body = {};
        if (this.currentConversationId) {
          body.conversationId = this.currentConversationId;
        }

        const res = await fetch(`/api/tasks/${taskId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          // Refresh tasks list
          await this.loadTasks();

          // Update task in tab if open
          const tab = this.openTabs.find((t) => t.id === `task-${taskId}`);
          if (tab?.data?.task) {
            const updated = await res.json();
            tab.data.task = updated;
          }
        }
      } catch (err) {
        console.error("[App] Failed to complete task:", err);
      }
    },

    /**
     * Delete task (soft delete)
     */
    async deleteTask(taskId) {
      const task = this.tasks.find((t) => t.id === taskId);
      const confirmed = confirm(`Delete "${task?.title || "this task"}"?`);
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "DELETE",
        });

        if (res.ok) {
          // Refresh tasks list
          await this.loadTasks();

          // Close task tab if open
          this.closeTab(`task-${taskId}`);
        }
      } catch (err) {
        console.error("[App] Failed to delete task:", err);
      }
    },

    /**
     * Open create task form
     */
    openCreateTaskForm() {
      this.createTaskForm = {
        title: "",
        instructions: "",
        type: "immediate",
        scheduledFor: "",
      };
      this.showCreateTaskForm = true;
    },

    /**
     * Close create task form
     */
    closeCreateTaskForm() {
      this.showCreateTaskForm = false;
    },

    /**
     * Create a new task
     */
    async createTask() {
      if (!this.createTaskForm.title || !this.createTaskForm.instructions) {
        alert("Title and instructions are required");
        return;
      }

      try {
        const body = {
          type: this.createTaskForm.type,
          sourceType: "manual",
          title: this.createTaskForm.title,
          instructions: this.createTaskForm.instructions,
          createdBy: "user",
        };

        if (
          this.createTaskForm.type === "scheduled" &&
          this.createTaskForm.scheduledFor
        ) {
          body.scheduledFor = new Date(
            this.createTaskForm.scheduledFor,
          ).toISOString();
        }

        // Note: Manual task creation does NOT auto-link to current conversation.
        // Only brain-created tasks or explicit user actions should create links.

        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const task = await res.json();
          await this.loadTasks();
          this.closeCreateTaskForm();

          // Open the new task
          this.openTaskTab(task);
        }
      } catch (err) {
        console.error("[App] Failed to create task:", err);
      }
    },

    /**
     * Load conversations linked to a task
     */
    async loadTaskConversations(taskId) {
      try {
        const res = await fetch(`/api/tasks/${taskId}/conversations`);
        if (res.ok) {
          const data = await res.json();
          return data.conversations || [];
        }
      } catch (err) {
        console.error("[App] Failed to load task conversations:", err);
      }
      return [];
    },

    /**
     * Set filter for tasks
     */
    setTasksFilter(key, value) {
      this.tasksFilter[key] = value;
      this.loadTasks();
    },

    /**
     * Clear all task filters
     */
    clearTasksFilter() {
      this.tasksFilter = { status: null, type: null };
      this.loadTasks();
    },
  };
}
