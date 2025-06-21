import { Queue } from '../core/queue.ts';
import { JobStatus, JobMeta, QueueMessage } from '../interfaces/job.ts';
export interface SQSClient {
    sendMessage(params: {
        QueueUrl: string;
        MessageBody: string;
        DelaySeconds?: number;
        MessageAttributes?: Record<string, {
            StringValue: string;
            DataType: string;
        }>;
    }): Promise<{
        MessageId: string;
    }>;
    receiveMessage(params: {
        QueueUrl: string;
        MaxNumberOfMessages?: number;
        WaitTimeSeconds?: number;
        MessageAttributeNames?: string[];
    }): Promise<{
        Messages?: Array<{
            MessageId: string;
            Body: string;
            ReceiptHandle: string;
            MessageAttributes?: Record<string, {
                StringValue: string;
            }>;
        }>;
    }>;
    deleteMessage(params: {
        QueueUrl: string;
        ReceiptHandle: string;
    }): Promise<void>;
    changeMessageVisibility(params: {
        QueueUrl: string;
        ReceiptHandle: string;
        VisibilityTimeout: number;
    }): Promise<void>;
}
export declare class SqsQueue extends Queue {
    private client;
    private queueUrl;
    constructor(client: SQSClient, queueUrl: string, options?: {
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
