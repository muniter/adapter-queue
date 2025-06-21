import { EventEmitter } from 'events';
import { Job, JobStatus, JobMeta, QueueMessage } from '../interfaces/job.ts';
import { Serializer } from './serializer.ts';
export declare abstract class Queue extends EventEmitter {
    protected ttrDefault: number;
    protected attemptsDefault: number;
    protected serializer: Serializer;
    private pushOpts;
    constructor(options?: {
        serializer?: Serializer;
        ttrDefault?: number;
        attemptsDefault?: number;
    });
    ttr(value: number): this;
    priority(priority: number): this;
    push(job: Job): Promise<string>;
    run(repeat?: boolean, timeout?: number): Promise<void>;
    protected handleMessage(message: QueueMessage): Promise<boolean>;
    protected handleError(message: QueueMessage, error: unknown): Promise<boolean>;
    private isRetryableJob;
    protected abstract pushMessage(payload: Buffer, meta: JobMeta): Promise<string>;
    protected abstract reserve(timeout: number): Promise<QueueMessage | null>;
    protected abstract release(message: QueueMessage): Promise<void>;
    abstract status(id: string): Promise<JobStatus>;
}
