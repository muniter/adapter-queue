import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage, SupportsTTR } from '../interfaces/job.ts';
import type { DatabaseAdapter, QueueJobRecord } from '../interfaces/database.ts';

export class DbQueue<TJobMap = Record<string, any>> extends Queue<TJobMap> {
  constructor(
    private db: DatabaseAdapter,
    options: { ttrDefault?: number } = {}
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


}