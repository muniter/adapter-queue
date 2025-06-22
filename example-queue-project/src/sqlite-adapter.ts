import { DatabaseAdapter, JobMeta, QueueJobRecord, JobStatus } from '@muniter/queue';
import { run, get, all } from './database.js';

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    const now = new Date();
    const result = await run(
      `INSERT INTO jobs (
        payload, ttr, delay, priority, push_time, 
        delay_time, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload,
        meta.ttr || 300,
        meta.delay || 0,
        meta.priority || 0,
        now.getTime(),
        meta.delay ? now.getTime() + meta.delay * 1000 : null,
        'waiting'
      ]
    ) as any;

    return result.lastID.toString();
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = Date.now();
    
    // First, recover any timed-out reserved jobs back to waiting
    await run(
      `UPDATE jobs SET 
        status = 'waiting',
        reserve_time = NULL,
        expire_time = NULL,
        attempt = attempt + 1
       WHERE status = 'reserved' 
       AND expire_time < ?`,
      [now]
    );
    
    // Atomically reserve a job using UPDATE with RETURNING (if supported) or UPDATE + SELECT
    // For SQLite, we'll use a subquery to atomically reserve the next available job
    const result = await run(
      `UPDATE jobs SET 
        status = 'reserved',
        reserve_time = ?,
        expire_time = ?
       WHERE id = (
         SELECT id FROM jobs 
         WHERE status = 'waiting' 
         AND (delay_time IS NULL OR delay_time <= ?)
         ORDER BY priority DESC, push_time ASC 
         LIMIT 1
       )`,
      [now, now + 300 * 1000, now] // Default 5 minute TTR for now
    );

    // Check if we actually updated a row
    if ((result as any).changes === 0) {
      return null;
    }

    // Now get the job we just reserved
    const job = await get(
      `SELECT * FROM jobs 
       WHERE status = 'reserved' 
       AND reserve_time = ?
       ORDER BY reserve_time DESC
       LIMIT 1`,
      [now]
    ) as any;

    if (!job) return null;

    // Update with the correct TTR from the job
    const jobTtr = job.ttr || 300;
    await run(
      `UPDATE jobs SET expire_time = ? WHERE id = ?`,
      [now + jobTtr * 1000, job.id]
    );

    return {
      id: job.id.toString(),
      payload: job.payload,
      meta: {
        ttr: job.ttr,
        delay: job.delay,
        priority: job.priority,
        pushedAt: new Date(job.push_time),
        reservedAt: new Date(now)
      },
      pushedAt: new Date(job.push_time),
      reservedAt: new Date(now)
    };
  }

  async completeJob(id: string): Promise<void> {
    await run(
      `UPDATE jobs SET 
        status = 'done',
        done_time = ?
       WHERE id = ?`,
      [Date.now(), parseInt(id)]
    );
  }

  async releaseJob(id: string): Promise<void> {
    await run(
      `UPDATE jobs SET 
        status = 'waiting',
        reserve_time = NULL,
        expire_time = NULL
       WHERE id = ?`,
      [parseInt(id)]
    );
  }

  async failJob(id: string, error: string): Promise<void> {
    await run(
      `UPDATE jobs SET 
        status = 'failed',
        error_message = ?,
        done_time = ?
       WHERE id = ?`,
      [error, Date.now(), parseInt(id)]
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
      case 'failed':
        return 'done';
      default:
        return null;
    }
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