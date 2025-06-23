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
export interface WorkerPlugin {
  /**
   * Called once when the worker starts.
   * Return a cleanup function that runs on shutdown.
   */
  init?(ctx: { queue: Queue; queueName?: string }): Promise<(() => Promise<void>) | void>;

  /**
   * Called before each poll/reserve attempt.
   * Return 'stop' to gracefully shut down the worker.
   */
  beforePoll?(): Promise<'continue' | 'stop' | void>;

  /**
   * Called after a job is reserved but before execution.
   * Return 'stop' to reject the job and stop the worker.
   * Plugins can mutate the job object if needed.
   */
  beforeJob?(job: QueueMessage): Promise<'continue' | 'stop' | void>;

  /**
   * Called after job execution (success or failure).
   * Receives the job and any error that occurred.
   */
  afterJob?(job: QueueMessage, error?: unknown): Promise<void>;
}
```

### Worker Integration

The worker loop integrates plugins at key points:

```typescript
export async function runWorker<T>(
  queue: Queue<T>,
  options: WorkerOptions & { plugins?: WorkerPlugin[] }
) {
  const { plugins = [], ...opts } = options;
  const disposers: Array<() => Promise<void>> = [];

  // 1. Initialize plugins
  for (const plugin of plugins) {
    if (plugin.init) {
      const dispose = await plugin.init({ queue, queueName: queue.name });
      if (dispose) disposers.push(dispose);
    }
  }

  try {
    // 2. Main processing loop
    while (!stopped) {
      // Check if any plugin wants to stop
      for (const plugin of plugins) {
        if (plugin.beforePoll) {
          const result = await plugin.beforePoll();
          if (result === 'stop') {
            stopped = true;
            break;
          }
        }
      }
      if (stopped) break;

      const message = await queue.reserve(opts.timeout);
      if (!message) continue;

      // 3. Pre-execution hooks
      let shouldProcess = true;
      for (const plugin of plugins) {
        if (plugin.beforeJob) {
          const result = await plugin.beforeJob(message);
          if (result === 'stop') {
            shouldProcess = false;
            stopped = true;
            break;
          }
        }
      }

      if (!shouldProcess) {
        await queue.release(message); // Return job to queue
        break;
      }

      // 4. Execute job
      try {
        await queue.handleMessage(message);
        
        // 5. Post-execution hooks (success)
        for (const plugin of plugins) {
          if (plugin.afterJob) {
            await plugin.afterJob(message);
          }
        }
      } catch (error) {
        // 6. Post-execution hooks (failure)
        for (const plugin of plugins) {
          if (plugin.afterJob) {
            await plugin.afterJob(message, error);
          }
        }
      }
    }
  } finally {
    // 7. Cleanup
    for (const dispose of disposers.reverse()) {
      await dispose();
    }
  }
}
```

### Design Benefits

#### Full Job Object Access
Passing the complete `QueueMessage` object to plugins provides:
- **Rich Context**: Access to all job metadata, payload, and identifiers
- **Logging Flexibility**: Plugins can log any job details they need
- **Job Transformation**: Advanced plugins can modify job metadata or payload
- **Performance Tracking**: Easy access to timestamps and TTR values

#### Explicit Return Values
Using string literals (`'continue'` | `'stop'`) instead of booleans:
- **Self-Documenting**: Code clearly expresses intent
- **Type Safety**: TypeScript prevents typos and invalid values
- **Future Extensibility**: Easy to add new return values like `'retry'` or `'defer'`
- **Readable**: `return 'stop'` is clearer than `return false`

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
import type { WorkerPlugin } from '@muniter/queue';

class ProtectionManager {
  private activeJobs = 0;
  private protected = false;
  private draining = false;
  private renewTimer: NodeJS.Timeout | null = null;
  private mutex = new Mutex();
  
  async onJobStart(ttrSeconds: number): Promise<'continue' | 'stop'> {
    return this.mutex.lock(async () => {
      if (this.draining) return 'stop';
      
      if (this.activeJobs === 0) {
        const acquired = await this.acquire(ttrSeconds);
        if (!acquired) {
          this.draining = true;
          return 'stop'; // Signal worker to stop
        }
      }
      
      this.activeJobs++;
      return 'continue';
    });
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

export function ecsTaskProtection(): WorkerPlugin {
  return {
    async beforeJob(job) {
      // Extract TTR from job metadata, using queue default if not specified
      const ttr = job.meta.ttr || 300; // Default 5 minutes
      const result = await manager.onJobStart(ttr);
      
      // Log job details for debugging
      console.log(`[ECS Protection] Job ${job.id} starting (TTR: ${ttr}s)`);
      
      return result;
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

const queue = new FileQueue<MyJobs>({ path: './queue' });

// Register job handlers
queue.onJob('send-email', async (payload) => {
  await emailService.send(payload);
});

// Run with ECS protection
await runWorker(queue, {
  plugins: [ecsTaskProtection()],
  timeout: 3,
});
```

### Multiple Queues

```typescript
// Single protection manager handles both queues
const protection = ecsTaskProtection();

await Promise.all([
  runWorker(emailQueue, { plugins: [protection] }),
  runWorker(imageQueue, { plugins: [protection] }),
]);
```

### Composing Plugins

```typescript
await runWorker(queue, {
  plugins: [
    ecsTaskProtection(),
    metricsPlugin({ statsd: 'localhost:8125' }),
    tracingPlugin({ serviceName: 'job-worker' }),
  ],
});
```

### Custom Plugin

```typescript
function customPlugin(): WorkerPlugin {
  let jobCount = 0;
  const jobTimes = new Map<string, number>();
  
  return {
    async init({ queue, queueName }) {
      console.log(`Starting worker for ${queueName || queue.name}`);
      return async () => {
        console.log(`Processed ${jobCount} jobs`);
      };
    },
    
    async beforeJob(job) {
      // Parse job data to get the name
      const jobData = JSON.parse(job.payload);
      console.log(`Starting job: ${jobData.name} (ID: ${job.id})`);
      
      // Track start time
      jobTimes.set(job.id, Date.now());
      jobCount++;
      
      // Example: Stop processing if we've hit a limit
      if (jobCount > 1000) {
        console.log('Job limit reached, stopping worker');
        return 'stop';
      }
      
      return 'continue';
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
function enrichmentPlugin(): WorkerPlugin {
  return {
    async beforeJob(job) {
      // Add processing metadata
      job.meta.processedAt = new Date();
      job.meta.workerHost = process.env.HOSTNAME;
      
      // Parse and validate payload
      const data = JSON.parse(job.payload);
      if (!data.userId) {
        console.error('Job missing userId, rejecting');
        return 'stop';
      }
      
      // Enrich with additional context
      data.environment = process.env.NODE_ENV;
      job.payload = JSON.stringify(data);
      
      return 'continue';
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

1. **v1.0**: Core library without plugin support (current)
2. **v1.1**: Add plugin interface, ship ECS plugin
3. **v1.2**: Community plugins emerge
4. **v2.0**: Refined plugin API based on feedback

The plugin API is designed to be stable from day one, with room for additive changes without breaking existing plugins.