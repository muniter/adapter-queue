import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage } from '../interfaces/job.ts';
import type { QueueOptions } from '../interfaces/plugin.ts';

// Interface for our internal Redis operations
interface RedisOperations {
  rpush(key: string, ...values: string[]): Promise<number>;
  rpop(key: string): Promise<string | null>;
  brpop(timeout: number, ...keys: string[]): Promise<[string, string] | null>;
  llen(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrevrangebyscore(key: string, max: number | string, min: number | string, limit?: { offset: number; count: number }): Promise<string[]>;
  zscore(key: string, member: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  incr(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
}

// Type for the redis package client (simplified - we'll use duck typing)
export interface RedisClient {
  [key: string]: any; // Allow any redis client that has the methods we need
}

// Adapter to convert redis npm package to our internal interface
class RedisAdapter implements RedisOperations {
  constructor(private client: RedisClient) {}

  async rpush(key: string, ...values: string[]): Promise<number> {
    return await this.client.rPush(key, values);
  }

  async rpop(key: string): Promise<string | null> {
    return await this.client.rPop(key);
  }

  async brpop(timeout: number, ...keys: string[]): Promise<[string, string] | null> {
    // Redis client expects separate arguments: (keys, timeout)
    const result = await this.client.brPop(keys, timeout);
    if (!result) return null;
    return [result.key, result.element];
  }

  async llen(key: string): Promise<number> {
    return await this.client.lLen(key);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return await this.client.zAdd(key, { score, value: member });
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return await this.client.zRem(key, members);
  }

  async zrevrangebyscore(key: string, max: number | string, min: number | string, limit?: { offset: number; count: number }): Promise<string[]> {
    const options: any = { REV: true };
    if (limit) {
      options.LIMIT = { offset: limit.offset, count: limit.count };
    }
    // Use zRangeByScore with REV option for reverse range
    return await this.client.zRangeByScore(key, min, max, options);
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = await this.client.zScore(key, member);
    return score !== null ? score.toString() : null;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    return await this.client.hSet(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return await this.client.hGet(key, field);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return await this.client.hDel(key, fields);
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return await this.client.hIncrBy(key, field, increment);
  }

  async incr(key: string): Promise<number> {
    return await this.client.incr(key);
  }

  async del(...keys: string[]): Promise<number> {
    return await this.client.del(keys);
  }

  async exists(...keys: string[]): Promise<number> {
    return await this.client.exists(keys);
  }
}

export interface RedisJobOptions {
  ttr?: number;
  delay?: number;
  priority?: number;
}

export interface RedisJobRequest<TPayload> extends RedisJobOptions {
  payload: TPayload;
}

export class RedisQueue<TJobMap = Record<string, any>> extends Queue<TJobMap, RedisJobRequest<any>> {
  private messagesKey: string;
  private waitingKey: string;
  private delayedKey: string;
  private reservedKey: string;
  private attemptsKey: string;
  private idKey: string;
  private redis: RedisOperations;

  constructor(
    redisClient: any, // Accept any Redis client
    private queueName: string = 'default',
    options: QueueOptions & { keyPrefix?: string }
  ) {
    super(options);
    const prefix = options.keyPrefix || 'queue';
    this.messagesKey = `${prefix}:${this.queueName}:messages`;
    this.waitingKey = `${prefix}:${this.queueName}:waiting`;
    this.delayedKey = `${prefix}:${this.queueName}:delayed`;
    this.reservedKey = `${prefix}:${this.queueName}:reserved`;
    this.attemptsKey = `${prefix}:${this.queueName}:attempts`;
    this.idKey = `${prefix}:${this.queueName}:id`;
    
    // Adapt the Redis client to our internal interface
    this.redis = new RedisAdapter(redisClient);
  }

  protected async pushMessage(payload: string, meta: JobMeta): Promise<string> {
    const id = (await this.redis.incr(this.idKey)).toString();
    const ttr = meta.ttr || this.ttrDefault;
    const now = Math.floor(Date.now() / 1000);
    
    // Store message in Yii2 format: "ttr;jsonPayload"
    const message = `${ttr};${payload}`;
    await this.redis.hset(this.messagesKey, id, message);
    
    if (meta.delaySeconds && meta.delaySeconds > 0) {
      // Add to delayed set with execution time as score
      const executeAt = now + meta.delaySeconds;
      await this.redis.zadd(this.delayedKey, executeAt, id);
    } else {
      // Add to waiting list (FIFO queue)
      await this.redis.rpush(this.waitingKey, id);
    }
    
    return id;
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    const now = Math.floor(Date.now() / 1000);
    
    // Move ready delayed jobs to waiting queue
    await this.moveDelayedJobs(now);
    
    // Recover timed-out reserved jobs
    await this.moveExpiredJobs(now);
    
    // Get a job from waiting queue (blocking if timeout > 0)
    let result: [string, string] | null = null;
    
    if (timeout > 0) {
      result = await this.redis.brpop(timeout, this.waitingKey);
    } else {
      // Non-blocking: use rpop
      const id = await this.redis.rpop(this.waitingKey);
      if (id) {
        result = [this.waitingKey, id];
      }
    }
    
    if (!result) {
      return null;
    }
    
    const id = result[1];
    const message = await this.redis.hget(this.messagesKey, id);
    
    if (!message) {
      return null;
    }
    
    // Parse Yii2 format: "ttr;jsonPayload"
    const separatorIndex = message.indexOf(';');
    if (separatorIndex === -1) {
      return null;
    }
    
    const ttr = parseInt(message.substring(0, separatorIndex));
    const payloadStr = message.substring(separatorIndex + 1);
    
    // Reserve the job
    const expireAt = now + ttr;
    await this.redis.zadd(this.reservedKey, expireAt, id);
    
    // Increment attempt counter
    await this.redis.hincrby(this.attemptsKey, id, 1);
    
    // Extract job name from payload
    const jobData = JSON.parse(payloadStr);
    
    return {
      id,
      name: jobData.name,
      payload: payloadStr,
      meta: {
        ttr,
        pushedAt: new Date()
      }
    };
  }

  protected async completeJob(message: QueueMessage): Promise<void> {
    // Remove from reserved queue
    await this.redis.zrem(this.reservedKey, message.id);
    
    // Remove job data
    await this.redis.hdel(this.messagesKey, message.id);
    await this.redis.hdel(this.attemptsKey, message.id);
  }

  protected async failJob(message: QueueMessage, error: unknown): Promise<void> {
    // Remove from reserved queue
    await this.redis.zrem(this.reservedKey, message.id);
    
    // Remove job data (Redis doesn't track failed job history by default)
    await this.redis.hdel(this.messagesKey, message.id);
    await this.redis.hdel(this.attemptsKey, message.id);
  }

  async status(id: string): Promise<JobStatus> {
    // Check if job data exists
    const exists = await this.redis.hget(this.messagesKey, id);
    if (!exists) {
      return 'done';
    }

    // Check delayed queue
    const delayedScore = await this.redis.zscore(this.delayedKey, id);
    if (delayedScore !== null) {
      return 'delayed';
    }

    // Check reserved queue  
    const reservedScore = await this.redis.zscore(this.reservedKey, id);
    if (reservedScore !== null) {
      return 'reserved';
    }

    // Must be waiting (we don't track waiting in sorted set, but if it exists and not delayed/reserved, it's waiting)
    return 'waiting';
  }

  private async moveDelayedJobs(now: number): Promise<void> {
    // Get jobs ready to execute (score <= now)
    const readyJobs = await this.redis.zrevrangebyscore(this.delayedKey, now, '-inf');
    
    for (const id of readyJobs) {
      // Remove from delayed
      await this.redis.zrem(this.delayedKey, id);
      
      // Add to waiting
      await this.redis.rpush(this.waitingKey, id);
    }
  }

  private async moveExpiredJobs(now: number): Promise<void> {
    // Get expired reserved jobs (score <= now)
    const expiredJobs = await this.redis.zrevrangebyscore(this.reservedKey, now, '-inf');
    
    for (const id of expiredJobs) {
      // Remove from reserved
      await this.redis.zrem(this.reservedKey, id);
      
      // Add back to waiting for retry
      await this.redis.rpush(this.waitingKey, id);
    }
  }

  /**
   * Get the number of jobs in the waiting queue
   */
  async getWaitingCount(): Promise<number> {
    return await this.redis.llen(this.waitingKey);
  }

  /**
   * Get the number of jobs in the delayed queue
   */
  async getDelayedCount(): Promise<number> {
    const delayed = await this.redis.zrevrangebyscore(this.delayedKey, '+inf', '-inf');
    return delayed.length;
  }

  /**
   * Get the number of jobs in the reserved queue
   */
  async getReservedCount(): Promise<number> {
    const reserved = await this.redis.zrevrangebyscore(this.reservedKey, '+inf', '-inf');
    return reserved.length;
  }

  /**
   * Clear all jobs from this queue
   */
  async clear(): Promise<void> {
    await this.redis.del(
      this.messagesKey,
      this.waitingKey, 
      this.delayedKey,
      this.reservedKey,
      this.attemptsKey
    );
  }
}