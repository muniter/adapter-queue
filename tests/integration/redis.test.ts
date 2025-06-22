import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createClient } from 'redis';
import { RedisQueue, createRedisQueue, RedisDatabaseAdapter } from '../../src/adapters/redis.ts';

interface TestJobs {
  'simple-job': { data: string };
  'delayed-job': { message: string };
  'failing-job': { shouldFail: boolean };
  'priority-job': { priority: number; data: string };
}

// Helper to check if Redis is available
async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = createClient({ 
      socket: { connectTimeout: 1000 }
    });
    await client.connect();
    await client.ping();
    await client.quit();
    return true;
  } catch {
    return false;
  }
}

describe('Redis Integration Tests', () => {
  let redisAvailable = false;
  let client: any;
  let queue: RedisQueue<TestJobs>;
  const testKeyPrefix = 'test:queue:jobs';

  beforeAll(async () => {
    redisAvailable = await isRedisAvailable();
    if (!redisAvailable) {
      console.warn('Redis not available, skipping Redis integration tests');
    }
  });

  beforeEach(async () => {
    if (!redisAvailable) return;
    
    client = createClient();
    await client.connect();
    
    // Clean up any existing test data
    const keys = await client.keys(`${testKeyPrefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
    }
    
    queue = new RedisQueue<TestJobs>({ 
      client,
      keyPrefix: testKeyPrefix 
    });
  });

  afterEach(async () => {
    if (!redisAvailable || !client) return;
    
    // Clean up test data
    const keys = await client.keys(`${testKeyPrefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
    }
    
    await client.quit();
  });

  describe('RedisQueue Constructor Pattern', () => {
    it('should create queue with client instance', () => {
      if (!redisAvailable) return;
      
      expect(queue).toBeInstanceOf(RedisQueue);
    });

    it('should use custom key prefix', async () => {
      if (!redisAvailable) return;
      
      await queue.addJob('simple-job', { payload: { data: 'test' } });
      
      // Check that keys are created with our prefix
      const keys = await client.keys(`${testKeyPrefix}*`);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.some((key: string) => key.startsWith(testKeyPrefix))).toBe(true);
    });
  });

  describe('Convenience Factory', () => {
    it('should create queue with factory function', async () => {
      if (!redisAvailable) return;
      
      const factoryQueue = createRedisQueue<TestJobs>();
      expect(factoryQueue).toBeInstanceOf(RedisQueue);
      
      // Clean up - the factory creates its own client
      // Note: In real usage, users would handle cleanup themselves
      const adapter = (factoryQueue as any).db as RedisDatabaseAdapter;
      await adapter.close();
    });
  });

  describe('Job Lifecycle', () => {
    it('should add and process jobs successfully', async () => {
      if (!redisAvailable) return;
      
      const processedJobs: string[] = [];
      
      queue.onJob('simple-job', async (payload) => {
        processedJobs.push(payload.data);
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
      if (!redisAvailable) return;
      
      const id = await queue.addJob('simple-job', { payload: { data: 'status test' } });
      
      // Initially waiting
      expect(await queue.status(id)).toBe('waiting');
      
      // Verify job is stored in Redis
      const jobData = await client.hGetAll(`${testKeyPrefix}:job:${id}`);
      expect(jobData).toBeTruthy();
      expect(jobData.status).toBe('waiting');
    });

    it('should handle job delays correctly', async () => {
      if (!redisAvailable) return;
      
      const processedJobs: string[] = [];
      
      queue.onJob('delayed-job', async (payload) => {
        processedJobs.push(payload.message);
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
      if (!redisAvailable) return;
      
      const processedJobs: Array<{ priority: number; data: string }> = [];
      
      queue.onJob('priority-job', async (payload) => {
        processedJobs.push(payload);
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
      if (!redisAvailable) return;
      
      const errors: any[] = [];
      
      queue.onJob('failing-job', async (payload) => {
        if (payload.shouldFail) {
          throw new Error('Job intentionally failed');
        }
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
      if (!redisAvailable) return;
      
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
      if (!redisAvailable) return;
      
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
      if (!redisAvailable) return;
      
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
      if (!redisAvailable) return;
      
      const processedJobs: string[] = [];
      
      queue.onJob('simple-job', async (payload) => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        processedJobs.push(payload.data);
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