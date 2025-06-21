import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Queue } from '../../src/core/queue.ts';
import { Job, JobMeta, QueueMessage } from '../../src/interfaces/job.ts';

class TestQueue extends Queue {
  public messages: Array<{ payload: Buffer; meta: JobMeta; id: string }> = [];
  private nextId = 1;

  protected async pushMessage(payload: Buffer, meta: JobMeta): Promise<string> {
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

class TestJob implements Job<string> {
  constructor(public data: string) {}

  async execute(): Promise<string> {
    return `Processed: ${this.data}`;
  }

  serialize() {
    return {
      constructor: 'TestJob',
      data: this.data
    };
  }

  static deserialize(data: any): TestJob {
    return new TestJob(data.data);
  }
}

describe('Queue', () => {
  let queue: TestQueue;

  beforeEach(() => {
    queue = new TestQueue();
    
    // Register job classes for serialization
    queue['serializer'].registerJob('TestJob', TestJob);
  });

  describe('push', () => {
    it('should push a job with default settings', async () => {
      const job = new TestJob('test data');
      const id = await queue.push(job);

      expect(id).toBe('1');
      expect(queue.messages).toHaveLength(1);
      expect(queue.messages[0].meta.ttr).toBe(300);
      expect(queue.messages[0].meta.delay).toBe(0);
      expect(queue.messages[0].meta.priority).toBe(0);
    });

    it('should push a job with custom settings', async () => {
      const job = new TestJob('test data');
      const id = await queue
        .ttr(600)
        .delay(30)
        .priority(5)
        .push(job);

      expect(id).toBe('1');
      expect(queue.messages).toHaveLength(1);
      expect(queue.messages[0].meta.ttr).toBe(600);
      expect(queue.messages[0].meta.delay).toBe(30);
      expect(queue.messages[0].meta.priority).toBe(5);
    });

    it('should emit beforePush and afterPush events', async () => {
      const beforePushSpy = vi.fn();
      const afterPushSpy = vi.fn();

      queue.on('beforePush', beforePushSpy);
      queue.on('afterPush', afterPushSpy);

      const job = new TestJob('test data');
      await queue.push(job);

      expect(beforePushSpy).toHaveBeenCalledOnce();
      expect(afterPushSpy).toHaveBeenCalledOnce();
      expect(beforePushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'beforePush',
          job,
          meta: expect.any(Object)
        })
      );
    });

    it('should reset push options after each push', async () => {
      const job1 = new TestJob('job1');
      const job2 = new TestJob('job2');

      await queue.ttr(600).push(job1);
      await queue.push(job2);

      expect(queue.messages[0].meta.ttr).toBe(600);
      expect(queue.messages[1].meta.ttr).toBe(300); // back to default
    });
  });

  describe('handleMessage', () => {
    it('should execute job successfully', async () => {
      const job = new TestJob('test data');
      const payload = queue['serializer'].serialize(job);
      const message: QueueMessage = {
        id: '1',
        payload,
        meta: { ttr: 300 }
      };

      const result = await queue['handleMessage'](message);
      expect(result).toBe(true);
    });

    it('should emit beforeExec and afterExec events', async () => {
      const beforeExecSpy = vi.fn();
      const afterExecSpy = vi.fn();

      queue.on('beforeExec', beforeExecSpy);
      queue.on('afterExec', afterExecSpy);

      const job = new TestJob('test data');
      const payload = queue['serializer'].serialize(job);
      const message: QueueMessage = {
        id: '1',
        payload,
        meta: { ttr: 300 }
      };

      await queue['handleMessage'](message);

      expect(beforeExecSpy).toHaveBeenCalledOnce();
      expect(afterExecSpy).toHaveBeenCalledOnce();
    });
  });
});