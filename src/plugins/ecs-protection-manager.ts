import type { QueuePlugin } from '../interfaces/plugin.ts';
import type { QueueMessage } from '../interfaces/job.ts';

/**
 * Simple logger interface for ECS Protection Manager.
 */
export interface EcsProtectionLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

/**
 * Configuration options for ECS Protection Manager.
 */
export interface EcsProtectionManagerOptions {
  /**
   * Custom fetch function for HTTP requests (useful for testing).
   * Defaults to global fetch if not provided.
   */
  fetch?: typeof fetch;
  
  /**
   * Custom ECS Agent URI override.
   * Defaults to process.env.ECS_AGENT_URI if not provided.
   */
  ecsAgentUri?: string;
  
  /**
   * Custom logger for ECS protection events.
   * Defaults to console if not provided.
   */
  logger?: EcsProtectionLogger;
}

/**
 * Simple async mutex for thread-safe operations.
 */
class Mutex {
  private promise = Promise.resolve();
  
  async lock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.promise.then(fn, fn);
    this.promise = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

/**
 * Manages ECS Task Protection state across all workers that share this instance.
 * Uses reference counting to track active jobs and automatically
 * acquire/release protection as needed.
 * 
 * **IMPORTANT: Only create ONE instance per application/container.**
 * 
 * ECS Task Protection is a container-level feature. Multiple instances would:
 * - Compete for protection control (causing acquisition/release conflicts)
 * - Break reference counting (leading to premature protection release)
 * - Result in inconsistent protection state
 * 
 * Create a single instance and share it across all queues in your application:
 * 
 * ```typescript
 * // ✅ CORRECT: Single instance for the entire application
 * const protectionManager = new EcsProtectionManager();
 * 
 * const emailQueue = new FileQueue({
 *   plugins: [ecsTaskProtection(protectionManager)]
 * });
 * 
 * const imageQueue = new SqsQueue({
 *   plugins: [ecsTaskProtection(protectionManager)] // Same instance
 * });
 * 
 * // ❌ WRONG: Multiple instances will conflict
 * const emailProtection = new EcsProtectionManager();
 * const imageProtection = new EcsProtectionManager(); // Don't do this!
 * ```
 * 
 * For testing, you can create separate instances for different test cases
 * since each test runs in isolation.
 */
export class EcsProtectionManager {
  private activeJobs = 0;
  private protected = false;
  private draining = false;
  private renewTimer: NodeJS.Timeout | null = null;
  private mutex = new Mutex();
  private fetchFn: typeof fetch;
  private agentUri: string;
  private logger: EcsProtectionLogger;
  
  constructor(options: EcsProtectionManagerOptions = {}) {
    this.fetchFn = options.fetch || fetch;
    this.agentUri = options.ecsAgentUri || process.env.ECS_AGENT_URI || '';
    this.logger = options.logger || {
      log: (message: string) => console.log(message),
      warn: (message: string) => console.warn(message),
      error: (message: string, error?: unknown) => console.error(message, error)
    };
    
    if (!this.agentUri) {
      this.logger.warn('[ECS Protection] ECS_AGENT_URI not set - protection will be disabled');
    }
  }
  
  /**
   * Called when a job starts processing.
   * Acquires protection if this is the first active job.
   */
  async onJobStart(ttrSeconds: number): Promise<void> {
    if (!this.agentUri) return;
    
    await this.mutex.lock(async () => {
      if (this.activeJobs === 0 && !this.draining) {
        const acquired = await this.acquire(ttrSeconds);
        if (!acquired) {
          this.draining = true;
          this.logger.log('[ECS Protection] Failed to acquire protection - ECS task is draining');
          return;
        }
      }
      
      this.activeJobs++;
    });
  }
  
  /**
   * Returns true if ECS is draining the task and no new jobs should be processed.
   */
  isDraining(): boolean {
    return this.draining;
  }
  
  /**
   * Manually mark the task as draining (for testing or external triggers).
   */
  markDraining(): void {
    this.draining = true;
  }
  
  /**
   * Called when a job completes processing.
   * Releases protection if this was the last active job.
   */
  async onJobEnd(): Promise<void> {
    if (!this.agentUri) return;
    
    await this.mutex.lock(async () => {
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      
      if (this.activeJobs === 0 && this.protected) {
        await this.release();
      }
    });
  }
  
  /**
   * Acquire task protection from ECS agent.
   * Returns true if successful, false if ECS is draining.
   */
  private async acquire(ttrSeconds: number): Promise<boolean> {
    try {
      const expiresInMinutes = Math.max(1, Math.ceil(ttrSeconds / 60) + 1);
      const endpoint = `${this.agentUri}/task-protection/v1/state`;
      
      const response = await this.fetchFn(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ProtectionEnabled: true,
          ExpiresInMinutes: expiresInMinutes,
        }),
      });
      
      if (!response.ok) {
        this.logger.warn(`[ECS Protection] Failed to acquire protection: ${response.status} ${response.statusText}`);
        return false;
      }
      
      this.protected = true;
      this.scheduleRenewal(ttrSeconds);
      this.logger.log(`[ECS Protection] Task protection acquired for ${expiresInMinutes} minutes`);
      return true;
    } catch (error) {
      this.logger.error('[ECS Protection] Error acquiring protection:', error);
      return false;
    }
  }
  
  /**
   * Release task protection from ECS agent.
   */
  private async release(): Promise<void> {
    this.cancelRenewal();
    
    try {
      const endpoint = `${this.agentUri}/task-protection/v1/state`;
      
      const response = await this.fetchFn(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ProtectionEnabled: false,
        }),
      });
      
      if (!response.ok) {
        this.logger.warn(`[ECS Protection] Failed to release protection: ${response.status} ${response.statusText}`);
      } else {
        this.logger.log('[ECS Protection] Task protection released');
      }
    } catch (error) {
      this.logger.error('[ECS Protection] Error releasing protection:', error);
    } finally {
      this.protected = false;
    }
  }
  
  /**
   * Schedule automatic renewal of protection before it expires.
   */
  private scheduleRenewal(ttrSeconds: number): void {
    this.cancelRenewal();
    
    // Renew 30 seconds before expiration, but at least after 30 seconds
    const renewInMs = Math.max(30_000, (ttrSeconds - 30) * 1000);
    
    this.renewTimer = setTimeout(() => {
      if (this.activeJobs > 0 && !this.draining) {
        this.acquire(ttrSeconds).catch((error) => {
          this.logger.error('[ECS Protection] Error during auto-renewal:', error);
        });
      }
    }, renewInMs);
  }
  
  /**
   * Cancel any scheduled renewal.
   */
  private cancelRenewal(): void {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }
  
  /**
   * Cleanup method for graceful shutdown.
   */
  async cleanup(): Promise<void> {
    this.cancelRenewal();
    if (this.protected) {
      await this.release();
    }
  }
}

/**
 * ECS Task Protection plugin factory.
 * 
 * This plugin prevents job loss during ECS container termination by:
 * 1. Automatically acquiring task protection when processing jobs
 * 2. Releasing protection when idle
 * 3. Detecting when ECS is draining and stopping new job processing
 * 4. Auto-renewing protection for long-running jobs
 * 
 * Users must provide an EcsProtectionManager instance. **Use the same instance
 * across all queues in your application** to ensure proper coordination.
 * 
 * Benefits of explicit instantiation:
 * - Clear control over the protection manager lifecycle
 * - Easier testing with dedicated instances per test
 * - No hidden global state
 * 
 * @param manager The EcsProtectionManager instance to use
 * @returns QueuePlugin instance
 * 
 * @example Basic usage:
 * ```typescript
 * import { FileQueue } from '@muniter/queue';
 * import { EcsProtectionManager, ecsTaskProtection } from '@muniter/queue/plugins/ecs-protection-manager';
 * 
 * // Create protection manager (can be shared across multiple queues)
 * const protectionManager = new EcsProtectionManager();
 * 
 * const queue = new FileQueue({
 *   name: 'my-queue',
 *   path: './queue',
 *   plugins: [ecsTaskProtection(protectionManager)]
 * });
 * 
 * await queue.run(true, 3);
 * ```
 * 
 * @example With custom logger:
 * ```typescript
 * import pino from 'pino';
 * 
 * const logger = pino();
 * const protectionManager = new EcsProtectionManager({
 *   logger: {
 *     log: (message) => logger.info(message),
 *     warn: (message) => logger.warn(message),
 *     error: (message, error) => logger.error({ error }, message)
 *   }
 * });
 * ```
 * 
 * @example Multiple queues sharing the same protection manager:
 * ```typescript
 * const protectionManager = new EcsProtectionManager();
 * 
 * const emailQueue = new FileQueue({
 *   name: 'email-queue',
 *   path: './email-queue',
 *   plugins: [ecsTaskProtection(protectionManager)]
 * });
 * 
 * const imageQueue = new FileQueue({
 *   name: 'image-queue', 
 *   path: './image-queue',
 *   plugins: [ecsTaskProtection(protectionManager)]
 * });
 * 
 * // Both queues will coordinate protection through the same manager
 * await Promise.all([
 *   emailQueue.run(true, 3),
 *   imageQueue.run(true, 3)
 * ]);
 * ```
 */
export function ecsTaskProtection(manager: EcsProtectionManager): QueuePlugin {
  // Access the logger from the manager to maintain consistency
  const logger = (manager as any).logger as EcsProtectionLogger;
  
  return {
    async init({ queue }) {
      logger.log(`[ECS Protection] Initializing for queue: ${queue.name}`);
      
      // Return cleanup function
      return async () => {
        logger.log(`[ECS Protection] Shutting down plugin for queue: ${queue.name}`);
        // Note: We don't call manager.cleanup() here because the manager
        // might be shared across multiple queues. Users should call
        // manager.cleanup() explicitly when they're done with all queues.
      };
    },

    async beforePoll() {
      // Check if ECS is draining and stop polling for new jobs
      if (manager.isDraining()) {
        logger.log('[ECS Protection] Task is draining - stopping job processing');
        return 'stop';
      }
      return 'continue';
    },

    async beforeJob(job: QueueMessage) {
      // Extract TTR from job metadata, using default if not specified
      const ttr = job.meta.ttr || 300; // Default 5 minutes
      await manager.onJobStart(ttr);
      
      // Log job details for debugging
      logger.log(`[ECS Protection] Job ${job.id} starting (TTR: ${ttr}s)`);
    },
    
    async afterJob(job: QueueMessage, error?: unknown) {
      await manager.onJobEnd();
      
      // Log completion
      if (error) {
        logger.error(`[ECS Protection] Job ${job.id} failed:`, error);
      } else {
        logger.log(`[ECS Protection] Job ${job.id} completed`);
      }
    },
  };
}