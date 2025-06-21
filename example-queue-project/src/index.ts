import { DbQueue, FileQueue } from '@muniter/queue';
import { SQLiteDatabaseAdapter } from './sqlite-adapter.js';
import { initializeDatabase } from './database.js';
import { EmailJob, ImageProcessingJob, ReportGeneratorJob } from './job-processors.js';
import { JobSerializer } from './job-serializer.js';

async function main() {
  console.log('Initializing database...');
  await initializeDatabase();

  const serializer = new JobSerializer();
  const generalQueue = new DbQueue(new SQLiteDatabaseAdapter(), { serializer });
  const emailQueue = new FileQueue({ path: '.email-queue', serializer });

  console.log('Adding some test jobs...');

  const emailJob1 = new EmailJob('user@example.com', 'Welcome!', 'Thanks for signing up!');
  const jobId1 = await emailQueue.push(emailJob1);
  console.log(`Email job added with ID: ${jobId1}`);

  const emailJob2 = new EmailJob('admin@example.com', 'Daily Report', 'Here is your daily report...');
  const jobId2 = await emailQueue.push(emailJob2);
  console.log(`Priority email job added with ID: ${jobId2}`);

  const imageJob = new ImageProcessingJob('https://example.com/image.jpg', { width: 800, height: 600 });
  const jobId3 = await generalQueue.push(imageJob);
  console.log(`Image job added with ID: ${jobId3}`);

  const reportJob = new ReportGeneratorJob('sales', 'Q4-2023');
  const jobId4 = await generalQueue.push(reportJob);
  console.log(`Report job added with ID: ${jobId4}`);

  // Add event listeners
  generalQueue.on('beforeExec', (event) => {
    console.log(`\n[generalQueue][${new Date().toISOString()}] Starting job ${event.id}...`);
  });

  generalQueue.on('afterExec', (event) => {
    console.log(`[generalQueue][${new Date().toISOString()}] Job ${event.id} completed successfully`);
  });

  generalQueue.on('afterError', (event) => {
    console.error(`[generalQueue][${new Date().toISOString()}] Job ${event.id} failed:`, event.error);
  });
  
  emailQueue.on('beforeExec', (event) => {
    console.log(`\n[emailQueue][${new Date().toISOString()}] Starting email job ${event.id}...`);
  });
  
  emailQueue.on('afterExec', (event) => {
    console.log(`[emailQueue][${new Date().toISOString()}] Email job ${event.id} completed successfully`);
  });
  
  emailQueue.on('afterError', (event) => {
    console.error(`[emailQueue][${new Date().toISOString()}] Email job ${event.id} failed:`, event.error);
  });

  console.log('\nStarting worker...');
  console.log('Queue worker is running. Press Ctrl+C to exit.');

  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
  });

  await Promise.allSettled([
    emailQueue.run(true, 1),
    generalQueue.run(true, 1),
  ]);
}

main().catch(console.error);