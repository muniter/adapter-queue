import { DbQueue } from "@muniter/queue";
import { SQLiteDatabaseAdapter } from "./sqlite-adapter.js";

export interface GeneralJobs {
    'process-image': { url: string; width: number; height: number };
    'generate-report': { type: string; period: string };
}


export const generalQueue = new DbQueue<GeneralJobs>(new SQLiteDatabaseAdapter());

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
})

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