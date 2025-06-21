export interface Job<T = any> {
  execute(queue: Queue): Promise<T> | T;
}

export interface RetryableJob<T = any> extends Job<T> {
  getTtr(): number;
  canRetry(attempt: number, error: unknown): boolean;
}

export interface Queue {
  push(job: Job): Promise<string>;
  status(id: string): Promise<JobStatus>;
  run(repeat?: boolean, timeout?: number): Promise<void>;
}

export type JobStatus = 'waiting' | 'reserved' | 'done';

export interface JobMeta {
  ttr?: number;
  delay?: number;
  priority?: number;
  attempt?: number;
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

export type QueueEvent = 
  | { type: 'beforePush'; job: Job; meta: JobMeta }
  | { type: 'afterPush'; id: string; job: Job; meta: JobMeta }
  | { type: 'beforeExec'; id: string; job: Job; meta: JobMeta }
  | { type: 'afterExec'; id: string; job: Job; meta: JobMeta; result: any }
  | { type: 'afterError'; id: string; job: Job; meta: JobMeta; error: unknown };