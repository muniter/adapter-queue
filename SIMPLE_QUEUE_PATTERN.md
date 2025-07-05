# Simple Queue Pattern - One File Per Queue

Perfect! This is exactly the clean, simple approach you want. Each queue in its own file with a simple `getQueue()` function.

## 🎯 The Use Case

You have **service files** that contain:
- Job definitions 
- HTTP handler functions that need to enqueue jobs

The **job handlers** already get the queue in their parameters, so they don't need imports.  
The **HTTP handler functions** need to access the queue to enqueue jobs.

## 🚀 Simple Pattern

### Email Queue - `email-queue.ts`
```typescript
import { createQueueFactory, FileQueue, assembleJobs } from 'adapter-queue';

export const getEmailQueue = createQueueFactory(() => {
  const queue = new FileQueue({ 
    name: 'email-queue', 
    path: './email-queue-data' 
  });
  
  // Import jobs at runtime - no circular dependency
  const { emailJobs } = await import('./email-service.js');
  queue.setHandlers(assembleJobs(emailJobs));
  
  return queue;
});
```

### Image Queue - `image-queue.ts`
```typescript
import { createQueueFactory, FileQueue, assembleJobs } from 'adapter-queue';

export const getImageQueue = createQueueFactory(() => {
  const queue = new FileQueue({ 
    name: 'image-queue', 
    path: './image-queue-data' 
  });
  
  const { imageJobs } = await import('./image-service.js');
  queue.setHandlers(assembleJobs(imageJobs));
  
  return queue;
});
```

### Email Service - `email-service.ts`
```typescript
import type { JobDefinition } from 'adapter-queue';
import { getEmailQueue } from './email-queue.js';

// Job definitions (handlers get queue in params)
export const welcomeEmailJob: JobDefinition<{
  to: string;
  name: string;
}> = {
  name: "welcome-email",
  handler: async (args, queue) => {
    const { payload } = args;
    
    await sendWelcomeEmail(payload.to, payload.name);
    
    // Job handler gets queue in params - no import needed!
    await queue.addJob("follow-up-email", {
      payload: { to: payload.to, days: 7 }
    });
  }
};

export const emailJobs = [welcomeEmailJob];

// HTTP handler functions (these need queue access!)
export async function sendWelcomeEmailFromAPI(to: string, name: string) {
  // THIS is where we need the queue - in HTTP handlers!
  const queue = getEmailQueue();
  
  await queue.addJob("welcome-email", {
    payload: { to, name }
  });
  
  return { success: true, message: "Welcome email queued" };
}

export async function sendBulkEmailsFromAPI(recipients: Array<{ to: string; name: string }>) {
  const queue = getEmailQueue(); // No circular dependency!
  
  for (const recipient of recipients) {
    await queue.addJob("welcome-email", {
      payload: recipient
    });
  }
  
  return { 
    success: true, 
    message: `${recipients.length} emails queued` 
  };
}
```

### Express Routes - `routes.ts`
```typescript
import express from 'express';
import { sendWelcomeEmailFromAPI, sendBulkEmailsFromAPI } from './email-service.js';
import { uploadAndProcessImage } from './image-service.js';

const router = express.Router();

// Email routes
router.post('/email/welcome', async (req, res) => {
  const { to, name } = req.body;
  const result = await sendWelcomeEmailFromAPI(to, name);
  res.json(result);
});

router.post('/email/bulk', async (req, res) => {
  const { recipients } = req.body;
  const result = await sendBulkEmailsFromAPI(recipients);
  res.json(result);
});

export { router };
```

## 📁 Clean File Structure

```
src/
├── email-queue.ts         // exports getEmailQueue()
├── image-queue.ts         // exports getImageQueue()  
├── email-service.ts       // jobs + HTTP handler functions
├── image-service.ts       // jobs + HTTP handler functions
├── routes.ts              // Express routes
└── main.ts                // Start queues
```

## 🔧 Dependency Flow (No Circular Dependencies!)

```
✅ email-service.ts → imports getEmailQueue() from email-queue.ts
✅ email-queue.ts → imports emailJobs from email-service.ts (at runtime)
✅ NO CIRCULAR DEPENDENCY because queue creation is deferred!
```

## ✨ Benefits

✅ **Super simple** - each queue in its own file  
✅ **One function per queue** - `getEmailQueue()`, `getImageQueue()`  
✅ **No complex factories** - just memoized functions  
✅ **Job handlers get queue in params** - no imports needed  
✅ **HTTP handlers use getQueue()** - for enqueueing  
✅ **No circular dependencies** - deferred resolution  
✅ **Easy to understand** - straightforward pattern  

## 🚀 Main App

```typescript
// main.ts
import { getEmailQueue } from './email-queue.js';
import { getImageQueue } from './image-queue.js';

async function startApp() {
  // Queues initialize automatically on first use
  const emailQueue = getEmailQueue();
  const imageQueue = getImageQueue();
  
  // Start queue workers
  await Promise.all([
    emailQueue.run(true, 1),
    imageQueue.run(true, 1)
  ]);
  
  console.log('✅ All queues running!');
}

startApp().catch(console.error);
```

## 🎯 Perfect for Your Use Case

This pattern is ideal when you have:
- Service files with both job definitions AND HTTP handler functions
- HTTP handlers that need to enqueue jobs
- Multiple queues (email, image, notifications, etc.)
- Want to avoid circular dependencies
- Prefer simple, clean code over complex factories

Each queue gets its own file with a simple `getQueue()` function. No complexity, no circular dependencies, just clean, memoized queue access! 🎉