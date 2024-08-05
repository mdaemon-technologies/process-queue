type ItemID = string | number;

class ProcessQueue<QueueItem extends { id: ItemID, [key: string]: any }> {
  private _queue: QueueItem[] = [];
  private _inProcess: Map<ItemID, QueueItem> = new Map();

  constructor(private _emplace: boolean = false) {}

  isProcessing = (id: ItemID): boolean => {
    return !!this._inProcess.get(id);
  };

  queueItem = (item: QueueItem): boolean => {
    if (this.isProcessing(item.id)) {
      return false;
    }

    let idx = this._queue.findIndex(t => t.id === item.id);
    if (this._emplace) {
      if (idx >= 0) {
        this._queue.splice(idx, 1, item);
        return true;
      }

      this._queue.push(item);
      return true;
    }

    if (idx >= 0) {
      this._queue.splice(idx, 1);
    }

    this._queue.unshift(item);

    return true;
  };

  getNextItem = (): QueueItem | null => {
    let item = this._queue.shift();
    if (!item) {
      return null;
    }

    // it's okay to set the item again
    this._inProcess.set(item.id, item);
    return item;
  };

  getQueue = (processing: boolean = false): QueueItem[] => {
    if (processing) {
      this._queue.forEach(t => {
        this._inProcess.set(t.id, t);
      });
      let temp = [...this._queue];
      this._queue.splice(0, this._queue.length);
      return temp;
    }

    return [...this._queue];
  };

  removeFromQueue = (id: ItemID): boolean => {
    let idx = this._queue.findIndex(t => t.id === id);
    if (idx !== -1) {
      this._queue.splice(idx, 1);
      return true;
    }

    return false;
  };

  doneProcessing = (id?: ItemID): void => {
    if (id !== undefined) {
      this._inProcess.delete(id);
      return;
    }

    this._inProcess.clear();
  };

  length = (prop?: string, val?: any): number => {
    if (!this._queue.length) {
      return 0;
    }

    if (prop !== undefined && this._queue.length && this._queue[0][prop] !== undefined && val !== undefined) {
      return this._queue.filter(q => q[prop] === val).length;
    }
    return this._queue.length;
  };

  busy = (): boolean => {
    return this._inProcess.size > 0;
  };

  processSize = (): number => {
    return this._inProcess.size;
  };
}

export default ProcessQueue;
