import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryQueue } from '../../src/drivers/memory.js';
import { createMemoryQueue } from '../../src/adapters/memory.js';

interface TestJobs {
  'simple-job': { data: string };
  'priority-job': { message: string };
  'delayed-job': { message: string };
  'long-job': { duration: number };
}

describe('InMemoryQueue', () => {
  let queue: InMemoryQueue<TestJobs>;

  beforeEach(() => {
    queue = new InMemoryQueue<TestJobs>({ 
      name: 'test-queue',
      maxJobs: 100 
    });
  });

  afterEach(async () => {
    await queue.cleanup();
  });

  describe('initialization', () => {
    it('should create queue with default options', () => {
      const defaultQueue = new InMemoryQueue({ name: 'default' });
      expect(defaultQueue).toBeDefined();
    });

    it('should create queue with custom maxJobs', () => {
      const customQueue = new InMemoryQueue({ name: 'custom', maxJobs: 50 });
      expect(customQueue).toBeDefined();
    });
  });

  describe('addJob', () => {
    it('should add job to waiting queue', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test payload' } });
      
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      const status = await queue.status(id);
      expect(status).toBe('waiting');
    });

    it('should add job with TTR', async () => {
      const id = await queue.addJob('simple-job', { 
        payload: { data: 'test payload' },
        ttr: 120
      });
      
      const status = await queue.status(id);
      expect(status).toBe('waiting');
    });

    it('should add delayed job', async () => {
      const id = await queue.addJob('delayed-job', { 
        payload: { message: 'test payload' }, 
        delay: 1
      });
      
      const status = await queue.status(id);
      expect(status).toBe('waiting');

      // Should not be immediately available
      const reserved1 = await queue['reserve'](0);
      expect(reserved1).toBeNull();

      // Should be available after delay
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const reserved2 = await queue['reserve'](0);
      expect(reserved2).not.toBeNull();
      expect(reserved2!.id).toBe(id);
    });

    it('should add job with priority', async () => {
      const lowId = await queue.addJob('priority-job', { 
        payload: { message: 'low priority' },
        priority: 1
      });
      
      const highId = await queue.addJob('priority-job', { 
        payload: { message: 'high priority' },
        priority: 10
      });

      // High priority job should be reserved first
      const reserved1 = await queue['reserve'](0);
      expect(reserved1!.id).toBe(highId);

      const reserved2 = await queue['reserve'](0);
      expect(reserved2!.id).toBe(lowId);
    });

    it('should generate unique job IDs', async () => {
      const ids = await Promise.all([
        queue.addJob('simple-job', { payload: { data: 'job1' } }),
        queue.addJob('simple-job', { payload: { data: 'job2' } }),
        queue.addJob('simple-job', { payload: { data: 'job3' } })
      ]);

      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('reserve', () => {
    it('should reserve waiting job', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test payload' } });

      const reserved = await queue['reserve'](0);
      expect(reserved).not.toBeNull();
      expect(reserved!.id).toBe(id);
      expect(reserved!.payload).toBeTruthy();
    });

    it('should return null when queue is empty', async () => {
      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();
    });

    it('should respect priority order', async () => {
      const mediumId = await queue.addJob('priority-job', { 
        payload: { message: 'medium' }, 
        priority: 5 
      });
      const highId = await queue.addJob('priority-job', { 
        payload: { message: 'high' }, 
        priority: 10 
      });
      const lowId = await queue.addJob('priority-job', { 
        payload: { message: 'low' }, 
        priority: 1 
      });

      const reserved1 = await queue['reserve'](0);
      expect(reserved1!.id).toBe(highId);

      const reserved2 = await queue['reserve'](0);
      expect(reserved2!.id).toBe(mediumId);

      const reserved3 = await queue['reserve'](0);
      expect(reserved3!.id).toBe(lowId);
    });

    it('should handle TTR timeout and recover job', async () => {
      const id = await queue.addJob('simple-job', { 
        payload: { data: 'test payload' }, 
        ttr: 1 
      });

      const reserved1 = await queue['reserve'](0);
      expect(reserved1).not.toBeNull();
      expect(reserved1!.id).toBe(id);

      // Job should be in reserved state
      const status1 = await queue.status(id);
      expect(status1).toBe('reserved');

      // Wait for TTR to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Job should be available again
      const reserved2 = await queue['reserve'](0);
      expect(reserved2).not.toBeNull();
      expect(reserved2!.id).toBe(id);
    });

    it('should not reserve delayed jobs before delay expires', async () => {
      await queue.addJob('delayed-job', { 
        payload: { message: 'delayed' }, 
        delay: 10 
      });

      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();
    });
  });

  describe('completeJob', () => {
    it('should mark job as completed', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test' } });
      const reserved = await queue['reserve'](0);
      
      await queue['completeJob'](reserved!);
      
      const status = await queue.status(id);
      expect(status).toBe('done');
    });

    it('should clear TTR timeout on completion', async () => {
      const id = await queue.addJob('simple-job', { 
        payload: { data: 'test' }, 
        ttr: 10 
      });
      const reserved = await queue['reserve'](0);
      
      await queue['completeJob'](reserved!);
      
      // Wait longer than TTR to ensure timeout was cleared
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const status = await queue.status(id);
      expect(status).toBe('done');
    });
  });

  describe('failJob', () => {
    it('should mark job as failed', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test' } });
      const reserved = await queue['reserve'](0);
      
      const error = new Error('Job failed');
      await queue['failJob'](reserved!, error);
      
      const status = await queue.status(id);
      expect(status).toBe('done');
      
      const job = queue.getJob(id);
      expect(job!.status).toBe('failed');
      expect(job!.error).toBe('Job failed');
    });

    it('should handle non-Error objects', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test' } });
      const reserved = await queue['reserve'](0);
      
      await queue['failJob'](reserved!, 'String error');
      
      const job = queue.getJob(id);
      expect(job!.status).toBe('failed');
      expect(job!.error).toBe('String error');
    });
  });

  describe('status', () => {
    it('should return correct status for waiting job', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test' } });
      const status = await queue.status(id);
      expect(status).toBe('waiting');
    });

    it('should return correct status for reserved job', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test' } });
      await queue['reserve'](0);
      
      const status = await queue.status(id);
      expect(status).toBe('reserved');
    });

    it('should return done for non-existent job', async () => {
      const status = await queue.status('non-existent');
      expect(status).toBe('done');
    });
  });

  describe('getStats', () => {
    it('should return correct stats for empty queue', () => {
      const stats = queue.getStats();
      expect(stats).toEqual({
        total: 0,
        waiting: 0,
        reserved: 0,
        done: 0,
        failed: 0,
        delayed: 0
      });
    });

    it('should return correct stats with various job states', async () => {
      // Add waiting job
      await queue.addJob('simple-job', { payload: { data: 'waiting' } });
      
      // Add delayed job
      await queue.addJob('delayed-job', { 
        payload: { message: 'delayed' }, 
        delay: 10 
      });
      
      // Add and reserve job
      const id = await queue.addJob('simple-job', { payload: { data: 'reserved' } });
      const reserved = await queue['reserve'](0);
      
      // Add and complete job
      const id2 = await queue.addJob('simple-job', { payload: { data: 'completed' } });
      const reserved2 = await queue['reserve'](0);
      await queue['completeJob'](reserved2!);
      
      // Add and fail job
      const id3 = await queue.addJob('simple-job', { payload: { data: 'failed' } });
      const reserved3 = await queue['reserve'](0);
      await queue['failJob'](reserved3!, new Error('Test error'));

      const stats = queue.getStats();
      expect(stats.total).toBe(5);
      expect(stats.waiting).toBe(1);
      expect(stats.reserved).toBe(1);
      expect(stats.done).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.delayed).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all jobs and reset state', async () => {
      await queue.addJob('simple-job', { payload: { data: 'job1' } });
      await queue.addJob('delayed-job', { 
        payload: { message: 'job2' }, 
        delay: 10 
      });
      
      const stats1 = queue.getStats();
      expect(stats1.total).toBe(2);

      queue.clear();

      const stats2 = queue.getStats();
      expect(stats2.total).toBe(0);
      expect(stats2.delayed).toBe(0);

      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();
    });

    it('should clear all timeouts', async () => {
      // Add delayed job
      await queue.addJob('delayed-job', { 
        payload: { message: 'delayed' }, 
        delay: 1 
      });
      
      // Add job with TTR and reserve it
      await queue.addJob('simple-job', { 
        payload: { data: 'ttr' }, 
        ttr: 1 
      });
      await queue['reserve'](0);

      queue.clear();

      // Wait and ensure no jobs become available (timeouts were cleared)
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should clear all timeouts on cleanup', async () => {
      await queue.addJob('delayed-job', { 
        payload: { message: 'delayed' }, 
        delay: 10 
      });
      
      await queue.addJob('simple-job', { 
        payload: { data: 'ttr' }, 
        ttr: 10 
      });
      await queue['reserve'](0);

      await queue.cleanup();

      // Stats should still show jobs but timeouts should be cleared
      const stats = queue.getStats();
      expect(stats.total).toBe(2);
    });
  });

  describe('memory management', () => {
    it('should cleanup old completed jobs when maxJobs exceeded', async () => {
      const smallQueue = new InMemoryQueue<TestJobs>({ 
        name: 'small-queue',
        maxJobs: 5 
      });

      // Add and complete 7 jobs (exceeds maxJobs of 5)
      for (let i = 0; i < 7; i++) {
        const id = await smallQueue.addJob('simple-job', { payload: { data: `job${i}` } });
        const reserved = await smallQueue['reserve'](0);
        await smallQueue['completeJob'](reserved!);
      }

      const stats = smallQueue.getStats();
      expect(stats.total).toBeLessThanOrEqual(5);
      expect(stats.done).toBeGreaterThan(0);

      await smallQueue.cleanup();
    });

    it('should not cleanup active or waiting jobs', async () => {
      const smallQueue = new InMemoryQueue<TestJobs>({ 
        name: 'small-queue',
        maxJobs: 3 
      });

      // Add 2 waiting jobs
      await smallQueue.addJob('simple-job', { payload: { data: 'waiting1' } });
      await smallQueue.addJob('simple-job', { payload: { data: 'waiting2' } });
      
      // Add and reserve 1 job
      await smallQueue.addJob('simple-job', { payload: { data: 'reserved' } });
      await smallQueue['reserve'](0);
      
      // Add 2 more jobs to exceed limit
      await smallQueue.addJob('simple-job', { payload: { data: 'waiting3' } });
      await smallQueue.addJob('simple-job', { payload: { data: 'waiting4' } });

      const stats = smallQueue.getStats();
      expect(stats.waiting).toBe(4); // All waiting jobs should remain
      expect(stats.reserved).toBe(1); // Reserved job should remain

      await smallQueue.cleanup();
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent job additions', async () => {
      const promises = Array.from({ length: 20 }, (_, i) => 
        queue.addJob('simple-job', { payload: { data: `job${i}` } })
      );

      const ids = await Promise.all(promises);
      expect(new Set(ids).size).toBe(20); // All IDs should be unique

      const stats = queue.getStats();
      expect(stats.waiting).toBe(20);
    });

    it('should handle concurrent reserves', async () => {
      // Add 10 jobs
      for (let i = 0; i < 10; i++) {
        await queue.addJob('simple-job', { payload: { data: `job${i}` } });
      }

      // Reserve concurrently
      const promises = Array.from({ length: 15 }, () => queue['reserve'](0));
      const results = await Promise.all(promises);

      const reserved = results.filter(r => r !== null);
      expect(reserved).toHaveLength(10);

      // Check all IDs are unique
      const ids = reserved.map(r => r!.id);
      expect(new Set(ids).size).toBe(10);

      const stats = queue.getStats();
      expect(stats.reserved).toBe(10);
      expect(stats.waiting).toBe(0);
    });
  });

  describe('job processing integration', () => {
    it('should process jobs with event handlers', async () => {
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': async ({ payload }) => {
          processedJobs.push(payload.data);
        },
        'priority-job': async ({ payload }) => {
          processedJobs.push(`priority: ${payload.message}`);
        },
        'delayed-job': vi.fn(),
        'long-job': vi.fn()
      });

      await queue.addJob('simple-job', { payload: { data: 'test1' } });
      await queue.addJob('priority-job', { 
        payload: { message: 'test2' }, 
        priority: 10 
      });
      await queue.addJob('simple-job', { payload: { data: 'test3' } });

      // Process jobs once
      await queue.run(false);

      // Priority job should be processed first
      expect(processedJobs).toEqual([
        'priority: test2',
        'test1', 
        'test3'
      ]);
    });

    it('should handle job failures', async () => {
      let errorThrown = false;

      queue.setHandlers({
        'simple-job': async () => {
          throw new Error('Job processing failed');
        },
        'priority-job': vi.fn(),
        'delayed-job': vi.fn(),
        'long-job': vi.fn()
      });

      queue.on('afterError', () => {
        errorThrown = true;
      });

      await queue.addJob('simple-job', { payload: { data: 'failing job' } });

      await queue.run(false);

      expect(errorThrown).toBe(true);
      
      const stats = queue.getStats();
      expect(stats.failed).toBe(1);
    });
  });
});

describe('createMemoryQueue', () => {
  it('should create InMemoryQueue with convenience function', () => {
    const queue = createMemoryQueue<TestJobs>('test-queue', { maxJobs: 50 });
    
    expect(queue).toBeInstanceOf(InMemoryQueue);
    expect(queue.name).toBe('test-queue');
  });

  it('should create queue with default options', () => {
    const queue = createMemoryQueue('default-queue');
    
    expect(queue).toBeInstanceOf(InMemoryQueue);
    expect(queue.name).toBe('default-queue');
  });
});