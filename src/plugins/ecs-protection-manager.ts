import type { QueuePlugin } from "../interfaces/plugin.ts";
import type { QueueMessage } from "../interfaces/job.ts";

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
 * Manages ECS Task Protection state for the container.
 * Handles communication with the ECS agent for acquiring and releasing protection.
 *
 * **IMPORTANT: Only create ONE instance per application/container.**
 *
 * ECS Task Protection is a container-level feature. Multiple manager instances would:
 * - Compete for protection control (causing acquisition/release conflicts)
 * - Have inconsistent draining state
 * - Result in protection conflicts between queues
 *
 * The manager itself is stateless regarding job tracking - each plugin instance
 * maintains its own reference count. The manager only tracks:
 * - Whether protection is currently acquired (`protected`)
 * - Whether ECS is draining the task (`draining`)
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
  private protected = false;
  private draining = false;
  private mutex = new Mutex();
  private fetchFn: typeof fetch;
  private agentUri: string;
  logger: EcsProtectionLogger;

  constructor(options: EcsProtectionManagerOptions = {}) {
    this.fetchFn = options.fetch || fetch;
    this.agentUri = options.ecsAgentUri || process.env.ECS_AGENT_URI || "";
    this.logger = options.logger || {
      log: (message: string) => console.log(message),
      warn: (message: string) => console.warn(message),
      error: (message: string, error?: unknown) =>
        console.error(message, error),
    };

    if (!this.agentUri) {
      this.logger.warn(
        "[ECS Protection] ECS_AGENT_URI not set - protection will be disabled"
      );
    }
  }

  /**
   * Called before polling for jobs.
   * Tries to acquire protection before getting a job.
   * Returns true if protection is acquired or not needed, false if draining.
   */
  async attemptProtect(ttrSeconds: number): Promise<boolean> {
    if (!this.agentUri) return true;

    return await this.mutex.lock(async () => {
      if (this.draining) {
        return false;
      }

      // Always acquire/extend protection with the requested TTR
      const acquired = await this.acquire(ttrSeconds);
      if (!acquired) {
        this.draining = true;
        this.logger.log(
          "[ECS Protection] Failed to acquire protection - ECS task is draining"
        );
        return false;
      }

      return true;
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
   * Decrements active job counter and releases protection.
   */
  async attemptRelease(): Promise<void> {
    if (!this.agentUri) return;

    await this.mutex.lock(async () => {
      await this.release();
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
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ProtectionEnabled: true,
          ExpiresInMinutes: expiresInMinutes,
        }),
      });

      if (!response.ok) {
        this.logger.warn(
          `[ECS Protection] Failed to acquire protection: ${response.status} ${response.statusText}`
        );
        return false;
      }

      this.protected = true;
      this.logger.log(
        `[ECS Protection] Task protection acquired for ${expiresInMinutes} minutes`
      );
      return true;
    } catch (error) {
      this.logger.error("[ECS Protection] Error acquiring protection:", error);
      return false;
    }
  }

  /**
   * Release task protection from ECS agent.
   */
  private async release(): Promise<void> {
    try {
      const endpoint = `${this.agentUri}/task-protection/v1/state`;

      const response = await this.fetchFn(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ProtectionEnabled: false,
        }),
      });

      if (!response.ok) {
        this.logger.warn(
          `[ECS Protection] Failed to release protection: ${response.status} ${response.statusText}`
        );
      } else {
        this.logger.log("[ECS Protection] Task protection released");
      }
    } catch (error) {
      this.logger.error("[ECS Protection] Error releasing protection:", error);
    } finally {
      this.protected = false;
    }
  }

  /**
   * Cleanup method for graceful shutdown.
   */
  async cleanup(): Promise<void> {
    if (this.protected) {
      await this.release();
    }
  }
}

/**
 * ECS Task Protection plugin factory.
 *
 * This plugin prevents job loss during ECS container termination by:
 * 1. Acquiring task protection before polling for jobs
 * 2. Maintaining protection while any jobs are active (reference counting)
 * 3. Extending protection automatically for long-running jobs based on TTR
 * 4. Releasing protection only when all jobs complete
 * 5. Detecting when ECS is draining and stopping new job processing
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
 *   plugins: [ecsTaskProtection({ manager: protectionManager })]
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
 * // Each plugin instance tracks its own active jobs
 * const emailPlugin = ecsTaskProtection({ manager: protectionManager });
 * const imagePlugin = ecsTaskProtection({ 
 *   manager: protectionManager,
 *   defaultProtectionTimeout: 900 // 15 minutes for longer jobs
 * });
 *
 * const emailQueue = new FileQueue({
 *   name: 'email-queue',
 *   path: './email-queue',
 *   plugins: [emailPlugin]
 * });
 *
 * const imageQueue = new FileQueue({
 *   name: 'image-queue',
 *   path: './image-queue',
 *   plugins: [imagePlugin]
 * });
 *
 * // Each queue's plugin tracks its own jobs independently
 * // Protection is released only when ALL jobs across ALL queues complete
 * await Promise.all([
 *   emailQueue.run(true, 3),
 *   imageQueue.run(true, 3)
 * ]);
 * ```
 */
export function ecsTaskProtection(opts: {
  manager: EcsProtectionManager;
  defaultProtectionTimeout?: number;
}): QueuePlugin {
  const { manager, defaultProtectionTimeout = 600 } = opts;
  const logger = manager.logger;
  const jobsInProgress = new Set<string>();
  const mutex = new Mutex();
  let protectionExpiresAt = 0; // Timestamp when current protection expires

  return {
    async init({ queue }) {
      logger.log(`[ECS Protection] Initializing for queue: ${queue.name}`);

      // Return cleanup function
      return async () => {
        logger.log(
          `[ECS Protection] Shutting down plugin for queue: ${queue.name}`
        );
      };
    },

    async beforePoll() {
      // Check if we need to acquire/extend protection
      const now = Date.now();
      const remainingProtection = protectionExpiresAt - now;
      
      // Only acquire protection if:
      // 1. We have no protection (protectionExpiresAt <= now)
      // 2. Protection expires soon (less than 30 seconds remaining)
      const needsProtection = remainingProtection < 30000; // 30 seconds buffer
      
      if (needsProtection) {
        logger.log(
          `[ECS Protection] Protection expires in ${Math.max(0, Math.round(remainingProtection / 1000))}s, acquiring new protection`
        );
        
        const protectionAcquired = await manager.attemptProtect(defaultProtectionTimeout);

        if (!protectionAcquired) {
          logger.log(
            "[ECS Protection] Cannot acquire protection - task is draining, stopping job processing"
          );
          return "stop";
        }
        
        // Update expiration time
        protectionExpiresAt = now + (defaultProtectionTimeout * 1000);
      } else {
        logger.log(
          `[ECS Protection] Protection still valid for ${Math.round(remainingProtection / 1000)}s, skipping acquisition`
        );
      }

      return "continue";
    },

    async beforeJob(job: QueueMessage) {
      await mutex.lock(async () => {
        jobsInProgress.add(job.id);
        logger.log(
          `[ECS Protection] Job ${job.id} starting (TTR: ${job.meta.ttr || 300}s)`
        );
      });

      const jobTtr = job.meta.ttr || 300;
      const now = Date.now();
      const jobCompletionTime = now + (jobTtr * 1000);
      
      // Only extend protection if this job would run beyond current protection
      if (jobCompletionTime > protectionExpiresAt) {
        logger.log(
          `[ECS Protection] Job ${job.id} needs ${jobTtr}s but protection expires in ${Math.round((protectionExpiresAt - now) / 1000)}s, extending protection`
        );
        
        const protectionAcquired = await manager.attemptProtect(jobTtr);
        if (protectionAcquired) {
          protectionExpiresAt = now + (jobTtr * 1000);
        }
      } else {
        logger.log(
          `[ECS Protection] Job ${job.id} TTR ${jobTtr}s fits within existing protection (${Math.round((protectionExpiresAt - now) / 1000)}s remaining)`
        );
      }
    },

    async afterJob(job: QueueMessage, error?: unknown) {
      await mutex.lock(async () => {
        jobsInProgress.delete(job.id);
        
        // Log completion
        if (error) {
          logger.error(`[ECS Protection] Job ${job.id} failed:`, error);
        } else {
          logger.log(`[ECS Protection] Job ${job.id} completed`);
        }
        
        if (jobsInProgress.size === 0) {
          logger.log(
            `[ECS Protection] No jobs in progress, releasing protection`
          );
          await manager.attemptRelease();
        }
      });
    },
  };
}
