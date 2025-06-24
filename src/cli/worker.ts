#!/usr/bin/env node

import { Worker } from '../worker/worker.ts';
import { DbQueue } from '../drivers/db.ts';
import { SqsQueue } from '../drivers/sqs.ts';

interface WorkerConfig {
  driver: 'db' | 'sqs';
  repeat?: boolean;
  timeout?: number;
  dbAdapter?: any;
  sqsClient?: any;
  queueUrl?: string;
}

function parseArgs(): WorkerConfig {
  const args = process.argv.slice(2);
  const config: WorkerConfig = {
    driver: 'db',
    repeat: true,
    timeout: 3
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--driver':
        config.driver = args[++i] as 'db' | 'sqs';
        break;
      case '--no-repeat':
        config.repeat = false;
        break;
      case '--timeout':
        config.timeout = parseInt(args[++i]!, 10);
        break;
      case '--queue-url':
        config.queueUrl = args[++i];
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
Nexus Queue Worker

Usage: node worker.js [options]

Options:
  --driver <type>     Queue driver: 'db' or 'sqs' (default: db)
  --no-repeat        Run once and exit (default: run continuously)
  --timeout <sec>    Polling timeout in seconds (default: 3)
  --queue-url <url>  SQS queue URL (required for SQS driver)
  --help             Show this help message

Examples:
  node worker.js --driver db
  node worker.js --driver sqs --queue-url https://sqs.us-east-1.amazonaws.com/123/test
  node worker.js --no-repeat --timeout 10
  `);
}

async function main(): Promise<void> {
  const config = parseArgs();

  let queue;

  if (config.driver === 'sqs') {
    if (!config.queueUrl) {
      console.error('Error: --queue-url is required for SQS driver');
      process.exit(1);
    }

    if (!config.sqsClient) {
      console.error('Error: SQS client must be provided when using SQS driver');
      console.error('This CLI is a template. You need to provide your own SQS client instance.');
      process.exit(1);
    }

    queue = new SqsQueue(config.sqsClient, config.queueUrl, { name: 'cli-queue', onFailure: 'delete' });
  } else {
    if (!config.dbAdapter) {
      console.error('Error: Database adapter must be provided when using DB driver');
      console.error('This CLI is a template. You need to provide your own database adapter instance.');
      process.exit(1);
    }

    queue = new DbQueue(config.dbAdapter, { name: 'cli-queue' });
  }

  const worker = new Worker(queue, {
    timeout: config.timeout
  });

  console.log(`Starting worker with ${config.driver} driver...`);
  console.log(`Repeat: ${config.repeat}`);
  console.log(`Timeout: ${config.timeout}s`);

  try {
    await worker.start(config.repeat, config.timeout);
  } catch (error) {
    console.error('Worker error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}