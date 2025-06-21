import type { JobStatus, JobMeta } from './job.ts';

export interface DatabaseAdapter {
  insertJob(payload: Buffer, meta: JobMeta): Promise<string>;
  reserveJob(timeout: number): Promise<QueueJobRecord | null>;
  completeJob(id: string): Promise<void>;
  releaseJob(id: string): Promise<void>;
  failJob(id: string, error: string): Promise<void>;
  getJobStatus(id: string): Promise<JobStatus | null>;
}

export interface QueueJobRecord {
  id: string;
  payload: Buffer;
  meta: JobMeta;
  pushedAt: Date;
  reservedAt?: Date;
  doneAt?: Date;
}