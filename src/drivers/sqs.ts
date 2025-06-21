import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage } from '../interfaces/job.ts';

export interface SQSClient {
  sendMessage(params: {
    QueueUrl: string;
    MessageBody: string;
    DelaySeconds?: number;
    MessageAttributes?: Record<string, { StringValue: string; DataType: string }>;
  }): Promise<{ MessageId: string }>;
  
  receiveMessage(params: {
    QueueUrl: string;
    MaxNumberOfMessages?: number;
    WaitTimeSeconds?: number;
    MessageAttributeNames?: string[];
  }): Promise<{ Messages?: Array<{
    MessageId: string;
    Body: string;
    ReceiptHandle: string;
    MessageAttributes?: Record<string, { StringValue: string }>;
  }> }>;
  
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

export class SqsQueue extends Queue {
  constructor(
    private client: SQSClient,
    private queueUrl: string,
    options: { serializer?: any; ttrDefault?: number; attemptsDefault?: number } = {}
  ) {
    super(options);
  }

  protected async pushMessage(payload: Buffer, meta: JobMeta): Promise<string> {
    const messageAttributes: Record<string, { StringValue: string; DataType: string }> = {};
    
    if (meta.ttr) {
      messageAttributes.ttr = { StringValue: meta.ttr.toString(), DataType: 'Number' };
    }
    if (meta.priority) {
      messageAttributes.priority = { StringValue: meta.priority.toString(), DataType: 'Number' };
    }
    if (meta.attempt !== undefined) {
      messageAttributes.attempt = { StringValue: meta.attempt.toString(), DataType: 'Number' };
    }

    const result = await this.client.sendMessage({
      QueueUrl: this.queueUrl,
      MessageBody: payload.toString('base64'),
      DelaySeconds: meta.delay || 0,
      MessageAttributes: messageAttributes
    });

    return result.MessageId!;
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    const result = await this.client.receiveMessage({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: timeout,
      MessageAttributeNames: ['All']
    });

    if (!result.Messages || result.Messages.length === 0) {
      return null;
    }

    const message = result.Messages[0]!;
    const payload = Buffer.from(message.Body, 'base64');
    
    const meta: JobMeta = {};
    if (message.MessageAttributes?.ttr) {
      meta.ttr = parseInt(message.MessageAttributes.ttr.StringValue);
    }
    if (message.MessageAttributes?.priority) {
      meta.priority = parseInt(message.MessageAttributes.priority.StringValue);
    }
    if (message.MessageAttributes?.attempt) {
      meta.attempt = parseInt(message.MessageAttributes.attempt.StringValue);
    }

    if (meta.ttr) {
      await this.client.changeMessageVisibility({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: meta.ttr
      });
    }

    return {
      id: message.MessageId,
      payload,
      meta: {
        ...meta,
        receiptHandle: message.ReceiptHandle
      }
    };
  }

  protected async release(message: QueueMessage): Promise<void> {
    if (message.meta.receiptHandle) {
      await this.client.deleteMessage({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.meta.receiptHandle
      });
    }
  }

  async status(id: string): Promise<JobStatus> {
    return 'done';
  }

  protected override async handleError(message: QueueMessage, error: unknown): Promise<boolean> {
    const job = this.serializer.deserialize(message.payload);
    const errorEvent = { type: 'afterError' as const, id: message.id, job, meta: message.meta, error };
    this.emit('afterError', errorEvent);

    const currentAttempt = (message.meta.attempt || 0) + 1;
    const maxAttempts = this.attemptsDefault;

    let shouldRetry = currentAttempt < maxAttempts;

    if (this.isRetryableJob(job)) {
      shouldRetry = shouldRetry && job.canRetry(currentAttempt, error);
    }

    if (!shouldRetry) {
      await this.release(message);
    }

    return true;
  }

}