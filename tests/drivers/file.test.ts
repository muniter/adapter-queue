import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FileQueue } from '../../src/drivers/file.js';
import { SimpleJob } from '../jobs/test-job.js';

describe('FileQueue', () => {
  let queue: FileQueue;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'queue-test-' + Date.now());
    queue = new FileQueue({ path: testDir });
    await queue.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  });

  describe('init', () => {
    it('should create queue directory', async () => {
      const stats = await fs.stat(testDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create index file', async () => {
      const indexPath = path.join(testDir, 'index.json');
      const stats = await fs.stat(indexPath);
      expect(stats.isFile()).toBe(true);
    });
  });

  describe('push', () => {
    it('should add job to waiting queue', async () => {
      const job = new SimpleJob('test payload');
      const id = await queue.push(job);
      
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      const status = await queue.status(id);
      expect(status).toBe('waiting');
    });

    it('should add delayed job to delayed queue', async () => {
      const job = new SimpleJob('test payload');
      const id = await queue.delay(10).push(job);
      
      const status = await queue.status(id);
      expect(status).toBe('waiting');
    });

    it('should create job file', async () => {
      const job = new SimpleJob('test payload');
      const id = await queue.push(job);
      
      const jobPath = path.join(testDir, `job${id}.data`);
      const stats = await fs.stat(jobPath);
      expect(stats.isFile()).toBe(true);
    });
  });

  describe('reserve', () => {
    it('should reserve waiting job', async () => {
      const job = new SimpleJob('test payload');
      const id = await queue.push(job);

      const reserved = await queue['reserve'](0);
      expect(reserved).not.toBeNull();
      expect(reserved!.id).toBe(id);
    });

    it('should return null when queue is empty', async () => {
      const reserved = await queue['reserve'](0);
      expect(reserved).toBeNull();
    });

    it('should respect delay', async () => {
      const job = new SimpleJob('test payload');
      await queue.delay(2).push(job);

      const reserved1 = await queue['reserve'](0);
      expect(reserved1).toBeNull();

      await new Promise(resolve => setTimeout(resolve, 2100));
      
      const reserved2 = await queue['reserve'](0);
      expect(reserved2).not.toBeNull();
    });

    it('should handle TTR timeout', async () => {
      const job = new SimpleJob('test payload');
      await queue.ttr(1).push(job);

      const reserved1 = await queue['reserve'](0);
      expect(reserved1).not.toBeNull();

      // Wait for TTR to expire
      await new Promise(resolve => setTimeout(resolve, 1500));

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
      const job = new SimpleJob('test payload');
      const id = await queue.push(job);

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
      await queue.push(new SimpleJob('job1'));
      await queue.push(new SimpleJob('job2'));
      await queue.delay(10).push(new SimpleJob('job3'));

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
      const job = new SimpleJob('test payload');
      const id = await queue.push(job);

      const removed = await queue.remove(id);
      expect(removed).toBe(true);

      const status = await queue.status(id);
      expect(status).toBe('done');
    });

    it('should remove specific job from delayed', async () => {
      const job = new SimpleJob('test payload');
      const id = await queue.delay(10).push(job);

      const removed = await queue.remove(id);
      expect(removed).toBe(true);

      const status = await queue.status(id);
      expect(status).toBe('done');
    });

    it('should remove specific job from reserved', async () => {
      const job = new SimpleJob('test payload');
      const id = await queue.push(job);
      
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
    it('should handle concurrent pushes', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => 
        queue.push(new SimpleJob(`job${i}`))
      );

      const ids = await Promise.all(promises);
      expect(new Set(ids).size).toBe(10); // All IDs should be unique

      for (const id of ids) {
        const status = await queue.getJobStatus(id);
        expect(status).toBe('waiting');
      }
    });

    it('should handle concurrent reserves', async () => {
      // Push 5 jobs
      for (let i = 0; i < 5; i++) {
        await queue.push(new SimpleJob(`job${i}`));
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
});