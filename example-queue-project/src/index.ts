import { DbQueue, FileQueue } from '@muniter/queue';
import { SQLiteDatabaseAdapter } from './sqlite-adapter.js';
import { initializeDatabase } from './database.js';

// Define job types for both queues
interface EmailJobs {
  'welcome-email': { to: string; name: string };
  'notification': { to: string; subject: string; body: string };
}

interface GeneralJobs {
  'process-image': { url: string; width: number; height: number };
  'generate-report': { type: string; period: string };
}

async function main() {
  console.log('Initializing database...');
  await initializeDatabase();

  // Create typed queues
  const generalQueue = new DbQueue<GeneralJobs>(new SQLiteDatabaseAdapter());
  const emailQueue = new FileQueue<EmailJobs>({ path: '.email-queue' });

  // Register job handlers for email queue
  emailQueue.onJob('welcome-email', async (payload) => {
    const { to, name } = payload;
    console.log(`Sending welcome email to ${to} (${name})`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (Math.random() > 0.8) {
      throw new Error('Email service temporarily unavailable');
    }
    
    console.log(`Welcome email sent successfully to ${to}`);
  });

  emailQueue.onJob('notification', async (payload) => {
    const { to, subject, body } = payload;
    console.log(`Sending notification email to ${to}: ${subject}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`Notification sent successfully`);
  });

  // Register job handlers for general queue
  generalQueue.onJob('process-image', async (payload) => {
    const { url, width, height } = payload;
    console.log(`Processing image from ${url} to ${width}x${height}`);
    
    const steps = ['Downloading', 'Resizing', 'Optimizing', 'Saving'];
    for (const step of steps) {
      console.log(`  - ${step}...`);
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    console.log(`Image processed successfully`);
  });

  generalQueue.onJob('generate-report', async (payload) => {
    const { type, period } = payload;
    console.log(`Generating ${type} report for ${period}`);
    
    const steps = ['Fetching data', 'Processing', 'Formatting', 'Saving'];
    for (const step of steps) {
      console.log(`  - ${step}...`);
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    
    console.log(`Report generated: ${type} for ${period}`);
  });

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
  console.log('Queue workers are running. Press Ctrl+C to exit.');

  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
  });

  // Run both queues concurrently
  await Promise.allSettled([
    emailQueue.run(true, 1),
    generalQueue.run(true, 1),
  ]);
}

main().catch(console.error);