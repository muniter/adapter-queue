import { DatabaseAdapter, JobMeta, QueueJobRecord, JobStatus } from '@muniter/queue';
import { run, get, all } from './database.js';

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    const now = new Date();
    const result = await run(
      `INSERT INTO jobs (
        payload, ttr, delay, priority, push_time, 
        delay_time, attempt, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload,
        meta.ttr || 300,
        meta.delay || 0,
        meta.priority || 0,
        now.getTime(),
        meta.delay ? now.getTime() + meta.delay * 1000 : null,
        meta.attempt || 0,
        'waiting'
      ]
    ) as any;

    return result.lastID.toString();
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = Date.now();
    
    const job = await get(
      `SELECT * FROM jobs 
       WHERE status = 'waiting' 
       AND (delay_time IS NULL OR delay_time <= ?)
       ORDER BY priority DESC, push_time ASC 
       LIMIT 1`,
      [now]
    ) as any;

    if (!job) return null;

    await run(
      `UPDATE jobs SET 
        status = 'reserved',
        reserve_time = ?,
        expire_time = ?
       WHERE id = ?`,
      [now, now + timeout * 1000, job.id]
    );

    return {
      id: job.id.toString(),
      payload: job.payload,
      meta: {
        ttr: job.ttr,
        delay: job.delay,
        priority: job.priority,
        attempt: job.attempt,
        pushedAt: new Date(job.push_time),
        reservedAt: new Date(now)
      },
      pushedAt: new Date(job.push_time),
      reservedAt: new Date(now),
      attempt: job.attempt
    };
  }

  async releaseJob(id: string): Promise<void> {
    // Mark job as done instead of releasing it back to waiting
    await run(
      `UPDATE jobs SET 
        status = 'done',
        done_time = ?
       WHERE id = ?`,
      [Date.now(), parseInt(id)]
    );
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    const job = await get(
      `SELECT status FROM jobs WHERE id = ?`,
      [parseInt(id)]
    ) as any;

    if (!job) return null;
    
    switch (job.status) {
      case 'waiting':
        return 'waiting';
      case 'reserved':
        return 'reserved';
      case 'done':
        return 'done';
      default:
        return null;
    }
  }

  async updateJobAttempt(id: string, attempt: number): Promise<void> {
    await run(
      `UPDATE jobs SET attempt = ? WHERE id = ?`,
      [attempt, parseInt(id)]
    );
  }

  async deleteJob(id: string): Promise<void> {
    await run(`DELETE FROM jobs WHERE id = ?`, [parseInt(id)]);
  }

  async markJobDone(id: string): Promise<void> {
    await run(
      `UPDATE jobs SET status = 'done', done_time = ? WHERE id = ?`,
      [Date.now(), parseInt(id)]
    );
  }
}