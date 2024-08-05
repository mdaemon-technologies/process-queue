[![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmdaemon-technologies%2Fprocess-queue%2Fmaster%2Fpackage.json&query=%24.version&prefix=v&label=npm&color=blue)](https://www.npmjs.com/package/@mdaemon/process-queue) [![Static Badge](https://img.shields.io/badge/node-v16%2B-blue?style=flat&label=node&color=blue)](https://nodejs.org)
 [![install size](https://packagephobia.com/badge?p=@mdaemon/process-queue)](https://packagephobia.com/result?p=@mdaemon/process-queue) [![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmdaemon-technologies%2Fprocess-queue%2Fmaster%2Fpackage.json&query=%24.license&prefix=v&label=license&color=green)](https://github.com/mdaemon-technologies/process-queue/blob/master/LICENSE) [![Node.js CI](https://github.com/mdaemon-technologies/process-queue/actions/workflows/node.js.yml/badge.svg)](https://github.com/mdaemon-technologies/process-queue/actions/workflows/node.js.yml)

# @mdaemon/process-queue, A class for pushing objects to a queue and getting the next object from the queue to be processed



# Install #

    $ npm install @mdaemon/process-queue --save

## Node CommonJS ##
```javascript
    const ProcessQueue = require("@mdaemon/process-queue/dist/processQueue.cjs");
```

## Node Modules ##
```javascript
    import ProcessQueue from "@mdaemon/process-queue/dist/processQueue.mjs";
```

## Web ##
```HTML
    <script type="text/javascript" src="/path_to_modules/dist/processQueue.umd.js">
```

### Creating a ProcessQueue ###

```javascript
  // Define your item type
  interface MyQueueItem {
    id: string | number;
    // other properties...
  }

  // Create a new ProcessQueue
  const queue = new ProcessQueue<MyQueueItem>();

```

### Adding Items to the Queue ###
```javascript
  const item: MyQueueItem = { id: '1', /* other properties */ };
  const added = queue.queueItem(item);
  console.log(added); // true if the item was added, false if it was already being processed
```

### Getting the Next Item ###
```javascript
  const nextItem = queue.getNextItem();
  if (nextItem) {
    // Process the item
    // ...
    
    // Mark it as done when finished
    queue.doneProcessing(nextItem.id);
  }
```

### Checking Queue Status ###
```javascript
  console.log(queue.length()); // Number of items in the queue
  console.log(queue.busy()); // true if any items are being processed
  console.log(queue.processSize()); // Number of items currently being processed
```

### Removing Items ###
```javascript
  const removed = queue.removeFromQueue('itemId');
  console.log(removed); // true if the item was removed, false if it wasn't in the queue
```

### Getting All Queue Items ###
```javascript
  const allItems = queue.getQueue();
  console.log(allItems); // Array of all items in the queue
```

### API Reference ###
```javascript
  queueItem(item: QueueItem): boolean: Adds an item to the queue.

  getNextItem(): QueueItem | null: Retrieves and removes the next item from the queue.

  isProcessing(id: ItemID): boolean: Checks if an item is currently being processed.
  
  doneProcessing(id?: ItemID): void: Marks an item (or all items if no id is provided) as done processing.

  removeFromQueue(id: ItemID): boolean: Removes an item from the queue.

  length(prop?: string, val?: any): number: Returns the number of items in the queue, optionally filtered by a property value.

  busy(): boolean: Checks if any items are currently being processed.

  processSize(): number: Returns the number of items currently being processed.

  getQueue(processing: boolean = false): QueueItem[]: Returns all items in the queue, optionally moving them to the processing state.

```

# License #

Published under the [LGPL-2.1 license](https://github.com/mdaemon-technologies/process-queue/blob/main/LICENSE "LGPL-2.1 License").

Published by<br/> 
<b>MDaemon Technologies, Ltd.<br/>
Simple Secure Email</b><br/>
[https://www.mdaemon.com](https://www.mdaemon.com)