# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `@muniter/queue`, a TypeScript queue system inspired by Yii2-Queue architecture. It provides a clean abstraction for job processing with multiple storage backends (Database and Amazon SQS).

## Essential Commands

### Development Commands
- `pnpm run build` - Build TypeScript to JavaScript
- `pnpm run dev` - Watch mode for development (TypeScript compiler)
- `pnpm run lint` - Type checking with TypeScript compiler
- `pnpm test` - Run all tests with Vitest

### Worker Commands
- `pnpm run queue:worker` - Start a queue worker
- `pnpm run queue:worker:isolate` - Start worker with job isolation

### CLI Worker Options
The CLI worker supports these arguments:
- `--driver <type>` - Queue driver: 'db' or 'sqs' (default: db)
- `--isolate` - Run jobs in isolated child processes
- `--no-repeat` - Run once and exit (default: run continuously)
- `--timeout <sec>` - Polling timeout in seconds (default: 3)
- `--queue-url <url>` - SQS queue URL (required for SQS driver)

## Architecture Overview

### Core Components

1. **Abstract Queue** (`src/core/queue.ts`): Base class providing common queue functionality with event system and fluent API
2. **Drivers**: Storage-specific implementations
   - **DbQueue** (`src/drivers/db.ts`): Database-backed queue using DatabaseAdapter interface
   - **SqsQueue** (`src/drivers/sqs.ts`): Amazon SQS-backed queue
   - **FileQueue** (`src/drivers/file.ts`): File-based queue storing jobs as individual files with JSON index
3. **Jobs**: Units of work implementing the `Job<T>` interface with `execute(queue: Queue)` method
4. **Workers**: Long-running processes that consume and execute jobs
5. **Serialization**: Pluggable serialization system for job payloads

### Key Interfaces

- **Job**: Core interface for all jobs with `execute(queue: Queue): Promise<T> | T`
- **DatabaseAdapter**: Interface that database implementations must satisfy
- **QueueMessage**: Internal message format with id, payload (Buffer), and metadata
- **JobMeta**: Metadata for jobs including TTR, delay, priority, timestamps

### Driver Architecture

The system uses a driver pattern where:
- DbQueue requires a DatabaseAdapter implementation (user-provided)
- SqsQueue requires an SQS client instance (AWS SDK)
- Both inherit from the abstract Queue class

### Event System

The queue emits lifecycle events:
- `beforePush`, `afterPush` - Job insertion events
- `beforeExec`, `afterExec` - Job execution events  
- `afterError` - Job failure events

## Development Patterns

### Job Implementation
Jobs implement the `Job<T>` interface. The payload is serialized using the configured serializer (defaults to JSON).

### Database Adapters
When implementing DatabaseAdapter, you must provide:
- `insertJob(payload: Buffer, meta: JobMeta): Promise<string>`
- `reserveJob(timeout: number): Promise<QueueJobRecord | null>`
- `completeJob(id: string): Promise<void>`
- `getJobStatus(id: string): Promise<JobStatus | null>`

### Testing
- Uses Vitest for testing
- Test setup file: `tests/setup.ts`
- Mock implementations available in `tests/mocks/`
- Tests organized by component: `core/`, `drivers/`, `worker/`

### Worker Isolation
Workers can run jobs in isolated child processes using the `--isolate` flag or `isolate: true` option. This improves stability by preventing job failures from crashing the worker process.

## Example Project
The `example-queue-project/` directory contains a working example with SQLite database adapter implementation.

## Important Notes

- The CLI worker is a template - it requires user-provided database adapters or SQS clients
- Jobs are serialized as Buffer objects and must be deserializable
- TTR (Time To Run) defaults to 300 seconds but can be configured per job
- SQS driver uses message attributes for metadata and base64 encoding for payloads
- The queue system is designed to be backend-agnostic through the driver pattern