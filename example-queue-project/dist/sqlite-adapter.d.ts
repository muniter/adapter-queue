import { DatabaseAdapter, JobMeta, QueueJobRecord, JobStatus } from '@muniter/queue';
export declare class SQLiteDatabaseAdapter implements DatabaseAdapter {
    insertJob(payload: Buffer, meta: JobMeta): Promise<string>;
    reserveJob(timeout: number): Promise<QueueJobRecord | null>;
    releaseJob(id: string): Promise<void>;
    getJobStatus(id: string): Promise<JobStatus | null>;
    updateJobAttempt(id: string, attempt: number): Promise<void>;
    deleteJob(id: string): Promise<void>;
    markJobDone(id: string): Promise<void>;
}
//# sourceMappingURL=sqlite-adapter.d.ts.map