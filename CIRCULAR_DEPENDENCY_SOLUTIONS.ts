// Circular Dependency Solutions - Complete Examples
// This file demonstrates all patterns to avoid circular dependencies
// when you need queue access within job handlers

import type { 
  JobDefinition, 
  JobDefinitionWithQueue, 
  JobFactory, 
  JobDefinitionWithLocator 
} from './src/interfaces/job.ts';
import { 
  getQueue, 
  createQueueWithRegistry,
  assembleJobs,
  assembleJobsWithQueue,
  assembleJobFactories,
  assembleJobsWithLocator,
  assembleJobsUniversal,
  setQueue
} from './src/index.ts';
import { FileQueue } from './src/drivers/file.ts';

// =======================================================
// PATTERN 1: Global Queue Registry (Simplest)
// =======================================================

// Define jobs normally, access queue via global registry
const emailJob: JobDefinition<{
  to: string;
  name: string;
}> = {
  name: "welcome-email",
  handler: async (args) => {
    const { payload } = args;
    const { to, name } = payload;
    
    console.log(`Sending welcome email to ${name} at ${to}`);
    
    // Access queue from global registry - no circular dependency!
    const queue = getQueue();
    await queue.addJob("follow-up-email", {
      payload: { to, name, days: 7 }
    });
  }
};

// =======================================================
// PATTERN 2: Enhanced Context with Queue Methods
// =======================================================

const notificationJob: JobDefinitionWithQueue<{
  to: string;
  subject: string;
  body: string;
}> = {
  name: "notification",
  handler: async (args) => {
    const { payload, queue } = args; // Queue methods available in args!
    const { to, subject, body } = payload;
    
    console.log(`Sending notification to ${to}: ${subject}`);
    await sendNotification(to, subject, body);
    
    // Use queue methods directly from context
    await queue.addJob("analytics-track", {
      payload: { event: "notification_sent", userId: to }
    });
  }
};

// =======================================================
// PATTERN 3: Factory Pattern
// =======================================================

const imageJobFactory: JobFactory<{
  url: string;
  width: number;
  height: number;
}> = {
  name: "process-image",
  factory: (queue) => async (args) => {
    const { payload } = args;
    const { url, width, height } = payload;
    
    console.log(`Processing image ${url} to ${width}x${height}`);
    await processImage(url, width, height);
    
    // Queue is provided by factory - no circular dependency!
    await queue.addJob("image-cleanup", {
      payload: { originalUrl: url, processedUrl: `${url}_processed` }
    });
  }
};

// =======================================================
// PATTERN 4: Service Locator Pattern
// =======================================================

const reportJob: JobDefinitionWithLocator<{
  type: 'daily' | 'weekly' | 'monthly';
  userId: string;
}> = {
  name: "generate-report",
  handler: async (args, getQueue) => {
    const { payload } = args;
    const { type, userId } = payload;
    
    console.log(`Generating ${type} report for user ${userId}`);
    await generateReport(type, userId);
    
    // Get queue when needed via locator function
    const queue = getQueue();
    await queue.addJob("email-report", {
      payload: { 
        to: `user-${userId}@example.com`,
        reportType: type,
        reportData: "report-data-here"
      }
    });
  }
};

// =======================================================
// PATTERN 5: Complete Circular-Dependency-Free Setup
// =======================================================

// This pattern completely eliminates circular dependencies
// by creating the queue and registering it all in one place

export function createApplicationQueue() {
  // All job definitions are imported here, no circular dependencies
  const allJobs = [
    emailJob,           // Uses global registry
    notificationJob,    // Uses enhanced context
    imageJobFactory,    // Uses factory pattern
    reportJob          // Uses service locator
  ] as const;

  // Create queue and auto-register it - one-liner setup!
  const queue = createQueueWithRegistry(
    allJobs,
    () => new FileQueue({ 
      name: 'app-queue', 
      path: './queue-data' 
    })
  );

  return queue;
}

// =======================================================
// PATTERN 6: Manual Assembly (More Control)
// =======================================================

export function createApplicationQueueManual() {
  // Create queue first
  const queue = new FileQueue({ 
    name: 'app-queue', 
    path: './queue-data' 
  });

  // Assemble different job types with their appropriate assemblers
  const handlers = {
    // Regular jobs (no queue access needed)
    ...assembleJobs([emailJob]),
    
    // Jobs with enhanced queue context
    ...assembleJobsWithQueue([notificationJob], queue),
    
    // Factory-based jobs
    ...assembleJobFactories([imageJobFactory], queue),
    
    // Service locator jobs
    ...assembleJobsWithLocator([reportJob])
  };

  // Or use the universal assembler (automatically detects patterns)
  // const handlers = assembleJobsUniversal([
  //   emailJob, notificationJob, imageJobFactory, reportJob
  // ], queue);

  queue.setHandlers(handlers);
  
  // Register queue for global access
  setQueue(queue);

  return queue;
}

// =======================================================
// USAGE IN YOUR APPLICATION
// =======================================================

/*
// main.ts - No circular dependencies!
import { createApplicationQueue } from './circular-dependency-solutions';

async function main() {
  // Create queue with all jobs configured
  const queue = createApplicationQueue();
  
  // Add some jobs
  await queue.addJob('welcome-email', {
    payload: { to: 'user@example.com', name: 'John Doe' }
  });
  
  await queue.addJob('process-image', {
    payload: { url: 'https://example.com/image.jpg', width: 800, height: 600 }
  });
  
  // Start processing
  await queue.run();
}

main().catch(console.error);
*/

// =======================================================
// MODULAR APPROACH - Define Jobs Anywhere
// =======================================================

/*
File structure that avoids circular dependencies:

src/
├── jobs/
│   ├── email/
│   │   ├── welcome-email.ts      // Uses getQueue() from registry
│   │   ├── notification.ts       // Uses JobDefinitionWithQueue
│   │   └── newsletter.ts         // Uses JobFactory
│   ├── image/
│   │   ├── process-image.ts      // Uses JobDefinitionWithLocator  
│   │   └── optimize-image.ts     // Uses regular JobDefinition
│   └── index.ts                  // Exports all jobs
├── services/
│   ├── email-service.ts          // Can import getQueue() safely
│   ├── image-service.ts          // Can import getQueue() safely
│   └── report-service.ts         // Can import getQueue() safely  
├── queue-setup.ts                // Imports all jobs, creates queue
└── main.ts                       // Imports queue-setup, starts app

Each file can:
- Define jobs with queue access (no circular imports)
- Define services that use the queue (no circular imports)  
- Import and use queue methods safely
*/

// =======================================================
// MOCK FUNCTIONS FOR DEMONSTRATION
// =======================================================

async function sendNotification(to: string, subject: string, body: string) {
  console.log(`📧 Notification sent to ${to}: ${subject}`);
}

async function processImage(url: string, width: number, height: number) {
  console.log(`🖼️ Processed image ${url} to ${width}x${height}`);
}

async function generateReport(type: string, userId: string) {
  console.log(`📊 Generated ${type} report for user ${userId}`);
}

// =======================================================
// EXPORT ALL PATTERNS FOR TESTING
// =======================================================

export {
  emailJob,
  notificationJob,
  imageJobFactory,
  reportJob
};