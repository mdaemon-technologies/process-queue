import { Item, OVERFLOW_STRATEGIES, OverflowStrategy, ProcessQueueEvent, ProcessQueueOptions } from '../types.js';

/**
 * Options after defaults are applied. Callbacks without a default stay optional.
 */
export type ResolvedOptions<QueueItem extends Item> =
  Required<Omit<ProcessQueueOptions<QueueItem>, 'comparator' | 'worker'>> &
  Pick<ProcessQueueOptions<QueueItem>, 'comparator' | 'worker'>;

/**
 * Default handler for exceptions thrown by event listeners.
 * Looks up console.error at call time, so it can be replaced or spied on.
 */
const defaultListenerErrorHandler = (error: unknown, event: ProcessQueueEvent): void => {
  console.error(`ProcessQueue: "${event}" listener threw`, error);
};

/**
 * Default values for every option that has one
 */
const DEFAULT_OPTIONS = {
  emplace: false,
  maxSize: 1000,
  overflowStrategy: 'reject' as OverflowStrategy,
  concurrency: 1,
  maxRetries: 0,
  maxDeadLetterSize: 1000,
  retryDelay: 0,
  ttl: 0,
  processingTimeout: 0,
  onListenerError: defaultListenerErrorHandler,
};

/**
 * Throws unless value is an integer >= min (or Infinity when allowed)
 */
const checkCount = (name: string, value: number, min: number, allowInfinity: boolean): void => {
  if (allowInfinity && value === Infinity) return;
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`ProcessQueue: ${name} must be an integer >= ${min}${allowInfinity ? " or Infinity" : ""}`);
  }
};

/**
 * Throws unless value is a finite number >= 0
 */
const checkDuration = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`ProcessQueue: ${name} must be a finite number >= 0`);
  }
};

/**
 * Throws unless value is a function or undefined
 */
const checkOptionalFunction = (name: string, value: unknown): void => {
  if (value !== undefined && typeof value !== "function") {
    throw new TypeError(`ProcessQueue: ${name} must be a function`);
  }
};

/**
 * Rejects option values that would silently disable limits or break processing
 * @throws {RangeError} If a numeric option is out of range
 * @throws {TypeError} If a callback option is not a function, or overflowStrategy is unknown
 */
const validate = <QueueItem extends Item>(options: ResolvedOptions<QueueItem>): void => {
  checkCount("maxSize", options.maxSize, 1, true);
  checkCount("concurrency", options.concurrency, 1, true);
  checkCount("maxRetries", options.maxRetries, 0, false);
  checkCount("maxDeadLetterSize", options.maxDeadLetterSize, 0, true);
  checkDuration("ttl", options.ttl);
  checkDuration("processingTimeout", options.processingTimeout);
  if (typeof options.retryDelay === "number") {
    checkDuration("retryDelay", options.retryDelay);
  } else {
    checkOptionalFunction("retryDelay", options.retryDelay);
  }
  checkOptionalFunction("worker", options.worker);
  checkOptionalFunction("comparator", options.comparator);
  checkOptionalFunction("onListenerError", options.onListenerError);
  if (!OVERFLOW_STRATEGIES.includes(options.overflowStrategy)) {
    throw new TypeError(`ProcessQueue: overflowStrategy must be one of ${OVERFLOW_STRATEGIES.join(", ")}`);
  }
};

/**
 * Normalizes constructor arguments to a complete, validated options object
 * @param optionsOrEmplace - Options object, or boolean for emplace mode (positional form)
 * @param maxSize - Maximum queue size (positional form only)
 */
export const resolveOptions = <QueueItem extends Item>(
  optionsOrEmplace?: ProcessQueueOptions<QueueItem> | boolean,
  maxSize?: number
): ResolvedOptions<QueueItem> => {
  const given: ProcessQueueOptions<QueueItem> = typeof optionsOrEmplace === 'object' && optionsOrEmplace !== null
    ? optionsOrEmplace
    : { emplace: optionsOrEmplace === true, maxSize };

  const resolved: ResolvedOptions<QueueItem> = {
    emplace: given.emplace ?? DEFAULT_OPTIONS.emplace,
    maxSize: given.maxSize ?? DEFAULT_OPTIONS.maxSize,
    comparator: given.comparator,
    overflowStrategy: given.overflowStrategy ?? DEFAULT_OPTIONS.overflowStrategy,
    worker: given.worker,
    concurrency: given.concurrency ?? DEFAULT_OPTIONS.concurrency,
    maxRetries: given.maxRetries ?? DEFAULT_OPTIONS.maxRetries,
    maxDeadLetterSize: given.maxDeadLetterSize ?? DEFAULT_OPTIONS.maxDeadLetterSize,
    retryDelay: given.retryDelay ?? DEFAULT_OPTIONS.retryDelay,
    ttl: given.ttl ?? DEFAULT_OPTIONS.ttl,
    processingTimeout: given.processingTimeout ?? DEFAULT_OPTIONS.processingTimeout,
    onListenerError: given.onListenerError ?? DEFAULT_OPTIONS.onListenerError,
  };
  validate(resolved);
  return resolved;
};
