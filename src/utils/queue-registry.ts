/**
 * Queue Registry - Service Locator Pattern
 * 
 * This registry allows job handlers to access the queue instance without
 * creating circular dependencies between job definitions and queue setup.
 */

let queueInstance: any = null;

/**
 * Registry for managing queue instances to avoid circular dependencies.
 */
export class QueueRegistry {
  private static instance: QueueRegistry;
  private queues: Map<string, any> = new Map();
  private defaultQueue: any = null;

  private constructor() {}

  static getInstance(): QueueRegistry {
    if (!QueueRegistry.instance) {
      QueueRegistry.instance = new QueueRegistry();
    }
    return QueueRegistry.instance;
  }

  /**
   * Register a queue instance with a name.
   * 
   * @param name - Queue name identifier
   * @param queue - Queue instance
   */
  register(name: string, queue: any): void {
    this.queues.set(name, queue);
    
    // Set as default if it's the first queue
    if (!this.defaultQueue) {
      this.defaultQueue = queue;
    }
  }

  /**
   * Set the default queue instance.
   * 
   * @param queue - Queue instance to set as default
   */
  setDefault(queue: any): void {
    this.defaultQueue = queue;
  }

  /**
   * Get a queue by name.
   * 
   * @param name - Queue name identifier
   * @returns Queue instance or null if not found
   */
  get(name: string): any | null {
    return this.queues.get(name) || null;
  }

  /**
   * Get the default queue instance.
   * 
   * @returns Default queue instance or null if none set
   */
  getDefault(): any | null {
    return this.defaultQueue;
  }

  /**
   * Check if a queue is registered.
   * 
   * @param name - Queue name identifier
   * @returns True if queue exists
   */
  has(name: string): boolean {
    return this.queues.has(name);
  }

  /**
   * Clear all registered queues.
   */
  clear(): void {
    this.queues.clear();
    this.defaultQueue = null;
  }
}

/**
 * Simple global queue registry for basic use cases.
 * 
 * @example
 * ```typescript
 * // In queue setup
 * import { setQueue } from 'adapter-queue/registry';
 * setQueue(myQueue);
 * 
 * // In job handler
 * import { getQueue } from 'adapter-queue/registry';
 * const queue = getQueue();
 * await queue.addJob('follow-up', { payload: data });
 * ```
 */

/**
 * Set the global queue instance.
 * 
 * @param queue - Queue instance to set globally
 */
export function setQueue(queue: any): void {
  queueInstance = queue;
  QueueRegistry.getInstance().setDefault(queue);
}

/**
 * Get the global queue instance.
 * 
 * @returns Global queue instance
 * @throws Error if no queue has been set
 */
export function getQueue(): any {
  if (!queueInstance) {
    throw new Error(
      'No queue instance registered. Call setQueue() in your queue setup before using getQueue().'
    );
  }
  return queueInstance;
}

/**
 * Get the global queue instance safely.
 * 
 * @returns Global queue instance or null if none set
 */
export function getQueueSafe(): any | null {
  return queueInstance;
}

/**
 * Check if a global queue is registered.
 * 
 * @returns True if global queue is set
 */
export function hasQueue(): boolean {
  return queueInstance !== null;
}

/**
 * Clear the global queue instance.
 */
export function clearQueue(): void {
  queueInstance = null;
  QueueRegistry.getInstance().clear();
}

/**
 * Create a queue getter function for use in job handlers.
 * This is useful for the JobDefinitionWithLocator pattern.
 * 
 * @param queueName - Optional specific queue name, uses default if not provided
 * @returns Function that returns the queue instance
 */
export function createQueueGetter(queueName?: string): () => any {
  return () => {
    const registry = QueueRegistry.getInstance();
    if (queueName) {
      const queue = registry.get(queueName);
      if (!queue) {
        throw new Error(`Queue '${queueName}' not found in registry`);
      }
      return queue;
    }
    
    const defaultQueue = registry.getDefault();
    if (!defaultQueue) {
      throw new Error('No default queue registered. Use QueueRegistry.setDefault() or setQueue()');
    }
    return defaultQueue;
  };
}