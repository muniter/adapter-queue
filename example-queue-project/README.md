# Queue Example Project

This example demonstrates how to use `adapter-queue` in a realistic production setup with separate processes for job producers and consumers.

## Architecture

This example shows the **separation of concerns** pattern recommended for production applications:

- **Queue Configuration** (`queues.ts`) - Centralized queue initialization, configuration, and event listeners
- **Job Producers** (`add-job.ts`) - Add jobs to queues (e.g., from web servers, API endpoints)
- **Job Consumers** (`process-jobs.ts`) - Process jobs continuously (e.g., background worker processes)
- **Shared Types** (`types.ts`) - Job type definitions shared between producers and consumers

## Features Demonstrated

- **Multiple Queue Types**: SQLite, Redis, SQS, and File queues with clean adapter APIs
- **New Adapter System**: Clean drizzle-style APIs for queue creation
- **Type Safety**: Full TypeScript support with job payload validation
- **Event System**: Comprehensive logging via queue lifecycle events
- **Worker Management**: Using Worker class for clean process organization
- **Error Handling**: Simulated failures and proper error events
- **Delayed Jobs**: Jobs that run after a specified delay
- **Production Pattern**: Separate entry points for different concerns

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Install the queue drivers you want to use (peer dependencies):

For SQLite queue:
```bash
pnpm add better-sqlite3
```

For Redis queue:
```bash
pnpm add redis
```

For SQS queue:
```bash
pnpm add @aws-sdk/client-sqs
```

3. Build the project:
```bash
pnpm run build
```

## Usage

### 1. Start the Job Processors (Workers)

In one terminal, start the background workers that will process jobs:

```bash
pnpm run process-jobs
```

This will:
- Initialize the database and file queue
- Register handlers for all job types
- Start workers that continuously poll for new jobs
- Display real-time processing logs

### 2. Add Jobs to the Queues

In another terminal, add jobs to be processed:

```bash
pnpm run add-job
```

This will add various types of jobs:
- Welcome emails
- Notification emails  
- Image processing tasks
- Report generation (with delay)
- Batch processing jobs

You'll see the jobs being processed in real-time in the worker terminal.

## Job Types

### Email Jobs (File Queue)
- `welcome-email`: Send welcome emails to new users
- `notification`: Send system notifications

### General Jobs (Database Queue)  
- `process-image`: Resize and optimize images
- `generate-report`: Generate business reports

## Production Deployment

In a real production environment, you would:

1. **Web Server** - Run `add-job.ts` logic in your API endpoints to add jobs
2. **Worker Processes** - Deploy `process-jobs.ts` as separate background services
3. **Scaling** - Run multiple worker processes for high throughput
4. **Monitoring** - Use the event system to send metrics to monitoring services
5. **Error Handling** - Implement retry logic and dead letter queues

## Files

- `general-queue.ts` - SQLite queue using new adapter API
- `redis-queue.ts` - Redis queue using new adapter API  
- `email-queue.ts` - File and SQS queues using new adapter APIs
- `index.ts` - Main demo entry point

## Try It

1. Start workers: `pnpm run process-jobs`
2. In another terminal: `pnpm run add-job`
3. Watch the jobs get processed in real-time!
4. Try adding jobs multiple times to see concurrent processing
5. Stop workers with Ctrl+C