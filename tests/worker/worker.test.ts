import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Worker } from '../../src/worker/worker.ts';
import { DbQueue } from '../../src/drivers/db.ts';
import { TestDatabaseAdapter } from '../mocks/test-database-adapter.ts';

interface TestJobs {
  'simple-job': { data: string };
  'worker-job': { message: string };
}

describe('Worker', () => {
  let queue: DbQueue<TestJobs>;
  let dbAdapter: TestDatabaseAdapter;

  beforeEach(() => {
    dbAdapter = new TestDatabaseAdapter();
    queue = new DbQueue<TestJobs>(dbAdapter, { name: 'test-queue' });
  });

  describe('basic worker functionality', () => {
    it('should process jobs when running', async () => {
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': async ({ payload }) => {
          processedJobs.push(payload.data);
        },
        'worker-job': vi.fn()
      });

      await queue.addJob('simple-job', { payload: { data: 'worker test' } });

      const afterExecSpy = vi.fn();
      queue.on('afterExec', afterExecSpy);

      const worker = new Worker(queue);
      await worker.start(false, 1); // Process once

      expect(processedJobs).toEqual(['worker test']);
      expect(afterExecSpy).toHaveBeenCalledOnce();
    });

    it('should handle multiple workers', async () => {
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': vi.fn(),
        'worker-job': async ({ payload }) => {
          processedJobs.push(payload.message);
          await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
        }
      });

      // Add multiple jobs
      for (let i = 0; i < 5; i++) {
        await queue.addJob('worker-job', { payload: { message: `job${i}` } });
      }

      const worker1 = new Worker(queue);
      const worker2 = new Worker(queue);

      // Run workers concurrently for a short time
      await Promise.all([
        worker1.start(false, 1),
        worker2.start(false, 1)
      ]);

      expect(processedJobs).toHaveLength(5);
      expect(processedJobs.sort()).toEqual(['job0', 'job1', 'job2', 'job3', 'job4']);
    });


    it('should handle worker start and stop', async () => {
      queue.setHandlers({
        'simple-job': vi.fn(),
        'worker-job': vi.fn()
      });
      
      const worker = new Worker(queue);
      
      // Worker should be able to start and stop without errors
      await expect(worker.start(false, 0)).resolves.not.toThrow();
    });

    it('should support different worker options', async () => {
      const worker1 = new Worker(queue);
      const worker2 = new Worker(queue, { timeout: 5 });
      
      expect(worker1).toBeInstanceOf(Worker);
      expect(worker2).toBeInstanceOf(Worker);
    });

    it('should handle concurrent job processing', async () => {
      const processedJobs: string[] = [];
      const startTimes: number[] = [];
      
      queue.setHandlers({
        'simple-job': vi.fn(),
        'worker-job': async ({ payload }) => {
          startTimes.push(Date.now());
          await new Promise(resolve => setTimeout(resolve, 50));
          processedJobs.push(payload.message);
        }
      });

      // Add jobs
      await queue.addJob('worker-job', { payload: { message: 'concurrent1' } });
      await queue.addJob('worker-job', { payload: { message: 'concurrent2' } });

      const worker = new Worker(queue);
      await worker.start(false, 1);

      expect(processedJobs).toHaveLength(2);
      expect(processedJobs.sort()).toEqual(['concurrent1', 'concurrent2']);
    });

    it('should emit events during job processing', async () => {
      const events: string[] = [];
      
      queue.setHandlers({
        'simple-job': async ({ payload }) => {
          // Job processor
        },
        'worker-job': vi.fn()
      });

      queue.on('beforeExec', () => events.push('beforeExec'));
      queue.on('afterExec', () => events.push('afterExec'));

      await queue.addJob('simple-job', { payload: { data: 'event test' } });

      const worker = new Worker(queue);
      await worker.start(false, 1);

      expect(events).toEqual(['beforeExec', 'afterExec']);
    });
  });
});