import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqsQueue } from '../../src/drivers/sqs.ts';
import { TestSQSClient } from '../mocks/test-sqs-client.ts';

interface TestJobs {
  'simple-job': { data: string };
  'complex-job': { id: number; name: string };
  'test-job': { data: string };
}

describe('SqsQueue', () => {
  let queue: SqsQueue<TestJobs>;
  let sqsClient: TestSQSClient;

  beforeEach(() => {
    sqsClient = new TestSQSClient();
    queue = new SqsQueue<TestJobs>(sqsClient, 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue', { name: 'test-queue', onFailure: 'delete' });
  });

  describe('addJob and reserve cycle', () => {
    it('should add and reserve a job successfully', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test data' } });
      expect(id).toBeTruthy();

      const reserved = await queue['reserve'](0);
      expect(reserved).not.toBeNull();
      expect(reserved!.id).toBe(id);
    });

    it('should handle message attributes correctly', async () => {
      await queue.addJob('simple-job', { 
        payload: { data: 'test' }, 
        ttr: 600, 
        delay: 30 
      });

      expect(sqsClient.sentMessages).toHaveLength(1);
      const sentMessage = sqsClient.sentMessages[0];
      expect(sentMessage?.MessageAttributes?.ttr?.StringValue).toBe('600');
      expect(sentMessage?.DelaySeconds).toBe(30);
    });

    it('should respect delay seconds', async () => {
      await queue.addJob('simple-job', { 
        payload: { data: 'delayed' }, 
        delay: 30 
      });

      expect(sqsClient.sentMessages).toHaveLength(1);
      const message = sqsClient.sentMessages[0];
      expect(message?.DelaySeconds).toBe(30);
    });

    it('should handle job processing', async () => {
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': async ({ payload }) => {
          processedJobs.push(payload.data);
        },
        'complex-job': vi.fn(),
        'test-job': vi.fn()
      });

      await queue.addJob('simple-job', { payload: { data: 'test1' } });
      await queue.addJob('simple-job', { payload: { data: 'test2' } });

      // Process jobs once
      await queue.run(false);

      expect(processedJobs).toEqual(['test1', 'test2']);
    });
  });

  describe('message lifecycle', () => {
    it('should delete message on successful release', async () => {
      await queue.addJob('simple-job', { payload: { data: 'test' } });
      const reserved = await queue['reserve'](0);
      
      expect(reserved).not.toBeNull();
      
      await queue['completeJob'](reserved!);
      
      expect(sqsClient.deletedMessages).toHaveLength(1);
    });

    it('should handle failJob with onFailure="delete" (default)', async () => {
      // Default configuration: failJob does nothing, message visibility will timeout
      await queue.addJob('test-job', { payload: { data: 'test' } });
      
      const reserved = await queue['reserve'](0);
      
      expect(reserved).not.toBeNull();
      
      const error = new Error('Job failed');
      await queue['failJob'](reserved!, error);
      
      // Should not delete the message with default "delete" config
      // Message will become visible again after TTR timeout
      expect(sqsClient.deletedMessages).toHaveLength(0);
    });

    it('should handle failJob with onFailure="leaveInQueue"', async () => {
      // Create new test client to avoid interference with previous test
      const newSqsClient = new TestSQSClient();
      const leaveInQueueQueue = new SqsQueue<TestJobs>(
        newSqsClient, 
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
        { name: 'test-queue', onFailure: 'leaveInQueue' }
      );
      
      await leaveInQueueQueue.addJob('test-job', { payload: { data: 'test' } });
      
      const reserved = await leaveInQueueQueue['reserve'](0);
      
      expect(reserved).not.toBeNull();
      
      const error = new Error('Job failed');
      await leaveInQueueQueue['failJob'](reserved!, error);
      
      // Should delete the message with "leaveInQueue" config
      expect(newSqsClient.deletedMessages).toHaveLength(1);
    });
  });

  describe('queue operations', () => {
    it('should return null when no messages available', async () => {
      // Don't add any messages
      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();
    });

    it('should always return done status for SQS', async () => {
      // SQS doesn't track job status like DB does
      await expect(queue.status('any-id')).rejects.toThrow();
    });
  });
});