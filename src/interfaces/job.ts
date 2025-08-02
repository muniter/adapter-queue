import type { Queue } from "../core/queue.ts";

export type JobStatus = 'waiting' | 'delayed' | 'reserved' | 'done' | 'failed';

export interface JobMeta {
  /** Time to run - number of seconds to run the job */ 
  ttr?: number;
  /** Number of seconds to delay job execution from now */
  delaySeconds?: number;
  /** Job priority - higher numbers = higher priority (processed first) */
  priority?: number;
  /** Job pushed at */
  pushedAt?: Date;
  /** Job reserved at */
  reservedAt?: Date;
  /** Job done at */
  doneAt?: Date;
  /** SQS receipt handle */
  receiptHandle?: string;  // For SQS
}

/**
 * Job context object passed to handlers containing full job information.
 */
export interface JobContext<T> {
  /** Job ID */
  id: string;
  /** Job payload */
  payload: T;
  /** Job meta: ttr, delaySeconds, priority, pushedAt, reservedAt, doneAt, receiptHandle */
  meta: JobMeta;
  /** Job pushed at */
  pushedAt?: Date;
  /** Job reserved at */
  reservedAt?: Date;
}

/**
 * Type for a single job handler function.
 */
export type JobHandler<T, Q = Queue> = (job: JobContext<T>, queue: Queue) => Promise<void> | void;

/**
 * Type mapping all job types to their corresponding handlers.
 * Ensures type safety and completeness of handler registration.
 */
export type JobHandlers<TJobMap> = {
  [K in keyof TJobMap]: JobHandler<TJobMap[K]>;
}

export interface QueueMessage {
  id: string;
  /** Job name */
  name: string;
  /** Job payload */
  payload: string;
  /** Job meta: ttr, delaySeconds, priority, pushedAt, reservedAt, doneAt, receiptHandle */
  meta: JobMeta;
}

export interface JobData {
  /** Job name */
  name: string;
  /** Job payload */
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
  /** Time to run - number of seconds to run the job */ 
  ttr?: number;
}

// Full options interface (for internal use)
export interface JobOptions extends BaseJobOptions {
  /** Number of seconds to delay job execution from now */
  delaySeconds?: number;
  /** Job priority - higher numbers = higher priority (processed first) */
  priority?: number;
}

// Driver-specific options interfaces (without payload)
export interface DbJobOptions extends BaseJobOptions {
  // DB adapters may or may not support delay/priority - we allow them for flexibility
  // The specific DatabaseAdapter implementation determines actual support
  /** Number of seconds to delay job execution from now. Support varies by database adapter. */
  delaySeconds?: number;
  /** Job priority - higher numbers = higher priority. Support varies by database adapter. */
  priority?: number;
}

export interface SqsJobOptions extends BaseJobOptions {
  /** Number of seconds to delay job execution from now (0-900 seconds max for SQS) */
  delaySeconds?: number;
}

export interface FileJobOptions extends BaseJobOptions {
  /** Number of seconds to delay job execution from now */
  delaySeconds?: number;
}

export interface InMemoryJobOptions extends BaseJobOptions {
  /** Number of seconds to delay job execution from now */
  delaySeconds?: number;
  /** Job priority - higher numbers = higher priority (processed first) */
  priority?: number;
}

export interface JobRequestFull<TPayload> extends BaseJobOptions {
  /** Job priority - higher numbers = higher priority (processed first) */
  priority?: number;
  /** Job delay - number of seconds to delay job execution from now */
  delaySeconds?: number;
  /** Job payload */
  payload: TPayload;
}

// Combined interfaces that include payload for the new API
export interface BaseJobRequest<TPayload> extends BaseJobOptions {
  /** Job payload */
  payload: TPayload;
}

export interface DbJobRequest<TPayload> extends DbJobOptions {
  /** Job payload */
  payload: TPayload;
}

export interface SqsJobRequest<TPayload> extends SqsJobOptions {
  /** Job payload */
  payload: TPayload;
}

export interface FileJobRequest<TPayload> extends FileJobOptions {
  /** Job payload */
  payload: TPayload;
}

export interface InMemoryJobRequest<TPayload> extends InMemoryJobOptions {
  /** Job payload */
  payload: TPayload;
}

