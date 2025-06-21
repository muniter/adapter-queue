import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Worker } from '../../src/worker/worker.ts';
import { DbQueue } from '../../src/drivers/db.ts';
import { TestDatabaseAdapter } from '../mocks/test-database-adapter.ts';
import { SimpleJob } from '../jobs/test-job.ts';

describe('Worker', () => {
  let queue: DbQueue;
  let dbAdapter: TestDatabaseAdapter;

  beforeEach(() => {
    dbAdapter = new TestDatabaseAdapter();
    queue = new DbQueue(dbAdapter);
  });

  describe('basic worker functionality', () => {
    it('should process jobs when running', async () => {
      const job = new SimpleJob('worker test');
      queue['serializer'].registerJob('SimpleJob', SimpleJob);
      await queue.push(job);

      const afterExecSpy = vi.fn();
      queue.on('afterExec', afterExecSpy);

      const worker = new Worker(queue);
      
      // Mock the run method to only process one job
      queue.run = vi.fn().mockImplementation(async (repeat, timeout) => {
        const message = await queue['reserve'](timeout || 0);
        if (message) {
          await queue['handleMessage'](message);
          await queue['release'](message);
        }
      });

      await worker.start(false, 0); // Run once, no timeout

      expect(afterExecSpy).toHaveBeenCalledOnce();
      expect(queue.run).toHaveBeenCalledWith(false, 0);
    });

    it('should create worker with custom options', () => {
      const worker = new Worker(queue, {
        isolate: true,
        timeout: 60,
        childScriptPath: '/custom/path/worker-child.js'
      });

      expect(worker).toBeInstanceOf(Worker);
    });
  });

  describe('isolated mode', () => {
    it('should modify handleMessage when isolate is enabled', () => {
      const originalHandleMessage = queue['handleMessage'];
      const worker = new Worker(queue, { isolate: true });

      // The handleMessage should be different now
      expect(queue['handleMessage']).not.toBe(originalHandleMessage);
    });

    it('should use custom child script path when provided', () => {
      const customPath = '/custom/worker-child.js';
      const worker = new Worker(queue, { 
        isolate: true,
        childScriptPath: customPath
      });

      expect(worker).toBeInstanceOf(Worker);
    });
  });

  describe('worker configuration', () => {
    it('should pass correct parameters to queue.run', async () => {
      const runSpy = vi.spyOn(queue, 'run').mockResolvedValue();
      
      const worker = new Worker(queue);
      await worker.start(true, 5);

      expect(runSpy).toHaveBeenCalledWith(true, 5);
      runSpy.mockRestore();
    });

    it('should use default parameters', async () => {
      const runSpy = vi.spyOn(queue, 'run').mockResolvedValue();
      
      const worker = new Worker(queue);
      await worker.start();

      expect(runSpy).toHaveBeenCalledWith(true, 3);
      runSpy.mockRestore();
    });
  });

  describe('error handling in worker', () => {
    it('should handle queue errors gracefully', async () => {
      const error = new Error('Queue error');
      vi.spyOn(queue, 'run').mockRejectedValue(error);

      const worker = new Worker(queue);
      
      await expect(worker.start()).rejects.toThrow('Queue error');
    });
  });
});