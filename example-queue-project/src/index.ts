import { DbQueue } from '@muniter/queue';
import { SQLiteDatabaseAdapter } from './sqlite-adapter.js';
import { initializeDatabase } from './database.js';
import { EmailJob, ImageProcessingJob, ReportGeneratorJob } from './job-processors.js';

async function main() {
  console.log('Initializing database...');
  await initializeDatabase();

  const adapter = new SQLiteDatabaseAdapter();
  const queue = new DbQueue(adapter);

  console.log('Adding some test jobs...');

  const emailJob1 = new EmailJob('user@example.com', 'Welcome!', 'Thanks for signing up!');
  const jobId1 = await queue.push(emailJob1);
  console.log(`Email job added with ID: ${jobId1}`);

  const emailJob2 = new EmailJob('admin@example.com', 'Daily Report', 'Here is your daily report...');
  const jobId2 = await queue.push(emailJob2);
  console.log(`Priority email job added with ID: ${jobId2}`);

  const imageJob = new ImageProcessingJob('https://example.com/image.jpg', { width: 800, height: 600 });
  const jobId3 = await queue.push(imageJob);
  console.log(`Image job added with ID: ${jobId3}`);

  const reportJob = new ReportGeneratorJob('sales', 'Q4-2023');
  const jobId4 = await queue.push(reportJob);
  console.log(`Report job added with ID: ${jobId4}`);

  console.log('\nStarting worker...');
  console.log('Queue worker is running. Press Ctrl+C to exit.');

  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
  });

  await queue.run(true, 30);
}

main().catch(console.error);