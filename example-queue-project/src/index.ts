import { initializeDatabase, run } from './database.js';
import { emailQueue } from './email-queue.js';
import { generalQueue } from './general-queue.js';
import { parseArgs } from 'util';

async function push() {
  console.log('Initializing database...');
  await initializeDatabase();

  console.log('Adding some test jobs...');
  // Add jobs using the new type-safe API
  const emailJobId1 = await emailQueue.addJob('welcome-email', {
    payload: {
      to: 'user@example.com',
      name: 'John Doe'
    }
  });
  console.log(`Welcome email job added with ID: ${emailJobId1}`);

  const emailJobId2 = await emailQueue.addJob('notification', {
    payload: {
      to: 'admin@example.com',
      subject: 'Daily Report',
      body: 'Here is your daily report...'
    }
    // Note: FileQueue doesn't support priority - would cause TypeScript error
    // For demo purposes, we removed the priority option
  });
  console.log(`Priority notification job added with ID: ${emailJobId2}`);

  const imageJobId = await generalQueue.addJob('process-image', {
    payload: {
      url: 'https://example.com/image.jpg',
      width: 800,
      height: 600
    }
  });
  console.log(`Image job added with ID: ${imageJobId}`);

  const reportJobId = await generalQueue.addJob('generate-report', {
    payload: {
      type: 'sales',
      period: 'Q4-2023'
    },
    delay: 2
  });
  console.log(`Delayed report job added with ID: ${reportJobId}`);

  // Add event listeners for both queues
  generalQueue.on('beforeExec', (event) => {
    console.log(`\n[generalQueue][${new Date().toISOString()}] Starting ${event.name} job ${event.id}...`);
  });

  generalQueue.on('afterExec', (event) => {
    console.log(`[generalQueue][${new Date().toISOString()}] Job ${event.id} (${event.name}) completed successfully`);
  });

  generalQueue.on('afterError', (event) => {
    console.error(`[generalQueue][${new Date().toISOString()}] Job ${event.id} (${event.name}) failed:`, event.error);
  });

  emailQueue.on('beforeExec', (event) => {
    console.log(`\n[emailQueue][${new Date().toISOString()}] Starting ${event.name} job ${event.id}...`);
  });

  emailQueue.on('afterExec', (event) => {
    console.log(`[emailQueue][${new Date().toISOString()}] Email job ${event.id} (${event.name}) completed successfully`);
  });

  emailQueue.on('afterError', (event) => {
    console.error(`[emailQueue][${new Date().toISOString()}] Email job ${event.id} (${event.name}) failed:`, event.error);
  });

  console.log('\nStarting workers...');

  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
  });
}

async function run() {
  console.log('Starting queue workers...');
  await Promise.allSettled([
    emailQueue.run(true),
    generalQueue.run(true)
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