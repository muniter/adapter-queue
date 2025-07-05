# Simple Job Definition Guide

This guide shows the **simple and clean** approach to defining type-safe job handlers throughout your application.

## 🎯 The Simple Pattern

Define jobs exactly as you requested:

```typescript
const welcomeEmailJob: JobDefinition<{
  to: string;
  name: string;
}> = {
  name: "welcome-email",
  handler: async (args) => {
    // 'args' is completely type-safe!
    const { payload } = args;
    const { to, name } = payload; // TypeScript knows these types
    
    await sendWelcomeEmail(to, name);
  }
};
```

## 🚀 Complete Example

### Step 1: Define Jobs Anywhere

```typescript
// jobs/email-jobs.ts
import type { JobDefinition } from 'adapter-queue';

export const welcomeEmailJob: JobDefinition<{
  to: string;
  name: string;
}> = {
  name: "welcome-email",
  handler: async (args) => {
    const { id, payload, meta } = args;
    const { to, name } = payload; // Fully typed!
    
    console.log(`Processing welcome email ${id} for ${name} at ${to}`);
    await sendWelcomeEmail(to, name);
  }
};

export const notificationJob: JobDefinition<{
  to: string;
  subject: string;
  body: string;
}> = {
  name: "notification",
  handler: async (args, queue) => {
    const { payload } = args;
    const { to, subject, body } = payload; // Fully typed!
    
    await sendNotification(to, subject, body);
    
    // Can use queue parameter too
    if (queue) {
      await queue.addJob("welcome-email", {
        payload: { to, name: "Follow-up User" }
      });
    }
  }
};
```

```typescript
// jobs/image-jobs.ts
import type { JobDefinition } from 'adapter-queue';

export const processImageJob: JobDefinition<{
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
```

```typescript
// jobs/report-jobs.ts
import type { JobDefinition } from 'adapter-queue';

export const reportJob: JobDefinition<{
  type: 'daily' | 'weekly' | 'monthly';
  userId: string;
  filters?: string[];
}> = {
  name: "generate-report",
  handler: async (args) => {
    const { payload } = args;
    const { type, userId, filters = [] } = payload; // Fully typed with optional properties!
    
    console.log(`Generating ${type} report for user ${userId}`);
    await generateReport(type, userId, filters);
  }
};
```

### Step 2: Assemble in One Place

```typescript
// queue-setup.ts
import { FileQueue, assembleJobs } from 'adapter-queue';
import { welcomeEmailJob, notificationJob } from './jobs/email-jobs.js';
import { processImageJob } from './jobs/image-jobs.js';
import { reportJob } from './jobs/report-jobs.js';

// Collect all jobs
const allJobs = [
  welcomeEmailJob,
  notificationJob,
  processImageJob,
  reportJob
] as const;

// Assemble handlers
const handlers = assembleJobs(allJobs);

// Create and configure queue
const queue = new FileQueue({ name: 'my-queue', path: './queue' });
queue.setHandlers(handlers);

// Export for use
export { queue };
```

### Step 3: Use With Full Type Safety

```typescript
// app.ts
import { queue } from './queue-setup.js';

// TypeScript knows about all your jobs and their payload types!
await queue.addJob('welcome-email', {
  payload: { to: 'user@example.com', name: 'John Doe' }
});

await queue.addJob('process-image', {
  payload: { url: 'https://example.com/image.jpg', width: 800, height: 600 }
});

await queue.addJob('generate-report', {
  payload: { type: 'weekly', userId: '123', filters: ['active'] }
});

// Start processing
await queue.run();
```

## 💡 What You Get

### ✅ **Complete Type Safety**
- `args` parameter is fully typed
- `payload` properties are known to TypeScript
- Optional properties work correctly
- Union types work perfectly

### ✅ **Zero Boilerplate**
- Just define the `JobDefinition<TPayload>` type
- No complex generics or utility functions needed
- Clean, readable code

### ✅ **Modular Organization**
- Define jobs anywhere in your application
- No need to access the global job map
- Easy to organize by feature/domain

### ✅ **Automatic Assembly**
- TypeScript automatically infers the complete job map
- Full type safety when adding jobs to the queue
- Compile-time validation

## 🎨 Advanced Examples

### Complex Payload Types

```typescript
const complexJob: JobDefinition<{
  user: {
    id: string;
    email: string;
    preferences: {
      notifications: boolean;
      theme: 'light' | 'dark';
    };
  };
  action: 'create' | 'update' | 'delete';
  metadata?: Record<string, any>;
}> = {
  name: "user-action",
  handler: async (args) => {
    const { payload } = args;
    const { user, action, metadata } = payload; // All fully typed!
    
    console.log(`${action} user ${user.id} with theme ${user.preferences.theme}`);
    if (metadata) {
      console.log('Metadata:', metadata);
    }
  }
};
```

### Conditional Logic

```typescript
const conditionalJob: JobDefinition<{
  type: 'email' | 'sms';
  recipient: string;
  message: string;
  priority?: 'high' | 'normal' | 'low';
}> = {
  name: "send-message",
  handler: async (args) => {
    const { payload } = args;
    const { type, recipient, message, priority = 'normal' } = payload;
    
    if (type === 'email') {
      await sendEmail(recipient, message, priority);
    } else {
      await sendSMS(recipient, message, priority);
    }
  }
};
```

## 📁 Recommended File Structure

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
└── app.ts
```

## 🔧 Available Functions

- `assembleJobs(jobs)` - Combines job definitions into handlers
- `createQueueSetup(jobs)` - Advanced setup with type helpers
- `defineJob(job)` - Optional helper for better type inference

## 🎉 That's It!

This simple pattern gives you:
- **Complete type safety** without complexity
- **Modular job definitions** throughout your app
- **Clean, readable code** that's easy to maintain
- **Automatic type inference** for your entire job system

Just define your jobs with `JobDefinition<TPayload>`, assemble them with `assembleJobs()`, and enjoy fully typed queue operations! 🚀