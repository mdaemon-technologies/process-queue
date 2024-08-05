export = ProcessQueue;

declare class ProcessQueue {
  constructor(emplace?: boolean);
  isProcessing(id: string | number): boolean;
  queueItem(item: { id: string | number, [key: string]: any }): boolean;
  getNextItem(): { id: string | number, [key: string]: any } | null;
  getQueue(processing?: boolean): { id: string | number, [key: string]: any }[];
  removeFromQueue(id: string | number): boolean;
  doneProcessing(id?: string | number): void;
  length(prop?: string, val?: any): number;
  busy(): boolean;
  processSize(): number;
}