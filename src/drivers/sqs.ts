import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  type SendMessageCommandInput,
  type ReceiveMessageCommandInput,
  type DeleteMessageCommandInput,
  type ChangeMessageVisibilityCommandInput,
} from "@aws-sdk/client-sqs";
import { Queue } from "../core/queue.ts";
import type {
  JobStatus,
  JobMeta,
  QueueMessage,
  SqsJobRequest,
} from "../interfaces/job.ts";
import type { QueueOptions } from "../interfaces/plugin.ts";

interface SqsClient {
  send: SQSClient["send"];
}

export class SqsQueue<TJobMap = Record<string, any>> extends Queue<
  TJobMap,
  SqsJobRequest<any>
> {
  #onFailure: "delete" | "leaveInQueue"

  constructor(
    private client: SqsClient,
    private queueUrl: string,
    options: QueueOptions & { onFailure: "delete" | "leaveInQueue" } = {
      onFailure: "delete",
    }
  ) {
    super(options);
    // SQS supports long polling via WaitTimeSeconds
    this.supportsLongPolling = true;
    this.#onFailure = options.onFailure;
  }

  protected async pushMessage(payload: string, meta: JobMeta): Promise<string> {
    const messageAttributes: Record<
      string,
      { StringValue: string; DataType: string }
    > = {};

    if (meta.ttr) {
      messageAttributes.ttr = {
        StringValue: meta.ttr.toString(),
        DataType: "Number",
      };
    }
    if (meta.priority) {
      messageAttributes.priority = {
        StringValue: meta.priority.toString(),
        DataType: "Number",
      };
    }

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: payload,
      DelaySeconds: meta.delay || 0,
      MessageAttributes: messageAttributes,
    });

    const result = await this.client.send(command);

    if (!result.MessageId) {
      throw new Error("Failed to send message - no MessageId returned");
    }
    return result.MessageId;
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: timeout,
      MessageAttributeNames: ["All"],
    });

    const result = await this.client.send(command);

    if (!result.Messages || result.Messages.length === 0) {
      return null;
    }

    const message = result.Messages[0];
    if (
      !message ||
      !message.Body ||
      !message.MessageId ||
      !message.ReceiptHandle
    ) {
      return null;
    }
    const payload = message.Body;

    const meta: JobMeta = {};
    if (message.MessageAttributes?.ttr?.StringValue) {
      meta.ttr = parseInt(message.MessageAttributes.ttr.StringValue);
    }
    if (message.MessageAttributes?.priority?.StringValue) {
      meta.priority = parseInt(message.MessageAttributes.priority.StringValue);
    }

    if (meta.ttr) {
      const visibilityCommand = new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: meta.ttr,
      });

      await this.client.send(visibilityCommand);
    }

    return {
      id: message.MessageId,
      payload,
      meta: {
        ...meta,
        receiptHandle: message.ReceiptHandle,
      },
    };
  }

  protected async completeJob(message: QueueMessage): Promise<void> {
    if (!message.meta.receiptHandle) {
      throw new Error(
        "Cannot complete SQS message: receiptHandle is missing from metadata"
      );
    }

    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: message.meta.receiptHandle,
    });

    await this.client.send(deleteCommand);
  }

  protected async failJob(
    message: QueueMessage,
    error: unknown
  ): Promise<void> {
    if (this.#onFailure === "leaveInQueue") {
      if (!message.meta.receiptHandle) {
        throw new Error(
          "Cannot fail SQS message: receiptHandle is missing from metadata"
        );
      }

      // For SQS, we delete failed messages too since SQS doesn't track failure states
      // Future enhancement could send to a dead letter queue
      const deleteCommand = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.meta.receiptHandle,
      });

      await this.client.send(deleteCommand);
    }
  }

  async status(id: string): Promise<JobStatus> {
    throw new Error("SQS does not support status");
  }
}
