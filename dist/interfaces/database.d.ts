export interface DatabaseAdapter {
    insertJob(payload: Buffer, meta: JobMeta): Promise<string>;
    reserveJob(timeout: number): Promise<QueueJobRecord | null>;
    releaseJob(id: string): Promise<void>;
    getJobStatus(id: string): Promise<JobStatus | null>;
    updateJobAttempt(id: string, attempt: number): Promise<void>;
}
export interface QueueJobRecord {
    id: string;
    payload: Buffer;
    meta: JobMeta;
    pushedAt: Date;
    reservedAt?: Date;
    doneAt?: Date;
    attempt: number;
}
export interface JobMeta {
    ttr?: number;
    delay?: number;
    priority?: number;
    attempt?: number;
    pushedAt?: Date;
    reservedAt?: Date;
    doneAt?: Date;
}
export type JobStatus = 'waiting' | 'reserved' | 'done';
