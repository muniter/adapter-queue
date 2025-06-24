import Database from 'better-sqlite3';
import type { DatabaseAdapter, QueueJobRecord } from '../interfaces/database.ts';
import type { JobMeta, JobStatus } from '../interfaces/job.ts';
import { DbQueue } from '../drivers/db.ts';

// Generic SQLite database interface - works with better-sqlite3, expo-sqlite, bun:sqlite, etc.
export interface SQLiteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: any[]): { lastInsertRowid: number | bigint; changes: number };
    get(...params: any[]): any;
  };
}

// For better-sqlite3 specifically
export interface BetterSQLite3Config {
  filename: string;
  options?: Database.Options;
}

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Create jobs table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload BLOB NOT NULL,
        ttr INTEGER DEFAULT 300,
        delay INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        push_time INTEGER NOT NULL,
        delay_time INTEGER,
        reserve_time INTEGER,
        expire_time INTEGER,
        done_time INTEGER,
        attempt INTEGER DEFAULT 0,
        status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'reserved', 'done', 'failed')),
        error_message TEXT
      )
    `);

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status_delay_priority 
      ON jobs (status, delay_time, priority DESC, push_time ASC)
    `);
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_expire_time 
      ON jobs (expire_time) WHERE status = 'reserved'
    `);
  }

  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    const now = new Date();
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        payload, ttr, delay, priority, push_time, 
        delay_time, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      payload,
      meta.ttr || 300,
      meta.delay || 0,
      meta.priority || 0,
      now.getTime(),
      meta.delay ? now.getTime() + meta.delay * 1000 : null,
      'waiting'
    );

    return result.lastInsertRowid.toString();
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = Date.now();
    
    // First, recover any timed-out reserved jobs back to waiting
    const recoverStmt = this.db.prepare(`
      UPDATE jobs SET 
        status = 'waiting',
        reserve_time = NULL,
        expire_time = NULL,
        attempt = attempt + 1
       WHERE status = 'reserved' 
       AND expire_time < ?
    `);
    recoverStmt.run(now);
    
    // Atomically reserve a job using UPDATE with RETURNING (if supported) or UPDATE + SELECT
    // For SQLite, we'll use a subquery to atomically reserve the next available job
    const reserveStmt = this.db.prepare(`
      UPDATE jobs SET 
        status = 'reserved',
        reserve_time = ?,
        expire_time = ?
       WHERE id = (
         SELECT id FROM jobs 
         WHERE status = 'waiting' 
         AND (delay_time IS NULL OR delay_time <= ?)
         ORDER BY priority DESC, push_time ASC 
         LIMIT 1
       )
    `);

    const result = reserveStmt.run(now, now + 300 * 1000, now); // Default 5 minute TTR for now

    // Check if we actually updated a row
    if (result.changes === 0) {
      return null;
    }

    // Now get the job we just reserved
    const getJobStmt = this.db.prepare(`
      SELECT * FROM jobs 
       WHERE status = 'reserved' 
       AND reserve_time = ?
       ORDER BY reserve_time DESC
       LIMIT 1
    `);

    const job = getJobStmt.get(now) as any;

    if (!job) return null;

    // Update with the correct TTR from the job
    const jobTtr = job.ttr || 300;
    const updateTtrStmt = this.db.prepare(`
      UPDATE jobs SET expire_time = ? WHERE id = ?
    `);
    updateTtrStmt.run(now + jobTtr * 1000, job.id);

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
    const stmt = this.db.prepare(`
      UPDATE jobs SET 
        status = 'done',
        done_time = ?
       WHERE id = ?
    `);
    stmt.run(Date.now(), parseInt(id));
  }

  async releaseJob(id: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE jobs SET 
        status = 'waiting',
        reserve_time = NULL,
        expire_time = NULL
       WHERE id = ?
    `);
    stmt.run(parseInt(id));
  }

  async failJob(id: string, error: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE jobs SET 
        status = 'failed',
        error_message = ?,
        done_time = ?
       WHERE id = ?
    `);
    stmt.run(error, Date.now(), parseInt(id));
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    const stmt = this.db.prepare(`SELECT status FROM jobs WHERE id = ?`);
    const job = stmt.get(parseInt(id)) as any;

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
    const stmt = this.db.prepare(`DELETE FROM jobs WHERE id = ?`);
    stmt.run(parseInt(id));
  }

  async markJobDone(id: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE jobs SET status = 'done', done_time = ? WHERE id = ?
    `);
    stmt.run(Date.now(), parseInt(id));
  }

  close(): void {
    // Only close if the database has a close method (some implementations might not)
    if ('close' in this.db && typeof this.db.close === 'function') {
      (this.db as any).close();
    }
  }
}

// Main export - constructor pattern
export class SQLiteQueue<T = Record<string, any>> extends DbQueue<T> {
  constructor(config: { database: SQLiteDatabase; name: string }) {
    const adapter = new SQLiteDatabaseAdapter(config.database);
    super(adapter, { name: config.name });
  }
}

// Convenience factory for better-sqlite3
export function createSQLiteQueue<T = Record<string, any>>(name: string, filename: string, options?: Database.Options): SQLiteQueue<T> {
  const db = new Database(filename, options);
  return new SQLiteQueue<T>({ database: db, name });
}

// Re-export for convenience
export { DbQueue };