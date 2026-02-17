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
    agentName: "Agent", // Loaded from server in init()
    isHatching: false, // True during hatching flow
    pendingControlMsgId: null, // Message ID that has active controls

    // Compose bar dynamic state
    composeHintControlId: null, // When set, Enter sends control_response
    composePlaceholder: "", // Dynamic placeholder from server
    composePasswordMode: false, // Toggles password masking

    // Conversation state
    conversations: [],
    currentConversationId: null,
    sidebarOpen: true,
    sidebarWidth: 260,
    sidebarDragging: false,

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

    // Image lightbox
    lightboxImage: null,

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

    get modelDisplayName() {
      const model = this.modelOptions.find((m) => m.id === this.selectedModel);
      return model ? model.name : "Sonnet 4.5";
    },

    get isHaikuModel() {
      return this.selectedModel.includes("haiku");
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

      // Load agent name and check hatching status
      fetch("/api/hatching/status")
        .then((r) => r.json())
        .then((data) => {
          if (data.hatched && data.agentName) {
            this.agentName = data.agentName;
          } else {
            this.isHatching = true;
          }
        })
        .catch(() => {});

      // Load channels
      this.fetchChannels();

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
        const msg = {
          type: "message",
          content: text,
          reasoning,
          model: this.selectedModel,
        };
        if (wsAttachments) {
          msg.attachments = wsAttachments;
        }
        this.ws.send(msg);
      }

      // Update sidebar timestamp for current conversation
      this.touchCurrentConversation();

      // Reset compose bar state
      this.inputText = "";
      this.attachments = [];
      this.composeHintControlId = null;
      this.composePlaceholder = "";
      this.composePasswordMode = false;
      this.isResponding = true;

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
          // Update sidebar conversation list
          this.conversations = data.conversations;
          break;

        case "conversation_created":
          // Add to sidebar list
          this.conversations.unshift(data.conversation);

          // Only switch to it if THIS client created it
          if (
            this._pendingNewConversation ||
            this.currentConversationId === null
          ) {
            this.currentConversationId = data.conversation.id;
            this._pendingNewConversation = false;
          }
          break;

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
          // If it was the current conversation, show empty state
          if (this.currentConversationId === data.conversationId) {
            this.currentConversationId = null;
            this.resetChatState();
          }
          break;

        case "channel_status_changed": {
          // Update channel status dot in real-time
          const ch = this.channels.find((c) => c.id === data.channelId);
          if (ch) {
            ch.status = data.status;
            ch.reconnectAttempts = data.reconnectAttempts;
          }
          break;
        }

        default:
          console.warn("[App] Unknown message type:", data.type);
      }
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
    // Sidebar resize
    // ─────────────────────────────────────────────────────────────────
    startSidebarDrag(e) {
      if (!this.sidebarOpen) return;
      e.preventDefault();
      this.sidebarDragging = true;
      document.body.classList.add("sidebar-resizing");
      const onMove = (ev) => {
        const x = ev.clientX;
        this.sidebarWidth = Math.min(Math.max(x, 180), 500);
      };
      const onUp = () => {
        this.sidebarDragging = false;
        document.body.classList.remove("sidebar-resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
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
  };
}
