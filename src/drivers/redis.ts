import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage } from '../interfaces/job.ts';
import type { QueueOptions } from '../interfaces/plugin.ts';


// Type-safe interface for Redis client based on the popular 'redis' npm package
export interface RedisClient {
  // Counter operations
  incr(key: string): Promise<number>;
  
  // Hash operations
  hSet(key: string, field: string, value: string): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hDel(key: string, fields: string[]): Promise<number>;
  hIncrBy(key: string, field: string, increment: number): Promise<number>;
  
  // Sorted set operations
  zAdd(key: string, members: { score: number; value: string }): Promise<number>;
  zRem(key: string, members: string[]): Promise<number>;
  zRangeByScore(
    key: string, 
    min: number | string, 
    max: number | string, 
    options?: { REV?: boolean; LIMIT?: { offset: number; count: number } }
  ): Promise<string[]>;
  zRange(
    key: string, 
    start: number, 
    stop: number, 
    options?: { REV?: boolean }
  ): Promise<string[]>;
  zScore(key: string, member: string): Promise<number | null>;
  
  // General operations
  del(keys: string[]): Promise<number>;
}


export class RedisQueue<TJobMap = Record<string, any>> extends Queue<TJobMap> {
  private messagesKey: string;
  private waitingKey: string;
  private delayedKey: string;
  private reservedKey: string;
  private attemptsKey: string;
  private idKey: string;
  private redis: RedisClient;

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
    
    this.redis = redisClient;
  }

  protected async pushMessage(payload: string, meta: JobMeta): Promise<string> {
    const id = (await this.redis.incr(this.idKey)).toString();
    const ttr = meta.ttr || this.ttrDefault;
    const now = Math.floor(Date.now() / 1000);
    
    // Store message in Yii2 format: "ttr;jsonPayload"
    const message = `${ttr};${payload}`;
    await this.redis.hSet(this.messagesKey, id, message);
    
    if (meta.delaySeconds && meta.delaySeconds > 0) {
      // Add to delayed set with execution time as score
      const executeAt = now + meta.delaySeconds;
      await this.redis.zAdd(this.delayedKey, { score: executeAt, value: id });
    } else {
      // Add to waiting queue with priority support
      // Use sorted set for priority, with higher priority = higher score
      // For same priority, use job ID for FIFO (lower ID = added earlier = higher priority within same priority)
      // Score = priority * 1000000000 + (1000000000 - jobId) for FIFO within same priority
      const priority = meta.priority || 0;
      const jobIdNum = parseInt(id);
      const timePart = 1000000000 - jobIdNum; // Invert job ID for FIFO within same priority
      const score = priority * 1000000000 + timePart;
      await this.redis.zAdd(this.waitingKey, { score, value: id });
    }
    
    return id;
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    const now = Math.floor(Date.now() / 1000);
    
    // Move ready delayed jobs to waiting queue
    await this.moveDelayedJobs(now);
    
    // Recover timed-out reserved jobs
    await this.moveExpiredJobs(now);
    
    // Get highest priority job from waiting queue (sorted set)
    // Since Redis doesn't have blocking operations for sorted sets, we'll poll
    let id: string | null = null;
    
    if (timeout > 0) {
      // For blocking behavior, we need to implement polling since Redis doesn't have bzpop
      const endTime = Date.now() + timeout * 1000;
      while (Date.now() < endTime && !id) {
        const jobs = await this.redis.zRangeByScore(this.waitingKey, '-inf', '+inf', { REV: true, LIMIT: { offset: 0, count: 1 } });
        if (jobs[0]) {
          id = jobs[0];
          await this.redis.zRem(this.waitingKey, [id]);
          break;
        }
        // Small sleep to avoid busy waiting
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } else {
      // Non-blocking: get highest priority job using ZRANGE with REV (highest score first)
      const jobs = await this.redis.zRange(this.waitingKey, 0, 0, { REV: true });
      if (jobs[0]) {
        id = jobs[0];
        await this.redis.zRem(this.waitingKey, [id]);
      }
    }
    
    if (!id) {
      return null;
    }
    
    const message = await this.redis.hGet(this.messagesKey, id);
    
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
    await this.redis.zAdd(this.reservedKey, { score: expireAt, value: id });
    
    // Increment attempt counter
    await this.redis.hIncrBy(this.attemptsKey, id, 1);
    
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
    await this.redis.zRem(this.reservedKey, [message.id]);
    
    // Remove job data
    await this.redis.hDel(this.messagesKey, [message.id]);
    await this.redis.hDel(this.attemptsKey, [message.id]);
  }

  protected async failJob(message: QueueMessage, error: unknown): Promise<void> {
    // Remove from reserved queue
    await this.redis.zRem(this.reservedKey, [message.id]);
    
    // Remove job data (Redis doesn't track failed job history by default)
    await this.redis.hDel(this.messagesKey, [message.id]);
    await this.redis.hDel(this.attemptsKey, [message.id]);
  }

  async status(id: string): Promise<JobStatus> {
    // Check if job data exists
    const exists = await this.redis.hGet(this.messagesKey, id);
    if (!exists) {
      return 'done';
    }

    // Check delayed queue
    const delayedScore = await this.redis.zScore(this.delayedKey, id);
    if (delayedScore !== null) {
      return 'delayed';
    }

    // Check reserved queue  
    const reservedScore = await this.redis.zScore(this.reservedKey, id);
    if (reservedScore !== null) {
      return 'reserved';
    }

    // Check waiting queue (sorted set)
    const waitingScore = await this.redis.zScore(this.waitingKey, id);
    if (waitingScore !== null) {
      return 'waiting';
    }

    // If job exists but not in any queue, it must be done
    return 'done';
  }

  private async moveDelayedJobs(now: number): Promise<void> {
    // Get jobs ready to execute (score <= now)
    const readyJobs = await this.redis.zRangeByScore(this.delayedKey, '-inf', now, { REV: true });
    
    for (const id of readyJobs) {
      // Remove from delayed
      await this.redis.zRem(this.delayedKey, [id]);
      
      // Add to waiting queue with default priority (0)
      // Use job ID for FIFO within same priority
      const jobIdNum = parseInt(id);
      const timePart = 1000000000 - jobIdNum;
      const score = 0 * 1000000000 + timePart; // Priority 0 by default
      await this.redis.zAdd(this.waitingKey, { score, value: id });
    }
  }

  private async moveExpiredJobs(now: number): Promise<void> {
    // Get expired reserved jobs (score <= now)
    const expiredJobs = await this.redis.zRangeByScore(this.reservedKey, '-inf', now, { REV: true });
    
    for (const id of expiredJobs) {
      // Remove from reserved
      await this.redis.zRem(this.reservedKey, [id]);
      
      // Add back to waiting for retry with default priority (0)
      // Use job ID for FIFO within same priority
      const jobIdNum = parseInt(id);
      const timePart = 1000000000 - jobIdNum;
      const score = 0 * 1000000000 + timePart; // Priority 0 by default
      await this.redis.zAdd(this.waitingKey, { score, value: id });
    }
  }

  /**
   * Get the number of jobs in the waiting queue
   */
  async getWaitingCount(): Promise<number> {
    const waiting = await this.redis.zRange(this.waitingKey, 0, -1);
    return waiting.length;
  }

  /**
   * Get the number of jobs in the delayed queue
   */
  async getDelayedCount(): Promise<number> {
    const delayed = await this.redis.zRange(this.delayedKey, 0, -1);
    return delayed.length;
  }

  /**
   * Get the number of jobs in the reserved queue
   */
  async getReservedCount(): Promise<number> {
    const reserved = await this.redis.zRange(this.reservedKey, 0, -1);
    return reserved.length;
  }

  /**
   * Clear all jobs from this queue
   */
  async clear(): Promise<void> {
    await this.redis.del([
      this.messagesKey,
      this.waitingKey, 
      this.delayedKey,
      this.reservedKey,
      this.attemptsKey
    ]);
  }
}