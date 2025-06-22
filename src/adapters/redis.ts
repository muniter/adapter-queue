import { createClient, type RedisClientType } from 'redis';
import type { DatabaseAdapter, QueueJobRecord } from '../interfaces/database.ts';
import type { JobMeta, JobStatus } from '../interfaces/job.ts';
import { DbQueue } from '../drivers/db.ts';
import { RedisQueue as NativeRedisQueue } from '../drivers/redis.ts';

// Generic Redis client interface - works with node-redis, ioredis, etc.
export interface RedisClient {
  isOpen?: boolean;
  connect?(): Promise<any>;
  quit?(): Promise<any>;
  incr(key: string): Promise<number>;
  hSet(key: string, field: string | Record<string, string>, value?: string): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, ...fields: string[]): Promise<number>;
  hIncrBy(key: string, field: string, increment: number): Promise<number>;
  zAdd(key: string, member: { score: number; value: string }): Promise<number>;
  zRem(key: string, ...members: string[]): Promise<number>;
  zRangeByScore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zPopMax(key: string): Promise<{ value: string; score: number } | null>;
  del(...keys: string[]): Promise<number>;
}

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  keyPrefix?: string;
}

export class RedisDatabaseAdapter implements DatabaseAdapter {
  private client: RedisClient;
  private keyPrefix: string;
  private connected: boolean = false;

  constructor(client: RedisClient, keyPrefix: string = 'queue:jobs') {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      if (this.client.isOpen === false && this.client.connect) {
        await this.client.connect();
      }
      this.connected = true;
    }
  }

  private getJobKey(id: string): string {
    return `${this.keyPrefix}:job:${id}`;
  }

  private getCounterKey(): string {
    return `${this.keyPrefix}:counter`;
  }

  private getWaitingKey(): string {
    return `${this.keyPrefix}:waiting`;
  }

  private getReservedKey(): string {
    return `${this.keyPrefix}:reserved`;
  }

  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    await this.ensureConnected();
    
    const id = await this.client.incr(this.getCounterKey());
    const jobId = id.toString();
    const now = Date.now();
    
    const jobData = {
      id: jobId,
      payload: payload.toString('base64'),
      ttr: (meta.ttr || 300).toString(),
      delay: (meta.delay || 0).toString(),
      priority: (meta.priority || 0).toString(),
      push_time: now.toString(),
      delay_time: meta.delay ? (now + meta.delay * 1000).toString() : '',
      status: 'waiting',
      attempt: '0'
    };

    // Store job data
    await this.client.hSet(this.getJobKey(jobId), jobData);

    // Add to waiting queue based on delay
    if (meta.delay && meta.delay > 0) {
      // Add to delayed set with execution time as score
      const executeAt = Math.floor((now + meta.delay * 1000) / 1000);
      await this.client.zAdd(`${this.keyPrefix}:delayed`, {
        score: executeAt,
        value: jobId
      });
    } else {
      // Add to waiting sorted set with priority
      await this.client.zAdd(this.getWaitingKey(), {
        score: meta.priority || 0,
        value: jobId
      });
    }

    return jobId;
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    await this.ensureConnected();
    
    const now = Math.floor(Date.now() / 1000);
    
    // Move ready delayed jobs to waiting queue
    await this.moveDelayedJobs(now);
    
    // Recover timed-out reserved jobs
    await this.recoverExpiredJobs(now);
    
    // Get highest priority job from waiting queue (ZREVPOPMIN for highest score first)
    const result = await this.client.zPopMax(this.getWaitingKey());
    
    if (!result) {
      return null;
    }
    
    const jobId = result.value;
    const jobKey = this.getJobKey(jobId);
    
    // Get job data
    const jobData = await this.client.hGetAll(jobKey);
    
    if (!jobData || !jobData.id || !jobData.payload) {
      return null;
    }
    
    const ttr = parseInt(jobData.ttr || '300');
    const expireTime = now + ttr;
    
    // Mark as reserved
    await this.client.hSet(jobKey, {
      status: 'reserved',
      reserve_time: now.toString(),
      expire_time: expireTime.toString(),
      attempt: (parseInt(jobData.attempt || '0') + 1).toString()
    });
    
    // Add to reserved set with expiration time as score
    await this.client.zAdd(this.getReservedKey(), {
      score: expireTime,
      value: jobId
    });
    
    return {
      id: jobId,
      payload: Buffer.from(jobData.payload, 'base64'),
      meta: {
        ttr: parseInt(jobData.ttr || '300'),
        delay: parseInt(jobData.delay || '0'),
        priority: parseInt(jobData.priority || '0'),
        pushedAt: new Date(parseInt(jobData.push_time || '0')),
        reservedAt: new Date(now * 1000)
      },
      pushedAt: new Date(parseInt(jobData.push_time || '0')),
      reservedAt: new Date(now * 1000)
    };
  }

  async completeJob(id: string): Promise<void> {
    await this.ensureConnected();
    
    const jobKey = this.getJobKey(id);
    
    // Remove from reserved set
    await this.client.zRem(this.getReservedKey(), id);
    
    // Mark as done
    await this.client.hSet(jobKey, {
      status: 'done',
      done_time: Date.now().toString()
    });
  }

  async releaseJob(id: string): Promise<void> {
    await this.ensureConnected();
    
    const jobKey = this.getJobKey(id);
    
    // Get job data for priority
    const jobData = await this.client.hGetAll(jobKey);
    if (!jobData) return;
    
    // Remove from reserved set
    await this.client.zRem(this.getReservedKey(), id);
    
    // Mark as waiting and clear reservation data
    await this.client.hSet(jobKey, {
      status: 'waiting',
      reserve_time: '',
      expire_time: ''
    });
    
    // Add back to waiting queue
    await this.client.zAdd(this.getWaitingKey(), {
      score: parseInt(jobData.priority || '0'),
      value: id
    });
  }

  async failJob(id: string, error: string): Promise<void> {
    await this.ensureConnected();
    
    const jobKey = this.getJobKey(id);
    
    // Remove from reserved set
    await this.client.zRem(this.getReservedKey(), id);
    
    // Mark as failed
    await this.client.hSet(jobKey, {
      status: 'failed',
      error_message: error,
      done_time: Date.now().toString()
    });
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    await this.ensureConnected();
    
    const jobKey = this.getJobKey(id);
    const status = await this.client.hGet(jobKey, 'status');
    
    if (!status) return null;
    
    switch (status) {
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
    await this.ensureConnected();
    
    const jobKey = this.getJobKey(id);
    
    // Remove from all possible sets
    await Promise.all([
      this.client.zRem(this.getWaitingKey(), id),
      this.client.zRem(this.getReservedKey(), id),
      this.client.zRem(`${this.keyPrefix}:delayed`, id),
      this.client.del(jobKey)
    ]);
  }

  async markJobDone(id: string): Promise<void> {
    await this.ensureConnected();
    
    const jobKey = this.getJobKey(id);
    await this.client.hSet(jobKey, {
      status: 'done',
      done_time: Date.now().toString()
    });
  }

  private async moveDelayedJobs(now: number): Promise<void> {
    // Get jobs ready to execute (score <= now)
    const readyJobs = await this.client.zRangeByScore(`${this.keyPrefix}:delayed`, 0, now);
    
    for (const jobId of readyJobs) {
      // Get job data for priority
      const jobData = await this.client.hGetAll(this.getJobKey(jobId));
      if (!jobData) continue;
      
      // Remove from delayed
      await this.client.zRem(`${this.keyPrefix}:delayed`, jobId);
      
      // Add to waiting with priority
      await this.client.zAdd(this.getWaitingKey(), {
        score: parseInt(jobData.priority || '0'),
        value: jobId
      });
    }
  }

  private async recoverExpiredJobs(now: number): Promise<void> {
    // Get expired reserved jobs (score <= now)
    const expiredJobs = await this.client.zRangeByScore(this.getReservedKey(), 0, now);
    
    for (const jobId of expiredJobs) {
      await this.releaseJob(jobId);
    }
  }

  async close(): Promise<void> {
    if (this.connected && this.client.isOpen && this.client.quit) {
      await this.client.quit();
      this.connected = false;
    }
  }
}

// Main export - constructor pattern for database-backed Redis queue
export class RedisQueue<T = Record<string, any>> extends DbQueue<T> {
  constructor(config: { client: RedisClient; keyPrefix?: string }) {
    const adapter = new RedisDatabaseAdapter(config.client, config.keyPrefix);
    super(adapter);
  }
}

// Convenience factory for node-redis
export function createRedisQueue<T = Record<string, any>>(url?: string): RedisQueue<T> {
  const client = createClient(url ? { url } : {}) as any;
  return new RedisQueue<T>({ client });
}

// Re-export for convenience
export { DbQueue, NativeRedisQueue };