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

export interface JobOptions {
  ttr?: number;
  delay?: number;
  priority?: number;
}

// Feature interfaces for optional queue capabilities
export interface SupportsPriority<TJobMap> {
  /**
   * Sets the priority for the next job to be added.
   * Higher priority jobs are processed before lower priority ones.
   * 
   * @param priority - Priority value (higher numbers = higher priority)
   * @returns This queue instance for method chaining
   */
  priority(priority: number): this;
}

export interface SupportsDelay<TJobMap> {
  /**
   * Sets a delay for the next job to be added.
   * The job will not be available for processing until the delay has elapsed.
   * 
   * @param seconds - Delay in seconds
   * @returns This queue instance for method chaining
   */
  delay(seconds: number): this;
}

export interface SupportsTTR<TJobMap> {
  /**
   * Sets the time-to-run (TTR) for the next job to be added.
   * TTR is the maximum time in seconds a job can run before it's considered timed out.
   * 
   * @param value - TTR in seconds
   * @returns This queue instance for method chaining
   */
  ttr(value: number): this;
}