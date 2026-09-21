/** Maps each event name to its handler signature */
export type EventMap = {
    [event: string]: (...args: any[]) => void;
};
/**
 * A small synchronous event emitter. Every listener is isolated: an exception it
 * throws goes to the error reporter and never reaches the emitter's caller.
 */
export declare class EventBus<Events extends EventMap> {
    private readonly onListenerError;
    private readonly _listeners;
    private readonly _onceListeners;
    /**
     * @param onListenerError - Receives exceptions thrown by listeners
     */
    constructor(onListenerError: (error: unknown, event: keyof Events & string) => void);
    /** Registers a listener for every emit of an event */
    on: <E extends keyof Events & string>(event: E, handler: Events[E]) => void;
    /** Registers a listener for the next emit of an event only */
    once: <E extends keyof Events & string>(event: E, handler: Events[E]) => void;
    /** Removes a listener registered with on or once */
    off: <E extends keyof Events & string>(event: E, handler: Events[E]) => void;
    /**
     * Calls the event's listeners, following the DOM EventTarget rules: a listener added during
     * this emit is first called on the next one, and a listener removed during this emit is not
     * called again, even later in this one. Removing and re-adding a listener counts as adding it.
     */
    emit: <E extends keyof Events & string>(event: E, ...args: Parameters<Events[E]>) => void;
    private _add;
    private _call;
}
