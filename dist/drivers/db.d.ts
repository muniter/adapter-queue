import { Queue } from '../core/queue.ts';
import { JobStatus, JobMeta, QueueMessage } from '../interfaces/job.ts';
import { DatabaseAdapter } from '../interfaces/database.ts';
export declare class DbQueue extends Queue {
    private db;
    constructor(db: DatabaseAdapter, options?: {
        serializer?: any;
        ttrDefault?: number;
        attemptsDefault?: number;
    });
    protected pushMessage(payload: Buffer, meta: JobMeta): Promise<string>;
    protected reserve(timeout: number): Promise<QueueMessage | null>;
    protected release(message: QueueMessage): Promise<void>;
    status(id: string): Promise<JobStatus>;
    protected handleError(message: QueueMessage, error: unknown): Promise<boolean>;
    private isRetryableJob;
}
