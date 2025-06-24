# @muniter/queue

A TypeScript queue system inspired by Yii2-Queue architecture, providing a clean abstraction for job processing with multiple storage backends and event-based job handling.

## Features

- **Driver-based architecture**: Swap between DB, SQS, and File drivers seamlessly
- **Event-based jobs**: Register handlers for job types without complex classes
- **Type-safe API**: Full TypeScript support with driver-specific option validation
- **Multiple backends**: Database, Amazon SQS, and File storage drivers
- **Event system**: Hook into queue lifecycle events

## Installation

```bash
pnpm add @muniter/queue
```

For SQS support:
```bash
pnpm add @muniter/queue @aws-sdk/client-sqs
```

## Quick Start

### 1. Define Job Types and Handlers

```typescript
import { FileQueue } from '@muniter/queue';

// Define your job types with TypeScript
interface MyJobs {
  'send-email': { to: string; subject: string; body: string };
  'resize-image': { url: string; width: number; height: number };
  'generate-report': { type: string; period: string };
}

const queue = new FileQueue<MyJobs>({ path: './queue-data' });

// Register type-safe handlers
queue.setHandlers({
  'send-email': async ({ payload }) => {
    // payload is automatically typed as { to: string; subject: string; body: string }
    console.log(`Sending email to ${payload.to}: ${payload.subject}`);
    await sendEmail(payload.to, payload.subject, payload.body);
  },
  'resize-image': async ({ payload }) => {
    // payload is automatically typed as { url: string; width: number; height: number }
    console.log(`Resizing image ${payload.url} to ${payload.width}x${payload.height}`);
    await resizeImage(payload.url, payload.width, payload.height);
  },
  'generate-report': async ({ payload }) => {
    // Handle report generation
    console.log(`Generating ${payload.type} report for ${payload.period}`);
  }
});
```

### 2. Add Jobs to Queue

```typescript
// Simple job addition
await queue.addJob('send-email', {
  payload: {
    to: 'user@example.com',
    subject: 'Welcome!',
    body: 'Thanks for signing up!'
  }
});

// Job with options (TTR supported by all drivers)
await queue.addJob('resize-image', {
  payload: {
    url: 'https://example.com/image.jpg',
    width: 800,
    height: 600
  },
  ttr: 300  // 5 minute timeout
});

// Job with delay (supported by File and SQS drivers)
await queue.addJob('generate-report', {
  payload: {
    type: 'monthly',
    period: 'December 2024'
  },
  delay: 60,  // 1 minute delay
  ttr: 600    // 10 minute timeout
});
```

### 3. Process Jobs

```typescript
// Start processing jobs
await queue.run(true, 3); // Run continuously, poll every 3 seconds

// Or process jobs once and exit
await queue.run(false);
```

## Queue Drivers

### File Driver

A file-based queue that stores jobs as individual files with JSON index tracking. Perfect for development and single-server applications.

```typescript
import { FileQueue } from '@muniter/queue';

const queue = new FileQueue<MyJobs>({
  path: './queue-data',    // Directory to store queue files
  dirMode: 0o755,         // Directory permissions (optional)
  fileMode: 0o644         // File permissions (optional)
});

// Supports: TTR, Delay
// Does not support: Priority
await queue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'File queue test' },
  ttr: 300,
  delay: 60
});
```

### Database Driver

Use any database that implements the `DatabaseAdapter` interface:

```typescript
import { DbQueue } from '@muniter/queue';

// You provide the database adapter implementation
const dbAdapter = new YourDatabaseAdapter(); // implements DatabaseAdapter
const queue = new DbQueue<MyJobs>(dbAdapter);

// Supports: TTR, Delay, Priority (depends on adapter implementation)
await queue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'DB queue test' },
  ttr: 300,
  delay: 60,
  priority: 5
});
```

### SQS Driver

Amazon SQS integration with native delay support:

```typescript
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsQueue } from '@muniter/queue';

const sqsClient = new SQSClient({ region: 'us-east-1' });
const queue = new SqsQueue<MyJobs>(
  sqsClient,
  'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'
);

// Supports: TTR, Delay  
// Does not support: Priority (SQS FIFO queues would be needed)
await queue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'SQS test' },
  ttr: 300,
  delay: 60
  // priority: 5  // ❌ TypeScript error - not supported by SQS driver
});
```

## Type Safety

The library provides compile-time type safety for both payloads and driver-specific options:

```typescript
interface MyJobs {
  'send-email': { to: string; subject: string; body: string };
}

const fileQueue = new FileQueue<MyJobs>({ path: './data' });
const sqsQueue = new SqsQueue<MyJobs>(client, url);

// ✅ Payload is type-checked
await fileQueue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'Hello' }
});

// ✅ TTR and delay work with FileQueue
await fileQueue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'Hello' },
  ttr: 300,
  delay: 60
});

// ❌ TypeScript error - FileQueue doesn't support priority
await fileQueue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'Hello' },
  priority: 5  // Error!
});

// ✅ SqsQueue supports delay but not priority  
await sqsQueue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'Hello' },
  delay: 30  // Works
});

// ❌ TypeScript error - SqsQueue doesn't support priority
await sqsQueue.addJob('send-email', {
  payload: { to: 'user@example.com', subject: 'Test', body: 'Hello' },
  priority: 5  // Error!
});
```

## Worker Usage

```typescript
import { Worker } from '@muniter/queue';

const worker = new Worker(queue);

// Process jobs continuously
await worker.start(true, 3); // repeat=true, timeout=3 seconds

// Process once then exit
await worker.start(false);

// With custom timeout
const worker = new Worker(queue, { timeout: 5 });
await worker.start();
```

## Event Handling

```typescript
// Job lifecycle events
queue.on('beforePush', (event) => {
  console.log('About to add job:', event.name, event.payload);
});

queue.on('afterPush', (event) => {
  console.log('Job added with ID:', event.id);
});

queue.on('beforeExec', (event) => {
  console.log('Starting job:', event.id, event.name);
});

queue.on('afterExec', (event) => {
  console.log('Job completed:', event.id, 'Result:', event.result);
});

queue.on('afterError', (event) => {
  console.error('Job failed:', event.id, 'Error:', event.error);
});
```

## Database Adapter Interface

To create your own database driver, implement the `DatabaseAdapter` interface:

```typescript
import { DatabaseAdapter, QueueJobRecord, JobMeta, JobStatus } from '@muniter/queue';

export class YourDatabaseAdapter implements DatabaseAdapter {
  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    // Insert job into your database
    // Return unique job ID
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    // Find and reserve next available job
    // Handle delay, priority, TTR logic
    // Return job record or null
  }

  async completeJob(id: string): Promise<void> {
    // Mark job as completed
  }

  async releaseJob(id: string): Promise<void> {
    // Release job back to queue (for retry)
  }

  async failJob(id: string, error: string): Promise<void> {
    // Mark job as failed
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    // Return 'waiting' | 'reserved' | 'done' | 'failed'
  }
}
```

## CLI Usage

```bash
# Database driver (requires your adapter)
pnpm run queue:worker -- --driver db

# SQS driver  
pnpm run queue:worker -- --driver sqs --queue-url https://sqs.us-east-1.amazonaws.com/123/test

# File driver
pnpm run queue:worker -- --driver file --path ./queue-data

# Run once and exit
pnpm run queue:worker -- --no-repeat

# Custom polling timeout
pnpm run queue:worker -- --timeout 10
```

## API Reference

### Queue Methods

- `addJob<K>(name: K, request: { payload: JobMap[K], ...options }): Promise<string>` - Add job to queue
- `setHandlers(handlers: JobHandlers<JobMap>): void` - Register all job handlers with type safety
- `run(repeat?: boolean, timeout?: number): Promise<void>` - Start processing jobs
- `status(id: string): Promise<JobStatus>` - Get job status

### Driver-Specific Options

- **All drivers**: `{ ttr?: number }` (time-to-run in seconds)
- **DbQueue**: `{ ttr?, delay?, priority? }` (depends on adapter implementation)
- **SqsQueue**: `{ ttr?, delay? }` (uses SQS DelaySeconds)
- **FileQueue**: `{ ttr?, delay? }` (implements delay functionality)

### Job Definition

```typescript
interface JobMap {
  'job-name': { /* payload type */ };
  'another-job': { /* payload type */ };
}

// Jobs are defined as TypeScript interfaces, not classes
// Handlers are registered with queue.setHandlers()
```

## Plugins

The queue system supports plugins to extend functionality. Plugins can hook into the queue lifecycle to add features like task protection, metrics collection, distributed tracing, and more.

### ECS Task Protection Plugin

Prevents job loss during ECS container termination by automatically acquiring and releasing [ECS Task Protection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html) based on job activity.

**Why ECS Task Protection?**

In ECS environments, containers can be terminated during:
- Auto-scaling scale-in events
- Rolling deployments 
- Spot instance interruptions
- Manual task stopping

Without protection, in-flight jobs are lost when the container terminates. [ECS Task Protection](https://aws.amazon.com/blogs/containers/deep-dive-on-amazon-ecs-cluster-auto-scaling/) prevents this by marking tasks as "protected" from termination while they're processing jobs.

**How this plugin helps:**
- **Automatic**: No manual protection management - activated only when needed
- **Efficient**: Protection is acquired when jobs start, released when idle
- **Safe**: Detects ECS draining and gracefully stops accepting new work
- **Reliable**: Auto-renews protection for long-running jobs

```bash
pnpm add @muniter/queue
```

```typescript
import { SQSQueue } from '@muniter/queue/sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { EcsProtectionManager, ecsTaskProtection } from '@muniter/queue/plugins/ecs-protection-manager';

// Create protection manager (share across all queues in your app)
const protectionManager = new EcsProtectionManager();

const queue = new SQSQueue({
  client: new SQSClient({ region: 'us-east-1' }),
  queueUrl: process.env.SQS_QUEUE_URL!,
  name: 'email-queue',
  onFailure: 'delete', // or 'leaveInQueue'
  plugins: [ecsTaskProtection(protectionManager)]
});

await queue.run(true, 3);

// Clean up when shutting down
await protectionManager.cleanup();
```

**Features:**
- **Automatic Protection**: Acquires ECS task protection when jobs are active, releases when idle
- **Draining Detection**: Detects when ECS is draining and gracefully stops accepting new jobs  
- **Auto-Renewal**: Refreshes protection before expiration for long-running jobs
- **Zero Dependencies**: Uses built-in Node.js `fetch` API
- **Configurable Logging**: Integrate with your existing logging system

**Custom Logger Example:**
```typescript
import pino from 'pino';

const logger = pino();
const protectionManager = new EcsProtectionManager({
  logger: {
    log: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
    error: (message, error) => logger.error({ error }, message)
  }
});
```

**Multiple Queues:**
```typescript
// Use the same protection manager across all queues
const protectionManager = new EcsProtectionManager();

const emailQueue = new SQSQueue({
  client: new SQSClient({ region: 'us-east-1' }),
  queueUrl: process.env.EMAIL_QUEUE_URL!,
  name: 'email-queue',
  onFailure: 'delete',
  plugins: [ecsTaskProtection(protectionManager)]
});

const imageQueue = new SQSQueue({
  client: new SQSClient({ region: 'us-east-1' }),
  queueUrl: process.env.IMAGE_QUEUE_URL!,
  name: 'image-queue',
  onFailure: 'delete',
  plugins: [ecsTaskProtection(protectionManager)] // Same instance
});

// Both queues coordinate protection through the shared manager
await Promise.all([
  emailQueue.run(true),
  imageQueue.run(true)
]);
```

**⚠️ Important**: Only create **one** EcsProtectionManager instance per application/container. Multiple instances will conflict and break protection coordination.

### Plugin Development

Plugins implement the `QueuePlugin` interface and can hook into these lifecycle events:

- `init?()` - Called once when queue starts, return cleanup function
- `beforePoll?()` - Called before polling for jobs, can return 'stop' to gracefully shut down
- `beforeJob?()` - Called after job is reserved but before execution
- `afterJob?()` - Called after job completion (success or failure)

```typescript
import { QueuePlugin } from '@muniter/queue';

function customPlugin(): QueuePlugin {
  return {
    async init({ queue }) {
      console.log(`Plugin initialized for queue: ${queue.name}`);
      return async () => console.log('Plugin cleanup');
    },
    
    async beforeJob(job) {
      console.log(`Starting job ${job.id}`);
    },
    
    async afterJob(job, error) {
      if (error) {
        console.error(`Job ${job.id} failed:`, error);
      } else {
        console.log(`Job ${job.id} completed`);
      }
    }
  };
}
```

## Testing

Run the test suite:

```bash
pnpm test
```

Build the project:
```bash
pnpm run build
```

Type checking:
```bash
pnpm run lint
```

## Architecture

The library uses an event-based architecture:

1. **Abstract Queue** - Common interface and job processing logic
2. **Drivers** - Storage-specific implementations (DB, SQS, File)  
3. **Event Handlers** - Functions that process specific job types
4. **Type Safety** - Compile-time validation of payloads and options
5. **Events** - Lifecycle hooks for monitoring and cross-cutting concerns

Benefits:
- Swap drivers without changing job code
- Add new storage backends easily
- Type-safe job payloads and options
- Test with mock implementations  
- Scale workers independently
- Monitor via events

## License

MIT