import { FileQueue } from '@muniter/queue';
import path from 'path';
import { EmailJob } from './jobs.js';

// Create a file-based queue
const queue = new FileQueue({
  path: path.join(process.cwd(), 'queue-data'),
  dirMode: 0o755,
  fileMode: 0o644
});

async function main() {
  // Initialize the queue (creates directory if needed)
  await queue.init();

  // Push some jobs
  const jobId1 = await queue.push(new EmailJob('user1@example.com', 'Welcome!', 'Thanks for signing up'));
  console.log(`Pushed email job: ${jobId1}`);

  // Push a delayed job (5 seconds delay)
  const jobId2 = await queue.delay(5).push(new EmailJob('user2@example.com', 'Reminder', 'Don\'t forget to verify your email'));
  console.log(`Pushed delayed email job: ${jobId2}`);

  // Push a high priority job with custom TTR
  const jobId3 = await queue.ttr(120).push(new EmailJob('admin@example.com', 'Urgent', 'System alert'));
  console.log(`Pushed high priority job: ${jobId3}`);

  // Check job status
  console.log(`\nJob ${jobId1} status: ${await queue.status(jobId1)}`);
  console.log(`Job ${jobId2} status: ${await queue.status(jobId2)}`);
  console.log(`Job ${jobId3} status: ${await queue.status(jobId3)}`);

  // Setup event listeners
  queue.on('beforeExec', (event) => {
    console.log(`\nStarting job ${event.id}...`);
  });

  queue.on('afterExec', (event) => {
    console.log(`Completed job ${event.id}`);
  });

  queue.on('afterError', (event) => {
    console.error(`Job ${event.id} failed:`, event.error);
  });

  // Run the worker (process jobs)
  console.log('\nStarting worker...');
  await queue.run(false); // Run once then exit
}

main().catch(console.error);