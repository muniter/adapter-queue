import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unlinkSync } from 'fs';
import Database from 'better-sqlite3';
import { SQLiteQueue, createSQLiteQueue, SQLiteDatabaseAdapter } from '../../src/adapters/sqlite.ts';

interface TestJobs {
  'simple-job': { data: string };
  'delayed-job': { message: string };
  'failing-job': { shouldFail: boolean };
  'priority-job': { priority: number; data: string };
}

describe('SQLite Integration Tests', () => {
  const testDbPath = './test-queue.db';
  let db: Database.Database;
  let queue: SQLiteQueue<TestJobs>;

  beforeEach(() => {
    // Clean up any existing test database
    try {
      unlinkSync(testDbPath);
    } catch {}
    
    db = new Database(testDbPath);
    queue = new SQLiteQueue<TestJobs>({ name: 'test-sqlite-queue', database: db });
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(testDbPath);
    } catch {}
  });

  describe('SQLiteQueue Constructor Pattern', () => {
    it('should create queue with database instance', () => {
      expect(queue).toBeInstanceOf(SQLiteQueue);
    });

    it('should create tables automatically', () => {
      const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
      expect(tableInfo).toBeTruthy();
    });
  });

  describe('Convenience Factory', () => {
    it('should create queue with factory function', () => {
      const factoryQueue = createSQLiteQueue<TestJobs>('test-factory-queue', './test-factory.db');
      expect(factoryQueue).toBeInstanceOf(SQLiteQueue);
      
      // Clean up by closing the underlying database connection  
      // Note: In real usage, users would handle cleanup themselves
      const adapter = (factoryQueue as any).db as SQLiteDatabaseAdapter;
      adapter.close();
      try {
        unlinkSync('./test-factory.db');
      } catch {}
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
        'priority-job': vi.fn()
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
      
      // Verify job is stored in database
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parseInt(id)) as any;
      expect(job).toBeTruthy();
      expect(job?.status).toBe('waiting');
    });

    it('should handle job delays correctly', async () => {
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': vi.fn(),
        'delayed-job': async ({ payload }) => {
          processedJobs.push(payload.message);
        },
        'failing-job': vi.fn(),
        'priority-job': vi.fn()
      });

      // Add delayed job (1 second delay)
      await queue.addJob('delayed-job', { 
        payload: { message: 'delayed' }, 
        delaySeconds: 1 
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
        }
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
        'priority-job': vi.fn()
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
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parseInt(id)) as any;
      expect(job?.ttr).toBe(10);
    });
  });

  describe('Database Persistence', () => {
    it('should persist jobs across queue instances', async () => {
      // Add job with first queue instance
      const id = await queue.addJob('simple-job', { payload: { data: 'persistent' } });
      
      // Close first instance
      db.close();
      
      // Create new queue instance with same database
      const db2 = new Database(testDbPath);
      const queue2 = new SQLiteQueue<TestJobs>({ name: 'test-sqlite-queue-2', database: db2 });
      
      // Should be able to see the job
      const status = await queue2.status(id);
      expect(status).toBe('waiting');
      
      db2.close();
    });
  });

  describe('Adapter Direct Usage', () => {
    it('should work with adapter directly', async () => {
      const adapter = new SQLiteDatabaseAdapter(db);
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
});