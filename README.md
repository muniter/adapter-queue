# @muniter/queue

A TypeScript queue system inspired by Yii2-Queue architecture, providing a clean abstraction for job processing with multiple storage backends.

## Features

- **Driver-based architecture**: Swap between DB and SQS drivers seamlessly
- **Type-safe jobs**: Full TypeScript support with proper serialization
- **Retry logic**: Built-in retry mechanisms with customizable strategies  
- **Event system**: Hook into queue lifecycle events
- **Worker isolation**: Run jobs in separate processes for better stability
- **Fluent API**: Chain configuration methods for clean code

## Installation

```bash
npm install @muniter/queue
```

For SQS support:
```bash
npm install @muniter/queue @aws-sdk/client-sqs
```

## Quick Start

### 1. Define a Job

```typescript
import { Job, Queue } from '@muniter/queue';

export class EmailJob implements Job<void> {
  constructor(
    public to: string,
    public subject: string,
    public body: string
  ) {}

  async execute(queue: Queue): Promise<void> {
    // Send email logic here
    console.log(`Sending email to ${this.to}: ${this.subject}`);
  }

  // Optional: Make job serializable
  serialize() {
    return {
      constructor: 'EmailJob',
      to: this.to,
      subject: this.subject,
      body: this.body
    };
  }

  static deserialize(data: any): EmailJob {
    return new EmailJob(data.to, data.subject, data.body);
  }
}
```

### 2. Database Driver Setup

Create a database adapter that implements the `DatabaseAdapter` interface:

```typescript
import { DatabaseAdapter, QueueJobRecord, JobMeta, JobStatus } from '@muniter/queue';

export class MongoDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: MongoDatabase) {}

  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    const result = await this.db.collection('queue_jobs').insertOne({
      payload,
      meta,
      pushedAt: new Date(),
      attempt: meta.attempt || 0
    });
    return result.insertedId.toString();
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = new Date();
    
    const job = await this.db.collection('queue_jobs').findOneAndUpdate(
      { 
        doneAt: { $exists: false },
        reservedAt: { $exists: false },
        $or: [
          { 'meta.delay': { $exists: false } },
          { pushedAt: { $lte: new Date(now.getTime() - (meta.delay || 0) * 1000) } }
        ]
      },
      { $set: { reservedAt: now } },
      { sort: { 'meta.priority': -1, pushedAt: 1 } }
    );

    return job?.value ? {
      id: job.value._id.toString(),
      payload: job.value.payload,
      meta: job.value.meta,
      pushedAt: job.value.pushedAt,
      reservedAt: job.value.reservedAt,
      attempt: job.value.attempt
    } : null;
  }

  async releaseJob(id: string): Promise<void> {
    await this.db.collection('queue_jobs').updateOne(
      { _id: new ObjectId(id) },
      { $set: { doneAt: new Date() } }
    );
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    const job = await this.db.collection('queue_jobs').findOne({ _id: new ObjectId(id) });
    if (!job) return null;
    
    if (job.doneAt) return 'done';
    if (job.reservedAt) return 'reserved';
    return 'waiting';
  }

  async updateJobAttempt(id: string, attempt: number): Promise<void> {
    await this.db.collection('queue_jobs').updateOne(
      { _id: new ObjectId(id) },
      { $set: { attempt, 'meta.attempt': attempt } }
    );
  }
}
```

### 3. Push Jobs

```typescript
import { DbQueue } from '@muniter/queue';

const dbAdapter = new MongoDatabaseAdapter(db);
const queue = new DbQueue(dbAdapter);

// Simple job
await queue.push(new EmailJob('user@example.com', 'Welcome!', 'Hello world'));

// Job with custom settings
await queue
  .ttr(600)        // 10 minute timeout
  .delay(30)       // 30 second delay  
  .priority(5)     // Higher priority
  .push(new EmailJob('urgent@example.com', 'Urgent!', 'Important message'));
```

### 4. Process Jobs (Worker)

```typescript
import { Worker } from '@muniter/queue';

const worker = new Worker(queue);

// Process jobs continuously
await worker.start();

// Process once then exit
await worker.start(false);

// With isolation (jobs run in child processes)
const isolatedWorker = new Worker(queue, { isolate: true });
await isolatedWorker.start();
```

## SQS Driver

```typescript
import { SQSClient } from '@aws-sdk/client-sqs';
import { SqsQueue } from '@muniter/queue';

const sqsClient = new SQSClient({ region: 'us-east-1' });
const queue = new SqsQueue(
  sqsClient,
  'https://sqs.us-east-1.amazonaws.com/123456789/my-queue'
);

await queue.push(new EmailJob('user@example.com', 'SQS Test', 'Via SQS'));
```

## Retryable Jobs

```typescript
import { RetryableJob, Queue } from '@muniter/queue';

export class RetryableEmailJob implements RetryableJob<void> {
  constructor(public to: string, public subject: string) {}

  getTtr(): number {
    return 300; // 5 minute timeout
  }

  canRetry(attempt: number, error: unknown): boolean {
    return attempt < 3; // Max 3 attempts
  }

  async execute(queue: Queue): Promise<void> {
    // Might fail and retry
    if (Math.random() < 0.5) {
      throw new Error('Simulated failure');
    }
    console.log(`Email sent to ${this.to}`);
  }
}
```

## Event Handling

```typescript
queue.on('beforePush', (event) => {
  console.log('About to push job:', event.job);
});

queue.on('afterExec', (event) => {
  console.log('Job completed:', event.id, 'Result:', event.result);
});

queue.on('afterError', (event) => {
  console.error('Job failed:', event.id, 'Error:', event.error);
});
```

## CLI Usage

```bash
# Database driver
node dist/cli/worker.js --driver db

# SQS driver  
node dist/cli/worker.js --driver sqs --queue-url https://sqs.us-east-1.amazonaws.com/123/test

# Isolated mode
node dist/cli/worker.js --isolate

# Run once and exit
node dist/cli/worker.js --no-repeat

# Custom timeout
node dist/cli/worker.js --timeout 10
```

## API Reference

### Queue Methods

- `push(job: Job): Promise<string>` - Add job to queue
- `ttr(seconds: number): this` - Set job timeout  
- `delay(seconds: number): this` - Delay job execution
- `priority(level: number): this` - Set job priority
- `status(id: string): Promise<JobStatus>` - Get job status

### Job Interface

```typescript
interface Job<T = any> {
  execute(queue: Queue): Promise<T> | T;
}

interface RetryableJob<T = any> extends Job<T> {
  getTtr(): number;
  canRetry(attempt: number, error: unknown): boolean;
}
```

### Database Adapter Interface

```typescript
interface DatabaseAdapter {
  insertJob(payload: Buffer, meta: JobMeta): Promise<string>;
  reserveJob(timeout: number): Promise<QueueJobRecord | null>;
  releaseJob(id: string): Promise<void>;
  getJobStatus(id: string): Promise<JobStatus | null>;
  updateJobAttempt(id: string, attempt: number): Promise<void>;
}
```

## Testing

Run the test suite:

```bash
npm test
```

Watch mode:
```bash
npm run test:watch
```

## Architecture

This library follows the Yii2-Queue architecture:

1. **Abstract Queue** - Common interface and logic
2. **Drivers** - Storage-specific implementations (DB, SQS)  
3. **Jobs** - Units of work with execute() method
4. **Workers** - Long-running processes that consume jobs
5. **Events** - Lifecycle hooks for cross-cutting concerns

The design allows you to:
- Swap drivers without changing job code
- Add new storage backends easily
- Test with in-memory implementations  
- Scale workers independently
- Monitor via events

## License

MIT