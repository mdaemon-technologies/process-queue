import { Item, ItemID, ItemState, Snapshot } from '../types.js';
import { isValidItem } from './validation.js';

/** Maximum list sizes a snapshot may have; Infinity for no limit */
export interface SnapshotLimits {
  maxQueued: number;
  maxInProcess: number;
  /** Limit on queued and in-process items together */
  maxTotal: number;
}

const fail = (message: string): never => {
  throw new TypeError(`ProcessQueue.deserialize: ${message}`);
};

const optionalArray = <T>(value: unknown, name: string): T[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`data.${name} must be an array when present`);
  return value as T[];
};

/**
 * Checks that each itemState entry belongs to a distinct queued or in-process item, with
 * well-formed fields. An entry for any other id would leave bookkeeping behind for an item
 * that does not exist. Unknown fields are ignored, so later versions can add some.
 * @param queuedIds - The ids of the queued items
 * @param ids - The ids of the queued and in-process items
 */
const validateItemState = (itemState: unknown[], queuedIds: ReadonlySet<ItemID>, ids: ReadonlySet<ItemID>): void => {
  const seen = new Set<ItemID>();
  itemState.forEach((entry, i) => {
    const at = `data.itemState[${i}]`;
    if (!isValidItem(entry)) fail(`${at} must be an object with a valid id`);
    const { id, attempts, retryAt, enqueuedAt } = entry as ItemState;
    if (!ids.has(id)) fail(`${at}.id ${JSON.stringify(id)} is not queued or in process`);
    if (seen.has(id)) fail(`duplicate itemState id ${JSON.stringify(id)}`);
    seen.add(id);

    if (attempts !== undefined && !(Number.isSafeInteger(attempts) && attempts >= 0)) {
      fail(`${at}.attempts must be an integer >= 0`);
    }
    ([['retryAt', retryAt], ['enqueuedAt', enqueuedAt]] as const).forEach(([name, time]) => {
      if (time === undefined) return;
      if (typeof time !== "number" || !Number.isFinite(time)) fail(`${at}.${name} must be a finite number`);
      if (!queuedIds.has(id)) fail(`${at}.${name} is only allowed for queued items`);
    });
  });
};

/**
 * Validates a snapshot in full, so nothing is restored from malformed or tampered data
 * @returns The snapshot's lists, with absent optional lists as empty arrays
 * @throws {TypeError} If the snapshot is malformed, contains an invalid item, or repeats an id outside the dead letter queue
 * @throws {RangeError} If a list exceeds its limit
 */
export const validateSnapshot = <T extends Item>(
  data: unknown,
  limits: SnapshotLimits
): { queued: T[]; inProcess: T[]; deadLetters: T[]; itemState: ItemState[] } => {
  if (typeof data !== "object" || data === null || !Array.isArray((data as Snapshot<T>).queue)) {
    fail("data.queue must be an array");
  }
  const snapshot = data as Snapshot<T>;
  const queued = snapshot.queue;
  const inProcess = optionalArray<T>(snapshot.inProcess, "inProcess");
  const deadLetters = optionalArray<T>(snapshot.deadLetterQueue, "deadLetterQueue");
  const itemState = optionalArray<ItemState>(snapshot.itemState, "itemState");

  [...queued, ...inProcess, ...deadLetters].forEach(item => {
    if (!isValidItem(item)) fail("every item must be an object with a valid id");
  });
  const ids = new Set<ItemID>();
  [...queued, ...inProcess].forEach(item => {
    if (ids.has(item.id)) fail(`duplicate id ${JSON.stringify(item.id)}`);
    ids.add(item.id);
  });

  if (queued.length > limits.maxQueued) {
    throw new RangeError(`ProcessQueue.deserialize: ${queued.length} queued items exceed the limit of ${limits.maxQueued}`);
  }
  if (inProcess.length > limits.maxInProcess) {
    throw new RangeError(`ProcessQueue.deserialize: ${inProcess.length} in-process items exceed the limit of ${limits.maxInProcess}`);
  }
  const total = queued.length + inProcess.length;
  if (total > limits.maxTotal) {
    throw new RangeError(`ProcessQueue.deserialize: ${total} queued and in-process items exceed the limit of ${limits.maxTotal}`);
  }

  // After the size limits, so the ids every entry must match are bounded
  validateItemState(itemState, new Set(queued.map(item => item.id)), ids);

  return { queued, inProcess, deadLetters, itemState };
};
