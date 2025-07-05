// This file demonstrates the modular job system
// Import types directly from source to avoid module resolution issues
import type { QueueArgs, JobModule } from './src/interfaces/job.ts';
import { defineJobWithPayload, assembleHandlers } from './src/utils/job-assembly.ts';

// ===========================================
// METHOD 1: Using defineJobWithPayload (Recommended)
// ===========================================

// Define individual jobs anywhere in your application with explicit types
export const welcomeEmailJob = defineJobWithPayload('welcome-email', async (args: QueueArgs<{
  to: string;
  name: string;
}>, queue) => {
  const { id, payload } = args;
  const { to, name } = payload; // Fully typed!
  
  console.log(`Processing welcome email ${id} for ${name} (${to})`);
  // Your email logic here...
});

export const notificationJob = defineJobWithPayload('notification', async (args: QueueArgs<{
  to: string;
  subject: string;
  body: string;
}>, queue) => {
  const { payload } = args;
  const { to, subject, body } = payload; // Fully typed!
  
  console.log(`Sending notification to ${to}: ${subject}`);
  
  // Can use queue to trigger other jobs
  await queue.addJob('welcome-email', {
    payload: { to, name: 'Follow-up User' }
  });
});

export const processImageJob = defineJobWithPayload('process-image', async (args: QueueArgs<{
  url: string;
  width: number;
  height: number;
}>) => {
  const { payload } = args;
  const { url, width, height } = payload; // Fully typed!
  
  console.log(`Processing image ${url} to ${width}x${height}`);
});

// ===========================================
// METHOD 2: Using JobModule interface
// ===========================================

type ReportPayload = {
  type: 'daily' | 'weekly' | 'monthly';
  userId: string;
};

export const reportJob: JobModule<'generate-report', ReportPayload> = {
  name: 'generate-report',
  handler: async (args: QueueArgs<ReportPayload>) => {
    const { payload } = args;
    console.log(`Generating ${payload.type} report for user ${payload.userId}`);
  }
};

// ===========================================
// METHOD 3: Using QueueArgs directly
// ===========================================

export const newsletterHandler = async (args: QueueArgs<{
  subscribers: string[];
  template: string;
}>) => {
  const { payload } = args;
  console.log(`Sending newsletter to ${payload.subscribers.length} subscribers`);
};

export const newsletterJob = {
  name: 'newsletter' as const,
  handler: newsletterHandler
};

// ===========================================
// ASSEMBLY: Combine all jobs
// ===========================================

const allJobs = [
  welcomeEmailJob,
  notificationJob,
  processImageJob,
  reportJob,
  newsletterJob
] as const;

// Assemble handlers for queue registration
export const handlers = assembleHandlers(allJobs);

// TypeScript automatically infers the complete job map:
// {
//   'welcome-email': { to: string; name: string };
//   'notification': { to: string; subject: string; body: string };
//   'process-image': { url: string; width: number; height: number };
//   'generate-report': { type: 'daily' | 'weekly' | 'monthly'; userId: string };
//   'newsletter': { subscribers: string[]; template: string };
// }

// ===========================================
// USAGE: How you'd use this in your app
// ===========================================

/*
// In your queue setup file:
import { FileQueue } from 'adapter-queue';
import { handlers } from './all-jobs';

const queue = new FileQueue({ name: 'my-queue', path: './queue' });
queue.setHandlers(handlers);

// Now you can use the queue with full type safety:
await queue.addJob('welcome-email', {
  payload: { to: 'user@example.com', name: 'John Doe' }
});

await queue.addJob('process-image', {
  payload: { url: 'https://example.com/image.jpg', width: 800, height: 600 }
});
*/

// ===========================================
// DEMONSTRATION: Type safety in action
// ===========================================

// This would cause TypeScript errors:
// queue.addJob('welcome-email', {
//   payload: { to: 'user@example.com' } // ❌ Missing 'name' property
// });

// queue.addJob('non-existent-job', { // ❌ Job doesn't exist
//   payload: { whatever: 'data' }
// });

export default { allJobs, handlers };