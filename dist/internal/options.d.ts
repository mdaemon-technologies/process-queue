import { Item, ProcessQueueOptions } from '../types.js';
/**
 * Options after defaults are applied. Callbacks without a default stay optional.
 */
export type ResolvedOptions<QueueItem extends Item> = Required<Omit<ProcessQueueOptions<QueueItem>, 'comparator' | 'worker'>> & Pick<ProcessQueueOptions<QueueItem>, 'comparator' | 'worker'>;
/**
 * Normalizes constructor arguments to a complete, validated options object
 * @param optionsOrEmplace - Options object, or boolean for emplace mode (positional form)
 * @param maxSize - Maximum queue size (positional form only)
 */
export declare const resolveOptions: <QueueItem extends Item>(optionsOrEmplace?: ProcessQueueOptions<QueueItem> | boolean, maxSize?: number) => ResolvedOptions<QueueItem>;
