/** Handle returned by Clock.setTimeout */
export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Time and timers. The internal modules take a Clock so their tests can control time;
 * ProcessQueue itself always uses systemClock.
 */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/**
 * The real clock. Each call looks up the global at call time, so test fake timers
 * installed after this module loads still apply.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle),
};

/** Longest delay setTimeout honors; larger values fire after about 1 ms */
export const MAX_TIMER_DELAY = 2 ** 31 - 1;
