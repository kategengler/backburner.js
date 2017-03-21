import {
  isString
} from './utils';

export default class Queue {
  public _queue: any[];
  private name: string;
  private globalOptions: any;
  private options: any;
  private targetQueues: any;
  private _queueBeingFlushed: any | undefined;

  constructor(name: string, options: any, globalOptions: any) {
    this.name = name;
    this.globalOptions = globalOptions || {};
    this.options = options;
    this._queue = [];
    this.targetQueues = {};
    this._queueBeingFlushed = undefined;
  }

  public push(target, method, args, stack) {
    let queue = this._queue;
    queue.push(target, method, args, stack);

    return {
      queue: this,
      target,
      method
    };
  }

  public pushUnique(target, method, args, stack) {
    let KEY = this.globalOptions.GUID_KEY;

    if (target && KEY) {
      let guid = target[KEY];
      if (guid) {
        return this.pushUniqueWithGuid(guid, target, method, args, stack);
      }
    }

    this.pushUniqueWithoutGuid(target, method, args, stack);

    return {
      queue: this,
      target,
      method
    };
  }

  public flush(sync?) {
    let queue = this._queue;
    let length = queue.length;

    if (length === 0) {
      return;
    }

    let globalOptions = this.globalOptions;
    let options = this.options;
    let before = options && options.before;
    let after = options && options.after;
    let onError = globalOptions.onError || (globalOptions.onErrorTarget &&
                                            globalOptions.onErrorTarget[globalOptions.onErrorMethod]);
    let target;
    let method;
    let args;
    let errorRecordedForStack;
    let invoke = onError ? this.invokeWithOnError : this.invoke;

    this.targetQueues = Object.create(null);
    let queueItems = this._queueBeingFlushed = this._queue;
    this._queue = [];

    if (before) {
      before();
    }

    for (let i = 0; i < length; i += 4) {
      target                = queueItems[i];
      method                = queueItems[i + 1];
      args                  = queueItems[i + 2];
      errorRecordedForStack = queueItems[i + 3]; // Debugging assistance

      if (isString(method)) {
        method = target[method];
      }

      // method could have been nullified / canceled during flush
      if (method) {
        //
        //    ** Attention intrepid developer **
        //
        //    To find out the stack of this task when it was scheduled onto
        //    the run loop, add the following to your app.js:
        //
        //    Ember.run.backburner.DEBUG = true; // NOTE: This slows your app, don't leave it on in production.
        //
        //    Once that is in place, when you are at a breakpoint and navigate
        //    here in the stack explorer, you can look at `errorRecordedForStack.stack`,
        //    which will be the captured stack when this job was scheduled.
        //
        //    One possible long-term solution is the following Chrome issue:
        //       https://bugs.chromium.org/p/chromium/issues/detail?id=332624
        //
        invoke(target, method, args, onError, errorRecordedForStack);
      }
    }

    if (after) {
      after();
    }

    this._queueBeingFlushed = undefined;

    if (sync !== false &&
        this._queue.length > 0) {
      // check if new items have been added
      this.flush(true);
    }
  }

  public cancel(actionToCancel) {
    let queue = this._queue;
    let currentTarget;
    let currentMethod;
    let i;
    let l;
    let { target, method }  = actionToCancel;
    let GUID_KEY = this.globalOptions.GUID_KEY;

    if (GUID_KEY && this.targetQueues && target) {
      let targetQueue = this.targetQueues[target[GUID_KEY]];

      if (targetQueue) {
        for (i = 0, l = targetQueue.length; i < l; i++) {
          if (targetQueue[i] === method) {
            targetQueue.splice(i, 1);
          }
        }
      }
    }

    for (i = 0, l = queue.length; i < l; i += 4) {
      currentTarget = queue[i];
      currentMethod = queue[i + 1];

      if (currentTarget === target &&
          currentMethod === method) {
        queue.splice(i, 4);
        return true;
      }
    }

    // if not found in current queue
    // could be in the queue that is being flushed
    queue = this._queueBeingFlushed;

    if (!queue) {
      return;
    }

    for (i = 0, l = queue.length; i < l; i += 4) {
      currentTarget = queue[i];
      currentMethod = queue[i + 1];

      if (currentTarget === target &&
          currentMethod === method) {
        // don't mess with array during flush
        // just nullify the method
        queue[i + 1] = null;
        return true;
      }
    }
  }

  private pushUniqueWithoutGuid(target, method, args, stack) {
    let queue = this._queue;

    for (let i = 0, l = queue.length; i < l; i += 4) {
      let currentTarget = queue[i];
      let currentMethod = queue[i + 1];

      if (currentTarget === target && currentMethod === method) {
        queue[i + 2] = args;  // replace args
        queue[i + 3] = stack; // replace stack
        return;
      }
    }

    queue.push(target, method, args, stack);
  }

  private targetQueue(targetQueue, target, method, args, stack) {
    let queue = this._queue;

    for (let i = 0, l = targetQueue.length; i < l; i += 2) {
      let currentMethod = targetQueue[i];
      let currentIndex  = targetQueue[i + 1];

      if (currentMethod === method) {
        queue[currentIndex + 2] = args;  // replace args
        queue[currentIndex + 3] = stack; // replace stack
        return;
      }
    }

    targetQueue.push(
      method,
      queue.push(target, method, args, stack) - 4
    );
  }

  private pushUniqueWithGuid(guid, target, method, args, stack) {
    let hasLocalQueue = this.targetQueues[guid];

    if (hasLocalQueue) {
      this.targetQueue(hasLocalQueue, target, method, args, stack);
    } else {
      this.targetQueues[guid] = [
        method,
        this._queue.push(target, method, args, stack) - 4
      ];
    }

    return {
      queue: this,
      target: target,
      method: method
    };
  }

  private invoke(target, method, args /*, onError, errorRecordedForStack */) {
    if (args && args.length > 0) {
      method.apply(target, args);
    } else {
      method.call(target);
    }
  }

  private invokeWithOnError(target, method, args, onError, errorRecordedForStack) {
    try {
      if (args && args.length > 0) {
        method.apply(target, args);
      } else {
        method.call(target);
      }
    } catch (error) {
      onError(error, errorRecordedForStack);
    }
  }
}