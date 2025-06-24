import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from 'redis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { RedisQueue, createRedisQueue, RedisDatabaseAdapter } from '../../src/adapters/redis.ts';

interface TestJobs {
  'simple-job': { data: string };
  'delayed-job': { message: string };
  'failing-job': { shouldFail: boolean };
  'priority-job': { priority: number; data: string };
}

describe('Redis Integration Tests (with TestContainers)', () => {
  let redisContainer: StartedTestContainer;
  let client: any;
  let queue: RedisQueue<TestJobs>;
  let redisUrl: string;
  const testKeyPrefix = 'test:queue:jobs';

  beforeAll(async () => {
    // Start Redis container with non-default port to avoid conflicts
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts({ container: 6379, host: 0 }) // Let Docker assign a random available port
      .withStartupTimeout(30000)
      .start();
    
    const redisPort = redisContainer.getMappedPort(6379);
    const redisHost = redisContainer.getHost();
    redisUrl = `redis://${redisHost}:${redisPort}`;
    
    console.log(`Redis container started at ${redisUrl}`);
  }, 60000); // 60 second timeout for container startup

  afterAll(async () => {
    if (redisContainer) {
      await redisContainer.stop();
    }
  });

  beforeEach(async () => {
    client = createClient({ url: redisUrl });
    await client.connect();
    
    // Clean up any existing test data
    await client.flushDb();
    
    queue = new RedisQueue<TestJobs>({ 
      client,
      keyPrefix: testKeyPrefix 
    });
  });

  afterEach(async () => {
    if (client) {
      await client.quit();
    }
  });

  describe('RedisQueue Constructor Pattern', () => {
    it('should create queue with client instance', () => {
      expect(queue).toBeInstanceOf(RedisQueue);
    });

    it('should use custom key prefix', async () => {
      await queue.addJob('simple-job', { payload: { data: 'test' } });
      
      // Check that keys are created with our prefix
      const keys = await client.keys(`${testKeyPrefix}*`);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.some((key: string) => key.startsWith(testKeyPrefix))).toBe(true);
    });
  });

  describe('Convenience Factory', () => {
    it('should create queue with factory function', async () => {
      const factoryQueue = createRedisQueue<TestJobs>(redisUrl);
      expect(factoryQueue).toBeInstanceOf(RedisQueue);
      
      // Clean up - the factory creates its own client
      // Note: In real usage, users would handle cleanup themselves
      const adapter = (factoryQueue as any).db as RedisDatabaseAdapter;
      await adapter.close();
    });
  });

  describe('Job Lifecycle', () => {
    it('should add and process jobs successfully', async () => {
      
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': async ({ payload }) => {
          processedJobs.push(payload.data);
        },
        'delayed-job': vi.fn(),
        'failing-job': vi.fn(),
        'priority-job': vi.fn(),
      });

      const id1 = await queue.addJob('simple-job', { payload: { data: 'test1' } });
      const id2 = await queue.addJob('simple-job', { payload: { data: 'test2' } });

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);

      // Process jobs once
      await queue.run(false);

      expect(processedJobs).toEqual(expect.arrayContaining(['test1', 'test2']));
    });

    it('should handle job status tracking', async () => {
      
      const id = await queue.addJob('simple-job', { payload: { data: 'status test' } });
      
      // Initially waiting
      expect(await queue.status(id)).toBe('waiting');
      
      // Verify job is stored in Redis
      const jobData = await client.hGetAll(`${testKeyPrefix}:job:${id}`);
      expect(jobData).toBeTruthy();
      expect(jobData.status).toBe('waiting');
    });

    it('should handle job delays correctly', async () => {
      
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': vi.fn(),
        'delayed-job': async ({ payload }) => {
          processedJobs.push(payload.message);
        },
        'failing-job': vi.fn(),
        'priority-job': vi.fn(),
      });

      // Add delayed job (1 second delay)
      await queue.addJob('delayed-job', { 
        payload: { message: 'delayed' }, 
        delay: 1 
      });

      // Should not process immediately
      await queue.run(false);
      expect(processedJobs).toHaveLength(0);

      // Wait for delay and process again
      await new Promise(resolve => setTimeout(resolve, 1100));
      await queue.run(false);
      expect(processedJobs).toEqual(['delayed']);
    });

    it('should handle job priorities correctly', async () => {
      
      const processedJobs: Array<{ priority: number; data: string }> = [];
      
      queue.setHandlers({
        'simple-job': vi.fn(),
        'delayed-job': vi.fn(),
        'failing-job': vi.fn(),
        'priority-job': async ({ payload }) => {
          processedJobs.push(payload);
        },
      });

      // Add jobs with different priorities (higher number = higher priority)
      await queue.addJob('priority-job', { 
        payload: { priority: 1, data: 'low' }, 
        priority: 1 
      });
      await queue.addJob('priority-job', { 
        payload: { priority: 5, data: 'high' }, 
        priority: 5 
      });
      await queue.addJob('priority-job', { 
        payload: { priority: 3, data: 'medium' }, 
        priority: 3 
      });

      await queue.run(false);

      // Should process in priority order (high to low)
      expect(processedJobs.map(j => j.data)).toEqual(['high', 'medium', 'low']);
    });

    it('should handle job failures and errors', async () => {
      
      const errors: any[] = [];
      
      queue.setHandlers({
        'simple-job': vi.fn(),
        'delayed-job': vi.fn(),
        'failing-job': async ({ payload }) => {
          if (payload.shouldFail) {
            throw new Error('Job intentionally failed');
          }
        },
        'priority-job': vi.fn(),
      });

      queue.on('afterError', (event) => {
        errors.push(event.error);
      });

      await queue.addJob('failing-job', { payload: { shouldFail: true } });
      await queue.run(false);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Job intentionally failed');
    });
  });

  describe('TTR (Time To Run) Handling', () => {
    it('should respect job TTR settings', async () => {
      
      const id = await queue.addJob('simple-job', { 
        payload: { data: 'ttr test' },
        ttr: 10 // 10 seconds
      });

      // Verify TTR is stored correctly
      const ttr = await client.hGet(`${testKeyPrefix}:job:${id}`, 'ttr');
      expect(parseInt(ttr)).toBe(10);
    });
  });

  describe('Redis Persistence', () => {
    it('should persist jobs across queue instances', async () => {
      
      // Add job with first queue instance
      const id = await queue.addJob('simple-job', { payload: { data: 'persistent' } });
      
      // Create new queue instance with same client and prefix
      const queue2 = new RedisQueue<TestJobs>({ 
        client,
        keyPrefix: testKeyPrefix 
      });
      
      // Should be able to see the job
      const status = await queue2.status(id);
      expect(status).toBe('waiting');
    });
  });

  describe('Adapter Direct Usage', () => {
    it('should work with adapter directly', async () => {
      
      const adapter = new RedisDatabaseAdapter(client, testKeyPrefix);
      const payload = Buffer.from(JSON.stringify({ data: 'direct adapter test' }));
      
      const id = await adapter.insertJob(payload, { ttr: 300 });
      expect(id).toBeTruthy();
      
      const job = await adapter.reserveJob(5);
      expect(job).toBeTruthy();
      expect(job!.id).toBe(id);
      expect(job!.payload).toEqual(payload);
      
      await adapter.completeJob(id);
      const status = await adapter.getJobStatus(id);
      expect(status).toBe('done');
    });
  });

  describe('Concurrent Job Processing', () => {
    it('should handle concurrent job reservation correctly', async () => {
      
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': async ({ payload }) => {
          // Simulate some processing time
          await new Promise(resolve => setTimeout(resolve, 50));
          processedJobs.push(payload.data);
        },
        'delayed-job': vi.fn(),
        'failing-job': vi.fn(),
        'priority-job': vi.fn(),
      });

      // Add multiple jobs
      for (let i = 0; i < 5; i++) {
        await queue.addJob('simple-job', { payload: { data: `job-${i}` } });
      }

      // Process jobs concurrently
      await Promise.all([
        queue.run(false),
        queue.run(false)
      ]);

      expect(processedJobs).toHaveLength(5);
      expect(new Set(processedJobs).size).toBe(5); // All jobs should be unique
    });
  });
});