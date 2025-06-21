import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DbQueue } from '../../src/drivers/db.ts';
import { TestDatabaseAdapter } from '../mocks/test-database-adapter.ts';
import { SimpleJob, FailingJob } from '../jobs/test-job.ts';

describe('DbQueue', () => {
  let queue: DbQueue;
  let dbAdapter: TestDatabaseAdapter;

  beforeEach(() => {
    dbAdapter = new TestDatabaseAdapter();
    queue = new DbQueue(dbAdapter);
    
    // Register job classes for serialization
    queue['serializer'].registerJob('SimpleJob', SimpleJob);
    queue['serializer'].registerJob('FailingJob', FailingJob);
  });

  describe('push and reserve cycle', () => {
    it('should push and reserve a job successfully', async () => {
      const job = new SimpleJob('test data');
      const jobId = await queue.push(job);

      expect(jobId).toBe('1');
      expect(dbAdapter.getAllJobs()).toHaveLength(1);

      const message = await queue['reserve'](0);
      expect(message).toBeTruthy();
      expect(message!.id).toBe('1');
      
      const deserializedJob = queue['serializer'].deserialize(message!.payload);
      expect(deserializedJob.data).toBe('test data');
    });

    it('should respect job delay', async () => {
      const job = new SimpleJob('delayed job');
      await queue.delay(1).push(job);

      // Should not be available immediately
      const message1 = await queue['reserve'](0);
      expect(message1).toBeNull();

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 1100));
      const message2 = await queue['reserve'](0);
      
      expect(message2).toBeTruthy();
    });

    it('should handle job execution lifecycle', async () => {
      const job = new SimpleJob('lifecycle test');
      await queue.push(job);

      const beforeExecSpy = vi.fn();
      const afterExecSpy = vi.fn();
      queue.on('beforeExec', beforeExecSpy);
      queue.on('afterExec', afterExecSpy);

      // Manually run one cycle
      const message = await queue['reserve'](0);
      expect(message).toBeTruthy();

      const success = await queue['handleMessage'](message!);
      expect(success).toBe(true);
      expect(beforeExecSpy).toHaveBeenCalledOnce();
      expect(afterExecSpy).toHaveBeenCalledOnce();

      await queue['release'](message!);
      expect(await queue.status(message!.id)).toBe('done');
    });
  });

  describe('error handling and retries', () => {
    it('should handle job failure', async () => {
      const job = new FailingJob(true);
      await queue.push(job);

      const afterErrorSpy = vi.fn();
      queue.on('afterError', afterErrorSpy);

      const message = await queue['reserve'](0);
      const success = await queue['handleMessage'](message!);

      expect(success).toBe(true); // Error handled gracefully
      expect(afterErrorSpy).toHaveBeenCalledOnce();
    });

  });

  describe('job status', () => {
    it('should track job status correctly', async () => {
      const job = new SimpleJob('status test');
      const jobId = await queue.push(job);

      expect(await queue.status(jobId)).toBe('waiting');

      const message = await queue['reserve'](0);
      expect(await queue.status(jobId)).toBe('reserved');

      await queue['release'](message!);
      expect(await queue.status(jobId)).toBe('done');
    });
  });

  describe('fluent interface', () => {
    it('should chain configuration methods', async () => {
      const job = new SimpleJob('fluent test');
      
      const jobId = await queue
        .ttr(600)
        .delay(5)
        .priority(10)
        .push(job);

      const jobs = dbAdapter.getAllJobs();
      expect(jobs[0].meta.ttr).toBe(600);
      expect(jobs[0].meta.delay).toBe(5);
      expect(jobs[0].meta.priority).toBe(10);
    });
  });
});