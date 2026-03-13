/**
 * ResponseTimer — manages typing indicator refresh and interim messages
 * for long-running brain responses.
 *
 * - Typing indicator: refreshed every 10s
 * - Interim message 1: sent at 30s
 * - Interim message 2: sent at 90s
 * - Max 2 interim messages, then just typing dots
 * - All timers cleared on cancel()
 */

const TYPING_INTERVAL_MS = 10_000;
const INTERIM_1_DELAY_MS = 30_000;
const INTERIM_2_DELAY_MS = 90_000;

const INTERIM_MESSAGES = [
  "Working on it...",
  "Still on it, bear with me...",
];

export interface ResponseTimerOptions {
  sendTyping: () => Promise<void>;
  sendInterim: (message: string) => Promise<void>;
}

export class ResponseTimer {
  private sendTyping: () => Promise<void>;
  private sendInterim: (message: string) => Promise<void>;
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private interimTimeouts: ReturnType<typeof setTimeout>[] = [];

  constructor(options: ResponseTimerOptions) {
    this.sendTyping = options.sendTyping;
    this.sendInterim = options.sendInterim;
  }

  start(): void {
    this.typingInterval = setInterval(() => {
      this.sendTyping().catch(() => {});
    }, TYPING_INTERVAL_MS);

    this.interimTimeouts.push(
      setTimeout(() => {
        this.sendInterim(INTERIM_MESSAGES[0]).catch(() => {});
      }, INTERIM_1_DELAY_MS),
    );

    this.interimTimeouts.push(
      setTimeout(() => {
        this.sendInterim(INTERIM_MESSAGES[1]).catch(() => {});
      }, INTERIM_2_DELAY_MS),
    );
  }

  cancel(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    for (const timeout of this.interimTimeouts) {
      clearTimeout(timeout);
    }
    this.interimTimeouts = [];
  }
}
