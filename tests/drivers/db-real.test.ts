import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { DbQueue } from '../../src/drivers/db.ts';
import { SQLiteDatabaseAdapter } from '../../src/adapters/sqlite.ts';
import { TestDatabaseAdapter } from '../mocks/test-database-adapter.ts';

interface TestJobs {
  'simple-job': { data: string };
  'failing-job': { shouldFail: boolean };
  'delayed-job': { message: string };
}

describe('DbQueue with Real SQLite Adapter', () => {
  const testDbPath = './test-db-real.db';
  let db: Database.Database;
  let realQueue: DbQueue<TestJobs>;
  let mockQueue: DbQueue<TestJobs>;
  let realAdapter: SQLiteDatabaseAdapter;
  let mockAdapter: TestDatabaseAdapter;

  beforeEach(() => {
    // Clean up any existing test database
    try {
      unlinkSync(testDbPath);
    } catch {}
    
    // Setup real SQLite adapter
    db = new Database(testDbPath);
    realAdapter = new SQLiteDatabaseAdapter(db);
    realQueue = new DbQueue<TestJobs>(realAdapter);
    
    // Setup mock adapter for comparison
    mockAdapter = new TestDatabaseAdapter();
    mockQueue = new DbQueue<TestJobs>(mockAdapter);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(testDbPath);
    } catch {}
  });

  describe('Adapter Compatibility', () => {
    it('should behave the same as mock adapter for basic operations', async () => {
      // Test job insertion
      const realId = await realQueue.addJob('simple-job', { payload: { data: 'test' } });
      const mockId = await mockQueue.addJob('simple-job', { payload: { data: 'test' } });
      
      expect(realId).toBeTruthy();
      expect(mockId).toBeTruthy();
      
      // Test status checking
      expect(await realQueue.status(realId)).toBe('waiting');
      expect(await mockQueue.status(mockId)).toBe('waiting');
    });

    it('should handle job processing identically', async () => {
      const realProcessed: string[] = [];
      const mockProcessed: string[] = [];
      
      realQueue.onJob('simple-job', async (payload) => {
        realProcessed.push(payload.data);
      });
      
      mockQueue.onJob('simple-job', async (payload) => {
        mockProcessed.push(payload.data);
      });

      // Add same jobs to both queues
      await realQueue.addJob('simple-job', { payload: { data: 'test1' } });
      await realQueue.addJob('simple-job', { payload: { data: 'test2' } });
      await mockQueue.addJob('simple-job', { payload: { data: 'test1' } });
      await mockQueue.addJob('simple-job', { payload: { data: 'test2' } });

      // Process jobs
      await realQueue.run(false);
      await mockQueue.run(false);

      expect(realProcessed.sort()).toEqual(mockProcessed.sort());
    });
  });

  describe('Real SQLite Features', () => {
    it('should persist data to actual database file', async () => {
      await realQueue.addJob('simple-job', { payload: { data: 'persistent' } });
      
      // Verify data exists in database (check by partial payload content)
      const jobs = db.prepare('SELECT * FROM jobs').all();
      expect(jobs).toHaveLength(1);
      
      const job = jobs[0];
      expect(job.status).toBe('waiting');
      
      // Verify the payload contains our data (it's a serialized job request)
      const payloadStr = job.payload.toString();
      expect(payloadStr).toContain('persistent');
    });

    it('should handle concurrent access correctly', async () => {
      // Add multiple jobs
      const jobs = await Promise.all([
        realQueue.addJob('simple-job', { payload: { data: 'job1' } }),
        realQueue.addJob('simple-job', { payload: { data: 'job2' } }),
        realQueue.addJob('simple-job', { payload: { data: 'job3' } }),
      ]);

      expect(jobs).toHaveLength(3);
      expect(new Set(jobs).size).toBe(3); // All IDs should be unique
      
      // Verify all jobs are in database
      const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
      expect(jobCount.count).toBe(3);
    });

    it('should properly handle database transactions', async () => {
      const processedJobs: string[] = [];
      let jobIdDuringProcessing: string;
      
      realQueue.onJob('simple-job', async (payload) => {
        processedJobs.push(payload.data);
        // We can't easily check the job status during processing since we don't have the ID here
      });

      const jobId = await realQueue.addJob('simple-job', { payload: { data: 'transaction test' } });
      await realQueue.run(false);

      // After processing, job should be marked as done
      const status = await realQueue.status(jobId);
      expect(status).toBe('done');
      expect(processedJobs).toEqual(['transaction test']);
    });

    it('should handle priority ordering correctly', async () => {
      const processedJobs: number[] = [];
      
      realQueue.onJob('simple-job', async (payload) => {
        processedJobs.push(parseInt(payload.data));
      });

      // Add jobs with different priorities (SQLite should order by priority DESC)
      await realQueue.addJob('simple-job', { payload: { data: '1' }, priority: 1 });
      await realQueue.addJob('simple-job', { payload: { data: '5' }, priority: 5 });
      await realQueue.addJob('simple-job', { payload: { data: '3' }, priority: 3 });

      await realQueue.run(false);

      // Should process in priority order (highest first)
      expect(processedJobs).toEqual([5, 3, 1]);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close database to force error
      db.close();
      
      // Should throw error when trying to add job
      await expect(
        realQueue.addJob('simple-job', { payload: { data: 'error test' } })
      ).rejects.toThrow();
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle large number of jobs efficiently', async () => {
      const jobCount = 100;
      const startTime = Date.now();
      
      // Add many jobs
      const promises = [];
      for (let i = 0; i < jobCount; i++) {
        promises.push(
          realQueue.addJob('simple-job', { payload: { data: `job-${i}` } })
        );
      }
      
      await Promise.all(promises);
      const insertTime = Date.now() - startTime;
      
      // Verify all jobs were inserted
      const count = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
      expect(count.count).toBe(jobCount);
      
      // Should be reasonably fast (less than 1 second for 100 jobs)
      expect(insertTime).toBeLessThan(1000);
    });
  });
});