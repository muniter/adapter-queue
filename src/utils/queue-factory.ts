/**
 * Queue Factory with Memoization
 * 
 * This approach eliminates circular dependencies by deferring queue resolution
 * to execution time while using memoization to ensure the same instance is returned.
 * Supports multiple queues by creating separate factory modules.
 */

/**
 * Creates a memoized queue factory that eliminates circular dependencies.
 * The queue is only created when first accessed, not at import time.
 * 
 * @example
 * ```typescript
 * // queue-setup.ts
 * import { createQueueFactory } from 'adapter-queue';
 * 
 * export const getQueue = createQueueFactory(() => {
 *   const queue = new FileQueue({ name: 'my-queue', path: './queue' });
 *   const handlers = assembleJobs([emailJob, imageJob]);
 *   queue.setHandlers(handlers);
 *   return queue;
 * });
 * 
 * // job-file.ts
 * import { getQueue } from './queue-setup.js';
 * 
 * export const emailJob: JobDefinition<...> = {
 *   handler: async (args) => {
 *     const queue = getQueue(); // No circular dependency!
 *     await queue.addJob("follow-up", { payload: data });
 *   }
 * };
 * ```
 */
export function createQueueFactory<T>(
  createQueue: () => T
): () => T {
  let queueInstance: T | null = null;
  let isInitializing = false;

  return function getQueue(): T {
    // Prevent infinite recursion during initialization
    if (isInitializing) {
      throw new Error(
        'Circular dependency detected: Queue factory called during queue initialization. ' +
        'Move job definitions that call getQueue() outside of the queue creation function.'
      );
    }

    if (!queueInstance) {
      isInitializing = true;
      try {
        queueInstance = createQueue();
      } finally {
        isInitializing = false;
      }
    }

    return queueInstance;
  };
}

/**
 * Creates a queue factory with lazy initialization and dependency injection.
 * This pattern allows you to define jobs without importing the queue setup module.
 * 
 * @example
 * ```typescript
 * // queue-factory.ts
 * import { createLazyQueueFactory } from 'adapter-queue';
 * 
 * export const { getQueue, initializeQueue } = createLazyQueueFactory<MyQueue>();
 * 
 * // job-file.ts
 * import { getQueue } from './queue-factory.js';
 * 
 * export const emailJob: JobDefinition<...> = {
 *   handler: async (args) => {
 *     const queue = getQueue(); // No imports from queue-setup!
 *   }
 * };
 * 
 * // main.ts
 * import { initializeQueue } from './queue-factory.js';
 * import { emailJob } from './job-file.js';
 * 
 * initializeQueue(() => {
 *   const queue = new FileQueue({ ... });
 *   queue.setHandlers(assembleJobs([emailJob]));
 *   return queue;
 * });
 * ```
 */
export function createLazyQueueFactory<T>(): {
  getQueue: () => T;
  initializeQueue: (factory: () => T) => T;
  isInitialized: () => boolean;
  reset: () => void;
} {
  let queueInstance: T | null = null;
  let isInitializing = false;

  function getQueue(): T {
    if (isInitializing) {
      throw new Error(
        'Circular dependency detected: getQueue() called during queue initialization. ' +
        'Ensure job handlers don\'t call getQueue() during queue setup.'
      );
    }

    if (!queueInstance) {
      throw new Error(
        'Queue not initialized. Call initializeQueue() before using getQueue(). ' +
        'Make sure to initialize the queue in your application startup code.'
      );
    }

    return queueInstance;
  }

  function initializeQueue(factory: () => T): T {
    if (queueInstance) {
      return queueInstance;
    }

    isInitializing = true;
    try {
      queueInstance = factory();
      return queueInstance;
    } finally {
      isInitializing = false;
    }
  }

  function isInitialized(): boolean {
    return queueInstance !== null;
  }

  function reset(): void {
    queueInstance = null;
    isInitializing = false;
  }

  return {
    getQueue,
    initializeQueue,
    isInitialized,
    reset
  };
}

/**
 * Creates multiple queue factories for applications that need multiple queues.
 * Each queue gets its own factory with separate memoization.
 * 
 * @example
 * ```typescript
 * // queue-factories.ts
 * import { createMultiQueueFactory } from 'adapter-queue';
 * 
 * export const {
 *   createEmailQueue,
 *   createImageQueue,
 *   getEmailQueue,
 *   getImageQueue
 * } = createMultiQueueFactory({
 *   email: () => new FileQueue({ name: 'email', path: './email-queue' }),
 *   image: () => new FileQueue({ name: 'image', path: './image-queue' })
 * });
 * 
 * // job-file.ts
 * import { getEmailQueue } from './queue-factories.js';
 * 
 * export const emailJob: JobDefinition<...> = {
 *   handler: async (args) => {
 *     const queue = getEmailQueue(); // Specific queue, no circular deps!
 *   }
 * };
 * ```
 */
export function createMultiQueueFactory<T extends Record<string, any>>(
  queueConfigs: { [K in keyof T]: () => T[K] }
): {
  [K in keyof T as `create${Capitalize<string & K>}Queue`]: () => T[K];
} & {
  [K in keyof T as `get${Capitalize<string & K>}Queue`]: () => T[K];
} {
  const factories: Record<string, () => any> = {};
  const result: any = {};

  for (const [queueName, factory] of Object.entries(queueConfigs)) {
    const capitalizedName = queueName.charAt(0).toUpperCase() + queueName.slice(1);
    const memoizedFactory = createQueueFactory(factory as () => any);
    
    // Create getter (getEmailQueue, getImageQueue, etc.)
    const getterName = `get${capitalizedName}Queue`;
    result[getterName] = memoizedFactory;
    
    // Create creator alias (createEmailQueue, createImageQueue, etc.)
    const creatorName = `create${capitalizedName}Queue`;
    result[creatorName] = memoizedFactory;
    
    factories[queueName] = memoizedFactory;
  }

  return result;
}

/**
 * Utility to create a queue factory with automatic job assembly.
 * This combines queue creation with job registration in a single factory.
 * 
 * @example
 * ```typescript
 * // email-queue.ts
 * import { createQueueWithJobs } from 'adapter-queue';
 * import { assembleJobs } from 'adapter-queue';
 * import { emailJob, notificationJob } from './jobs/index.js';
 * 
 * export const getEmailQueue = createQueueWithJobs(
 *   [emailJob, notificationJob],
 *   (jobs) => {
 *     const queue = new FileQueue({ name: 'email', path: './email-queue' });
 *     const handlers = assembleJobs(jobs);
 *     queue.setHandlers(handlers);
 *     return queue;
 *   }
 * );
 * 
 * // job-file.ts
 * import { getEmailQueue } from './email-queue.js';
 * 
 * export const followUpJob: JobDefinition<...> = {
 *   handler: async (args) => {
 *     const queue = getEmailQueue(); // Auto-assembled queue!
 *   }
 * };
 * ```
 */
export function createQueueWithJobs<TQueue, TJobs extends readonly import('../interfaces/job.ts').JobDefinition<any>[]>(
  jobs: TJobs,
  createQueue: (jobs: TJobs) => TQueue
): () => TQueue & { _jobTypes: import('../interfaces/job.ts').JobDefinitionsToMap<TJobs> } {
  return createQueueFactory(() => {
    const queue = createQueue(jobs) as any;
    return queue;
  });
}

/**
 * Development helper that warns about potential circular dependencies.
 * Only active in development mode.
 */
export function createQueueFactoryWithWarnings<T>(
  createQueue: () => T,
  queueName: string = 'unnamed'
): () => T {
  const factory = createQueueFactory(createQueue);
  
  return function getQueueWithWarnings(): T {
    // Safe check for development environment
    const isDevelopment = typeof globalThis !== 'undefined' && 
      (globalThis as any).process?.env?.NODE_ENV === 'development';
      
    if (isDevelopment) {
      const stack = new Error().stack;
      if (stack?.includes('queue-setup') || stack?.includes('createQueue')) {
        // Safe console usage
        if (typeof globalThis !== 'undefined' && (globalThis as any).console?.warn) {
          (globalThis as any).console.warn(
            `⚠️  Potential circular dependency detected in queue "${queueName}". ` +
            `getQueue() called from queue setup code. Consider moving job definitions ` +
            `that use getQueue() to separate files.`
          );
        }
      }
    }
    
    return factory();
  };
}