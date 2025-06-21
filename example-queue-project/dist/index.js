import { Worker } from '@muniter/queue';
import { SQLiteQueue } from './sqlite-queue.js';
import { initializeDatabase } from './database.js';
import { EmailJob, ImageProcessingJob, ReportGeneratorJob } from './job-processors.js';
async function main() {
    console.log('Initializing database...');
    await initializeDatabase();
    const emailQueue = new SQLiteQueue('emails');
    const imageQueue = new SQLiteQueue('images');
    const reportQueue = new SQLiteQueue('reports');
    console.log('Adding some test jobs...');
    const emailJob1 = new EmailJob('user@example.com', 'Welcome!', 'Thanks for signing up!');
    const jobId1 = await emailQueue.push(emailJob1);
    console.log(`Email job added with ID: ${jobId1}`);
    const emailJob2 = new EmailJob('admin@example.com', 'Daily Report', 'Here is your daily report...');
    const jobId2 = await emailQueue.push(emailJob2, { priority: 10 });
    console.log(`Priority email job added with ID: ${jobId2}`);
    const imageJob = new ImageProcessingJob('https://example.com/image.jpg', { width: 800, height: 600 });
    const jobId3 = await imageQueue.push(imageJob);
    console.log(`Image job added with ID: ${jobId3}`);
    const reportJob = new ReportGeneratorJob('sales', 'Q4-2023');
    const jobId4 = await reportQueue.push(reportJob, { delay: 5 });
    console.log(`Report job added with ID: ${jobId4} (delayed 5 seconds)`);
    console.log('\nStarting workers...');
    const worker1 = new Worker();
    worker1.addQueue(emailQueue);
    worker1.addQueue(imageQueue);
    worker1.addQueue(reportQueue);
    worker1.start();
    console.log('Queue workers are running. Press Ctrl+C to exit.');
    process.on('SIGINT', () => {
        console.log('\nShutting down gracefully...');
        worker1.stop();
        process.exit(0);
    });
}
main().catch(console.error);
//# sourceMappingURL=index.js.map