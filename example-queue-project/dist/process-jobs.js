import { Queue } from '@muniter/queue';
import { SQLiteQueueAdapter } from './sqlite-adapter.js';
import { initializeDatabase } from './database.js';
import { emailProcessor, imageProcessor, reportGenerator } from './job-processors.js';
const processors = {
    emails: emailProcessor,
    images: imageProcessor,
    reports: reportGenerator
};
async function processJobs() {
    await initializeDatabase();
    const adapter = new SQLiteQueueAdapter();
    const queueName = process.argv[2];
    if (!queueName) {
        console.error('Usage: npm run process-jobs <queue-name>');
        console.error('Available queues: emails, images, reports');
        process.exit(1);
    }
    const processor = processors[queueName];
    if (!processor) {
        console.error(`No processor found for queue: ${queueName}`);
        console.error('Available queues: emails, images, reports');
        process.exit(1);
    }
    const queue = new Queue(queueName, adapter);
    queue.on('job:start', (job) => {
        console.log(`\n[${new Date().toISOString()}] Starting job ${job.id}`);
    });
    queue.on('job:success', (job, result) => {
        console.log(`[${new Date().toISOString()}] Job ${job.id} completed successfully`);
        if (result)
            console.log('Result:', result);
    });
    queue.on('job:failure', (job, error) => {
        console.error(`[${new Date().toISOString()}] Job ${job.id} failed:`, error.message);
    });
    queue.on('job:retry', (job, error) => {
        console.warn(`[${new Date().toISOString()}] Job ${job.id} will be retried. Attempt ${job.attempts + 1}/${job.maxAttempts}`);
    });
    console.log(`Processing jobs from queue: ${queueName}`);
    console.log('Press Ctrl+C to stop\n');
    queue.process(processor, { concurrency: 2 });
    setInterval(async () => {
        const stats = await queue.getStats();
        console.log(`\n[Stats] Pending: ${stats.pending}, Processing: ${stats.processing}, Completed: ${stats.completed}, Failed: ${stats.failed}`);
    }, 10000);
}
processJobs().catch(console.error);
//# sourceMappingURL=process-jobs.js.map