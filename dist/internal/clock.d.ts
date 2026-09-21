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
export declare const systemClock: Clock;
/** Longest delay setTimeout honors; larger values fire after about 1 ms */
export declare const MAX_TIMER_DELAY: number;
