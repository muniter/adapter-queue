import type { Queue } from "../core/queue.ts";

export type JobStatus = 'waiting' | 'delayed' | 'reserved' | 'done' | 'failed';

export interface JobMeta {
  /** Job name */
  name: string;
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
  /** Job payload */
  payload: unknown;
  /** Job meta: ttr, delaySeconds, priority, pushedAt, reservedAt, doneAt, receiptHandle */
  meta: JobMeta;
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

// Feature interfaces for composable job options
export interface WithPriority {
  /** Job priority - higher numbers = higher priority (processed first) */
  priority?: number;
}

export interface WithDelay {
  /** Number of seconds to delay job execution from now */
  delaySeconds?: number;
}

// Full options interface (for internal use)
export interface JobOptions extends BaseJobOptions, WithPriority, WithDelay {}


export interface JobRequestFull<TPayload> extends BaseJobOptions, WithPriority, WithDelay {
  /** Job payload */
  payload: TPayload;
}

// Driver-specific job request interfaces using feature composition
// Each interface defines what features the driver supports

export interface BaseJobRequest<TPayload> extends BaseJobOptions {
  /** Job payload */
  payload: TPayload;
}


