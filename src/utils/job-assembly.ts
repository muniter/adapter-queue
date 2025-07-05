import type { JobModule, JobModulesToMap, JobModulesToHandlers } from '../interfaces/job.ts';

/**
 * Assembles an array of job modules into a handlers object for queue registration.
 * This function extracts all handlers from job modules and creates a handlers object
 * that can be passed to queue.setHandlers().
 * 
 * @param modules - Array of job modules to assemble
 * @returns Object mapping job names to their handlers
 * 
 * @example
 * ```typescript
 * import { assembleHandlers } from 'adapter-queue/utils';
 * 
 * const handlers = assembleHandlers([emailJob, imageJob, reportJob]);
 * queue.setHandlers(handlers);
 * ```
 */
export function assembleHandlers<T extends readonly JobModule<any, any>[]>(
  modules: T
): JobModulesToHandlers<T> {
  const handlers = {} as any;
  
  for (const module of modules) {
    handlers[module.name] = module.handler;
  }
  
  return handlers;
}

/**
 * Creates a type-safe queue instance with job modules.
 * This function combines job modules and returns both the job map type and assembled handlers.
 * 
 * @param modules - Array of job modules to assemble
 * @returns Object containing the assembled handlers and a type helper
 * 
 * @example
 * ```typescript
 * import { createQueueWithModules } from 'adapter-queue/utils';
 * 
 * const { handlers, createQueue } = createQueueWithModules([emailJob, imageJob]);
 * 
 * // Create queue with inferred type
 * const queue = createQueue(new FileQueue({ name: 'my-queue', path: './queue' }));
 * 
 * // Register handlers
 * queue.setHandlers(handlers);
 * ```
 */
export function createQueueWithModules<T extends readonly JobModule<any, any>[]>(
  modules: T
) {
  const handlers = assembleHandlers(modules);
  
  return {
    handlers,
    createQueue: <Q extends { setHandlers(handlers: JobModulesToHandlers<T>): void }>(queue: Q) => {
      return queue as Q & { _jobMap: JobModulesToMap<T> };
    }
  };
}

/**
 * Utility function to define a job module with better type inference.
 * This version uses a more sophisticated approach to infer the payload type from the handler.
 * 
 * @param name - The job name
 * @param handler - The job handler function
 * @returns A properly typed job module
 * 
 * @example
 * ```typescript
 * import { defineJob } from 'adapter-queue/utils';
 * 
 * export const emailJob = defineJob('send-email', async (args, queue) => {
 *   const { payload } = args;
 *   // TypeScript will infer payload type from your destructuring
 *   const { to, subject, body } = payload;
 *   await sendEmail(to, subject, body);
 * });
 * ```
 */
export function defineJob<
  TName extends string,
  THandler extends (args: any, queue: any) => Promise<void> | void
>(
  name: TName,
  handler: THandler
): JobModule<TName, THandler extends (args: infer Args, queue: any) => any 
  ? Args extends { payload: infer P } 
    ? P 
    : unknown 
  : unknown> {
  return {
    name,
    handler: handler as any
  };
}

/**
 * Alternative defineJob that requires explicit payload type.
 * Use this when you want to be explicit about the payload type.
 * 
 * @param name - The job name
 * @param handler - The job handler function
 * @returns A properly typed job module
 * 
 * @example
 * ```typescript
 * import { defineJobWithPayload } from 'adapter-queue/utils';
 * 
 * export const emailJob = defineJobWithPayload('send-email', async (args: QueueArgs<{
 *   to: string;
 *   subject: string;
 *   body: string;
 * }>, queue) => {
 *   const { payload } = args;
 *   await sendEmail(payload.to, payload.subject, payload.body);
 * });
 * ```
 */
export function defineJobWithPayload<TName extends string, TPayload>(
  name: TName,
  handler: (args: import('../interfaces/job.ts').QueueArgs<TPayload>, queue: any) => Promise<void> | void
): JobModule<TName, TPayload> {
  return {
    name,
    handler
  };
}

/**
 * Utility function to create a job definition type.
 * This is purely for type-level work and doesn't produce runtime values.
 * 
 * @example
 * ```typescript
 * import { defineJobType } from 'adapter-queue/utils';
 * 
 * export type EmailJob = ReturnType<typeof defineJobType<'send-email', {
 *   to: string;
 *   subject: string;
 *   body: string;
 * }>>;
 * ```
 */
export function defineJobType<TName extends string, TPayload>(): import('../interfaces/job.ts').JobDefinition<TName, TPayload> {
  return {} as any; // This function is only for type-level work
}