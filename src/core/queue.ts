import { EventEmitter } from 'events';
import type { JobStatus, JobMeta, QueueMessage, QueueEvent, JobData, JobOptions, BaseJobRequest } from '../interfaces/job.ts';

/**
 * Abstract queue class providing event-based job processing with fluent API.
 * 
 * @template TJobMap - A map of job names to their payload types for type safety.
 * 
 * @example
 * ```typescript
 * interface MyJobs {
 *   'send-email': { to: string; subject: string; body: string };
 *   'resize-image': { url: string; width: number; height: number };
 * }
 * 
 * const queue = new FileQueue<MyJobs>({ path: './queue-data' });
 * 
 * // Register job handlers
 * queue.onJob('send-email', async (payload) => {
 *   await sendEmail(payload.to, payload.subject, payload.body);
 * });
 * 
 * // Add jobs with type safety
 * await queue.addJob('send-email', { to: 'user@example.com', subject: 'Hello', body: 'World' });
 * 
 * // Start processing
 * await queue.run();
 * ```
 */
export abstract class Queue<TJobMap = Record<string, any>, TJobRequest extends BaseJobRequest<any> = BaseJobRequest<any>> extends EventEmitter {
  protected ttrDefault = 300;

  /**
   * Creates a new Queue instance.
   * 
   * @param options - Configuration options
   * @param options.ttrDefault - Default time-to-run for jobs in seconds (default: 300)
   */
  constructor(options: { ttrDefault?: number } = {}) {
    super();
    if (options.ttrDefault) this.ttrDefault = options.ttrDefault;
  }


  /**
   * Adds a new job to the queue with type-safe payload validation.
   * 
   * @template K - The job name type from TJobMap
   * @param name - The name of the job type to add
   * @param request - Job request containing payload and options
   * @returns Promise that resolves to the unique job ID
   * 
   * @example
   * ```typescript
   * // Simple job addition
   * const id = await queue.addJob('send-email', {
   *   payload: { 
   *     to: 'user@example.com', 
   *     subject: 'Hello', 
   *     body: 'World' 
   *   }
   * });
   * 
   * // With options
   * await queue.addJob('backup', {
   *   payload: { path: '/data' },
   *   ttr: 3600,
   *   delay: 60
   * });
   * ```
   */
  async addJob<K extends keyof TJobMap>(
    name: K,
    request: TJobRequest & { payload: TJobMap[K] }
  ): Promise<string> {
    const { payload, ...options } = request;
    
    const meta: JobMeta = {
      ttr: options.ttr ?? this.ttrDefault,
      delay: (options as any).delay ?? 0,
      priority: (options as any).priority ?? 0,
      pushedAt: new Date()
    };

    const event: QueueEvent = { type: 'beforePush', name: name as string, payload, meta };
    this.emit('beforePush', event);

    const jobData: JobData = { name: name as string, payload };
    const serializedPayload = JSON.stringify(jobData);
    const id = await this.pushMessage(serializedPayload, meta);

    const afterEvent: QueueEvent = { type: 'afterPush', id, name: name as string, payload, meta };
    this.emit('afterPush', afterEvent);

    return id;
  }

  /**
   * Registers a handler function for a specific job type with type safety.
   * 
   * @template K - The job name type from TJobMap
   * @param jobName - The name of the job type to handle
   * @param handler - Function to execute when this job type is processed
   * @returns This queue instance for method chaining
   * 
   * @example
   * ```typescript
   * queue.onJob('send-email', async (payload) => {
   *   // payload is automatically typed as { to: string; subject: string; body: string }
   *   await emailService.send(payload.to, payload.subject, payload.body);
   * });
   * 
   * queue.onJob('resize-image', async (payload) => {
   *   // payload is automatically typed as { url: string; width: number; height: number }
   *   await imageService.resize(payload.url, payload.width, payload.height);
   * });
   * ```
   */
  onJob<K extends keyof TJobMap>(
    jobName: K,
    handler: (payload: TJobMap[K]) => Promise<void>
  ): this {
    return super.on(`job:${String(jobName)}`, handler);
  }

  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /**
   * Starts the queue worker to process jobs continuously or once.
   * 
   * @param repeat - Whether to continue processing jobs after completing all available jobs (default: false)
   * @param timeout - Polling timeout in seconds when no jobs are available (default: 0)
   * @returns Promise that resolves when processing stops
   * 
   * @example
   * ```typescript
   * // Process all available jobs once and stop
   * await queue.run();
   * 
   * // Run continuously, polling every 3 seconds when no jobs available
   * await queue.run(true, 3);
   * 
   * // Run continuously with immediate polling (no delay)
   * await queue.run(true);
   * ```
   */
  async run(repeat: boolean = false, timeout: number = 0): Promise<void> {
    const canContinue = () => true;

    while (canContinue()) {
      const message = await this.reserve(timeout);
      
      if (!message) {
        if (!repeat) break;
        if (timeout > 0) {
          await this.sleep(timeout * 1000);
        }
        continue;
      }

      const success = await this.handleMessage(message);
      if (success) {
        await this.release(message);
      }
    }
  }

  /**
   * Processes a single queue message by executing its registered handlers.
   * 
   * @param message - The queue message to process
   * @returns Promise resolving to true if processing succeeded, false if it failed
   * @protected
   */
  protected async handleMessage(message: QueueMessage): Promise<boolean> {
    try {
      const jobData: JobData = JSON.parse(message.payload);
      const { name, payload } = jobData;

      const beforeEvent: QueueEvent = { type: 'beforeExec', id: message.id, name, payload, meta: message.meta };
      this.emit('beforeExec', beforeEvent);

      // Execute the job handler
      const jobEvent = `job:${name}`;
      
      if (this.listenerCount(jobEvent) === 0) {
        throw new Error(`No handler registered for job type: ${name}`);
      }

      // Get all handlers for this job type and execute them
      const handlers = this.listeners(jobEvent) as Array<(payload: any) => Promise<void>>;
      const results = await Promise.all(handlers.map(handler => handler(payload)));
      
      const result = results.length === 1 ? results[0] : results;

      const afterEvent: QueueEvent = { type: 'afterExec', id: message.id, name, payload, meta: message.meta, result };
      this.emit('afterExec', afterEvent);

      return true;
    } catch (error) {
      return await this.handleError(message, error);
    }
  }

  /**
   * Handles errors that occur during job processing by emitting error events.
   * 
   * @param message - The queue message that failed to process
   * @param error - The error that occurred during processing
   * @returns Promise resolving to true (job is considered handled despite the error)
   * @protected
   */
  protected async handleError(message: QueueMessage, error: unknown): Promise<boolean> {
    try {
      const jobData: JobData = JSON.parse(message.payload);
      const { name, payload } = jobData;
      
      const errorEvent: QueueEvent = { type: 'afterError', id: message.id, name, payload, meta: message.meta, error };
      this.emit('afterError', errorEvent);
    } catch {
      // If we can't parse the job data, emit with minimal info
      const errorEvent: QueueEvent = { type: 'afterError', id: message.id, name: 'unknown', payload: {}, meta: message.meta, error };
      this.emit('afterError', errorEvent);
    }

    return true; // Job is considered handled (failed)
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Abstract methods that drivers must implement
  
  /**
   * Pushes a new message to the queue storage backend.
   * 
   * @param payload - Serialized job data as string
   * @param meta - Job metadata including TTR, delay, priority
   * @returns Promise resolving to unique job ID
   * @protected
   * @abstract
   */
  protected abstract pushMessage(payload: string, meta: JobMeta): Promise<string>;
  
  /**
   * Reserves the next available job from the queue for processing.
   * 
   * @param timeout - Polling timeout in seconds
   * @returns Promise resolving to queue message or null if no jobs available
   * @protected
   * @abstract
   */
  protected abstract reserve(timeout: number): Promise<QueueMessage | null>;
  
  /**
   * Releases a processed job from the queue (marks as complete).
   * 
   * @param message - The queue message to release
   * @returns Promise that resolves when job is released
   * @protected
   * @abstract
   */
  protected abstract release(message: QueueMessage): Promise<void>;
  
  /**
   * Retrieves the current status of a job by its ID.
   * 
   * @param id - The job ID to check
   * @returns Promise resolving to job status ('waiting', 'reserved', 'done', 'failed')
   * @abstract
   */
  abstract status(id: string): Promise<JobStatus>;
}