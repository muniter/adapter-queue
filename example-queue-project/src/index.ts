import { emailQueue } from './email-queue.js';
import { generalQueue } from './general-queue.js';
import { emailQueue as redisEmailQueue } from './redis-queue.js';
import { parseArgs } from 'util';

async function push() {
  console.log('Adding jobs to demonstrate different queue types...');
  console.log('- SQLite queue (general tasks)');
  console.log('- SQS queue (production email)'); 
  console.log('- Redis queue (high-performance email)');
  console.log('');

  // SQS queue - using new createQueue(queueUrl) API
  const emailJobId1 = await emailQueue.addJob('welcome-email', {
    payload: {
      to: 'user@example.com',
      name: 'John Doe'
    }
  });
  console.log(`[SQS] Welcome email job added with ID: ${emailJobId1}`);

  // Redis queue - using new createRedisQueue(url) API  
  const emailJobId2 = await redisEmailQueue.addJob('notification', {
    payload: {
      to: 'admin@example.com',
      subject: 'Daily Report',
      body: 'Here is your daily report...'
    }
  });
  console.log(`[Redis] Notification job added with ID: ${emailJobId2}`);

  // SQLite queue - using new createQueue('db.sqlite') API
  const imageJobId = await generalQueue.addJob('process-image', {
    payload: {
      url: 'https://example.com/image.jpg',
      width: 800,
      height: 600
    }
  });
  console.log(`[SQLite] Image job added with ID: ${imageJobId}`);

  await generalQueue.addJob('generate-report', {
    payload: {
      type: 'sales',
      period: 'Q4-2023'
    },
    delay: 2
  });
  console.log(`[SQLite] Report job added with 2s delay`);
}

async function run() {
  console.log('Starting queue workers...');
  await Promise.allSettled([
    emailQueue.run(true, 1),
    generalQueue.run(true, 1),
  ])
  console.log('Queue workers are running. Press Ctrl+C to exit.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      push: { type: 'boolean', default: false },
      run: { type: 'boolean', default: false }
    }
  });

  if (args.values.help) {
    console.log('Usage: node index.js [--help]');
    console.log('Options:');
    console.log('  --help, -h     Show this help message');
    console.log('  --push         Push jobs to the queue (default: false)');
    console.log('  --run          Run the queue workers (default: false)');
    process.exit(0);
  }

  if (args.values.push) {
    await push();
  } else if (args.values.run) {
    await run();
  } else {
    console.log('No action specified. Use --push to add jobs or --run to start workers.');
    process.exit(1);
  }
}