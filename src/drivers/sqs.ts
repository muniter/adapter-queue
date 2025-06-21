import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage, SqsJobRequest } from '../interfaces/job.ts';

export interface SQSClient {
  sendMessage(params: {
    QueueUrl: string;
    MessageBody: string;
    DelaySeconds?: number;
    MessageAttributes?: Record<string, { StringValue: string; DataType: string }>;
  }): Promise<{ MessageId?: string; $metadata?: any }>;
  
  receiveMessage(params: {
    QueueUrl: string;
    MaxNumberOfMessages?: number;
    WaitTimeSeconds?: number;
    MessageAttributeNames?: string[];
  }): Promise<{ Messages?: Array<{
    MessageId?: string;
    Body?: string;
    ReceiptHandle?: string;
    MessageAttributes?: Record<string, { StringValue?: string }>;
  }>; $metadata?: any }>;
  
  deleteMessage(params: {
    QueueUrl: string;
    ReceiptHandle: string;
  }): Promise<{ $metadata?: any }>;
  
  changeMessageVisibility(params: {
    QueueUrl: string;
    ReceiptHandle: string;
    VisibilityTimeout: number;
  }): Promise<{ $metadata?: any }>;
}

export class SqsQueue<TJobMap = Record<string, any>> extends Queue<TJobMap, SqsJobRequest<any>> {
  constructor(
    private client: SQSClient,
    private queueUrl: string,
    options: { ttrDefault?: number } = {}
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

    const result = await this.client.sendMessage({
      QueueUrl: this.queueUrl,
      MessageBody: payload.toString('utf8'),
      DelaySeconds: meta.delay || 0,
      MessageAttributes: messageAttributes
    });

    if (!result.MessageId) {
      throw new Error('Failed to send message - no MessageId returned');
    }
    return result.MessageId;
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

    const message = result.Messages[0];
    if (!message || !message.Body || !message.MessageId || !message.ReceiptHandle) {
      return null;
    }
    const payload = Buffer.from(message.Body, 'utf8');
    
    const meta: JobMeta = {};
    if (message.MessageAttributes?.ttr?.StringValue) {
      meta.ttr = parseInt(message.MessageAttributes.ttr.StringValue);
    }
    if (message.MessageAttributes?.priority?.StringValue) {
      meta.priority = parseInt(message.MessageAttributes.priority.StringValue);
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


}