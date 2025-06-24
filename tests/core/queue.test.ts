import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Queue } from '../../src/core/queue.ts';
import type { JobMeta, QueueMessage, DbJobRequest } from '../../src/interfaces/job.ts';

interface TestJobs {
  'test-job': { data: string };
  'math-job': { a: number; b: number };
  'success-job': { data: string };
  'fail-job': { data: string };
}

class TestQueue extends Queue<TestJobs, DbJobRequest<any>> {
  public messages: Array<{ payload: string; meta: JobMeta; id: string }> = [];
  public completedJobs: Array<{ id: string; message: QueueMessage }> = [];
  public failedJobs: Array<{ id: string; message: QueueMessage; error: unknown }> = [];
  private nextId = 1;

  protected async pushMessage(payload: string, meta: JobMeta): Promise<string> {
    const id = this.nextId.toString();
    this.nextId++;
    this.messages.push({ payload, meta, id });
    return id;
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    const message = this.messages.shift();
    if (!message) return null;
    
    return {
      id: message.id,
      payload: message.payload,
      meta: message.meta
    };
  }

  protected async completeJob(message: QueueMessage): Promise<void> {
    this.completedJobs.push({ id: message.id, message });
  }

  protected async failJob(message: QueueMessage, error: unknown): Promise<void> {
    this.failedJobs.push({ id: message.id, message, error });
  }

  async status(id: string): Promise<'waiting' | 'reserved' | 'done'> {
    return 'done';
  }

  // Helper methods for testing
  clearTracking() {
    this.completedJobs = [];
    this.failedJobs = [];
  }
}

class TestQueueWithLongPolling extends TestQueue {
  constructor(options = {}) {
    super(options);
    this.supportsLongPolling = true;
  }
}

describe('Queue', () => {
  let queue: TestQueue;

  beforeEach(() => {
    queue = new TestQueue();
  });

  describe('addJob', () => {
    it('should add a job with default settings', async () => {
      const id = await queue.addJob('test-job', { 
        payload: { data: 'test data' }
      });

      expect(id).toBe('1');
      expect(queue.messages).toHaveLength(1);
      expect(queue.messages[0]?.meta.ttr).toBe(300);
      expect(queue.messages[0]?.meta.delay).toBe(0);
      expect(queue.messages[0]?.meta.priority).toBe(0);
    });

    it('should add a job with custom settings using new API', async () => {
      const id = await queue.addJob('test-job', {
        payload: { data: 'test data' },
        ttr: 600,
        delay: 30,
        priority: 5
      });

      expect(id).toBe('1');
      expect(queue.messages).toHaveLength(1);
      expect(queue.messages[0]?.meta.ttr).toBe(600);
      expect(queue.messages[0]?.meta.delay).toBe(30);
      expect(queue.messages[0]?.meta.priority).toBe(5);
    });

    it('should emit beforePush and afterPush events', async () => {
      const beforePushSpy = vi.fn();
      const afterPushSpy = vi.fn();

      queue.on('beforePush', beforePushSpy);
      queue.on('afterPush', afterPushSpy);

      await queue.addJob('test-job', { payload: { data: 'test data' } });

      expect(beforePushSpy).toHaveBeenCalledOnce();
      expect(afterPushSpy).toHaveBeenCalledOnce();
      expect(beforePushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'beforePush',
          name: 'test-job',
          payload: { data: 'test data' },
          meta: expect.any(Object)
        })
      );
    });

    it('should use default TTR when no options provided', async () => {
      await queue.addJob('test-job', { payload: { data: 'job1' }, ttr: 600 });
      await queue.addJob('test-job', { payload: { data: 'job2' } });

      expect(queue.messages[0]?.meta.ttr).toBe(600);
      expect(queue.messages[1]?.meta.ttr).toBe(300); // back to default
    });
  });

  describe('job processing', () => {
    it('should execute job handler successfully', async () => {
      const handlerSpy = vi.fn().mockResolvedValue(undefined);
      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });

      const payloadString = JSON.stringify({
        name: 'test-job',
        payload: { data: 'test data' }
      });
      
      const message: QueueMessage = {
        id: '1',
        payload: payloadString,
        meta: { ttr: 300 }
      };

      const result = await queue['handleMessage'](message);
      
      expect(result).toBe(true);
      expect(handlerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          payload: { data: 'test data' },
          meta: { ttr: 300 }
        }),
        queue
      );
    });

    it('should emit beforeExec and afterExec events', async () => {
      const beforeExecSpy = vi.fn();
      const afterExecSpy = vi.fn();
      const handlerSpy = vi.fn().mockResolvedValue('result');

      queue.on('beforeExec', beforeExecSpy);
      queue.on('afterExec', afterExecSpy);
      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });

      const payloadString = JSON.stringify({
        name: 'test-job',
        payload: { data: 'test data' }
      });
      
      const message: QueueMessage = {
        id: '1',
        payload: payloadString,
        meta: { ttr: 300 }
      };

      await queue['handleMessage'](message);

      expect(beforeExecSpy).toHaveBeenCalledOnce();
      expect(afterExecSpy).toHaveBeenCalledOnce();
      expect(beforeExecSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'beforeExec',
          id: '1',
          name: 'test-job',
          payload: { data: 'test data' },
          meta: { ttr: 300 }
        })
      );
    });

    it('should handle job execution errors', async () => {
      const error = new Error('Job failed');
      const handlerSpy = vi.fn().mockRejectedValue(error);
      const errorSpy = vi.fn();

      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      queue.on('afterError', errorSpy);

      const payloadString = JSON.stringify({
        name: 'test-job',
        payload: { data: 'test data' }
      });
      
      const message: QueueMessage = {
        id: '1',
        payload: payloadString,
        meta: { ttr: 300 }
      };

      const result = await queue['handleMessage'](message);
      
      expect(result).toBe(false); // Job failed
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'afterError',
          id: '1',
          name: 'test-job',
          payload: { data: 'test data' },
          error
        })
      );
    });

    it('should error when no handler is registered', async () => {
      const errorSpy = vi.fn();
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      queue.on('afterError', errorSpy);

      const payloadString = JSON.stringify({
        name: 'unregistered-job',
        payload: { data: 'test data' }
      });
      
      const message: QueueMessage = {
        id: '1',
        payload: payloadString,
        meta: { ttr: 300 }
      };

      const result = await queue['handleMessage'](message);
      
      expect(result).toBe(false); // Job failed
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'afterError',
          error: expect.objectContaining({
            message: 'No handler registered for job type: unregistered-job'
          })
        })
      );
    });
  });

  describe('polling behavior', () => {
    // Plugin to track polling times
    class PollTrackingPlugin {
      public pollTimes: number[] = [];
      public pollCount = 0;
      
      async beforePoll(): Promise<'continue' | 'stop'> {
        this.pollTimes.push(Date.now());
        this.pollCount++;
        
        // Stop after a few polls to prevent infinite loop
        if (this.pollCount >= 3) {
          return 'stop';
        }
        return 'continue';
      }
      
      getTimeBetweenPolls(index1: number, index2: number): number {
        if (index1 >= this.pollTimes.length || index2 >= this.pollTimes.length) {
          return -1;
        }
        return this.pollTimes[index2]! - this.pollTimes[index1]!;
      }
    }

    it('should sleep for at least 500ms when timeout is 0 (non-long-polling)', async () => {
      const plugin = new PollTrackingPlugin();
      const queue = new TestQueue({ plugins: [plugin] });
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      
      // Run with repeat=true and timeout=0
      await queue.run(true, 0);
      
      // Check time between polls
      const timeBetweenPolls = plugin.getTimeBetweenPolls(0, 1);
      expect(timeBetweenPolls).toBeGreaterThanOrEqual(500);
      expect(timeBetweenPolls).toBeLessThan(600); // Allow some margin
    });

    it('should sleep for at least 500ms when timeout < 0.5s (non-long-polling)', async () => {
      const plugin = new PollTrackingPlugin();
      const queue = new TestQueue({ plugins: [plugin] });
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      
      // Run with timeout=0.2 (200ms)
      await queue.run(true, 0.2);
      
      // Should still sleep for 500ms, not 200ms
      const timeBetweenPolls = plugin.getTimeBetweenPolls(0, 1);
      expect(timeBetweenPolls).toBeGreaterThanOrEqual(500);
      expect(timeBetweenPolls).toBeLessThan(600);
    });

    it('should use timeout value when > 0.5s (non-long-polling)', async () => {
      const plugin = new PollTrackingPlugin();
      const queue = new TestQueue({ plugins: [plugin] });
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      
      // Run with timeout=2 (2 seconds)
      await queue.run(true, 2);
      
      // Should sleep for 2000ms
      const timeBetweenPolls = plugin.getTimeBetweenPolls(0, 1);
      expect(timeBetweenPolls).toBeGreaterThanOrEqual(2000);
      expect(timeBetweenPolls).toBeLessThan(2100);
    });

    it('should not sleep when timeout is 0 (long-polling)', async () => {
      const plugin = new PollTrackingPlugin();
      const queue = new TestQueueWithLongPolling({ plugins: [plugin] });
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      
      // Run with timeout=0
      await queue.run(true, 0);
      
      // With long polling and timeout=0, polls should be immediate
      const timeBetweenPolls = plugin.getTimeBetweenPolls(0, 1);
      expect(timeBetweenPolls).toBeLessThan(50); // Should be nearly instant
    });

    it('should use exact timeout value (long-polling)', async () => {
      const plugin = new PollTrackingPlugin();
      const queue = new TestQueueWithLongPolling({ plugins: [plugin] });
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      
      // Run with timeout=0.2 (200ms)
      await queue.run(true, 0.2);
      
      // Should sleep for exactly 200ms
      const timeBetweenPolls = plugin.getTimeBetweenPolls(0, 1);
      expect(timeBetweenPolls).toBeGreaterThanOrEqual(200);
      expect(timeBetweenPolls).toBeLessThan(250);
    });

    it('should not sleep in single run mode', async () => {
      const plugin = new PollTrackingPlugin();
      const queue = new TestQueue({ plugins: [plugin] });
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      
      // Run with repeat=false
      await queue.run(false, 0);
      
      // Should only poll once
      expect(plugin.pollCount).toBe(1);
    });
  });

  describe('job completion methods', () => {
    beforeEach(() => {
      queue.clearTracking();
    });

    it('should call completeJob when job executes successfully', async () => {
      const handlerSpy = vi.fn().mockResolvedValue('success');
      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });

      await queue.addJob('test-job', { payload: { data: 'test data' } });
      
      // Process the job
      await queue.run(false, 0);

      expect(queue.completedJobs).toHaveLength(1);
      expect(queue.failedJobs).toHaveLength(0);
      expect(queue.completedJobs[0]?.id).toBe('1');
      expect(handlerSpy).toHaveBeenCalledOnce();
    });

    it('should call failJob when job throws an error', async () => {
      const error = new Error('Job execution failed');
      const handlerSpy = vi.fn().mockRejectedValue(error);
      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });

      await queue.addJob('test-job', { payload: { data: 'test data' } });
      
      // Process the job
      await queue.run(false, 0);

      expect(queue.completedJobs).toHaveLength(0);
      expect(queue.failedJobs).toHaveLength(1);
      expect(queue.failedJobs[0]?.id).toBe('1');
      expect(queue.failedJobs[0]?.error).toBe(error);
      expect(handlerSpy).toHaveBeenCalledOnce();
    });

    it('should call failJob when no handler is registered', async () => {
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });
      
      await queue.addJob('unregistered-job' as any, { payload: { data: 'test data' } });
      
      // Process the job
      await queue.run(false, 0);

      expect(queue.completedJobs).toHaveLength(0);
      expect(queue.failedJobs).toHaveLength(1);
      expect(queue.failedJobs[0]?.id).toBe('1');
      expect(queue.failedJobs[0]?.error).toBeInstanceOf(Error);
      expect((queue.failedJobs[0]?.error as any).message).toContain('No handler registered for job type: unregistered-job');
    });

    it('should pass correct message data to completeJob', async () => {
      const handlerSpy = vi.fn().mockResolvedValue(undefined);
      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });

      await queue.addJob('test-job', { 
        payload: { data: 'test data' },
        ttr: 600,
        delay: 10,
        priority: 5
      });
      
      // Process the job
      await queue.run(false, 0);

      expect(queue.completedJobs).toHaveLength(1);
      const completedJob = queue.completedJobs[0]!;
      
      expect(completedJob.id).toBe('1');
      expect(completedJob.message.id).toBe('1');
      expect(completedJob.message.meta.ttr).toBe(600);
      expect(completedJob.message.meta.delay).toBe(10);
      expect(completedJob.message.meta.priority).toBe(5);
      expect(JSON.parse(completedJob.message.payload)).toEqual({
        name: 'test-job',
        payload: { data: 'test data' }
      });
    });

    it('should pass correct message data to failJob', async () => {
      const error = new Error('Specific failure');
      const handlerSpy = vi.fn().mockRejectedValue(error);
      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });

      await queue.addJob('test-job', { 
        payload: { data: 'failing job' },
        ttr: 300,
        priority: 10
      });
      
      // Process the job
      await queue.run(false, 0);

      expect(queue.failedJobs).toHaveLength(1);
      const failedJob = queue.failedJobs[0]!;
      
      expect(failedJob.id).toBe('1');
      expect(failedJob.message.id).toBe('1');
      expect(failedJob.message.meta.ttr).toBe(300);
      expect(failedJob.message.meta.priority).toBe(10);
      expect(failedJob.error).toBe(error);
      expect(JSON.parse(failedJob.message.payload)).toEqual({
        name: 'test-job',
        payload: { data: 'failing job' }
      });
    });

    it('should handle multiple successful jobs correctly', async () => {
      const handlerSpy = vi.fn().mockResolvedValue(undefined);
      queue.setHandlers({
        'test-job': handlerSpy,
        'math-job': vi.fn(),
        'success-job': vi.fn(),
        'fail-job': vi.fn()
      });

      await queue.addJob('test-job', { payload: { data: 'job 1' } });
      await queue.addJob('test-job', { payload: { data: 'job 2' } });
      await queue.addJob('test-job', { payload: { data: 'job 3' } });
      
      // Process all jobs
      await queue.run(false, 0);
      await queue.run(false, 0);
      await queue.run(false, 0);

      expect(queue.completedJobs).toHaveLength(3);
      expect(queue.failedJobs).toHaveLength(0);
      expect(queue.completedJobs.map(j => j.id)).toEqual(['1', '2', '3']);
      expect(handlerSpy).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure jobs correctly', async () => {
      const successHandler = vi.fn().mockResolvedValue(undefined);
      const failHandler = vi.fn().mockRejectedValue(new Error('Intentional failure'));
      
      queue.setHandlers({
        'test-job': vi.fn(),
        'math-job': vi.fn(),
        'success-job': successHandler,
        'fail-job': failHandler
      });

      await queue.addJob('success-job', { payload: { data: 'will succeed' } });
      await queue.addJob('fail-job', { payload: { data: 'will fail' } });
      await queue.addJob('success-job', { payload: { data: 'will succeed 2' } });
      
      // Process all jobs
      await queue.run(false, 0);
      await queue.run(false, 0);
      await queue.run(false, 0);

      expect(queue.completedJobs).toHaveLength(2);
      expect(queue.failedJobs).toHaveLength(1);
      
      expect(queue.completedJobs.map(j => j.id)).toEqual(['1', '3']);
      expect(queue.failedJobs.map(j => j.id)).toEqual(['2']);
      
      expect(successHandler).toHaveBeenCalledTimes(2);
      expect(failHandler).toHaveBeenCalledTimes(1);
    });
  });
});