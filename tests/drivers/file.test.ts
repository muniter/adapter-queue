import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FileQueue } from '../../src/drivers/file.js';

interface TestJobs {
  'simple-job': { data: string };
  'delayed-job': { message: string };
}

describe('FileQueue', () => {
  let queue: FileQueue<TestJobs>;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'queue-test-' + Date.now());
    queue = new FileQueue<TestJobs>({ name: 'test-queue', path: testDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  });

  describe('auto-initialization', () => {
    it('should create queue directory on first job addition', async () => {
      await queue.addJob('simple-job', { payload: { data: 'test' } });
      
      const stats = await fs.stat(testDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create index file on first job addition', async () => {
      await queue.addJob('simple-job', { payload: { data: 'test' } });
      
      const indexPath = path.join(testDir, 'queue.index.json');
      const stats = await fs.stat(indexPath);
      expect(stats.isFile()).toBe(true);
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

    it('should add delayed job to delayed queue', async () => {
      const id = await queue.addJob('delayed-job', { 
        payload: { message: 'test payload' }, 
        delay: 10 
      });
      
      const status = await queue.status(id);
      expect(status).toBe('waiting');
    });

    it('should create job file', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test payload' } });
      
      const jobPath = path.join(testDir, `job${id}.data`);
      const stats = await fs.stat(jobPath);
      expect(stats.isFile()).toBe(true);
    });
  });

  describe('reserve', () => {
    it('should reserve waiting job', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test payload' } });

      const reserved = await queue['reserve'](0);
      expect(reserved).not.toBeNull();
      expect(reserved!.id).toBe(id);
    });

    it('should return null when queue is empty', async () => {
      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();
    });

    it('should respect delay', async () => {
      await queue.addJob('delayed-job', { 
        payload: { message: 'test payload' }, 
        delay: 2 
      });

      const reserved1 = await queue['reserve'](0);
      expect(reserved1).toBeNull();

      await new Promise(resolve => setTimeout(resolve, 2100));
      
      const reserved2 = await queue['reserve'](0);
      expect(reserved2).not.toBeNull();
    });

    it('should handle TTR timeout', async () => {
      await queue.addJob('simple-job', { 
        payload: { data: 'test payload' }, 
        ttr: 1 
      });

      const reserved1 = await queue['reserve'](0);
      expect(reserved1).not.toBeNull();

      // Wait for TTR to expire
      await new Promise(resolve => setTimeout(resolve, 2000));

      const reserved2 = await queue['reserve'](0);
      expect(reserved2).not.toBeNull();
      expect(reserved2!.id).toBe(reserved1!.id);
      
      // Complete the job to clean up
      if (reserved2) {
        await queue.complete(reserved2.id);
      }
    });
  });

  describe('complete', () => {
    it('should remove completed job', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test payload' } });

      const reserved = await queue['reserve'](0);
      expect(reserved).not.toBeNull();

      await queue.complete(id);
      
      const status = await queue.status(id);
      expect(status).toBe('done');

      const jobPath = path.join(testDir, `job${id}.data`);
      await expect(fs.access(jobPath)).rejects.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all jobs', async () => {
      await queue.addJob('simple-job', { payload: { data: 'job1' } });
      await queue.addJob('simple-job', { payload: { data: 'job2' } });
      await queue.addJob('delayed-job', { 
        payload: { message: 'job3' }, 
        delay: 10 
      });

      await queue.clear();

      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();

      const files = await fs.readdir(testDir);
      const jobFiles = files.filter(f => f.startsWith('job') && f.endsWith('.data'));
      expect(jobFiles).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('should remove specific job from waiting', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test payload' } });

      const removed = await queue.remove(id);
      expect(removed).toBe(true);

      const status = await queue.status(id);
      expect(status).toBe('done');
    });

    it('should remove specific job from delayed', async () => {
      const id = await queue.addJob('delayed-job', { 
        payload: { message: 'test payload' }, 
        delay: 10 
      });

      const removed = await queue.remove(id);
      expect(removed).toBe(true);

      const status = await queue.status(id);
      expect(status).toBe('done');
    });

    it('should remove specific job from reserved', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'test payload' } });
      
      await queue['reserve'](0);

      const removed = await queue.remove(id);
      expect(removed).toBe(true);

      const status = await queue.status(id);
      expect(status).toBe('done');
    });

    it('should return false for non-existent job', async () => {
      const removed = await queue.remove('999');
      expect(removed).toBe(false);
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent job additions', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => 
        queue.addJob('simple-job', { payload: { data: `job${i}` } })
      );

      const ids = await Promise.all(promises);
      expect(new Set(ids).size).toBe(10); // All IDs should be unique

      for (const id of ids) {
        const status = await queue.status(id);
        expect(status).toBe('waiting');
      }
    });

    it('should handle concurrent reserves', async () => {
      // Add 5 jobs
      for (let i = 0; i < 5; i++) {
        await queue.addJob('simple-job', { payload: { data: `job${i}` } });
      }

      // Reserve concurrently
      const promises = Array.from({ length: 10 }, () => queue['reserve'](0));
      const results = await Promise.all(promises);

      const reserved = results.filter(r => r !== null);
      expect(reserved).toHaveLength(5);

      // Check all IDs are unique
      const ids = reserved.map(r => r!.id);
      expect(new Set(ids).size).toBe(5);
    });
  });

  describe('job processing', () => {
    it('should process jobs with event handlers', async () => {
      const processedJobs: string[] = [];
      
      queue.setHandlers({
        'simple-job': async ({ payload }) => {
          processedJobs.push(payload.data);
        },
        'delayed-job': vi.fn()
      });

      await queue.addJob('simple-job', { payload: { data: 'test1' } });
      await queue.addJob('simple-job', { payload: { data: 'test2' } });

      // Process jobs once
      await queue.run(false);

      expect(processedJobs).toEqual(['test1', 'test2']);
    });
  });
});