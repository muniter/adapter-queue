export type JobStatus = 'waiting' | 'delayed' | 'reserved' | 'done' | 'failed';

export interface JobMeta {
  ttr?: number;
  delay?: number;
  priority?: number;
  pushedAt?: Date;
  reservedAt?: Date;
  doneAt?: Date;
  receiptHandle?: string;  // For SQS
}

/**
 * Job context object passed to handlers containing full job information.
 */
export interface JobContext<T> {
  id: string;
  payload: T;
  meta: JobMeta;
  pushedAt?: Date;
  reservedAt?: Date;
}

/**
 * Convenient type alias for job handler arguments.
 * Use this when defining handlers throughout your application.
 * 
 * @example
 * ```typescript
 * const emailHandler = async (args: QueueArgs<EmailPayload>) => {
 *   const { id, payload, meta } = args;
 *   // Process email...
 * };
 * ```
 */
export type QueueArgs<T> = JobContext<T>;

/**
 * Type for a single job handler function.
 */
export type JobHandler<T> = (job: JobContext<T>, queue: any) => Promise<void> | void;

/**
 * Type mapping all job types to their corresponding handlers.
 * Ensures type safety and completeness of handler registration.
 */
export type JobHandlers<TJobMap> = {
  [K in keyof TJobMap]: JobHandler<TJobMap[K]>;
}

/**
 * Type for a standalone job handler function that can be defined anywhere.
 * Use this for handlers that will be registered separately from their definition.
 * 
 * @example
 * ```typescript
 * const emailHandler: QueueHandler<EmailPayload> = async (args, queue) => {
 *   const { id, payload } = args;
 *   await sendEmail(payload.to, payload.subject, payload.body);
 * };
 * ```
 */
export type QueueHandler<T> = JobHandler<T>;

/**
 * Type for extracting the payload type from a job map for a specific job name.
 * Useful when you need to reference the payload type for a specific job.
 * 
 * @example
 * ```typescript
 * interface MyJobs {
 *   'send-email': { to: string; subject: string };
 *   'process-image': { url: string; width: number };
 * }
 * 
 * type EmailPayload = JobPayload<MyJobs, 'send-email'>; // { to: string; subject: string }
 * ```
 */
export type JobPayload<TJobMap, K extends keyof TJobMap> = TJobMap[K];

/**
 * Simple job definition type for defining individual jobs with full type safety.
 * This is the recommended way to define jobs throughout your application.
 * 
 * @example
 * ```typescript
 * const welcomeEmailJob: JobDefinition<{
 *   to: string;
 *   name: string;
 * }> = {
 *   name: "welcome-email",
 *   handler: async (args) => {
 *     const { payload } = args; // Fully typed as { to: string; name: string }
 *     await sendWelcomeEmail(payload.to, payload.name);
 *   }
 * };
 * ```
 */
export interface JobDefinition<TPayload> {
  name: string;
  handler: (args: QueueArgs<TPayload>, queue?: any) => Promise<void> | void;
}

/**
 * Extract the payload type from a job definition.
 */
export type JobDefinitionPayload<T extends JobDefinition<any>> = T extends JobDefinition<infer P> ? P : never;

/**
 * Extract the job name from a job definition.
 */
export type JobDefinitionName<T extends JobDefinition<any>> = T['name'];

/**
 * Convert a job definition to a job map entry.
 */
export type JobDefinitionToMapEntry<T extends JobDefinition<any>> = {
  [K in JobDefinitionName<T>]: JobDefinitionPayload<T>;
};

/**
 * Convert an array of job definitions to a complete job map.
 * 
 * @example
 * ```typescript
 * const jobs = [welcomeEmailJob, notificationJob, imageJob] as const;
 * type MyJobMap = JobDefinitionsToMap<typeof jobs>;
 * // Results in: { 'welcome-email': EmailPayload; 'notification': NotificationPayload; 'process-image': ImagePayload }
 * ```
 */
export type JobDefinitionsToMap<T extends readonly JobDefinition<any>[]> = {
  [K in T[number]['name']]: T[number] extends JobDefinition<infer P> 
    ? T[number]['name'] extends K 
      ? P 
      : never 
    : never;
};

/**
 * Convert an array of job definitions to handlers object.
 */
export type JobDefinitionsToHandlers<T extends readonly JobDefinition<any>[]> = {
  [K in T[number]['name']]: T[number] extends JobDefinition<infer P>
    ? T[number]['name'] extends K
      ? JobHandler<P>
      : never
    : never;
};

// Legacy types for backward compatibility
export type JobDefinitionComplex<TName extends string, TPayload> = {
  name: TName;
  payload: TPayload;
};
export type JobName<T extends JobDefinitionComplex<any, any>> = T['name'];
export type JobPayloadType<T extends JobDefinitionComplex<any, any>> = T['payload'];
export type JobDefinitionHandler<T extends JobDefinitionComplex<any, any>> = QueueHandler<JobPayloadType<T>>;
export interface JobModule<TName extends string, TPayload> {
  name: TName;
  handler: QueueHandler<TPayload>;
}
export type JobModuleToMapEntry<T extends JobModule<any, any>> = {
  [K in T['name']]: T extends JobModule<K, infer P> ? P : never;
};
export type JobModulesToMap<T extends readonly JobModule<any, any>[]> = {
  [K in T[number]['name']]: T[number] extends JobModule<K, infer P> ? P : never;
};
export type JobModulesToHandlers<T extends readonly JobModule<any, any>[]> = {
  [K in T[number]['name']]: T[number] extends JobModule<K, infer P> ? QueueHandler<P> : never;
};

export interface QueueMessage {
  id: string;
  payload: string;
  meta: JobMeta;
}

export interface JobData {
  name: string;
  payload: any;
}

export type QueueEvent = 
  | { type: 'beforePush'; name: string; payload: any; meta: JobMeta }
  | { type: 'afterPush'; id: string; name: string; payload: any; meta: JobMeta }
  | { type: 'beforeExec'; id: string; name: string; payload: any; meta: JobMeta }
  | { type: 'afterExec'; id: string; name: string; payload: any; meta: JobMeta; result: any }
  | { type: 'afterError'; id: string; name: string; payload: any; meta: JobMeta; error: unknown };

// Base options supported by all drivers (without payload)
export interface BaseJobOptions {
  ttr?: number;
}

// Full options interface (for internal use)
export interface JobOptions extends BaseJobOptions {
  delay?: number;
  priority?: number;
}

// Driver-specific options interfaces (without payload)
export interface DbJobOptions extends BaseJobOptions {
  // DB adapters may or may not support delay/priority - we allow them for flexibility
  // The specific DatabaseAdapter implementation determines actual support
  delay?: number;
  priority?: number;
}

export interface SqsJobOptions extends BaseJobOptions {
  delay?: number;
  // SQS supports delay natively via DelaySeconds
  // Priority is not supported (would require FIFO queues + message group IDs)
}

export interface FileJobOptions extends BaseJobOptions {
  delay?: number;
  // File queue implements delay functionality  
  // Priority ordering is not implemented in current FileQueue
}

export interface InMemoryJobOptions extends BaseJobOptions {
  delay?: number;
  priority?: number;
  // InMemory queue supports both delay and priority
}

// Combined interfaces that include payload for the new API
export interface BaseJobRequest<TPayload> extends BaseJobOptions {
  payload: TPayload;
}

export interface DbJobRequest<TPayload> extends DbJobOptions {
  payload: TPayload;
}

export interface SqsJobRequest<TPayload> extends SqsJobOptions {
  payload: TPayload;
}

export interface FileJobRequest<TPayload> extends FileJobOptions {
  payload: TPayload;
}

export interface InMemoryJobRequest<TPayload> extends InMemoryJobOptions {
  payload: TPayload;
}

