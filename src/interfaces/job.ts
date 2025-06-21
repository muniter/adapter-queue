export type JobStatus = 'waiting' | 'reserved' | 'done';

export interface JobMeta {
  ttr?: number;
  delay?: number;
  priority?: number;
  pushedAt?: Date;
  reservedAt?: Date;
  doneAt?: Date;
  receiptHandle?: string;  // For SQS
}

export interface QueueMessage {
  id: string;
  payload: Buffer;
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

// Base options supported by all drivers
export interface BaseJobOptions {
  ttr?: number;
}

// Full options interface (for internal use)
export interface JobOptions extends BaseJobOptions {
  delay?: number;
  priority?: number;
}

// Driver-specific options interfaces
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

