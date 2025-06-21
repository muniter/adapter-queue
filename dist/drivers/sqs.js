import { Queue } from "../core/queue.js";
export class SqsQueue extends Queue {
    client;
    queueUrl;
    constructor(client, queueUrl, options = {}) {
        super(options);
        this.client = client;
        this.queueUrl = queueUrl;
    }
    async pushMessage(payload, meta) {
        const messageAttributes = {};
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
        return result.MessageId;
    }
    async reserve(timeout) {
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
        const payload = Buffer.from(message.Body, 'base64');
        const meta = {};
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
    async release(message) {
        if (message.meta.receiptHandle) {
            await this.client.deleteMessage({
                QueueUrl: this.queueUrl,
                ReceiptHandle: message.meta.receiptHandle
            });
        }
    }
    async status(id) {
        return 'done';
    }
    async handleError(message, error) {
        const job = this.serializer.deserialize(message.payload);
        const errorEvent = { type: 'afterError', id: message.id, job, meta: message.meta, error };
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
//# sourceMappingURL=sqs.js.map