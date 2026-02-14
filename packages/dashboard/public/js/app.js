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

    // ─────────────────────────────────────────────────────────────────
    // Computed
    // ─────────────────────────────────────────────────────────────────
    get canSend() {
      return (
        this.inputText.trim().length > 0 &&
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

    // ─────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────
    get greetingText() {
      if (this.isHatching) {
        return "Let's get started!";
      }
      return "Hey! I\u2019m " + this.agentName + ".";
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

    sendMessage() {
      const text = this.inputText.trim();
      if (!text || !this.wsConnected) {
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
        this.ws.send({
          type: "message",
          content: text,
        });
      }

      // Reset compose bar state
      this.inputText = "";
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
          // Response is starting — create a new assistant message
          this.isResponding = true;
          this.currentThinkingText = "";
          this.isThinking = false;
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
          this.$nextTick(() => {
            this.scrollToBottom();
          });
          break;

        case "text_delta":
          // Append text delta to current message
          if (this.currentAssistantMessage) {
            this.currentAssistantMessage.content += data.content;
            this.currentAssistantMessage.renderedContent = this.renderMarkdown(
              this.currentAssistantMessage.content,
            );
            this.$nextTick(() => {
              this.scrollToBottom();
            });
          }
          break;

        case "thinking_delta":
          // Append thinking delta to current thinking text
          if (this.currentAssistantMessage) {
            this.currentThinkingText += data.content;
            this.currentAssistantMessage.thinkingText =
              this.currentThinkingText;
            this.isThinking = true;
            this.$nextTick(() => {
              this.scrollToBottom();
            });
          }
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
  };
}
