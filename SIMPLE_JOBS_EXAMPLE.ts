// Simple Job Definition Example
// This demonstrates the exact pattern the user requested
import type { JobDefinition, QueueArgs } from './src/interfaces/job.ts';
import { assembleJobs } from './src/utils/job-assembly.ts';

// =====================================================
// SIMPLE APPROACH: Define jobs exactly as requested
// =====================================================

// Welcome Email Job
const welcomeEmailJob: JobDefinition<{
  to: string;
  name: string;
}> = {
  name: "welcome-email",
  handler: async (args) => {
    // 'args' is fully typed as QueueArgs<{ to: string; name: string }>
    const { id, payload, meta } = args;
    const { to, name } = payload; // TypeScript knows these types!
    
    console.log(`Processing welcome email ${id} for ${name} at ${to}`);
    console.log(`Job created: ${meta.pushedAt}`);
    
    // Your email sending logic here
    await sendWelcomeEmail(to, name);
  }
};

// Notification Job
const notificationJob: JobDefinition<{
  to: string;
  subject: string;
  body: string;
}> = {
  name: "notification",
  handler: async (args, queue) => {
    const { payload } = args;
    const { to, subject, body } = payload; // Fully typed!
    
    console.log(`Sending notification to ${to}: ${subject}`);
    await sendNotification(to, subject, body);
    
    // Can use queue parameter to add follow-up jobs
    if (queue) {
      await queue.addJob("welcome-email", {
        payload: { to, name: "New User" }
      });
    }
  }
};

// Image Processing Job
const processImageJob: JobDefinition<{
  url: string;
  width: number;
  height: number;
}> = {
  name: "process-image",
  handler: async (args) => {
    const { payload } = args;
    const { url, width, height } = payload; // Fully typed!
    
    console.log(`Processing image ${url} to ${width}x${height}`);
    await processImage(url, width, height);
  }
};

// Report Job with Union Types
const reportJob: JobDefinition<{
  type: 'daily' | 'weekly' | 'monthly';
  userId: string;
  filters?: string[];
}> = {
  name: "generate-report",
  handler: async (args) => {
    const { payload } = args;
    const { type, userId, filters = [] } = payload; // Fully typed with optional properties!
    
    console.log(`Generating ${type} report for user ${userId}`);
    if (filters.length > 0) {
      console.log(`Applying filters: ${filters.join(', ')}`);
    }
    
    await generateReport(type, userId, filters);
  }
};

// =====================================================
// ASSEMBLY: Combine all jobs
// =====================================================

const allJobs = [
  welcomeEmailJob,
  notificationJob,
  processImageJob,
  reportJob
] as const;

// Assemble handlers for queue registration
const handlers = assembleJobs(allJobs);

// TypeScript automatically infers the complete job map:
// {
//   'welcome-email': { to: string; name: string };
//   'notification': { to: string; subject: string; body: string };
//   'process-image': { url: string; width: number; height: number };
//   'generate-report': { type: 'daily' | 'weekly' | 'monthly'; userId: string; filters?: string[] };
// }

// =====================================================
// USAGE: How you'd use this in your application
// =====================================================

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

await queue.addJob('generate-report', {
  payload: { type: 'weekly', userId: '123', filters: ['active'] }
});
*/

// =====================================================
// MOCK FUNCTIONS (for demonstration)
// =====================================================

async function sendWelcomeEmail(to: string, name: string) {
  console.log(`📧 Sending welcome email to ${name} at ${to}`);
}

async function sendNotification(to: string, subject: string, body: string) {
  console.log(`🔔 Notification sent to ${to}: ${subject}`);
}

async function processImage(url: string, width: number, height: number) {
  console.log(`🖼️ Processing image ${url} to ${width}x${height}`);
}

async function generateReport(type: string, userId: string, filters: string[]) {
  console.log(`📊 Generated ${type} report for user ${userId}`);
}

// =====================================================
// EXPORT FOR DEMONSTRATION
// =====================================================

export {
  welcomeEmailJob,
  notificationJob,
  processImageJob,
  reportJob,
  allJobs,
  handlers
};

// =====================================================
// TYPE SAFETY DEMONSTRATIONS
// =====================================================

// These would cause TypeScript errors:

// ❌ Missing required properties
// const badJob: JobDefinition<{ to: string; name: string }> = {
//   name: "bad-job",
//   handler: async (args) => {
//     const { payload } = args;
//     const { to } = payload; // ❌ 'name' property is missing
//   }
// };

// ❌ Wrong property types
// const anotherBadJob: JobDefinition<{ count: number }> = {
//   name: "another-bad-job",
//   handler: async (args) => {
//     const { payload } = args;
//     const { count } = payload;
//     console.log(count.toUpperCase()); // ❌ count is number, not string
//   }
// };

// ✅ This works perfectly:
const goodJob: JobDefinition<{ message: string; priority: number }> = {
  name: "good-job",
  handler: async (args) => {
    const { payload } = args;
    const { message, priority } = payload; // ✅ Fully typed!
    console.log(`Message: ${message}, Priority: ${priority}`);
  }
};