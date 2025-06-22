import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage, DbJobRequest } from '../interfaces/job.ts';
import type { DatabaseAdapter, QueueJobRecord } from '../interfaces/database.ts';

export class DbQueue<TJobMap = Record<string, any>> extends Queue<TJobMap, DbJobRequest<any>> {
  constructor(
    private db: DatabaseAdapter,
    options: { ttrDefault?: number } = {}
  ) {
    super(options);
  }

  get adapter(): DatabaseAdapter {
    return this.db;
  }

  protected async pushMessage(payload: string, meta: JobMeta): Promise<string> {
    return await this.db.insertJob(Buffer.from(payload), meta);
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    const record = await this.db.reserveJob(timeout);
    
    if (!record) {
      return null;
    }

    return {
      id: record.id,
      payload: record.payload.toString(),
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


}