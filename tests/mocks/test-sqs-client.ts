import { SQSClient } from '../../src/drivers/sqs.ts';

interface StoredMessage {
  MessageId: string;
  Body: string;
  ReceiptHandle: string;
  MessageAttributes?: Record<string, { StringValue: string }>;
  sentAt: Date;
  delaySeconds: number;
  visible: boolean;
  visibilityTimeoutUntil?: Date;
}

export class TestSQSClient implements SQSClient {
  private messages: Map<string, StoredMessage> = new Map();
  private nextMessageId = 1;
  private nextReceiptHandle = 1;
  
  // Track sent and deleted messages for testing
  public sentMessages: Array<{
    QueueUrl: string;
    MessageBody: string;
    DelaySeconds?: number;
    MessageAttributes?: Record<string, { StringValue: string; DataType: string }>;
  }> = [];
  
  public deletedMessages: Array<{ MessageId: string; ReceiptHandle: string }> = [];

  async sendMessage(params: {
    QueueUrl: string;
    MessageBody: string;
    DelaySeconds?: number;
    MessageAttributes?: Record<string, { StringValue: string; DataType: string }>;
  }): Promise<{ MessageId: string }> {
    const messageId = this.nextMessageId.toString();
    this.nextMessageId++;

    const messageAttributes: Record<string, { StringValue: string }> = {};
    if (params.MessageAttributes) {
      for (const [key, value] of Object.entries(params.MessageAttributes)) {
        messageAttributes[key] = { StringValue: value.StringValue };
      }
    }

    const message: StoredMessage = {
      MessageId: messageId,
      Body: params.MessageBody,
      ReceiptHandle: this.nextReceiptHandle.toString(),
      MessageAttributes: messageAttributes,
      sentAt: new Date(),
      delaySeconds: params.DelaySeconds || 0,
      visible: true
    };

    this.nextReceiptHandle++;
    this.messages.set(messageId, message);
    
    // Track sent message for testing
    this.sentMessages.push(params);

    return { MessageId: messageId };
  }

  async receiveMessage(params: {
    QueueUrl: string;
    MaxNumberOfMessages?: number;
    WaitTimeSeconds?: number;
    MessageAttributeNames?: string[];
  }): Promise<{ Messages?: Array<{
    MessageId: string;
    Body: string;
    ReceiptHandle: string;
    MessageAttributes?: Record<string, { StringValue: string }>;
  }> }> {
    const now = new Date();
    const messages: any[] = [];
    const maxMessages = params.MaxNumberOfMessages || 1;

    for (const [id, message] of this.messages.entries()) {
      if (!message.visible) continue;
      
      const availableAt = new Date(message.sentAt.getTime() + message.delaySeconds * 1000);
      if (now < availableAt) continue;

      if (message.visibilityTimeoutUntil && now < message.visibilityTimeoutUntil) continue;

      messages.push({
        MessageId: message.MessageId,
        Body: message.Body,
        ReceiptHandle: message.ReceiptHandle,
        MessageAttributes: message.MessageAttributes
      });

      if (messages.length >= maxMessages) break;
    }

    return { Messages: messages };
  }

  async deleteMessage(params: {
    QueueUrl: string;
    ReceiptHandle: string;
  }): Promise<void> {
    for (const [id, message] of this.messages.entries()) {
      if (message.ReceiptHandle === params.ReceiptHandle) {
        // Track deleted message for testing
        this.deletedMessages.push({ MessageId: id, ReceiptHandle: params.ReceiptHandle });
        this.messages.delete(id);
        break;
      }
    }
  }

  async changeMessageVisibility(params: {
    QueueUrl: string;
    ReceiptHandle: string;
    VisibilityTimeout: number;
  }): Promise<void> {
    for (const [id, message] of this.messages.entries()) {
      if (message.ReceiptHandle === params.ReceiptHandle) {
        message.visibilityTimeoutUntil = new Date(Date.now() + params.VisibilityTimeout * 1000);
        this.messages.set(id, message);
        break;
      }
    }
  }

  getAllMessages(): StoredMessage[] {
    return Array.from(this.messages.values());
  }

  clear(): void {
    this.messages.clear();
    this.nextMessageId = 1;
    this.nextReceiptHandle = 1;
  }
}