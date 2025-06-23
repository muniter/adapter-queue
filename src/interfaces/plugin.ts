import type { Queue } from '../core/queue.ts';
import type { QueueMessage } from './job.ts';

/**
 * Plugin interface for extending queue functionality.
 * 
 * Plugins can hook into the queue lifecycle to add features like:
 * - Task protection (ECS, Kubernetes)
 * - Metrics collection
 * - Distributed tracing
 * - Circuit breaking
 * - Job enrichment
 */
export interface QueuePlugin {
  /**
   * Called once when the queue starts processing.
   * Use this hook to initialize resources, connections, or state.
   * Return a cleanup function that will be called on shutdown.
   * 
   * @param ctx - Context containing the queue instance and optional name
   * @returns Optional cleanup function
   */
  init?(ctx: { queue: Queue; queueName?: string }): Promise<(() => Promise<void>) | void>;

  /**
   * Called before each poll/reserve attempt.
   * Use this hook to control whether the queue should continue polling for jobs.
   * 
   * Examples:
   * - Check if environment is being drained (ECS, Kubernetes)
   * - Implement circuit breaker logic
   * - Check resource availability
   * 
   * @returns 'stop' to gracefully shut down processing, 'continue' or void to continue
   */
  beforePoll?(): Promise<'continue' | 'stop' | void>;

  /**
   * Called after a job is reserved but before execution.
   * Use this hook to prepare for job processing using job details.
   * 
   * Examples:
   * - Acquire task protection using job TTR
   * - Start distributed tracing spans
   * - Enrich job with metadata
   * - Track job start metrics
   * 
   * Note: Once a job is reserved, it will be processed. This hook cannot reject jobs.
   * Use beforePoll() if you need to stop processing entirely.
   * 
   * @param job - The reserved job message with full context
   */
  beforeJob?(job: QueueMessage): Promise<void>;

  /**
   * Called after job execution (success or failure).
   * Use this hook for cleanup and post-processing.
   * 
   * Examples:
   * - Release task protection
   * - End distributed tracing spans
   * - Record completion metrics
   * - Clean up resources
   * 
   * @param job - The job that was processed
   * @param error - Error if job failed, undefined if successful
   */
  afterJob?(job: QueueMessage, error?: unknown): Promise<void>;
}

/**
 * Extended queue options interface that includes plugin support.
 */
export interface QueueOptions {
  /**
   * Default time-to-run for jobs in seconds.
   */
  ttrDefault?: number;
  
  /**
   * Optional name for the queue (used in plugin context).
   */
  name?: string;
  
  /**
   * Array of plugins to use with this queue.
   * Plugins are initialized when the queue starts processing
   * and their hooks are called during the job lifecycle.
   */
  plugins?: QueuePlugin[];
}