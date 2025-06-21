import { Queue } from '@muniter/queue';
import { SQLiteQueueAdapter } from './sqlite-adapter.js';
import { initializeDatabase } from './database.js';
async function addJob() {
    await initializeDatabase();
    const adapter = new SQLiteQueueAdapter();
    const queueName = process.argv[2];
    const jobData = process.argv[3];
    if (!queueName || !jobData) {
        console.error('Usage: npm run add-job <queue-name> <job-data-json>');
        console.error('Example: npm run add-job emails \'{"to":"test@example.com","subject":"Test"}\'');
        process.exit(1);
    }
    try {
        const queue = new Queue(queueName, adapter);
        const data = JSON.parse(jobData);
        const job = await queue.add(data);
        console.log(`Job added successfully!`);
        console.log(`Queue: ${queueName}`);
        console.log(`Job ID: ${job.id}`);
        console.log(`Data:`, job.data);
        process.exit(0);
    }
    catch (error) {
        console.error('Error adding job:', error);
        process.exit(1);
    }
}
addJob();
//# sourceMappingURL=add-job.js.map