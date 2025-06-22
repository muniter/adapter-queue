import { 
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  type SendMessageCommandOutput,
  type ReceiveMessageCommandOutput, 
  type DeleteMessageCommandOutput, 
  type ChangeMessageVisibilityCommandOutput 
} from "@aws-sdk/client-sqs";

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

export class TestSQSClient {
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

  async send(command: SendMessageCommand | ReceiveMessageCommand | DeleteMessageCommand | ChangeMessageVisibilityCommand): Promise<any> {
    if (command instanceof SendMessageCommand) {
      return this.handleSendMessage(command.input as any);
    } else if (command instanceof ReceiveMessageCommand) {
      return this.handleReceiveMessage(command.input as any);
    } else if (command instanceof DeleteMessageCommand) {
      return this.handleDeleteMessage(command.input as any);
    } else if (command instanceof ChangeMessageVisibilityCommand) {
      return this.handleChangeMessageVisibility(command.input as any);
    }
    throw new Error(`Unsupported command type: ${(command as any).constructor.name}`);
  }

  private async handleSendMessage(params: {
    QueueUrl: string;
    MessageBody: string;
    DelaySeconds?: number;
    MessageAttributes?: Record<string, { StringValue: string; DataType: string }>;
  }): Promise<SendMessageCommandOutput> {
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

    return { 
      MessageId: messageId,
      $metadata: {
        httpStatusCode: 200,
        requestId: 'test-request-id'
      }
    };
  }

  private async handleReceiveMessage(params: {
    QueueUrl: string;
    MaxNumberOfMessages?: number;
    WaitTimeSeconds?: number;
    MessageAttributeNames?: string[];
  }): Promise<ReceiveMessageCommandOutput> {
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

    return { 
      Messages: messages,
      $metadata: {
        httpStatusCode: 200,
        requestId: 'test-request-id'
      }
    } as ReceiveMessageCommandOutput;
  }

  private async handleDeleteMessage(params: {
    QueueUrl: string;
    ReceiptHandle: string;
  }): Promise<DeleteMessageCommandOutput> {
    for (const [id, message] of this.messages.entries()) {
      if (message.ReceiptHandle === params.ReceiptHandle) {
        // Track deleted message for testing
        this.deletedMessages.push({ MessageId: id, ReceiptHandle: params.ReceiptHandle });
        this.messages.delete(id);
        break;
      }
    }
    
    return {
      $metadata: {
        httpStatusCode: 200,
        requestId: 'test-request-id'
      }
    } as DeleteMessageCommandOutput;
  }

  private async handleChangeMessageVisibility(params: {
    QueueUrl: string;
    ReceiptHandle: string;
    VisibilityTimeout: number;
  }): Promise<ChangeMessageVisibilityCommandOutput> {
    for (const [id, message] of this.messages.entries()) {
      if (message.ReceiptHandle === params.ReceiptHandle) {
        message.visibilityTimeoutUntil = new Date(Date.now() + params.VisibilityTimeout * 1000);
        this.messages.set(id, message);
        break;
      }
    }
    
    return {
      $metadata: {
        httpStatusCode: 200,
        requestId: 'test-request-id'
      }
    } as ChangeMessageVisibilityCommandOutput;
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