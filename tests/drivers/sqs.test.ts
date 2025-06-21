import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqsQueue } from '../../src/drivers/sqs.ts';
import { TestSQSClient } from '../mocks/test-sqs-client.ts';
import { SimpleJob, FailingJob } from '../jobs/test-job.ts';

describe('SqsQueue', () => {
  let queue: SqsQueue;
  let sqsClient: TestSQSClient;
  const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

  beforeEach(() => {
    sqsClient = new TestSQSClient();
    queue = new SqsQueue(sqsClient, queueUrl);
    
    // Register job classes for serialization
    queue['serializer'].registerJob('SimpleJob', SimpleJob);
    queue['serializer'].registerJob('FailingJob', FailingJob);
  });

  describe('push and reserve cycle', () => {
    it('should push and reserve a job successfully', async () => {
      const job = new SimpleJob('test data');
      const messageId = await queue.push(job);

      expect(messageId).toBe('1');
      expect(sqsClient.getAllMessages()).toHaveLength(1);

      const message = await queue['reserve'](0);
      expect(message).toBeTruthy();
      expect(message!.id).toBe('1');
      
      const deserializedJob = queue['serializer'].deserialize(message!.payload);
      expect(deserializedJob.data).toBe('test data');
    });

    it('should handle message attributes correctly', async () => {
      const job = new SimpleJob('attrs test');
      await queue.ttr(600).priority(5).push(job);

      const messages = sqsClient.getAllMessages();
      expect(messages[0].MessageAttributes?.ttr?.StringValue).toBe('600');
      expect(messages[0].MessageAttributes?.priority?.StringValue).toBe('5');
    });

    it('should respect delay seconds', async () => {
      const job = new SimpleJob('delayed job');
      await queue.delay(30).push(job);

      const messages = sqsClient.getAllMessages();
      expect(messages[0].delaySeconds).toBe(30);
    });

    it('should set visibility timeout on reserve', async () => {
      const job = new SimpleJob('visibility test');
      await queue.ttr(300).push(job);

      const changeVisibilitySpy = vi.spyOn(sqsClient, 'changeMessageVisibility');
      
      await queue['reserve'](0);
      
      expect(changeVisibilitySpy).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        ReceiptHandle: '1',
        VisibilityTimeout: 300
      });
    });
  });

  describe('message lifecycle', () => {
    it('should delete message on successful release', async () => {
      const job = new SimpleJob('release test');
      await queue.push(job);

      const deleteMessageSpy = vi.spyOn(sqsClient, 'deleteMessage');
      
      const message = await queue['reserve'](0);
      await queue['release'](message!);

      expect(deleteMessageSpy).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        ReceiptHandle: '1'
      });
    });

    it('should handle job execution', async () => {
      const job = new SimpleJob('execution test');
      await queue.push(job);

      const beforeExecSpy = vi.fn();
      const afterExecSpy = vi.fn();
      queue.on('beforeExec', beforeExecSpy);
      queue.on('afterExec', afterExecSpy);

      const message = await queue['reserve'](0);
      const success = await queue['handleMessage'](message!);

      expect(success).toBe(true);
      expect(beforeExecSpy).toHaveBeenCalledOnce();
      expect(afterExecSpy).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('should handle job failures', async () => {
      const job = new FailingJob(true);
      await queue.push(job);

      const afterErrorSpy = vi.fn();
      queue.on('afterError', afterErrorSpy);

      const message = await queue['reserve'](0);
      const success = await queue['handleMessage'](message!);

      expect(success).toBe(true);
      expect(afterErrorSpy).toHaveBeenCalledOnce();
    });

    it('should delete message on max retries exceeded', async () => {
      const job = new FailingJob(true);
      await queue.push(job);

      const deleteMessageSpy = vi.spyOn(sqsClient, 'deleteMessage');
      
      const message = await queue['reserve'](0);
      await queue['handleError'](message!, new Error('Test error'));

      expect(deleteMessageSpy).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        ReceiptHandle: '1'
      });
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize jobs correctly', async () => {
      const job = new SimpleJob('serialization test');
      await queue.push(job);

      const message = await queue['reserve'](0);
      const deserializedJob = queue['serializer'].deserialize(message!.payload);

      expect(deserializedJob.data).toBe('serialization test');
      expect(typeof deserializedJob.execute).toBe('function');
    });

    it('should handle base64 encoding for SQS', async () => {
      const job = new SimpleJob('base64 test');
      await queue.push(job);

      const messages = sqsClient.getAllMessages();
      const messageBody = messages[0].Body;
      
      // Should be base64 encoded
      expect(() => Buffer.from(messageBody, 'base64')).not.toThrow();
      
      // Should decode back to original job
      const decoded = Buffer.from(messageBody, 'base64');
      const deserializedJob = queue['serializer'].deserialize(decoded);
      expect(deserializedJob.data).toBe('base64 test');
    });
  });

  describe('queue operations', () => {
    it('should return null when no messages available', async () => {
      const message = await queue['reserve'](0);
      expect(message).toBeNull();
    });

    it('should always return done status for SQS', async () => {
      const status = await queue.status('any-id');
      expect(status).toBe('done');
    });
  });
});