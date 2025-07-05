# Modular Job System Guide

This guide shows how to define individual jobs and handlers throughout your application and assemble them into a complete queue system.

## 🎯 The Problem We're Solving

You want to:
- Define jobs and handlers anywhere in your application
- Have full type safety without access to the complete job map
- Assemble everything in one place for queue registration

## 🚀 Solution: Modular Job System

### Method 1: Using `defineJob` Utility (Recommended)

The easiest way to define jobs with automatic type inference:

```typescript
// jobs/email/welcome-email.ts
import { defineJob } from 'adapter-queue';

export const welcomeEmailJob = defineJob('welcome-email', async (args, queue) => {
  const { id, payload } = args;
  // TypeScript automatically infers payload type from usage
  const { to, name } = payload; // This defines the payload structure
  
  console.log(`Processing welcome email ${id} for ${name} (${to})`);
  await sendWelcomeEmail(to, name);
});
```

```typescript
// jobs/email/notification.ts
import { defineJob } from 'adapter-queue';

export const notificationJob = defineJob('notification', async (args, queue) => {
  const { payload } = args;
  const { to, subject, body } = payload; // Payload shape inferred from usage
  
  await sendNotification(to, subject, body);
  
  // Can use queue to trigger other jobs
  await queue.addJob('welcome-email', {
    payload: { to, name: 'New User' }
  });
});
```

```typescript
// jobs/image/process-image.ts
import { defineJob } from 'adapter-queue';

export const processImageJob = defineJob('process-image', async (args) => {
  const { payload } = args;
  const { url, width, height } = payload;
  
  await processImage(url, width, height);
});
```

### Method 2: Using `JobModule` Interface

For more explicit type control:

```typescript
// jobs/email/welcome-email.ts
import type { JobModule, QueueArgs } from 'adapter-queue';

type WelcomeEmailPayload = {
  to: string;
  name: string;
};

export const welcomeEmailJob: JobModule<'welcome-email', WelcomeEmailPayload> = {
  name: 'welcome-email',
  handler: async (args: QueueArgs<WelcomeEmailPayload>, queue) => {
    const { payload } = args;
    await sendWelcomeEmail(payload.to, payload.name);
  }
};
```

### Method 3: Using `QueueArgs` Directly

For standalone handler functions:

```typescript
// handlers/email-handlers.ts
import type { QueueArgs } from 'adapter-queue';

// Define payload type inline
export const welcomeEmailHandler = async (args: QueueArgs<{
  to: string;
  name: string;
}>) => {
  const { payload } = args;
  await sendWelcomeEmail(payload.to, payload.name);
};

// Export as a job module
export const welcomeEmailJob = {
  name: 'welcome-email' as const,
  handler: welcomeEmailHandler
};
```

## 🔧 Assembly and Registration

### Basic Assembly

```typescript
// queue-setup.ts
import { FileQueue, assembleHandlers } from 'adapter-queue';
import { welcomeEmailJob } from './jobs/email/welcome-email.js';
import { notificationJob } from './jobs/email/notification.js';
import { processImageJob } from './jobs/image/process-image.js';

// Collect all job modules
const allJobs = [
  welcomeEmailJob,
  notificationJob,
  processImageJob
] as const;

// Assemble handlers
const handlers = assembleHandlers(allJobs);

// Create queue with inferred types
type MyJobMap = {
  'welcome-email': { to: string; name: string };
  'notification': { to: string; subject: string; body: string };
  'process-image': { url: string; width: number; height: number };
};

const queue = new FileQueue<MyJobMap>({ name: 'my-queue', path: './queue' });

// Register handlers
queue.setHandlers(handlers);
```

### Advanced Assembly with Type Inference

```typescript
// queue-setup.ts
import { FileQueue, createQueueWithModules } from 'adapter-queue';
import { welcomeEmailJob } from './jobs/email/welcome-email.js';
import { notificationJob } from './jobs/email/notification.js';
import { processImageJob } from './jobs/image/process-image.js';

// Assemble with automatic type inference
const { handlers, createQueue } = createQueueWithModules([
  welcomeEmailJob,
  notificationJob,
  processImageJob
]);

// Create queue with inferred types
const baseQueue = new FileQueue({ name: 'my-queue', path: './queue' });
const queue = createQueue(baseQueue);

// Register handlers
queue.setHandlers(handlers);

// Now you can use the queue with full type safety
await queue.addJob('welcome-email', {
  payload: { to: 'user@example.com', name: 'John Doe' }
});
```

## 🏗️ Organizing Your Jobs

### Recommended File Structure

```
src/
├── jobs/
│   ├── email/
│   │   ├── welcome-email.ts
│   │   ├── notification.ts
│   │   └── newsletter.ts
│   ├── image/
│   │   ├── process-image.ts
│   │   └── optimize-image.ts
│   └── reports/
│       ├── daily-report.ts
│       └── analytics.ts
├── queue-setup.ts
└── index.ts
```

### Auto-Discovery Pattern

Create an index file that automatically exports all jobs:

```typescript
// jobs/index.ts
export { welcomeEmailJob } from './email/welcome-email.js';
export { notificationJob } from './email/notification.js';
export { processImageJob } from './image/process-image.js';
// ... other jobs

// Or use dynamic imports for larger applications
export async function getAllJobs() {
  const modules = await Promise.all([
    import('./email/welcome-email.js'),
    import('./email/notification.js'),
    import('./image/process-image.js'),
  ]);
  
  return modules.map(m => Object.values(m)[0]);
}
```

## 🎨 Advanced Patterns

### Conditional Job Loading

```typescript
// queue-setup.ts
import { assembleHandlers } from 'adapter-queue';

const baseJobs = [
  welcomeEmailJob,
  notificationJob,
];

const imageJobs = process.env.ENABLE_IMAGE_PROCESSING ? [
  processImageJob,
  optimizeImageJob,
] : [];

const analyticsJobs = process.env.ENABLE_ANALYTICS ? [
  dailyReportJob,
  analyticsJob,
] : [];

const allJobs = [...baseJobs, ...imageJobs, ...analyticsJobs];
const handlers = assembleHandlers(allJobs);
```

### Job Composition

```typescript
// jobs/composite/user-onboarding.ts
import { defineJob } from 'adapter-queue';

export const userOnboardingJob = defineJob('user-onboarding', async (args, queue) => {
  const { payload } = args;
  const { userId, email, name } = payload;
  
  // Compose multiple jobs
  await queue.addJob('welcome-email', {
    payload: { to: email, name }
  });
  
  await queue.addJob('setup-profile', {
    payload: { userId }
  });
  
  await queue.addJob('send-tutorial', {
    payload: { userId, email }
  });
});
```

### Job Middleware Pattern

```typescript
// jobs/middleware/logged-job.ts
import { defineJob } from 'adapter-queue';

export function withLogging<T extends string, P>(
  name: T,
  handler: (args: import('adapter-queue').QueueArgs<P>, queue: any) => Promise<void>
) {
  return defineJob(name, async (args, queue) => {
    console.log(`[${name}] Starting job ${args.id}`);
    const startTime = Date.now();
    
    try {
      await handler(args, queue);
      console.log(`[${name}] Completed job ${args.id} in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error(`[${name}] Failed job ${args.id}:`, error);
      throw error;
    }
  });
}

// Usage
export const loggedEmailJob = withLogging('logged-email', async (args) => {
  const { payload } = args;
  await sendEmail(payload.to, payload.subject, payload.body);
});
```

## 🔍 Benefits

1. **🏗️ Modular**: Define jobs anywhere in your application
2. **🔒 Type Safe**: Full TypeScript support without needing complete job maps
3. **🧩 Composable**: Easy to combine and organize jobs
4. **🔄 Flexible**: Support for conditional loading and dynamic job discovery
5. **📦 Maintainable**: Clear separation of concerns
6. **🚀 DX**: Excellent developer experience with auto-completion

## 🔄 Migration Strategy

You can migrate gradually:

1. **Start with new jobs**: Use the modular approach for new jobs
2. **Gradually convert**: Move existing jobs to the new pattern
3. **Mixed approach**: Use both patterns during transition
4. **Final assembly**: Combine everything in your queue setup

This modular approach gives you the flexibility to define jobs throughout your application while maintaining full type safety and a clean assembly process! 🎉