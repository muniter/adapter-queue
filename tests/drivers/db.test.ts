import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DbQueue } from '../../src/drivers/db.ts';
import { TestDatabaseAdapter } from '../mocks/test-database-adapter.ts';

interface TestJobs {
  'simple-job': { data: string };
  'failing-job': { shouldFail: boolean };
}

describe('DbQueue', () => {
  let queue: DbQueue<TestJobs>;
  let dbAdapter: TestDatabaseAdapter;

  beforeEach(() => {
    dbAdapter = new TestDatabaseAdapter();
    queue = new DbQueue<TestJobs>(dbAdapter);
  });

  describe('addJob and reserve cycle', () => {
    it('should add and reserve a job successfully', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test data' } });
      expect(id).toBeTruthy();

      const reserved = await queue['reserve'](0);
      expect(reserved).not.toBeNull();
      expect(reserved!.id).toBe(id);
    });

    it('should accept job delay in options', async () => {
      const id = await queue.addJob('simple-job', { 
        payload: { data: 'delayed job' }, 
        delay: 5 
      });
      
      const immediateReserve = await queue['reserve'](0);
      expect(immediateReserve).toBeNull();
      
      // In a real test, we'd wait or mock time
      expect(dbAdapter.jobsArray[0]?.meta.delay).toBe(5);
    });

    it('should handle job execution lifecycle', async () => {
      const processedJobs: string[] = [];
      
      queue.onJob('simple-job', async (payload) => {
        processedJobs.push(payload.data);
      });

      await queue.addJob('simple-job', { payload: { data: 'test1' } });
      await queue.addJob('simple-job', { payload: { data: 'test2' } });

      // Process jobs once
      await queue.run(false);

      expect(processedJobs).toEqual(['test1', 'test2']);
    });
  });

  describe('error handling and retries', () => {
    it('should handle job failure', async () => {
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

  describe('job status', () => {
    it('should track job status correctly', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'status test' } });
      
      // Initially waiting
      expect(await queue.status(id)).toBe('waiting');
      
      // After reserving
      await queue['reserve'](0);
      expect(await queue.status(id)).toBe('reserved');
      
      // After completing
      await queue['release']({ id, payload: '', meta: {} });
      expect(await queue.status(id)).toBe('done');
    });
  });

  describe('job options', () => {
    it('should support job options for all features', async () => {
      const id = await queue.addJob('simple-job', { 
        payload: { data: 'options job' },
        ttr: 600, 
        delay: 30, 
        priority: 5 
      });

      expect(id).toBeTruthy();
      
      const job = dbAdapter.jobsArray.find(j => j.id === id);
      expect(job!.meta.ttr).toBe(600);
      expect(job!.meta.delay).toBe(30);
      expect(job!.meta.priority).toBe(5);
    });
  });
});