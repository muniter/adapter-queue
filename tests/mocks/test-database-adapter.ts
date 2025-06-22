import type { DatabaseAdapter, QueueJobRecord } from '../../src/interfaces/database.ts';
import type { JobMeta, JobStatus } from '../../src/interfaces/job.ts';

export class TestDatabaseAdapter implements DatabaseAdapter {
  private jobs: Map<string, QueueJobRecord> = new Map();
  private nextId = 1;
  
  // Expose jobs for testing
  get jobsArray(): QueueJobRecord[] {
    return Array.from(this.jobs.values());
  }

  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    const id = this.nextId.toString();
    this.nextId++;

    const job: QueueJobRecord = {
      id,
      payload,
      meta,
      pushedAt: new Date()
    };

    this.jobs.set(id, job);
    return id;
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = new Date();
    
    for (const [id, job] of this.jobs.entries()) {
      if (job.doneAt) continue;
      if (job.reservedAt) continue;
      
      const delaySeconds = job.meta.delay || 0;
      const delayUntil = new Date(job.pushedAt.getTime() + delaySeconds * 1000);
      if (now < delayUntil) continue;

      job.reservedAt = now;
      this.jobs.set(id, job);
      return { ...job };
    }

    return null;
  }

  async completeJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.doneAt = new Date();
      this.jobs.set(id, job);
    }
  }

  async releaseJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.reservedAt = undefined;
      this.jobs.set(id, job);
    }
  }

  async failJob(id: string, error: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      job.doneAt = new Date();
      (job as any).error = error;
      (job as any).failed = true;
      this.jobs.set(id, job);
    }
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    
    if ((job as any).failed) return 'failed';
    if (job.doneAt) return 'done';
    if (job.reservedAt) return 'reserved';
    return 'waiting';
  }


  getAllJobs(): QueueJobRecord[] {
    return Array.from(this.jobs.values());
  }

  clear(): void {
    this.jobs.clear();
    this.nextId = 1;
  }
}