# Queue Package Improvement Proposal

## Executive Summary

After implementing a real-world example with SQLite, several critical issues have been identified that impact developer experience and limit the package's usefulness. This document outlines the major problems and proposes solutions to make the package more ergonomic and feature-complete.

## Critical Issues

### We should always sleep at least for 0.5 second as minimum to poll again for drivers that don't support long polling (db)

### 1. Confusing Method Names - `releaseJob()` Footgun

**Problem**: The `releaseJob()` method in the `DatabaseAdapter` interface is called when a job completes successfully, but the name implies it should release the job back to the queue (common queue terminology).

**Current Workaround**:
```typescript
async releaseJob(id: string): Promise<void> {
  // Mark job as done instead of releasing it back to waiting
  await run(`UPDATE jobs SET status = 'done'...`);
}
```

**Proposed Solution**: Rename methods to match their actual behavior:
```typescript
interface DatabaseAdapter {
  completeJob(id: string): Promise<void>;  // When job succeeds
  releaseJob(id: string): Promise<void>;   // When returning job to queue
  failJob(id: string, error: string): Promise<void>; // When job fails
}
```

### 2. No Queue Name Support

**Problem**: Cannot create multiple logical queues. All jobs go into one pile.

**Current**: 
```typescript
const queue = new DbQueue(adapter); // No way to separate email/image/report queues
```

**Proposed Solution**:
```typescript
const emailQueue = new DbQueue('emails', adapter);
const imageQueue = new DbQueue('images', adapter);

// Or with a factory pattern:
const queueManager = new QueueManager(adapter);
const emailQueue = queueManager.getQueue('emails');
```

### 6. Poor Worker Management

**Problem**: 
- `queue.run()` blocks forever with no way to stop gracefully
- No concurrency control
- No health monitoring

**Current**:
```typescript
await queue.run(true, 30); // Blocks forever!
```

**Proposed Solution**:
```typescript
const worker = new Worker(queue, {
  concurrency: 5,
  pollInterval: 1000,
  maxRuntime: 3600000, // 1 hour
});

worker.on('error', (err) => console.error(err));
worker.on('completed', (job) => console.log(`Job ${job.id} done`));

await worker.start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.stop(); // Waits for current jobs to finish
});
```

### 7. Missing Essential Features

**Critical Missing Features**:
- Job progress reporting
- Job cancellation  
- Scheduled/recurring jobs (cron)
- Job dependencies
- Rate limiting
- Dead letter queues
- Bulk job operations
- Job deduplication

**Nice-to-Have Features**:
- Metrics and monitoring hooks
- Job event streaming
- Priority queues with fair scheduling
- Job timeouts
- Result storage

### 8. Type Safety Issues

**Problem**: Heavy use of `any` types and type casting reduces TypeScript benefits.

**Examples**:
```typescript
const job = await get(...) as any;
deserialize(payload: Buffer): any
```

**Proposed Solution**: Strong typing throughout:
```typescript
interface Queue<TData = unknown> {
  push(data: TData, options?: JobOptions): Promise<string>;
  process(handler: JobHandler<TData>): void;
}

type JobHandler<TData> = (job: Job<TData>) => Promise<void>;
```

### 9. Database Schema Limitations

**Problems**:
- No queue_name column
- Missing indexes for multi-queue scenarios  
- No partition support
- No archival strategy

**Proposed Schema Improvements**:
```sql
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  queue_name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  -- ... other columns ...
  
  INDEX idx_queue_status_priority (queue_name, status, priority DESC),
  INDEX idx_scheduled (scheduled_at) WHERE scheduled_at IS NOT NULL
);

-- Separate table for archived jobs
CREATE TABLE jobs_archive AS SELECT * FROM jobs WHERE FALSE;
```

## Recommended API Design

### Option 1: Bull-like API (Recommended)

```typescript
import { Queue } from 'adapter-queue';

// Create typed queues
const emailQueue = new Queue<EmailData>('emails', {
  connection: sqliteAdapter,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' }
  }
});

// Add jobs
await emailQueue.add('welcome-email', {
  to: 'user@example.com',
  templateId: 'welcome'
}, {
  delay: 5000,
  priority: 10
});

// Process jobs
emailQueue.process('welcome-email', 5, async (job) => {
  await sendEmail(job.data);
  
  // Report progress
  await job.progress(50);
  
  // Update job data
  await job.update({ sentAt: new Date() });
});

// Events
emailQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

// Graceful shutdown
await emailQueue.close();
```

### Option 2: Current API with Improvements

Keep the class-based approach but make it more ergonomic:

```typescript
@Queue('emails')
export class EmailJob extends BaseJob<EmailResult> {
  constructor(
    public to: string,
    public subject: string,
    public body: string
  ) {
    super();
  }

  async execute(): Promise<EmailResult> {
    // Auto-injected: this.id, this.attempt, this.queue
    await this.updateProgress(50);
    
    const result = await sendEmail(this.to, this.subject, this.body);
    
    return { messageId: result.id };
  }
  
  // Optional overrides
  getOptions(): JobOptions {
    return { 
      attempts: 5,
      priority: this.to.includes('admin') ? 10 : 0
    };
  }
}

// Usage
const queue = new QueueManager(adapter);
await queue.dispatch(new EmailJob('admin@example.com', 'Alert', '...'));
```

## Migration Path

1. **Phase 1**: Add missing features while maintaining backward compatibility
2. **Phase 2**: Deprecate confusing APIs (like `releaseJob`)
3. **Phase 3**: Release v2 with breaking changes and cleaner API

## Conclusion

The current API requires too much boilerplate for simple use cases while missing features needed for complex ones. By addressing these issues, the package could become a serious alternative to Bull/BullMQ for TypeScript projects.