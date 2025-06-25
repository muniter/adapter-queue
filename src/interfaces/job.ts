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

