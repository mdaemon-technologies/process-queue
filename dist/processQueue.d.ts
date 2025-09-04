export = ProcessQueue;

type ItemID = string | number;

interface Item {
  id: ItemID;
  [key: string]: unknown;
}

declare class ProcessQueue<QueueItem extends Item = Item> {
  constructor(emplace?: boolean, maxSize?: number);
  isProcessing(id: ItemID): boolean;
  queueItem(item: QueueItem): boolean;
  getNextItem(): QueueItem | null;
  getQueue(processing?: boolean): QueueItem[];
  processBatch(batchSize: number): QueueItem[];
  removeFromQueue(id: ItemID): boolean;
  doneProcessing(id?: ItemID): void;
  length<K extends keyof QueueItem>(prop?: K, val?: QueueItem[K]): number;
  clear(): void;
  isEmpty(): boolean;
  busy(): boolean;
  processSize(): number;
}