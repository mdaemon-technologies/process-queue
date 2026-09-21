import { Item } from '../types.js';
/** Maximum list sizes a snapshot may have; Infinity for no limit */
export interface SnapshotLimits {
    maxQueued: number;
    maxInProcess: number;
    /** Limit on queued and in-process items together */
    maxTotal: number;
}
/**
 * Validates a snapshot in full, so nothing is restored from malformed or tampered data
 * @returns The snapshot's lists, with absent optional lists as empty arrays
 * @throws {TypeError} If the snapshot is malformed, contains an invalid item, or repeats an id outside the dead letter queue
 * @throws {RangeError} If a list exceeds its limit
 */
export declare const validateSnapshot: <T extends Item>(data: unknown, limits: SnapshotLimits) => {
    queued: T[];
    inProcess: T[];
    deadLetters: T[];
};
