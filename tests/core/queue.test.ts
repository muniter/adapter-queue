import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Queue } from '../../src/core/queue.ts';
import type { JobMeta, QueueMessage, DbJobRequest } from '../../src/interfaces/job.ts';

interface TestJobs {
  'test-job': { data: string };
  'math-job': { a: number; b: number };
}

class TestQueue extends Queue<TestJobs, DbJobRequest<any>> {
  public messages: Array<{ payload: string; meta: JobMeta; id: string }> = [];
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

  protected async release(message: QueueMessage): Promise<void> {
    // Test implementation - just log
  }

  async status(id: string): Promise<'waiting' | 'reserved' | 'done'> {
    return 'done';
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
      queue.onJob('test-job', handlerSpy);

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
      expect(handlerSpy).toHaveBeenCalledWith({ data: 'test data' });
    });

    it('should emit beforeExec and afterExec events', async () => {
      const beforeExecSpy = vi.fn();
      const afterExecSpy = vi.fn();
      const handlerSpy = vi.fn().mockResolvedValue('result');

      queue.on('beforeExec', beforeExecSpy);
      queue.on('afterExec', afterExecSpy);
      queue.onJob('test-job', handlerSpy);

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

      queue.onJob('test-job', handlerSpy);
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
      
      expect(result).toBe(true); // Error is handled
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
      
      expect(result).toBe(true); // Error is handled
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
});