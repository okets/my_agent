/**
 * Mobile layout store and gesture handling (M2-S7 → M5-S10)
 *
 * Manages:
 * - Chat ratio system (--chat-ratio: 8 / 50 / 92)
 * - Popover system (open / close with type + data)
 * - Keyboard height tracking (visualViewport API)
 * - Mobile detection (< 768px breakpoint)
 * - Touch gesture engine — real-time panel resizing via CSS custom property
 *
 * Architecture:
 *   The outer container is position: fixed (prevents pull-to-refresh).
 *   Two panels (content + chat) split the space below a 44px header.
 *   --chat-ratio (0-100) drives both panel heights via CSS calc().
 *   Gestures set --chat-ratio in real-time during drag, then snap
 *   to the nearest preset (8, 50, 92) on release.
 *
 * Initialized on 'alpine:init' alongside other stores.
 */

/* ── Constants ─────────────────────────────────────────────────── */

const CHAT_RATIO_PEEK = 8;
const CHAT_RATIO_HALF = 50;
const CHAT_RATIO_FULL = 92;
const CHAT_RATIO_PRESETS = [CHAT_RATIO_PEEK, CHAT_RATIO_HALF, CHAT_RATIO_FULL];

/* ── Helpers ───────────────────────────────────────────────────── */

function isMobileLayout() {
  return window.innerWidth < 768;
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Derive chatState name from the current ratio value.
 * Used for UI conditionals (showing/hiding drag handle, peek content, etc.)
 */
function ratioToState(ratio) {
  if (ratio <= 25) return "peek";
  if (ratio <= 75) return "half";
  return "full";
}

/**
 * Find the nearest preset ratio for a given value.
 */
function nearestPreset(ratio) {
  let best = CHAT_RATIO_PRESETS[0];
  let bestDist = Math.abs(ratio - best);
  for (let i = 1; i < CHAT_RATIO_PRESETS.length; i++) {
    const dist = Math.abs(ratio - CHAT_RATIO_PRESETS[i]);
    if (dist < bestDist) {
      best = CHAT_RATIO_PRESETS[i];
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Set --chat-ratio on the container element and update the store.
 * This is the single source of truth for panel sizing.
 */
function setChatRatio(ratio, skipTransition) {
  const clamped = Math.max(0, Math.min(100, ratio));
  document.documentElement.style.setProperty("--chat-ratio", clamped);

  const store = Alpine.store("mobile");
  if (store) {
    store._chatRatio = clamped;
    store.chatState = ratioToState(clamped);
  }
}

/* ── Alpine store ──────────────────────────────────────────────── */

document.addEventListener("alpine:init", () => {
  Alpine.store("mobile", {
    /* ── Reactive state ──────────────────────────────────────── */
    isMobile: isMobileLayout(),
    chatState: "peek", // derived from _chatRatio: 'peek' | 'half' | 'full'
    _chatRatio: CHAT_RATIO_PEEK,
    popover: null, // null | { type: string, data: any }
    keyboardHeight: 0,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,

    /* ── Chat sheet controls ─────────────────────────────────── */

    expandChat(state) {
      if (!this.isMobile) return;
      if (state !== "peek" && state !== "half" && state !== "full") return;

      // Close conv switcher if collapsing to peek
      if (state === "peek" && this.convSwitcherOpen) {
        this.convSwitcherOpen = false;
      }

      const ratio =
        state === "peek"
          ? CHAT_RATIO_PEEK
          : state === "half"
            ? CHAT_RATIO_HALF
            : CHAT_RATIO_FULL;
      setChatRatio(ratio);
    },

    collapseChat() {
      if (!this.isMobile) return;
      this.convSwitcherOpen = false;
      setChatRatio(CHAT_RATIO_PEEK);
    },

    toggleChat() {
      if (!this.isMobile) return;
      if (this.chatState === "peek") {
        this.expandChat("half");
      } else {
        this.collapseChat();
      }
    },

    /* ── Popover controls ────────────────────────────────────── */

    /**
     * Open a popover sheet. Replaces any currently open popover.
     * @param {string} type - 'task' | 'event' | 'calendar' | 'settings' | 'notebook' | 'notification'
     * @param {any} data - Contextual data for the popover content
     */
    openPopover(type, data) {
      if (!this.isMobile) return;

      this.popover = { type: type, data: data || null };

      // Set chat context tag (mirrors desktop tab behavior)
      this._setChatContext(type, data);
    },

    closePopover() {
      this.popover = null;
      this._clearChatContext();
    },

    /** Set chatContext on the main Alpine chat component */
    _setChatContext(type, data) {
      try {
        const chatEl = document.querySelector("[x-data]");
        if (!chatEl || !chatEl._x_dataStack) return;
        const appData = chatEl._x_dataStack[0];
        if (!appData) return;

        if (type === "task" && data) {
          appData.chatContext = {
            type: "task",
            icon: "\uD83D\uDCCB",
            title: data.title,
            taskId: data.id,
          };
        } else if (type === "event" && data) {
          appData.chatContext = {
            type: "event",
            icon: "\uD83D\uDCC5",
            title: data.title,
            eventId: data.id,
          };
        }
      } catch (e) {
        // Silently fail — context tag is non-critical
      }
    },

    /** Clear chatContext on the main Alpine chat component */
    _clearChatContext() {
      try {
        const chatEl = document.querySelector("[x-data]");
        if (!chatEl || !chatEl._x_dataStack) return;
        const appData = chatEl._x_dataStack[0];
        if (appData) {
          appData.chatContext = null;
        }
      } catch (e) {
        // Silently fail
      }
    },

    get isPopoverOpen() {
      return this.popover !== null;
    },

    /* ── Conversation switcher (full chat state) ───────────────── */
    convSwitcherOpen: false,

    openConvSwitcher() {
      if (!this.isMobile || this.chatState === "peek") return;
      this.convSwitcherOpen = true;
    },

    closeConvSwitcher() {
      this.convSwitcherOpen = false;
    },

    toggleConvSwitcher() {
      if (this.convSwitcherOpen) {
        this.closeConvSwitcher();
      } else {
        this.openConvSwitcher();
      }
    },

    /* ── Focus management ──────────────────────────────────────── */
    _triggerEl: null, // Element that opened the popover (for focus return)

    openPopoverWithFocus(type, data, triggerEl) {
      this._triggerEl = triggerEl || document.activeElement;
      this.openPopover(type, data);
    },

    closePopoverWithFocus() {
      const returnTo = this._triggerEl;
      this.closePopover();
      if (returnTo && typeof returnTo.focus === "function") {
        requestAnimationFrame(() => returnTo.focus());
      }
      this._triggerEl = null;
    },
  });

  // Set initial ratio on the document
  setChatRatio(CHAT_RATIO_PEEK);
});

/* ── Resize listener (mobile detection) ────────────────────────── */

window.addEventListener(
  "resize",
  debounce(() => {
    const store = Alpine.store("mobile");
    if (!store) return;

    const wasMobile = store.isMobile;
    store.isMobile = isMobileLayout();

    // Switching from mobile to desktop: reset mobile state
    if (wasMobile && !store.isMobile) {
      setChatRatio(CHAT_RATIO_PEEK);
      store.popover = null;
    }
  }, 150),
);

/* ── Keyboard tracking (visualViewport API) ────────────────────── */

if (window.visualViewport) {
  const updateKeyboardHeight = debounce(() => {
    const store = Alpine.store("mobile");
    if (!store || !store.isMobile) return;

    const keyboardHeight = Math.max(
      0,
      window.innerHeight - window.visualViewport.height,
    );
    store.keyboardHeight = keyboardHeight;
    document.documentElement.style.setProperty(
      "--keyboard-height",
      keyboardHeight + "px",
    );
  }, 16); // One frame

  window.visualViewport.addEventListener("resize", updateKeyboardHeight);
  window.visualViewport.addEventListener("scroll", updateKeyboardHeight);
}

/* ── Keyboard: auto-scroll messages and popover inputs ────────── */

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const store = Alpine.store("mobile");
    if (!store || !store.isMobile) return;

    const kbHeight = Math.max(
      0,
      window.innerHeight - window.visualViewport.height,
    );

    // Auto-scroll chat messages when keyboard opens in half/full state
    if (kbHeight > 100 && store.chatState !== "peek") {
      requestAnimationFrame(() => {
        const msgArea = document.querySelector(".chat-messages-area");
        if (msgArea) {
          msgArea.scrollTop = msgArea.scrollHeight;
        }
      });
    }

    // Scroll focused input into view within popover
    if (kbHeight > 100 && store.isPopoverOpen) {
      requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (
          focused &&
          (focused.tagName === "INPUT" ||
            focused.tagName === "TEXTAREA" ||
            focused.tagName === "SELECT") &&
          focused.closest(".popover-sheet")
        ) {
          focused.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  });
}

/* ── Aria-live announcements ──────────────────────────────────── */

/**
 * Announce a message to screen readers via an aria-live region.
 * Creates the region on first call.
 */
function announceMobile(message) {
  let region = document.getElementById("mobile-aria-live");
  if (!region) {
    region = document.createElement("div");
    region.id = "mobile-aria-live";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.className = "sr-only-close"; // Use existing visually-hidden class
    document.body.appendChild(region);
  }
  // Clear then set to trigger announcement
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

/* ── Focus trap utility ───────────────────────────────────────── */

/**
 * Create a focus trap within a container element.
 * Returns a cleanup function to remove the trap.
 */
function createFocusTrap(container) {
  function getFocusable() {
    return container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
  }

  function onKeyDown(e) {
    if (e.key !== "Tab") return;

    const focusable = getFocusable();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  container.addEventListener("keydown", onKeyDown);

  // Focus first focusable element or the container itself
  requestAnimationFrame(() => {
    const focusable = getFocusable();
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      container.setAttribute("tabindex", "-1");
      container.focus();
    }
  });

  return function cleanup() {
    container.removeEventListener("keydown", onKeyDown);
  };
}

/* ── Reduced motion listener ───────────────────────────────────── */

window
  .matchMedia("(prefers-reduced-motion: reduce)")
  .addEventListener("change", (e) => {
    const store = Alpine.store("mobile");
    if (store) {
      store.reducedMotion = e.matches;
    }
  });

/* ── Touch gesture engine ──────────────────────────────────────── */

/**
 * Attach drag-to-dismiss behavior to a sheet element.
 *
 * Usage (from Alpine x-init or x-effect):
 *   initSheetGesture(el, {
 *     onDismiss: () => Alpine.store('mobile').closePopover(),
 *     getScrollTop: () => el.querySelector('.popover-content')?.scrollTop ?? 0,
 *     dismissThreshold: 0.33,  // fraction of sheet height
 *     velocityThreshold: 500,  // px/s
 *   })
 *
 * Returns a cleanup function to remove event listeners.
 */
function initSheetGesture(el, options) {
  const opts = Object.assign(
    {
      onDismiss: () => {},
      onDragStart: () => {},
      onDragMove: () => {},
      onDragEnd: () => {},
      getScrollTop: () => 0,
      dismissThreshold: 0.33,
      velocityThreshold: 500,
      direction: "down", // "down" = swipe down to dismiss, "up" = swipe up to dismiss
    },
    options,
  );

  const isUp = opts.direction === "up";

  let startY = 0;
  let startTime = 0;
  let currentY = 0;
  let isDragging = false;
  let gestureAbandoned = false; // set when wrong-direction swipe detected
  let rafId = null;

  function onTouchStart(e) {
    // Only respond to single-finger touches
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    startY = touch.clientY;
    startTime = Date.now();
    currentY = 0;
    isDragging = false;
    gestureAbandoned = false;
  }

  function onTouchMove(e) {
    if (gestureAbandoned || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - startY;

    if (!isDragging) {
      const threshold = 10;

      // Wrong direction → abandon this gesture, let native scroll work
      if (isUp ? deltaY > threshold : deltaY < -threshold) {
        gestureAbandoned = true;
        return;
      }

      // Right direction → only start if at scroll boundary
      const shouldStart = isUp
        ? deltaY < -threshold
        : deltaY > threshold && opts.getScrollTop() <= 0;
      if (shouldStart) {
        isDragging = true;
        opts.onDragStart();
        e.preventDefault();
      } else {
        return;
      }
    }

    if (isDragging) {
      e.preventDefault();
      // Absolute distance in the dismiss direction
      currentY = isUp ? Math.max(0, -deltaY) : Math.max(0, deltaY);

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        opts.onDragMove(currentY);
      });
    }
  }

  function onTouchEnd() {
    gestureAbandoned = false;
    if (!isDragging) return;
    isDragging = false;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    const elapsed = Date.now() - startTime;
    const velocity = elapsed > 0 ? (currentY / elapsed) * 1000 : 0;
    const sheetHeight = el.offsetHeight;
    const fraction = sheetHeight > 0 ? currentY / sheetHeight : 0;

    opts.onDragEnd(currentY);

    // Dismiss if past threshold or flicked fast enough
    if (fraction > opts.dismissThreshold || velocity > opts.velocityThreshold) {
      opts.onDismiss();
    }
  }

  // Listen on the whole element — dismiss activates only when scrolled to top
  // and swiping in the dismiss direction
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd, { passive: true });

  // Return cleanup function
  return function cleanup() {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    if (rafId) cancelAnimationFrame(rafId);
  };
}

/**
 * Attach chat panel swipe gestures — percentage-based real-time resizing.
 *
 * Listens on the ENTIRE chat panel element — not just the drag handle.
 * This is critical for peek state where the drag handle is hidden.
 *
 * Gesture behavior:
 *   - During drag: sets --chat-ratio in real-time (percentage of container)
 *   - On release: snaps to nearest preset (8%, 50%, 92%)
 *   - Velocity detection: fast swipe skips to next/previous preset
 *
 * Direction logic by state:
 *   peek:  swipe up anywhere   → increase chat ratio
 *   half:  swipe up on handle  → increase toward full
 *          swipe down at top   → decrease toward peek
 *   full:  swipe down at top   → decrease toward half
 *
 * Usage:
 *   initChatSheetGesture(chatPanelEl)
 *
 * Returns a cleanup function.
 */
function initChatSheetGesture(el) {
  let startY = 0;
  let startTime = 0;
  let currentDelta = 0;
  let isDragging = false;
  let gestureDecided = false;
  let startRatio = CHAT_RATIO_PEEK;
  let containerHeight = 0;
  let rafId = null;

  function getStore() {
    return Alpine.store("mobile");
  }

  /**
   * Check if the scrollable message area is at the top.
   * Returns true if there are no messages or scroll position is 0.
   */
  function isMessagesAtTop() {
    const msgArea = el.querySelector(".chat-messages-area");
    if (!msgArea) return true;
    return msgArea.scrollTop <= 1;
  }

  /**
   * Get the usable container height (total minus header).
   */
  function getContainerHeight() {
    const container = el.closest(".mobile-app-container");
    if (!container) return window.innerHeight;
    return container.offsetHeight - 44; // 44px header
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;

    const store = getStore();
    if (!store || !store.isMobile) return;

    startY = e.touches[0].clientY;
    startTime = Date.now();
    currentDelta = 0;
    isDragging = false;
    gestureDecided = false;
    startRatio = store._chatRatio;
    containerHeight = getContainerHeight();
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;

    const store = getStore();
    if (!store || !store.isMobile) return;

    const deltaY = e.touches[0].clientY - startY;

    /* Wait until the finger moves enough to determine direction */
    if (!gestureDecided && Math.abs(deltaY) > 10) {
      gestureDecided = true;
      const swipingUp = deltaY < 0;
      const swipingDown = deltaY > 0;

      if (store.chatState === "peek") {
        /* In peek: capture all swipe-up gestures to expand chat */
        if (swipingUp) {
          isDragging = true;
          el.classList.add("dragging");
        }
        /* Swipe down in peek does nothing — let it pass through */
      } else {
        /* In half/full: capture swipe-down only when at scroll top,
           capture swipe-up on drag handle area (top 40px) for state change */
        if (swipingDown && isMessagesAtTop()) {
          isDragging = true;
          el.classList.add("dragging");
        } else if (swipingUp && store.chatState === "half") {
          /* Check if touch started on the drag handle zone (top 40px of panel) */
          const panelRect = el.getBoundingClientRect();
          const touchStartRelY = startY - panelRect.top;
          if (touchStartRelY < 40) {
            isDragging = true;
            el.classList.add("dragging");
          }
        }
      }
    }

    if (isDragging) {
      /* Prevent the browser from scrolling — we own this gesture */
      e.preventDefault();
      currentDelta = deltaY;

      /* Convert pixel delta to ratio delta.
         Dragging UP (negative deltaY) = increasing chat ratio.
         Dragging DOWN (positive deltaY) = decreasing chat ratio. */
      if (containerHeight > 0) {
        const ratioDelta = (-currentDelta / containerHeight) * 100;
        const newRatio = Math.max(
          CHAT_RATIO_PEEK,
          Math.min(CHAT_RATIO_FULL, startRatio + ratioDelta),
        );

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setChatRatio(newRatio);
        });
      }
    }
  }

  function onTouchEnd() {
    if (!isDragging) {
      gestureDecided = false;
      return;
    }
    isDragging = false;
    gestureDecided = false;
    el.classList.remove("dragging");

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    const store = getStore();
    if (!store || !store.isMobile) return;

    const elapsed = Date.now() - startTime;
    const velocity =
      elapsed > 0 ? ((-currentDelta / containerHeight) * 100000) / elapsed : 0;
    // velocity in ratio-units per second (positive = expanding chat)

    const currentRatio = store._chatRatio;
    const absDelta = Math.abs(currentDelta);
    const isFastSwipe = Math.abs(velocity) > 30; // ~30 ratio-units/sec
    const isSignificant = absDelta > 20;

    if (!isSignificant && !isFastSwipe) {
      // Snap back to start position
      setChatRatio(nearestPreset(startRatio));
      return;
    }

    if (isFastSwipe) {
      /* Fast swipe: skip to next/previous preset based on direction */
      const direction = velocity > 0 ? 1 : -1; // positive = expanding
      const currentPresetIdx = CHAT_RATIO_PRESETS.indexOf(
        nearestPreset(startRatio),
      );
      const targetIdx = Math.max(
        0,
        Math.min(CHAT_RATIO_PRESETS.length - 1, currentPresetIdx + direction),
      );
      setChatRatio(CHAT_RATIO_PRESETS[targetIdx]);
    } else {
      /* Slow drag: snap to nearest preset based on current position */
      setChatRatio(nearestPreset(currentRatio));
    }

    // Close conv switcher if collapsing to peek
    if (store.chatState === "peek" && store.convSwitcherOpen) {
      store.convSwitcherOpen = false;
    }
  }

  /* Listen on the ENTIRE chat panel — passive: false so we can
     preventDefault on touchmove when capturing a gesture */
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd, { passive: true });

  return function cleanup() {
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    if (rafId) cancelAnimationFrame(rafId);
  };
}
