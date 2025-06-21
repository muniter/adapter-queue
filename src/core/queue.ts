import { EventEmitter } from 'events';
import type { Job, RetryableJob, JobStatus, JobMeta, QueueMessage, QueueEvent } from '../interfaces/job.ts';
import { DefaultSerializer } from './serializer.ts';
import type { Serializer } from './serializer.ts';

export abstract class Queue extends EventEmitter {
  protected ttrDefault = 300;
  protected attemptsDefault = 1;
  protected serializer: Serializer = new DefaultSerializer();
  private pushOpts: Partial<JobMeta> = {};

  constructor(options: { serializer?: Serializer; ttrDefault?: number; attemptsDefault?: number } = {}) {
    super();
    if (options.serializer) this.serializer = options.serializer;
    if (options.ttrDefault) this.ttrDefault = options.ttrDefault;
    if (options.attemptsDefault) this.attemptsDefault = options.attemptsDefault;
  }

  ttr(value: number): this {
    this.pushOpts.ttr = value;
    return this;
  }

  delay(seconds: number): this {
    this.pushOpts.delay = seconds;
    return this;
  }

  priority(priority: number): this {
    this.pushOpts.priority = priority;
    return this;
  }

  async push(job: Job): Promise<string> {
    const meta: JobMeta = {
      ttr: this.pushOpts.ttr ?? this.ttrDefault,
      delay: this.pushOpts.delay ?? 0,
      priority: this.pushOpts.priority ?? 0,
      attempt: 0,
      pushedAt: new Date()
    };

    this.pushOpts = {};

    const event: QueueEvent = { type: 'beforePush', job, meta };
    this.emit('beforePush', event);

    const payload = this.serializer.serialize(job);
    const id = await this.pushMessage(payload, meta);

    const afterEvent: QueueEvent = { type: 'afterPush', id, job, meta };
    this.emit('afterPush', afterEvent);

    return id;
  }

  async run(repeat: boolean = false, timeout: number = 0): Promise<void> {
    const canContinue = () => true;

    while (canContinue()) {
      const message = await this.reserve(timeout);
      
      if (!message) {
        if (!repeat) break;
        if (timeout > 0) {
          await this.sleep(timeout * 1000);
        }
        continue;
      }

      const success = await this.handleMessage(message);
      if (success) {
        await this.release(message);
      }
    }
  }

  protected async handleMessage(message: QueueMessage): Promise<boolean> {
    try {
      const job = this.serializer.deserialize(message.payload);
      const beforeEvent: QueueEvent = { type: 'beforeExec', id: message.id, job, meta: message.meta };
      this.emit('beforeExec', beforeEvent);

      const result = await job.execute(this);

      const afterEvent: QueueEvent = { type: 'afterExec', id: message.id, job, meta: message.meta, result };
      this.emit('afterExec', afterEvent);

      return true;
    } catch (error) {
      return await this.handleError(message, error);
    }
  }

  protected async handleError(message: QueueMessage, error: unknown): Promise<boolean> {
    const job = this.serializer.deserialize(message.payload);
    const errorEvent: QueueEvent = { type: 'afterError', id: message.id, job, meta: message.meta, error };
    this.emit('afterError', errorEvent);

    const currentAttempt = (message.meta.attempt || 0) + 1;
    const maxAttempts = this.attemptsDefault;

    let shouldRetry = currentAttempt < maxAttempts;

    if (this.isRetryableJob(job)) {
      shouldRetry = shouldRetry && job.canRetry(currentAttempt, error);
    }

    if (shouldRetry) {
      message.meta.attempt = currentAttempt;
      const payload = this.serializer.serialize(job);
      await this.pushMessage(payload, message.meta);
      return true;
    }

    return true;
  }

  protected isRetryableJob(job: any): job is RetryableJob {
    return typeof job.getTtr === 'function' && typeof job.canRetry === 'function';
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected abstract pushMessage(payload: Buffer, meta: JobMeta): Promise<string>;
  protected abstract reserve(timeout: number): Promise<QueueMessage | null>;
  protected abstract release(message: QueueMessage): Promise<void>;
  
  abstract status(id: string): Promise<JobStatus>;
}