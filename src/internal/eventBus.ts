/** Maps each event name to its handler signature */
export type EventMap = { [event: string]: (...args: any[]) => void };

/** Each registered handler of one event, with a token identifying that registration */
type Registrations<Handler> = Map<Handler, symbol>;

/**
 * A small synchronous event emitter. Every listener is isolated: an exception it
 * throws goes to the error reporter and never reaches the emitter's caller.
 */
export class EventBus<Events extends EventMap> {
  private readonly _listeners = new Map<keyof Events, Registrations<Events[keyof Events]>>();
  private readonly _onceListeners = new Map<keyof Events, Registrations<Events[keyof Events]>>();

  /**
   * @param onListenerError - Receives exceptions thrown by listeners
   */
  constructor(private readonly onListenerError: (error: unknown, event: keyof Events & string) => void) {}

  /** Registers a listener for every emit of an event */
  on = <E extends keyof Events & string>(event: E, handler: Events[E]): void => {
    this._add(this._listeners, event, handler);
  };

  /** Registers a listener for the next emit of an event only */
  once = <E extends keyof Events & string>(event: E, handler: Events[E]): void => {
    this._add(this._onceListeners, event, handler);
  };

  /** Removes a listener registered with on or once */
  off = <E extends keyof Events & string>(event: E, handler: Events[E]): void => {
    this._listeners.get(event)?.delete(handler);
    this._onceListeners.get(event)?.delete(handler);
  };

  /**
   * Calls the event's listeners, following the DOM EventTarget rules: a listener added during
   * this emit is first called on the next one, and a listener removed during this emit is not
   * called again, even later in this one. Removing and re-adding a listener counts as adding it.
   */
  emit = <E extends keyof Events & string>(event: E, ...args: Parameters<Events[E]>): void => {
    const listeners = this._listeners.get(event);
    const onceListeners = this._onceListeners.get(event);
    // Take both snapshots before any listener runs
    const current = [...(listeners ?? [])];
    const currentOnce = [...(onceListeners ?? [])];

    current.forEach(([handler, token]) => {
      if (listeners?.get(handler) === token) this._call(event, handler, args);
    });
    currentOnce.forEach(([handler, token]) => {
      if (onceListeners?.get(handler) !== token) return;
      // Deleting before the call lets the handler register itself again for the next emit
      onceListeners.delete(handler);
      this._call(event, handler, args);
    });
  };

  private _add = (
    registry: Map<keyof Events, Registrations<Events[keyof Events]>>,
    event: keyof Events,
    handler: Events[keyof Events]
  ): void => {
    let handlers = registry.get(event);
    if (!handlers) {
      handlers = new Map();
      registry.set(event, handlers);
    }
    // Registering a handler that is already registered changes nothing, as with a Set
    if (!handlers.has(handler)) handlers.set(handler, Symbol());
  };

  private _call = (event: keyof Events & string, handler: Events[keyof Events], args: unknown[]): void => {
    try {
      handler(...args);
    } catch (listenerError) {
      try {
        // Called through a local so the reporter is not given this bus as `this`
        const report = this.onListenerError;
        report(listenerError, event);
      } catch {
        // The error reporter itself failed; there is nowhere left to report it
      }
    }
  };
}
