import { Queue } from '../core/queue.ts';
import type { JobStatus, JobMeta, QueueMessage, InMemoryJobRequest } from '../interfaces/job.ts';
import type { QueueOptions } from '../interfaces/plugin.ts';

// Re-export job interface for this driver
export type { InMemoryJobRequest } from '../interfaces/job.ts';

interface InMemoryJobRecord {
  id: string;
  payload: string;
  meta: JobMeta;
  status: 'waiting' | 'reserved' | 'done' | 'failed';
  pushedAt: Date;
  reservedAt?: Date;
  doneAt?: Date;
  expireTime?: number; // timestamp when TTR expires
  delayTime?: number; // timestamp when job becomes available
  error?: string;
}

/**
 * Configuration options for InMemoryQueue.
 */
export interface InMemoryQueueOptions extends QueueOptions {
  /**
   * Maximum number of jobs to keep in memory.
   * Older completed/failed jobs will be automatically cleaned up.
   * Defaults to 1000.
   */
  maxJobs?: number;
}

/**
 * In-memory queue implementation for testing and development.
 * 
 * Features:
 * - Full priority support (higher numbers = higher priority)
 * - Delay functionality using setTimeout
 * - TTR (Time To Run) with automatic job recovery
 * - Job status tracking
 * - Automatic cleanup of old completed jobs
 * - No external dependencies
 * 
 * **Note**: All data is lost when the process exits. Use only for
 * testing, development, or temporary job processing.
 * 
 * @example
 * ```typescript
 * import { InMemoryQueue } from 'adapter-queue/memory';
 * 
 * const queue = new InMemoryQueue<MyJobs>({
 *   name: 'test-queue',
 *   maxJobs: 500
 * });
 * 
 * queue.setHandlers({
 *   'my-job': async ({ payload }) => {
 *     console.log('Processing:', payload);
 *   }
 * });
 * 
 * await queue.addJob('my-job', { 
 *   payload: { data: 'test' },
 *   priority: 5,
 *   delaySeconds: 10
 * });
 * 
 * await queue.run(true, 1);
 * ```
 */
export class InMemoryQueue<TJobMap = Record<string, any>> extends Queue<TJobMap, InMemoryJobRequest<any>> {
  private jobs = new Map<string, InMemoryJobRecord>();
  private waitingJobs: string[] = []; // job IDs sorted by priority (high to low)
  private reservedJobs = new Set<string>();
  private delayedJobs = new Map<string, NodeJS.Timeout>(); // job ID -> timeout handle
  private ttrTimeouts = new Map<string, NodeJS.Timeout>(); // job ID -> TTR timeout handle
  private nextJobId = 1;
  private maxJobs: number;

  constructor(options: InMemoryQueueOptions) {
    super(options);
    this.maxJobs = options.maxJobs || 1000;
  }

  protected async pushMessage(payload: string, meta: JobMeta): Promise<string> {
    const id = (this.nextJobId++).toString();
    const now = new Date();
    
    const job: InMemoryJobRecord = {
      id,
      payload,
      meta,
      status: 'waiting',
      pushedAt: now
    };

    this.jobs.set(id, job);

    // Handle delay
    if (meta.delaySeconds && meta.delaySeconds > 0) {
      job.delayTime = Date.now() + (meta.delaySeconds * 1000);
      job.status = 'waiting';
      
      // Schedule job to become available after delay
      const timeout = setTimeout(() => {
        this.delayedJobs.delete(id);
        this.addToWaitingQueue(id);
      }, meta.delaySeconds * 1000);
      
      this.delayedJobs.set(id, timeout);
    } else {
      // Add immediately to waiting queue
      this.addToWaitingQueue(id);
    }
    this.cleanupOldJobs();
    
    return id;
  }

  protected async reserve(timeout: number): Promise<QueueMessage | null> {
    // Clean up expired TTR jobs first
    this.recoverExpiredJobs();
    
    // Get next available job
    const jobId = this.waitingJobs.shift();
    if (!jobId) {
      return null;
    }

    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'waiting') {
      // Job was cleaned up or changed status, try next
      return this.reserve(timeout);
    }

    // Reserve the job
    const now = Date.now();
    const ttr = job.meta.ttr || this.ttrDefault;
    
    job.status = 'reserved';
    job.reservedAt = new Date(now);
    job.expireTime = now + (ttr * 1000);
    
    this.reservedJobs.add(jobId);
    
    // Set TTR timeout for automatic recovery
    const ttrTimeout = setTimeout(() => {
      this.recoverJob(jobId);
    }, ttr * 1000);
    
    this.ttrTimeouts.set(jobId, ttrTimeout);

    // Extract job name from payload
    const jobData = JSON.parse(job.payload);
    
    return {
      id: jobId,
      name: jobData.name,
      payload: job.payload,
      meta: job.meta
    };
  }

  protected async completeJob(message: QueueMessage): Promise<void> {
    const job = this.jobs.get(message.id);
    if (!job) return;

    job.status = 'done';
    job.doneAt = new Date();
    
    this.reservedJobs.delete(message.id);
    this.clearTtrTimeout(message.id);
  }

  protected async failJob(message: QueueMessage, error: unknown): Promise<void> {
    const job = this.jobs.get(message.id);
    if (!job) return;

    job.status = 'failed';
    job.doneAt = new Date();
    job.error = error instanceof Error ? error.message : String(error);
    
    this.reservedJobs.delete(message.id);
    this.clearTtrTimeout(message.id);
  }

  async status(id: string): Promise<JobStatus> {
    const job = this.jobs.get(id);
    if (!job) return 'done'; // Assume completed if not found
    
    switch (job.status) {
      case 'waiting':
        // Check if job is currently delayed
        if (job.delayTime && job.delayTime > Date.now()) {
          return 'delayed';
        }
        return 'waiting';
      case 'reserved':
        return 'reserved';
      case 'done':
      case 'failed':
        return 'done';
      default:
        return 'done';
    }
  }

  /**
   * Get statistics about the queue state.
   */
  getStats() {
    const stats = {
      total: this.jobs.size,
      waiting: 0,
      reserved: 0,
      done: 0,
      failed: 0,
      delayed: this.delayedJobs.size
    };

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case 'waiting':
          // Only count as waiting if not delayed
          if (!this.delayedJobs.has(job.id)) {
            stats.waiting++;
          }
          break;
        case 'reserved':
          stats.reserved++;
          break;
        case 'done':
          stats.done++;
          break;
        case 'failed':
          stats.failed++;
          break;
      }
    }

    return stats;
  }

  /**
   * Clear all jobs from the queue. Useful for testing.
   */
  clear(): void {
    // Clear all timeouts
    for (const timeout of this.delayedJobs.values()) {
      clearTimeout(timeout);
    }
    for (const timeout of this.ttrTimeouts.values()) {
      clearTimeout(timeout);
    }

    // Reset all state
    this.jobs.clear();
    this.waitingJobs.length = 0;
    this.reservedJobs.clear();
    this.delayedJobs.clear();
    this.ttrTimeouts.clear();
    this.nextJobId = 1;
  }

  /**
   * Get a job by ID (useful for testing and debugging).
   */
  getJob(id: string): InMemoryJobRecord | undefined {
    return this.jobs.get(id);
  }

  /**
   * Add job to waiting queue in priority order (high priority first).
   */
  private addToWaitingQueue(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const priority = job.meta.priority || 0;
    
    // Find insertion point to maintain priority order (high to low)
    let insertIndex = 0;
    for (let i = 0; i < this.waitingJobs.length; i++) {
      const existingJobId = this.waitingJobs[i];
      if (!existingJobId) continue;
      const existingJob = this.jobs.get(existingJobId);
      const existingPriority = existingJob?.meta.priority || 0;
      
      if (priority <= existingPriority) {
        insertIndex = i + 1;
      } else {
        break;
      }
    }
    
    this.waitingJobs.splice(insertIndex, 0, jobId);
  }

  /**
   * Recover jobs whose TTR has expired.
   */
  private recoverExpiredJobs(): void {
    const now = Date.now();
    
    for (const jobId of this.reservedJobs) {
      const job = this.jobs.get(jobId);
      if (job && job.expireTime && job.expireTime <= now) {
        this.recoverJob(jobId);
      }
    }
  }

  /**
   * Recover a specific job back to waiting state.
   */
  private recoverJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'reserved') return;

    job.status = 'waiting';
    job.reservedAt = undefined;
    job.expireTime = undefined;
    
    this.reservedJobs.delete(jobId);
    this.clearTtrTimeout(jobId);
    this.addToWaitingQueue(jobId);
  }

  /**
   * Clear TTR timeout for a job.
   */
  private clearTtrTimeout(jobId: string): void {
    const timeout = this.ttrTimeouts.get(jobId);
    if (timeout) {
      clearTimeout(timeout);
      this.ttrTimeouts.delete(jobId);
    }
  }

  /**
   * Clean up old completed jobs to prevent memory leaks.
   */
  private cleanupOldJobs(): void {
    if (this.jobs.size <= this.maxJobs) return;

    // Get completed jobs sorted by completion time (oldest first)
    const completedJobs = Array.from(this.jobs.entries())
      .filter(([_, job]) => job.status === 'done' || job.status === 'failed')
      .sort(([_, a], [__, b]) => {
        const aTime = a.doneAt?.getTime() || 0;
        const bTime = b.doneAt?.getTime() || 0;
        return aTime - bTime;
      });

    // Remove oldest completed jobs until we're under the limit
    const toRemove = this.jobs.size - this.maxJobs;
    for (let i = 0; i < Math.min(toRemove, completedJobs.length); i++) {
      const jobEntry = completedJobs[i];
      if (jobEntry) {
        const [jobId] = jobEntry;
        this.jobs.delete(jobId);
      }
    }
  }

  /**
   * Cleanup method for graceful shutdown.
   */
  async cleanup(): Promise<void> {
    // Clear all timeouts to prevent memory leaks
    for (const timeout of this.delayedJobs.values()) {
      clearTimeout(timeout);
    }
    for (const timeout of this.ttrTimeouts.values()) {
      clearTimeout(timeout);
    }
    
    this.delayedJobs.clear();
    this.ttrTimeouts.clear();
  }
}