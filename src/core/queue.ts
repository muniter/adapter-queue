import { EventEmitter } from 'events';
import type { JobStatus, JobMeta, QueueMessage, QueueEvent, JobData, JobOptions, BaseJobRequest, JobContext, JobHandlers, QueueArgs, QueueHandler, JobPayload, JobDefinition, JobDefinitionHandler, JobModule, JobModulesToMap, JobModulesToHandlers } from '../interfaces/job.ts';
import type { QueuePlugin, QueueOptions } from '../interfaces/plugin.ts';

// Re-export convenience types for easy access
export type { QueueArgs, QueueHandler, JobPayload, JobDefinition, JobDefinitionHandler, JobModule, JobModulesToMap, JobModulesToHandlers } from '../interfaces/job.ts';

/**
 * Abstract queue class providing event-based job processing.
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
 * queue.setHandlers({
 *   'send-email': async ({ payload }) => {
 *     await sendEmail(payload.to, payload.subject, payload.body);
 *   },
 *   'resize-image': async ({ payload }) => {
 *     await resizeImage(payload.url, payload.width, payload.height);
 *   }
 * });
 * 
 * // Add jobs with type safety
 * await queue.addJob('send-email', { 
 *   payload: { to: 'user@example.com', subject: 'Hello', body: 'World' }
 * });
 * 
 * // Start processing
 * await queue.run();
 * ```
 */
export abstract class Queue<TJobMap = Record<string, any>, TJobRequest extends BaseJobRequest<any> = BaseJobRequest<any>> extends EventEmitter {
  protected ttrDefault = 300;
  protected plugins: QueuePlugin[];
  protected pluginDisposers: Array<() => Promise<void>> = [];
  public readonly name: string;
  
  /**
   * Registry of job handlers mapping job names to their handler functions.
   */
  public handlers: Map<string, Function> = new Map();
  
  /**
   * Flag indicating whether handlers have been registered.
   */
  public handlersRegistered = false;
  
  /**
   * Indicates whether this queue driver supports long polling.
   * Drivers that support long polling (like SQS) can efficiently wait for messages.
   * Drivers that don't support long polling will have a minimum 0.5s sleep between polls.
   */
  protected supportsLongPolling = false;

  /**
   * Creates a new Queue instance.
   * 
   * @param options - Configuration options
   * @param options.name - Required name for the queue
   * @param options.ttrDefault - Default time-to-run for jobs in seconds (default: 300)
   * @param options.plugins - Array of plugins to use with this queue
   */
  constructor(options: QueueOptions) {
    super();
    this.name = options.name;
    if (options.ttrDefault) this.ttrDefault = options.ttrDefault;
    this.plugins = options.plugins || [];
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
   * Sets all job handlers at once. This method must be called before starting the queue.
   * All job types defined in TJobMap must have corresponding handlers.
   * 
   * @param handlers - Complete mapping of job names to their handler functions
   * 
   * @example
   * ```typescript
   * queue.setHandlers({
   *   'send-email': async ({ payload }, queue) => {
   *     await emailService.send(payload.to, payload.subject, payload.body);
   *   },
   *   'resize-image': async (job, queue) => {
   *     const { payload, id } = job;
   *     console.log(`Processing image resize job ${id}`);
   *     await imageService.resize(payload.url, payload.width, payload.height);
   *   }
   * });
   * ```
   */
  setHandlers(handlers: JobHandlers<TJobMap>): void {
    this.handlers.clear();
    for (const [jobName, handler] of Object.entries(handlers) as Array<[string, Function]>) {
      this.handlers.set(jobName, handler);
    }
    this.handlersRegistered = true;
  }

  /**
   * Sets or replaces a handler for a specific job type.
   * Useful for testing or dynamically updating handlers.
   * 
   * @template K - The job name type from TJobMap
   * @param jobName - The name of the job type to handle
   * @param handler - Function to execute when this job type is processed
   * 
   * @example
   * ```typescript
   * // Replace handler for testing
   * queue.setHandler('send-email', async ({ payload }, queue) => {
   *   console.log('Mock email sent to:', payload.to);
   * });
   * ```
   */
  setHandler<K extends keyof TJobMap>(
    jobName: K,
    handler: (job: JobContext<TJobMap[K]>, queue: Queue<TJobMap>) => Promise<void> | void
  ): void {
    this.handlers.set(String(jobName), handler);
  }

  /**
   * Gets the current handler for a specific job type.
   * Useful for testing or introspection.
   * 
   * @template K - The job name type from TJobMap
   * @param jobName - The name of the job type
   * @returns The handler function or undefined if not registered
   */
  getHandler<K extends keyof TJobMap>(jobName: K): Function | undefined {
    return this.handlers.get(String(jobName));
  }

  /**
   * Validates that handlers have been registered before starting the queue.
   */
  public validateHandlers(): void {
    if (!this.handlersRegistered) {
      throw new Error(
        'Handlers must be registered with setHandlers() before calling run(). ' +
        'Use queue.setHandlers({ ... }) to register all job type handlers.'
      );
    }
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
    // Validate that handlers have been registered
    this.validateHandlers();
    
    const disposers = [...this.pluginDisposers];

    // 1. Initialize plugins if not already initialized
    if (this.pluginDisposers.length === 0) {
      for (const plugin of this.plugins) {
        if (plugin.init) {
          const dispose = await plugin.init({ queue: this as any });
          if (dispose) {
            this.pluginDisposers.push(dispose);
            disposers.push(dispose);
          }
        }
      }
    }

    try {
      // 2. Main processing loop (enhancing existing loop)
      let stopped = false;
      
      while (!stopped) {
        // Check if any plugin wants to stop
        try {
          for (const plugin of this.plugins) {
            if (plugin.beforePoll) {
              const result = await plugin.beforePoll();
              if (result === 'stop') {
                stopped = true;
                break;
              }
            }
          }
        } catch (error) {
          console.error('Plugin beforePoll error:', error);
          // Continue polling despite plugin error
        }
        if (stopped) break;

        const message = await this.reserve(timeout);
        if (!message) {
          if (!repeat) break;
          
          // Apply minimum sleep time for drivers that don't support long polling
          const sleepMs = this.supportsLongPolling 
            ? timeout * 1000 
            : Math.max(500, timeout * 1000);
          
          if (sleepMs > 0) {
            await this.sleep(sleepMs);
          }
          continue;
        }

        // 3. Pre-execution hooks
        try {
          for (const plugin of this.plugins) {
            if (plugin.beforeJob) {
              await plugin.beforeJob(message);
            }
          }
        } catch (error) {
          console.error('Plugin beforeJob error:', error);
          // Continue processing despite plugin error
        }

        // 4. Execute job (with plugin hooks)
        let success = false;
        let jobError: unknown;
        
        // We need to track errors for plugins, but handleMessage catches them internally
        // So we'll set up an event listener to capture the error
        let capturedError: unknown;
        const errorListener = (event: QueueEvent) => {
          if (event.type === 'afterError' && event.id === message.id) {
            capturedError = event.error;
          }
        };
        
        this.once('afterError', errorListener);
        
        try {
          success = await this.handleMessage(message);
          jobError = capturedError; // Will be undefined if no error
        } catch (error) {
          // This shouldn't happen since handleMessage catches errors
          jobError = error;
          success = false;
        } finally {
          this.removeListener('afterError', errorListener);
        }

        // 5. Post-execution hooks
        try {
          for (const plugin of this.plugins) {
            if (plugin.afterJob) {
              await plugin.afterJob(message, jobError);
            }
          }
        } catch (error) {
          console.error('Plugin afterJob error:', error);
          // Don't let plugin errors affect job completion
        }

        // Complete the job if successful, otherwise mark as failed
        if (success) {
          await this.completeJob(message);
        } else {
          await this.failJob(message, jobError || new Error('Unknown job failure'));
        }
      }
    } finally {
      // 6. Cleanup only if we initialized in this run
      for (const dispose of disposers.reverse()) {
        await dispose();
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
      // Parse the job data (this may have been modified by plugins)
      const jobData: JobData = JSON.parse(message.payload);
      const { name, payload } = jobData;

      const beforeEvent: QueueEvent = { type: 'beforeExec', id: message.id, name, payload, meta: message.meta };
      this.emit('beforeExec', beforeEvent);

      // Get the registered handler for this job type
      const handler = this.handlers.get(name);
      if (!handler) {
        throw new Error(`No handler registered for job type: ${name}`);
      }

      // Create job context object with full job information
      const jobContext: JobContext<any> = {
        id: message.id,
        payload: payload,
        meta: message.meta,
        pushedAt: message.meta.pushedAt,
        reservedAt: message.meta.reservedAt
      };

      // Execute the handler with job context and queue reference
      const result = await handler(jobContext, this);

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
   * @returns Promise resolving to false (job failed)
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

    return false; // Job failed
  }

  protected async sleep(ms: number): Promise<void> {
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
   * Marks a job as successfully completed and removes it from the queue.
   * 
   * @param message - The queue message to complete
   * @returns Promise that resolves when job is marked as complete
   * @protected
   * @abstract
   */
  protected abstract completeJob(message: QueueMessage): Promise<void>;
  
  /**
   * Marks a job as failed and handles failure appropriately (remove or retry).
   * 
   * @param message - The queue message that failed
   * @param error - The error that caused the failure
   * @returns Promise that resolves when job failure is handled
   * @protected
   * @abstract
   */
  protected abstract failJob(message: QueueMessage, error: unknown): Promise<void>;
  
  /**
   * Retrieves the current status of a job by its ID.
   * 
   * @param id - The job ID to check
   * @returns Promise resolving to job status ('waiting', 'reserved', 'done', 'failed')
   * @abstract
   */
  abstract status(id: string): Promise<JobStatus>;
}