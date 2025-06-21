import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage } from '../interfaces/job.ts';
import type { DatabaseAdapter, QueueJobRecord } from '../interfaces/database.ts';

export class DbQueue extends Queue {
  constructor(
    private db: DatabaseAdapter,
    options: { serializer?: any; ttrDefault?: number; attemptsDefault?: number } = {}
  ) {
    super(options);
  }

  protected async pushMessage(payload: Buffer, meta: JobMeta): Promise<string> {
    return await this.db.insertJob(payload, meta);
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    const record = await this.db.reserveJob(timeout);
    
    if (!record) {
      return null;
    }

    return {
      id: record.id,
      payload: record.payload,
      meta: record.meta
    };
  }

  protected async release(message: QueueMessage): Promise<void> {
    await this.db.completeJob(message.id);
  }

  async status(id: string): Promise<JobStatus> {
    const status = await this.db.getJobStatus(id);
    return status || 'done';
  }

  protected override async handleError(message: QueueMessage, error: unknown): Promise<boolean> {
    const job = this.serializer.deserialize(message.payload);
    const errorEvent = { type: 'afterError' as const, id: message.id, job, meta: message.meta, error };
    this.emit('afterError', errorEvent);

    const currentAttempt = (message.meta.attempt || 0) + 1;
    const maxAttempts = this.attemptsDefault;

    let shouldRetry = currentAttempt < maxAttempts;

    if (this.isRetryableJob(job)) {
      shouldRetry = shouldRetry && job.canRetry(currentAttempt, error);
    }

    if (shouldRetry) {
      await this.db.updateJobAttempt(message.id, currentAttempt);
      message.meta.attempt = currentAttempt;
      const payload = this.serializer.serialize(job);
      await this.pushMessage(payload, message.meta);
      return true;
    }

    return true;
  }

}