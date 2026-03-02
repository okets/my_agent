/**
 * Haptic feedback for mobile interactions.
 *
 * Patterns:
 *   light   (10ms)  — navigation, close, toggle
 *   medium  (25ms)  — selection, secondary actions
 *   strong  (50ms)  — primary actions (send, save, create)
 *   heavy   (60ms)  — stop/interrupt
 *   warning ([15,50,15]) — destructive actions (delete, remove)
 *   success ([20,40,20]) — completion confirmation
 *
 * Usage:
 *   haptic.light()
 *   haptic.strong()
 *
 * Alpine magic:
 *   @click="$haptic.strong(); sendMessage()"
 *
 * Respects:
 *   - prefers-reduced-motion (disables all haptics)
 *   - Mobile-only (no-op on desktop)
 */

const haptic = {
  _canVibrate: typeof navigator !== "undefined" && "vibrate" in navigator,

  _shouldVibrate() {
    if (!this._canVibrate) return false;
    // Respect reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return false;
    // Only vibrate on mobile
    const store = window.Alpine?.store("mobile");
    if (store && !store.isMobile) return false;
    return true;
  },

  /** Light tap — navigation, close, toggle, expand/collapse */
  light() {
    if (this._shouldVibrate()) navigator.vibrate(10);
  },

  /** Medium tap — selection, secondary actions */
  medium() {
    if (this._shouldVibrate()) navigator.vibrate(25);
  },

  /** Strong tap — primary actions (send, save, create, confirm) */
  strong() {
    if (this._shouldVibrate()) navigator.vibrate(50);
  },

  /** Heavy tap — stop/interrupt actions */
  heavy() {
    if (this._shouldVibrate()) navigator.vibrate(60);
  },

  /** Warning double-pulse — destructive actions (delete, remove, disconnect) */
  warning() {
    if (this._shouldVibrate()) navigator.vibrate([15, 50, 15]);
  },

  /** Success pulse — completion confirmation */
  success() {
    if (this._shouldVibrate()) navigator.vibrate([20, 40, 20]);
  },
};

// Expose globally
window.haptic = haptic;

// Register as Alpine magic property
document.addEventListener("alpine:init", () => {
  Alpine.magic("haptic", () => haptic);
});
