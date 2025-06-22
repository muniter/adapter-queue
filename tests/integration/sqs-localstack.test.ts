import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { SQSClient, CreateQueueCommand, DeleteQueueCommand, PurgeQueueCommand } from '@aws-sdk/client-sqs';
import { SqsQueue } from '../../src/drivers/sqs.ts';

interface TestJobs {
  'process-data': { id: number; data: string };
  'send-notification': { email: string; message: string };
}

describe('SQS Integration Tests (LocalStack)', () => {
  let container: StartedTestContainer;
  let sqsClient: SQSClient;
  let queueUrl: string;
  let queue: SqsQueue<TestJobs>;

  beforeAll(async () => {
    // Start LocalStack container
    console.log('Starting LocalStack container...');
    container = await new GenericContainer('localstack/localstack:3.0')
      .withEnvironment({
        'SERVICES': 'sqs',
        'DEBUG': '1',
        'PERSISTENCE': '0'
      })
      .withExposedPorts(4566)
      .withStartupTimeout(90000)
      .start();

    const endpoint = `http://${container.getHost()}:${container.getMappedPort(4566)}`;
    console.log(`LocalStack started at ${endpoint}`);

    // Create SQS client pointing to LocalStack
    sqsClient = new SQSClient({
      region: 'us-east-1',
      endpoint,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test'
      }
    });

    // Create test queue
    const createQueueResult = await sqsClient.send(new CreateQueueCommand({
      QueueName: 'test-queue'
    }));
    
    queueUrl = createQueueResult.QueueUrl!;
    console.log(`Test queue created: ${queueUrl}`);
  }, 120000); // 2 minute timeout for container startup

  afterAll(async () => {
    // Clean up
    if (sqsClient && queueUrl) {
      try {
        await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
      } catch (error) {
        console.warn('Failed to delete test queue:', error);
      }
    }
    
    if (container) {
      await container.stop();
    }
  });

  beforeEach(async () => {
    // Purge queue before each test
    try {
      await sqsClient.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
    } catch (error) {
      // Queue might be empty, ignore
    }
    
    // Create fresh queue instance using SQSClient directly
    queue = new SqsQueue<TestJobs>(sqsClient, queueUrl);
  });

  describe('Real SQS Operations', () => {
    it('should add a job and retrieve it from real SQS', async () => {
      const jobId = await queue.addJob('process-data', {
        payload: { id: 1, data: 'test data' }
      });

      expect(jobId).toBeTruthy();

      // Reserve the job
      const reserved = await queue['reserve'](1);
      expect(reserved).not.toBeNull();
      expect(reserved!.id).toBe(jobId);
      
      // Parse the payload
      const payload = JSON.parse(reserved!.payload);
      expect(payload).toEqual({
        name: 'process-data',
        payload: { id: 1, data: 'test data' }
      });
    });

    it('should handle job execution lifecycle', async () => {
      const processedJobs: Array<{ id: number; data: string }> = [];
      
      // Register job handler
      queue.onJob('process-data', async (payload) => {
        processedJobs.push(payload);
        // Just process without returning string to match void return type
      });

      // Add job
      await queue.addJob('process-data', {
        payload: { id: 2, data: 'lifecycle test' }
      });

      // Process job
      await queue.run(false); // Run once

      expect(processedJobs).toHaveLength(1);
      expect(processedJobs[0]).toEqual({ id: 2, data: 'lifecycle test' });
    });

    it('should respect delay seconds', async () => {
      const startTime = Date.now();
      
      await queue.addJob('process-data', {
        payload: { id: 3, data: 'delayed job' },
        delay: 2 // 2 seconds delay
      });

      // Immediate attempt should return null (job not available yet)
      const immediateReserve = await queue['reserve'](0);
      expect(immediateReserve).toBeNull();

      // Wait for delay + small buffer
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const delayedReserve = await queue['reserve'](1);
      expect(delayedReserve).not.toBeNull();
      
      const elapsedTime = Date.now() - startTime;
      expect(elapsedTime).toBeGreaterThanOrEqual(2000); // At least 2 seconds
    });

    it('should handle TTR (Time To Run) correctly', async () => {
      await queue.addJob('process-data', {
        payload: { id: 4, data: 'ttr test' },
        ttr: 5 // 5 seconds TTR
      });

      // Reserve job
      const reserved = await queue['reserve'](1);
      expect(reserved).not.toBeNull();
      expect(reserved!.meta.ttr).toBe(5);

      // Verify job metadata contains receiptHandle for SQS
      expect(reserved!.meta.receiptHandle).toBeTruthy();
    });

    it('should handle multiple jobs concurrently', async () => {
      const promises = [];
      
      // Add multiple jobs
      for (let i = 0; i < 5; i++) {
        promises.push(
          queue.addJob('process-data', {
            payload: { id: i, data: `concurrent job ${i}` }
          })
        );
      }

      const jobIds = await Promise.all(promises);
      expect(jobIds).toHaveLength(5);
      expect(new Set(jobIds).size).toBe(5); // All IDs should be unique

      // Process all jobs
      const processedJobs: Array<{ id: number; data: string }> = [];
      queue.onJob('process-data', async (payload) => {
        processedJobs.push(payload);
      });

      // Run queue multiple times to process all jobs
      for (let i = 0; i < 5; i++) {
        await queue.run(false);
      }

      expect(processedJobs).toHaveLength(5);
    });

    it('should handle job errors and event system', async () => {
      let errorOccurred = false;
      let beforeExecCalled = false;
      let afterErrorCalled = false;

      // Register event handlers
      queue.on('beforeExec', () => {
        beforeExecCalled = true;
      });

      queue.on('afterError', (event) => {
        afterErrorCalled = true;
        expect(event.error).toBeInstanceOf(Error);
      });

      // Register failing job handler
      queue.onJob('process-data', async () => {
        throw new Error('Intentional test failure');
      });

      await queue.addJob('process-data', {
        payload: { id: 5, data: 'error test' }
      });

      // Process the failing job
      await queue.run(false);

      expect(beforeExecCalled).toBe(true);
      expect(afterErrorCalled).toBe(true);
    });

    it('should support different job types', async () => {
      const processedData: any[] = [];
      const processedNotifications: any[] = [];

      queue.onJob('process-data', async (payload) => {
        processedData.push(payload);
      });

      queue.onJob('send-notification', async (payload) => {
        processedNotifications.push(payload);
      });

      await queue.addJob('process-data', {
        payload: { id: 6, data: 'data job' }
      });

      await queue.addJob('send-notification', {
        payload: { email: 'test@example.com', message: 'Hello' }
      });

      // Process both jobs
      await queue.run(false);
      await queue.run(false);

      expect(processedData).toHaveLength(1);
      expect(processedData[0]).toEqual({ id: 6, data: 'data job' });
      
      expect(processedNotifications).toHaveLength(1);
      expect(processedNotifications[0]).toEqual({ 
        email: 'test@example.com', 
        message: 'Hello' 
      });
    });

    it('should handle SQS status limitation gracefully', async () => {
      const jobId = await queue.addJob('process-data', {
        payload: { id: 7, data: 'status test' }
      });

      // SQS doesn't support job status tracking, so this should throw
      await expect(queue.status(jobId)).rejects.toThrow('SQS does not support status');
    });
  });
});