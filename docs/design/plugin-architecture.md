# Queue Plugin Architecture Design

## Overview

### Problem Statement

The `@muniter/queue` package provides a solid foundation for job processing across multiple backends (Database, SQS, File). However, production deployments often require environment-specific features like:

- **ECS Task Protection**: Preventing job loss during container scale-in events
- **Metrics Collection**: Tracking job processing times and success rates
- **Distributed Tracing**: Following jobs through complex systems
- **Health Checks**: Exposing worker state for monitoring

Building these features directly into the core library would:
1. Increase bundle size for users who don't need them
2. Create coupling to specific cloud providers or monitoring tools
3. Make the library harder to maintain and test

### Goals

- **Extensibility**: Allow users to add custom behavior without modifying core code
- **Zero Overhead**: Users who don't use plugins pay no performance or bundle size penalty
- **Composability**: Multiple plugins can work together without conflicts
- **Type Safety**: Full TypeScript support for plugin development

### Non-Goals

- **Built-in Kitchen Sink**: We won't bundle every possible integration
- **Complex Plugin Management**: No plugin dependencies or version resolution
- **Runtime Plugin Loading**: Plugins are configured at startup, not dynamically

### Key Principles

1. **Opt-in by Design**: The core library works perfectly without any plugins
2. **Minimal Surface Area**: Small, focused plugin API that's easy to understand
3. **Lifecycle-Based**: Plugins hook into well-defined points in job processing
4. **Shared Nothing**: Plugins manage their own state; core remains stateless

## Plugin Architecture Design

### Plugin Interface

```typescript
export interface QueuePlugin {
  /**
   * Called once when the queue starts processing.
   * Return a cleanup function that runs on shutdown.
   */
  init?(ctx: { queue: Queue; queueName?: string }): Promise<(() => Promise<void>) | void>;

  /**
   * Called before each poll/reserve attempt.
   * Return 'stop' to gracefully shut down processing.
   */
  beforePoll?(): Promise<'continue' | 'stop' | void>;

  /**
   * Called after a job is reserved but before execution.
   * Use this hook to prepare for job processing (e.g., acquire resources,
   * extend timeouts, enrich job data). Once a job is reserved, it will
   * be processed - this hook cannot reject jobs.
   */
  beforeJob?(job: QueueMessage): Promise<void>;

  /**
   * Called after job execution (success or failure).
   * Receives the job and any error that occurred.
   */
  afterJob?(job: QueueMessage, error?: unknown): Promise<void>;
}
```

### Queue Integration

Plugins are configured when creating the queue instance, becoming part of its configuration:

```typescript
// Extended Queue constructor options
interface QueueOptions {
  ttrDefault?: number;
  plugins?: QueuePlugin[];
}

export abstract class Queue<TJobMap> {
  private plugins: QueuePlugin[];
  private pluginDisposers: Array<() => Promise<void>> = [];

  constructor(options: QueueOptions = {}) {
    super();
    this.plugins = options.plugins || [];
    if (options.ttrDefault) this.ttrDefault = options.ttrDefault;
  }

  async run(repeat: boolean = false, timeout: number = 0): Promise<void> {
    const disposers = [...this.pluginDisposers];

    // 1. Initialize plugins if not already initialized
    if (this.pluginDisposers.length === 0) {
      for (const plugin of this.plugins) {
        if (plugin.init) {
          const dispose = await plugin.init({ queue: this, queueName: this.name });
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
        for (const plugin of this.plugins) {
          if (plugin.beforePoll) {
            const result = await plugin.beforePoll();
            if (result === 'stop') {
              stopped = true;
              break;
            }
          }
        }
        if (stopped) break;

        const message = await this.reserve(timeout);
        if (!message) {
          if (!repeat) break;
          if (timeout > 0) {
            await this.sleep(timeout * 1000);
          }
          continue;
        }

        // 3. Pre-execution hooks
        for (const plugin of this.plugins) {
          if (plugin.beforeJob) {
            await plugin.beforeJob(message);
          }
        }

        // 4. Execute job (with plugin hooks)
        let success = false;
        let jobError: unknown;
        
        try {
          success = await this.handleMessage(message);
        } catch (error) {
          jobError = error;
        }

        // 5. Post-execution hooks
        for (const plugin of this.plugins) {
          if (plugin.afterJob) {
            await plugin.afterJob(message, jobError);
          }
        }

        // Complete the job if successful
        if (success) {
          await this.release(message);
        }
      }
    } finally {
      // 6. Cleanup only if we initialized in this run
      for (const dispose of disposers.reverse()) {
        await dispose();
      }
    }
  }
}
```

### Design Benefits

#### Direct Queue Integration
By integrating plugins directly into the Queue class at construction time:
- **Configuration-Time Setup**: Plugins become part of the queue's configuration
- **Consistent Behavior**: All runs of the queue will have the same plugins
- **Simpler API**: `queue.run()` stays simple without plugin parameters
- **Clear Mental Model**: Plugins are queue capabilities, not runtime options

#### Full Job Object Access
Passing the complete `QueueMessage` object to plugins provides:
- **Rich Context**: Access to all job metadata, payload, and identifiers
- **Logging Flexibility**: Plugins can log any job details they need
- **Job Transformation**: Advanced plugins can modify job metadata or payload
- **Performance Tracking**: Easy access to timestamps and TTR values

#### Clear Hook Responsibilities
Each plugin hook has a specific purpose:
- **`beforePoll`**: Control whether to continue polling for jobs (environment-level decisions)
- **`beforeJob`**: Prepare for job execution using job details (resource acquisition, logging)
- **`afterJob`**: Clean up after job completion (resource release, metrics)

#### Hook Design Rationale
- **`beforePoll` can stop**: Controls job acquisition at the queue level
- **`beforeJob` is void**: Once reserved, jobs must be processed (no "unreserve" semantics)
- **Explicit return values**: `'continue'` | `'stop'` is clearer than boolean values

### Error Handling

- Plugin errors in `init` prevent worker startup
- Plugin errors in `beforePoll` are logged but don't stop the worker
- Plugin errors in `beforeJob` are logged; job proceeds normally
- Plugin errors in `afterJob` are logged but don't affect job status
- Cleanup functions are called even if errors occur

## ECS Task Protection Plugin

### Problem It Solves

In ECS environments, containers can be terminated during:
- Auto-scaling scale-in events
- Deployments (rolling updates)
- Spot instance interruptions

Without protection, in-flight jobs are lost when the container terminates. ECS Task Protection prevents this by:
1. Marking the task as "protected" when processing jobs
2. Removing protection when idle
3. Allowing graceful shutdown when ECS wants to terminate

### How ECS Task Protection Works

ECS provides an agent endpoint inside each container:
```
PUT $ECS_AGENT_URI/task-protection/v1/state
{
  "ProtectionEnabled": true,
  "ExpiresInMinutes": 10
}
```

Key behaviors:
- Protection expires automatically (safety mechanism)
- ECS rejects protection requests when draining a task
- Protected tasks prevent deployments from completing
- Maximum protection duration is 48 hours

### Plugin Implementation

```typescript
// plugins/ecsTaskProtection.ts
import axios from 'axios';
import type { QueuePlugin } from '@muniter/queue';

class ProtectionManager {
  private activeJobs = 0;
  private protected = false;
  private draining = false;
  private renewTimer: NodeJS.Timeout | null = null;
  private mutex = new Mutex();
  
  async onJobStart(ttrSeconds: number): Promise<void> {
    await this.mutex.lock(async () => {
      if (this.activeJobs === 0 && !this.draining) {
        const acquired = await this.acquire(ttrSeconds);
        if (!acquired) {
          this.draining = true;
          return; // Will be handled by beforePoll
        }
      }
      
      this.activeJobs++;
    });
  }
  
  isDraining(): boolean {
    return this.draining;
  }
  
  markDraining(): void {
    this.draining = true;
  }
  
  async onJobEnd(): Promise<void> {
    await this.mutex.lock(async () => {
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      
      if (this.activeJobs === 0 && this.protected) {
        await this.release();
      }
    });
  }
  
  private async acquire(ttrSeconds: number): Promise<boolean> {
    try {
      const expiresInMinutes = Math.max(1, Math.ceil(ttrSeconds / 60) + 1);
      await axios.put(ENDPOINT, {
        ProtectionEnabled: true,
        ExpiresInMinutes: expiresInMinutes,
      });
      this.protected = true;
      this.scheduleRenewal(ttrSeconds);
      return true;
    } catch {
      return false; // ECS is draining the task
    }
  }
  
  private async release(): Promise<void> {
    this.cancelRenewal();
    try {
      await axios.put(ENDPOINT, { ProtectionEnabled: false });
    } finally {
      this.protected = false;
    }
  }
  
  private scheduleRenewal(ttrSeconds: number): void {
    this.cancelRenewal();
    // Renew 30 seconds before expiration
    const renewInMs = Math.max(30_000, (ttrSeconds - 30) * 1000);
    this.renewTimer = setTimeout(() => {
      if (this.activeJobs > 0) {
        this.acquire(ttrSeconds).catch(() => {
          // Log but don't crash
        });
      }
    }, renewInMs);
  }
}

// Singleton instance shared across all workers in the process
const manager = new ProtectionManager();

export function ecsTaskProtection(): QueuePlugin {
  return {
    async beforePoll() {
      // Check if ECS is draining and stop polling for new jobs
      if (manager.isDraining()) {
        return 'stop';
      }
      return 'continue';
    },

    async beforeJob(job) {
      // Extract TTR from job metadata, using queue default if not specified
      const ttr = job.meta.ttr || 300; // Default 5 minutes
      await manager.onJobStart(ttr);
      
      // Log job details for debugging
      console.log(`[ECS Protection] Job ${job.id} starting (TTR: ${ttr}s)`);
    },
    
    async afterJob(job, error) {
      await manager.onJobEnd();
      
      // Log completion
      if (error) {
        console.error(`[ECS Protection] Job ${job.id} failed:`, error);
      } else {
        console.log(`[ECS Protection] Job ${job.id} completed`);
      }
    },
    
    async init({ queue }) {
      console.log(`[ECS Protection] Initializing for queue: ${queue.name || 'unnamed'}`);
      
      // Return cleanup function
      return async () => {
        console.log('[ECS Protection] Shutting down...');
        await manager.onJobEnd();
      };
    },
  };
}
```

### Key Design Decisions

1. **Shared State**: Single ProtectionManager instance across all workers prevents multiple protection calls
2. **Reference Counting**: Track active jobs to know when to acquire/release protection
3. **Auto-Renewal**: Refresh protection before it expires for long-running jobs
4. **Graceful Draining**: Detect when ECS rejects protection and stop accepting new jobs
5. **Mutex Protection**: Prevent race conditions in concurrent job processing

## Usage Examples

### Basic Usage

```typescript
import { FileQueue } from '@muniter/queue';
import { ecsTaskProtection } from '@muniter/queue/plugins';

const queue = new FileQueue<MyJobs>({ 
  path: './queue',
  plugins: [ecsTaskProtection()]
});

// Register job handlers
queue.onJob('send-email', async (payload) => {
  await emailService.send(payload);
});

// Simple run call - plugins are already configured
await queue.run(true, 3);
```

### Multiple Queues

```typescript
// Single protection manager handles both queues
const protection = ecsTaskProtection();

const emailQueue = new SqsQueue<EmailJobs>(sqsClient, queueUrl, {
  plugins: [protection]
});

const imageQueue = new FileQueue<ImageJobs>({
  path: './image-queue',
  plugins: [protection]
});

await Promise.all([
  emailQueue.run(true),
  imageQueue.run(true),
]);
```

### Composing Plugins

```typescript
const queue = new DbQueue(databaseAdapter, {
  plugins: [
    // ECS task protection for safe scaling
    ecsTaskProtection(),
    
    // Metrics collection for monitoring
    metricsPlugin({ 
      statsd: 'localhost:8125',
      prefix: 'email_queue'
    }),
    
    // Distributed tracing for observability
    tracingPlugin({ 
      serviceName: 'email-worker',
      serviceVersion: '2.1.0'
    }),
    
    // Circuit breaker for resilience
    circuitBreakerPlugin({
      failureThreshold: 10,
      resetTimeoutMs: 120000
    }),
    
    // Job enrichment for context
    enrichmentPlugin()
  ]
});

await queue.run(true, 3);
```

### Real-World Production Setup

```typescript
// Production email queue with full observability
const emailQueue = new SqsQueue<EmailJobs>(sqsClient, process.env.EMAIL_QUEUE_URL!, {
  ttrDefault: 300,
  plugins: [
    ecsTaskProtection(),
    metricsPlugin({ 
      statsd: process.env.STATSD_HOST!,
      prefix: 'email_queue'
    }),
    tracingPlugin({ 
      serviceName: 'email-service',
      serviceVersion: process.env.SERVICE_VERSION!
    }),
    circuitBreakerPlugin({ failureThreshold: 5 })
  ]
});

// Background processing queue with different settings
const backgroundQueue = new DbQueue<BackgroundJobs>(databaseAdapter, {
  ttrDefault: 1800, // 30 minutes for long-running jobs
  plugins: [
    ecsTaskProtection(),
    metricsPlugin({ 
      statsd: process.env.STATSD_HOST!,
      prefix: 'background_queue'
    }),
    // No circuit breaker - background jobs can be more tolerant
    enrichmentPlugin()
  ]
});

// Start both queues concurrently
await Promise.all([
  emailQueue.run(true, 1),      // Fast polling for time-sensitive emails
  backgroundQueue.run(true, 5)  // Slower polling for background work
]);
```

### Custom Plugin

```typescript
function customPlugin(): QueuePlugin {
  let jobCount = 0;
  const jobTimes = new Map<string, number>();
  const maxJobs = 1000;
  
  return {
    async init({ queue, queueName }) {
      console.log(`Starting worker for ${queueName || queue.name}`);
      return async () => {
        console.log(`Processed ${jobCount} jobs`);
      };
    },
    
    async beforePoll() {
      // Stop processing if we've hit the job limit
      if (jobCount >= maxJobs) {
        console.log(`Job limit of ${maxJobs} reached, stopping worker`);
        return 'stop';
      }
      return 'continue';
    },
    
    async beforeJob(job) {
      // Parse job data to get the name
      const jobData = JSON.parse(job.payload);
      console.log(`Starting job: ${jobData.name} (ID: ${job.id})`);
      
      // Track start time
      jobTimes.set(job.id, Date.now());
      jobCount++;
      
      // Add processing metadata to the job
      job.meta.processedAt = new Date();
      job.meta.workerHost = process.env.HOSTNAME;
    },
    
    async afterJob(job, error) {
      const jobData = JSON.parse(job.payload);
      const duration = Date.now() - (jobTimes.get(job.id) || 0);
      jobTimes.delete(job.id);
      
      if (error) {
        console.error(`Job ${jobData.name} failed after ${duration}ms:`, error);
      } else {
        console.log(`Job ${jobData.name} completed in ${duration}ms`);
      }
    },
  };
}
```

## Technical Considerations

### Concurrency Safety

The plugin API must handle concurrent operations safely:
- Multiple workers may start simultaneously
- Jobs may complete in any order
- Plugins must not assume sequential execution

The ECS plugin uses a mutex to ensure atomic state updates:

```typescript
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
```

### Performance Impact

- Plugin hooks add minimal overhead (function calls)
- Async hooks are awaited sequentially (intentional for correctness)
- No impact when no plugins are configured
- ECS plugin makes 2 HTTP calls per busy/idle cycle (not per job)

### Testing Strategy

1. **Unit Tests**: Mock plugin interface, verify hook calls
2. **Integration Tests**: Real plugins with in-memory queue
3. **ECS Tests**: Mock axios calls, verify protection state machine
4. **Stress Tests**: Many concurrent workers with shared protection

### Advanced Plugin Examples

#### Job Enrichment Plugin
```typescript
function enrichmentPlugin(): QueuePlugin {
  return {
    async beforeJob(job) {
      // Add processing metadata
      job.meta.processedAt = new Date();
      job.meta.workerHost = process.env.HOSTNAME;
      
      // Parse and enrich payload
      const data = JSON.parse(job.payload);
      data.environment = process.env.NODE_ENV;
      data.processedBy = 'queue-worker-v1.2';
      job.payload = JSON.stringify(data);
      
      // Add trace ID for correlation
      job.meta.traceId = crypto.randomUUID();
    }
  };
}
```

#### Metrics Plugin
```typescript
interface MetricsOptions {
  statsd?: string;
  prefix?: string;
}

function metricsPlugin(options: MetricsOptions = {}): QueuePlugin {
  const { statsd = 'localhost:8125', prefix = 'queue' } = options;
  const client = new StatsD({ host: statsd.split(':')[0], port: parseInt(statsd.split(':')[1]) });
  
  const jobStartTimes = new Map<string, number>();
  let activeJobs = 0;
  
  return {
    async init({ queue }) {
      console.log(`[Metrics] Initializing for queue: ${queue.name}`);
      
      // Report active jobs periodically
      const interval = setInterval(() => {
        client.gauge(`${prefix}.active_jobs`, activeJobs);
      }, 10000);
      
      return async () => {
        clearInterval(interval);
        client.close();
      };
    },
    
    async beforeJob(job) {
      const jobData = JSON.parse(job.payload);
      
      // Track job start
      jobStartTimes.set(job.id, Date.now());
      activeJobs++;
      
      // Increment job counter by type
      client.increment(`${prefix}.jobs.started`, 1, [`job_type:${jobData.name}`]);
      client.gauge(`${prefix}.active_jobs`, activeJobs);
    },
    
    async afterJob(job, error) {
      const jobData = JSON.parse(job.payload);
      const startTime = jobStartTimes.get(job.id);
      const duration = startTime ? Date.now() - startTime : 0;
      
      jobStartTimes.delete(job.id);
      activeJobs = Math.max(0, activeJobs - 1);
      
      // Record completion metrics
      if (error) {
        client.increment(`${prefix}.jobs.failed`, 1, [`job_type:${jobData.name}`]);
      } else {
        client.increment(`${prefix}.jobs.completed`, 1, [`job_type:${jobData.name}`]);
        client.histogram(`${prefix}.jobs.duration`, duration, [`job_type:${jobData.name}`]);
      }
      
      client.gauge(`${prefix}.active_jobs`, activeJobs);
    }
  };
}
```

#### OpenTelemetry Tracing Plugin
```typescript
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

interface TracingOptions {
  serviceName?: string;
  serviceVersion?: string;
}

function tracingPlugin(options: TracingOptions = {}): QueuePlugin {
  const { serviceName = 'queue-worker', serviceVersion = '1.0.0' } = options;
  const tracer = trace.getTracer(serviceName, serviceVersion);
  
  const activeSpans = new Map<string, any>();
  
  return {
    async beforeJob(job) {
      const jobData = JSON.parse(job.payload);
      
      // Start a new span for this job
      const span = tracer.startSpan(`job.${jobData.name}`, {
        attributes: {
          'job.id': job.id,
          'job.name': jobData.name,
          'job.ttr': job.meta.ttr || 300,
          'queue.name': 'queue-worker', // Could be passed from init
        }
      });
      
      // Store span for later use
      activeSpans.set(job.id, span);
      
      // Add trace context to job for downstream services
      const traceContext = trace.setSpan(context.active(), span);
      job.meta.traceContext = JSON.stringify(traceContext);
    },
    
    async afterJob(job, error) {
      const span = activeSpans.get(job.id);
      if (!span) return;
      
      // Set span status based on job result
      if (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        span.recordException(error);
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      
      // End span and clean up
      span.end();
      activeSpans.delete(job.id);
    }
  };
}
```

#### Circuit Breaker Plugin
```typescript
interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  monitorWindowMs?: number;
}

function circuitBreakerPlugin(options: CircuitBreakerOptions = {}): QueuePlugin {
  const { 
    failureThreshold = 5, 
    resetTimeoutMs = 60000,
    monitorWindowMs = 30000 
  } = options;
  
  let failures = 0;
  let lastFailureTime = 0;
  let isOpen = false;
  
  return {
    async beforePoll() {
      // Check if circuit breaker should reset
      if (isOpen && Date.now() - lastFailureTime > resetTimeoutMs) {
        console.log('[CircuitBreaker] Attempting to close circuit');
        isOpen = false;
        failures = 0;
      }
      
      // Stop polling if circuit is open
      if (isOpen) {
        console.log('[CircuitBreaker] Circuit is open, stopping job processing');
        return 'stop';
      }
      
      return 'continue';
    },
    
    async afterJob(job, error) {
      if (error) {
        failures++;
        lastFailureTime = Date.now();
        
        if (failures >= failureThreshold) {
          isOpen = true;
          console.error(`[CircuitBreaker] Circuit opened after ${failures} failures`);
        }
      } else {
        // Reset failure count on success (in closed state)
        if (!isOpen) {
          failures = Math.max(0, failures - 1);
        }
      }
    }
  };
}
```

### Future Extensions

Potential plugins that follow this pattern:
- **Datadog Metrics**: Report job counts, durations, errors
- **OpenTelemetry**: Distributed tracing across services
- **Circuit Breaker**: Pause queue when downstream services fail
- **Rate Limiter**: Control job processing rate
- **Priority Router**: Route jobs to different workers by priority
- **Dead Letter Queue**: Move failed jobs to a separate queue
- **Job Deduplication**: Skip duplicate jobs based on content hash

## Migration Path

### Current State
The Queue class already has:
- A `run()` method with the processing loop
- Event emitters for job lifecycle
- All the infrastructure needed for plugins

### Implementation Steps

1. **Update Queue constructor**: 
   - Extend options interface to include `plugins?: QueuePlugin[]`
   - Store plugins as instance properties

2. **Add plugin hooks to run() method**: 
   - Minimal changes to existing loop
   - Plugins are optional, zero overhead when not used

3. **Ship ECS plugin**: 
   - As a separate export `@muniter/queue/plugins`
   - No dependencies added to core

### Backward Compatibility

```typescript
// Existing queues work unchanged
const queue = new FileQueue<MyJobs>({ path: './queue' });
await queue.run(true, 3);

// New queues with plugins
const protectedQueue = new FileQueue<MyJobs>({ 
  path: './queue',
  plugins: [ecsTaskProtection()]
});
await protectedQueue.run(true, 3);
```

The plugin API is designed to be stable from day one, with room for additive changes without breaking existing plugins.