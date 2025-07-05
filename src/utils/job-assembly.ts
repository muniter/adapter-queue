import type { JobDefinition, JobDefinitionsToMap, JobDefinitionsToHandlers } from '../interfaces/job.ts';

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