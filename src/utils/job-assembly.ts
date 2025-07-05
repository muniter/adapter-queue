import type { 
  JobDefinition, 
  JobDefinitionsToMap, 
  JobDefinitionsToHandlers,
  JobDefinitionWithQueue,
  JobFactory,
  JobDefinitionWithLocator,
  JobContextWithQueue,
  QueueArgs
} from '../interfaces/job.ts';
import { createQueueGetter, setQueue } from './queue-registry.ts';

/**
 * Assembles an array of job definitions into a handlers object for queue registration.
 * This is the main function you'll use to combine your job definitions.
 * 
 * @param jobs - Array of job definitions to assemble
 * @returns Object mapping job names to their handlers
 * 
 * @example
 * ```typescript
 * import { assembleJobs } from 'adapter-queue';
 * 
 * const handlers = assembleJobs([welcomeEmailJob, notificationJob, imageJob]);
 * queue.setHandlers(handlers);
 * ```
 */
export function assembleJobs<T extends readonly JobDefinition<any>[]>(
  jobs: T
): JobDefinitionsToHandlers<T> {
  const handlers = {} as any;
  
  for (const job of jobs) {
    handlers[job.name] = job.handler;
  }
  
  return handlers;
}

/**
 * Assembles job definitions with queue context to avoid circular dependencies.
 * This function creates handlers that receive an enhanced context with queue methods.
 * 
 * @param jobs - Array of job definitions with queue context
 * @param queue - Queue instance to inject into context
 * @returns Object mapping job names to their handlers
 * 
 * @example
 * ```typescript
 * import { assembleJobsWithQueue } from 'adapter-queue';
 * 
 * const handlers = assembleJobsWithQueue([emailJob, imageJob], queue);
 * queue.setHandlers(handlers);
 * ```
 */
export function assembleJobsWithQueue<T extends readonly JobDefinitionWithQueue<any>[]>(
  jobs: T,
  queue: any
): any {
  const handlers = {} as any;
  
  for (const job of jobs) {
    handlers[job.name] = (args: QueueArgs<any>) => {
      // Create enhanced context with queue methods
      const enhancedArgs: JobContextWithQueue<any> = {
        ...args,
        queue: {
          addJob: (name: string, request: { payload: any }) => queue.addJob(name, request),
          getStatus: (id: string) => queue.status(id)
        }
      };
      
      return job.handler(enhancedArgs);
    };
  }
  
  return handlers;
}

/**
 * Assembles job factories into handlers by calling the factory functions with the queue.
 * This pattern allows jobs to receive the queue instance without circular dependencies.
 * 
 * @param factories - Array of job factories
 * @param queue - Queue instance to pass to factories
 * @returns Object mapping job names to their handlers
 * 
 * @example
 * ```typescript
 * import { assembleJobFactories } from 'adapter-queue';
 * 
 * const handlers = assembleJobFactories([emailJobFactory, imageJobFactory], queue);
 * queue.setHandlers(handlers);
 * ```
 */
export function assembleJobFactories<T extends readonly JobFactory<any>[]>(
  factories: T,
  queue: any
): any {
  const handlers = {} as any;
  
  for (const factory of factories) {
    handlers[factory.name] = factory.factory(queue);
  }
  
  return handlers;
}

/**
 * Assembles job definitions that use the service locator pattern.
 * Handlers receive a function to get the queue when needed.
 * 
 * @param jobs - Array of job definitions with locator pattern
 * @param queueName - Optional queue name for the locator
 * @returns Object mapping job names to their handlers
 * 
 * @example
 * ```typescript
 * import { assembleJobsWithLocator } from 'adapter-queue';
 * 
 * const handlers = assembleJobsWithLocator([emailJob, imageJob]);
 * queue.setHandlers(handlers);
 * ```
 */
export function assembleJobsWithLocator<T extends readonly JobDefinitionWithLocator<any>[]>(
  jobs: T,
  queueName?: string
): any {
  const handlers = {} as any;
  const queueGetter = createQueueGetter(queueName);
  
  for (const job of jobs) {
    handlers[job.name] = (args: QueueArgs<any>) => {
      return job.handler(args, queueGetter);
    };
  }
  
  return handlers;
}

/**
 * Universal job assembler that can handle any combination of job definition types.
 * Automatically detects the job type and assembles appropriately.
 * 
 * @param jobs - Mixed array of different job definition types
 * @param queue - Queue instance (required for some job types)
 * @returns Object mapping job names to their handlers
 * 
 * @example
 * ```typescript
 * import { assembleJobsUniversal } from 'adapter-queue';
 * 
 * const handlers = assembleJobsUniversal([
 *   simpleJob,           // JobDefinition
 *   queueContextJob,     // JobDefinitionWithQueue  
 *   factoryJob,          // JobFactory
 *   locatorJob           // JobDefinitionWithLocator
 * ], queue);
 * 
 * queue.setHandlers(handlers);
 * ```
 */
export function assembleJobsUniversal(
  jobs: readonly (JobDefinition<any> | JobDefinitionWithQueue<any> | JobFactory<any> | JobDefinitionWithLocator<any>)[],
  queue?: any
): any {
  const handlers = {} as any;
  
  for (const job of jobs) {
    if ('factory' in job) {
      // JobFactory
      if (!queue) {
        throw new Error(`Queue instance required for job factory: ${job.name}`);
      }
      handlers[job.name] = job.factory(queue);
      
    } else if ('handler' in job) {
      // Check if it's JobDefinitionWithQueue by trying to call with enhanced context
      const handlerStr = job.handler.toString();
      
      if (handlerStr.includes('queue.addJob') || handlerStr.includes('args.queue')) {
        // Likely JobDefinitionWithQueue
        if (!queue) {
          throw new Error(`Queue instance required for job with queue context: ${job.name}`);
        }
        
        handlers[job.name] = (args: QueueArgs<any>) => {
          const enhancedArgs: JobContextWithQueue<any> = {
            ...args,
            queue: {
              addJob: (name: string, request: { payload: any }) => queue.addJob(name, request),
              getStatus: (id: string) => queue.status(id)
            }
          };
          return (job as JobDefinitionWithQueue<any>).handler(enhancedArgs);
        };
        
      } else if (job.handler.length > 1) {
        // JobDefinitionWithLocator (has getQueue parameter)
        const queueGetter = createQueueGetter();
        handlers[job.name] = (args: QueueArgs<any>) => {
          return (job as JobDefinitionWithLocator<any>).handler(args, queueGetter);
        };
        
      } else {
        // Regular JobDefinition
        handlers[job.name] = job.handler;
      }
    }
  }
  
  return handlers;
}

/**
 * Legacy function for backward compatibility.
 * Use `assembleJobs` instead.
 */
export function assembleHandlers<T extends readonly JobDefinition<any>[]>(
  jobs: T
): JobDefinitionsToHandlers<T> {
  return assembleJobs(jobs);
}

/**
 * Creates a type-safe queue setup with job definitions.
 * This function provides both the assembled handlers and type information.
 * 
 * @param jobs - Array of job definitions to assemble
 * @returns Object containing the assembled handlers and type utilities
 * 
 * @example
 * ```typescript
 * import { createQueueSetup } from 'adapter-queue';
 * 
 * const { handlers, JobMap } = createQueueSetup([welcomeEmailJob, notificationJob]);
 * 
 * // Create queue with inferred type
 * const queue = new FileQueue<typeof JobMap>({ name: 'my-queue', path: './queue' });
 * 
 * // Register handlers
 * queue.setHandlers(handlers);
 * ```
 */
export function createQueueSetup<T extends readonly JobDefinition<any>[]>(
  jobs: T
) {
  const handlers = assembleJobs(jobs);
  
  return {
    handlers,
    // Type helper for the job map
    JobMap: {} as JobDefinitionsToMap<T>
  };
}

/**
 * Creates a queue setup that avoids circular dependencies by registering the queue
 * after handler assembly and automatically setting up the queue registry.
 * 
 * @param jobs - Array of job definitions  
 * @param createQueue - Function that creates the queue instance
 * @returns Configured queue instance ready to use
 * 
 * @example
 * ```typescript
 * import { createQueueWithRegistry } from 'adapter-queue';
 * import { FileQueue } from 'adapter-queue';
 * 
 * const queue = createQueueWithRegistry(
 *   [emailJob, imageJob, reportJob],
 *   () => new FileQueue({ name: 'my-queue', path: './queue' })
 * );
 * 
 * // Queue is ready to use, jobs can access it via getQueue()
 * await queue.run();
 * ```
 */
export function createQueueWithRegistry<T extends readonly (JobDefinition<any> | JobDefinitionWithQueue<any> | JobFactory<any> | JobDefinitionWithLocator<any>)[]>(
  jobs: T,
  createQueue: () => any
): any {
  // Create queue instance
  const queue = createQueue();
  
  // Assemble handlers with queue context
  const handlers = assembleJobsUniversal(jobs, queue);
  
  // Register handlers with queue
  queue.setHandlers(handlers);
  
  // Register queue in global registry for jobs to access
  setQueue(queue);
  
  return queue;
}

/**
 * Legacy function for backward compatibility.
 * Use `createQueueSetup` instead.
 */
export function createQueueWithModules<T extends readonly JobDefinition<any>[]>(
  jobs: T
) {
  const setup = createQueueSetup(jobs);
  
  return {
    handlers: setup.handlers,
    createQueue: <Q extends { setHandlers(handlers: JobDefinitionsToHandlers<T>): void }>(queue: Q) => {
      return queue as Q & { _jobMap: JobDefinitionsToMap<T> };
    }
  };
}

/**
 * Utility function to help TypeScript infer the job definition type.
 * This is optional but can help with better type inference.
 * 
 * @param job - The job definition object
 * @returns The same job definition with better type inference
 * 
 * @example
 * ```typescript
 * import { defineJob } from 'adapter-queue';
 * 
 * export const emailJob = defineJob({
 *   name: "send-email",
 *   handler: async (args) => {
 *     const { payload } = args; // TypeScript infers the type from usage
 *     await sendEmail(payload.to, payload.subject, payload.body);
 *   }
 * });
 * ```
 */
export function defineJob<T extends JobDefinition<any>>(job: T): T {
  return job;
}

/**
 * Legacy function - use the new JobDefinition type instead.
 */
export function defineJobWithPayload<TName extends string, TPayload>(
  name: TName,
  handler: (args: import('../interfaces/job.ts').QueueArgs<TPayload>, queue: any) => Promise<void> | void
): JobDefinition<TPayload> {
  return {
    name,
    handler
  };
}

/**
 * Legacy function - use the new JobDefinition type instead.
 */
export function defineJobType<TName extends string, TPayload>(): import('../interfaces/job.ts').JobDefinitionComplex<TName, TPayload> {
  return {} as any;
}