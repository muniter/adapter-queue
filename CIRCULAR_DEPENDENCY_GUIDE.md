# Circular Dependency Solutions Guide

This guide addresses the circular dependency problem when you need queue access within job handlers and shows you **5 different patterns** to solve it cleanly.

## 🎯 The Problem

**Scenario:** You want to define jobs and services in the same file, where services need queue access.

**Current Issue:**
```
job-file.ts → imports queue from queue-setup.ts
queue-setup.ts → imports job definitions from job-file.ts
❌ CIRCULAR DEPENDENCY!
```

## 🚀 Solutions Overview

| Pattern | Complexity | Type Safety | Best For |
|---------|------------|-------------|----------|
| **1. Global Registry** | ⭐ Simple | ✅ Full | Most use cases |
| **2. Enhanced Context** | ⭐⭐ Medium | ✅ Full | Clean separation |
| **3. Factory Pattern** | ⭐⭐ Medium | ✅ Full | Advanced control |
| **4. Service Locator** | ⭐⭐⭐ Complex | ✅ Full | Large applications |
| **5. Auto-Registry** | ⭐ Simple | ✅ Full | One-liner setup |

---

## 🔥 **Pattern 1: Global Queue Registry** (Recommended)

**✅ Simplest solution with no downsides**

### Definition
```typescript
// jobs/email-service.ts
import type { JobDefinition } from 'adapter-queue';
import { getQueue } from 'adapter-queue';

export const welcomeEmailJob: JobDefinition<{
  to: string;
  name: string;
}> = {
  name: "welcome-email",
  handler: async (args) => {
    const { payload } = args;
    
    // Service logic
    await emailService.sendWelcome(payload.to, payload.name);
    
    // Queue access - no circular dependency!
    const queue = getQueue();
    await queue.addJob("follow-up-email", {
      payload: { to: payload.to, days: 7 }
    });
  }
};

// Your service in the same file
export class EmailService {
  async sendBulkEmails(emails: string[]) {
    const queue = getQueue(); // Safe to use here too!
    
    for (const email of emails) {
      await queue.addJob("welcome-email", {
        payload: { to: email, name: "User" }
      });
    }
  }
}
```

### Setup
```typescript
// queue-setup.ts
import { FileQueue, assembleJobs, setQueue } from 'adapter-queue';
import { welcomeEmailJob } from './jobs/email-service.js';

const queue = new FileQueue({ name: 'my-queue', path: './queue' });
const handlers = assembleJobs([welcomeEmailJob]);

queue.setHandlers(handlers);
setQueue(queue); // Register globally

export { queue };
```

### Benefits
- ✅ **Simplest to implement**
- ✅ **No circular dependencies** 
- ✅ **Works with existing job definitions**
- ✅ **Services can use queue anywhere**

---

## 🎨 **Pattern 2: Enhanced Context with Queue Methods**

**✅ Clean separation, queue methods in job context**

### Definition
```typescript
// jobs/notification-service.ts
import type { JobDefinitionWithQueue } from 'adapter-queue';

export const notificationJob: JobDefinitionWithQueue<{
  to: string;
  subject: string;
  body: string;
}> = {
  name: "notification",
  handler: async (args) => {
    const { payload, queue } = args; // Queue methods in context!
    
    // Service logic
    await notificationService.send(payload.to, payload.subject, payload.body);
    
    // Queue methods available directly
    await queue.addJob("analytics-track", {
      payload: { event: "notification_sent", userId: payload.to }
    });
  }
};

export class NotificationService {
  async send(to: string, subject: string, body: string) {
    // Implementation here
  }
}
```

### Setup
```typescript
// queue-setup.ts
import { assembleJobsWithQueue } from 'adapter-queue';
import { notificationJob } from './jobs/notification-service.js';

const queue = new FileQueue({ name: 'my-queue', path: './queue' });
const handlers = assembleJobsWithQueue([notificationJob], queue);

queue.setHandlers(handlers);
```

### Benefits
- ✅ **No global state**
- ✅ **Queue methods strongly typed in context**
- ✅ **Clear dependency injection**

---

## ⚙️ **Pattern 3: Factory Pattern**

**✅ Advanced control, queue injected via factory**

### Definition
```typescript
// jobs/image-service.ts
import type { JobFactory } from 'adapter-queue';

export const imageJobFactory: JobFactory<{
  url: string;
  width: number;
  height: number;
}> = {
  name: "process-image",
  factory: (queue) => async (args) => {
    const { payload } = args;
    
    // Service logic
    await imageService.process(payload.url, payload.width, payload.height);
    
    // Queue provided by factory
    await queue.addJob("image-cleanup", {
      payload: { originalUrl: payload.url }
    });
  }
};

export class ImageService {
  async process(url: string, width: number, height: number) {
    // Implementation here
  }
}
```

### Setup
```typescript
// queue-setup.ts
import { assembleJobFactories } from 'adapter-queue';
import { imageJobFactory } from './jobs/image-service.js';

const queue = new FileQueue({ name: 'my-queue', path: './queue' });
const handlers = assembleJobFactories([imageJobFactory], queue);

queue.setHandlers(handlers);
```

### Benefits
- ✅ **Explicit dependency injection**
- ✅ **Very testable**
- ✅ **No global state**

---

## 🏢 **Pattern 4: Service Locator Pattern**

**✅ Large applications, lazy queue access**

### Definition
```typescript
// jobs/report-service.ts
import type { JobDefinitionWithLocator } from 'adapter-queue';

export const reportJob: JobDefinitionWithLocator<{
  type: 'daily' | 'weekly' | 'monthly';
  userId: string;
}> = {
  name: "generate-report",
  handler: async (args, getQueue) => {
    const { payload } = args;
    
    // Service logic
    const report = await reportService.generate(payload.type, payload.userId);
    
    // Get queue when needed
    const queue = getQueue();
    await queue.addJob("email-report", {
      payload: { userId: payload.userId, reportData: report }
    });
  }
};

export class ReportService {
  async generate(type: string, userId: string) {
    return { type, userId, data: "report-data" };
  }
}
```

### Setup
```typescript
// queue-setup.ts
import { assembleJobsWithLocator } from 'adapter-queue';
import { reportJob } from './jobs/report-service.js';

const handlers = assembleJobsWithLocator([reportJob]);
queue.setHandlers(handlers);
```

### Benefits
- ✅ **Lazy queue access**
- ✅ **Good for complex applications**
- ✅ **Flexible queue resolution**

---

## 🚀 **Pattern 5: Auto-Registry Setup** (Ultimate)

**✅ One-liner setup, handles everything automatically**

### Definition
```typescript
// jobs/user-service.ts
import type { JobDefinition } from 'adapter-queue';
import { getQueue } from 'adapter-queue';

export const userOnboardingJob: JobDefinition<{
  userId: string;
  email: string;
  name: string;
}> = {
  name: "user-onboarding",
  handler: async (args) => {
    const { payload } = args;
    
    // Service logic
    await userService.createProfile(payload.userId);
    
    // Queue access
    const queue = getQueue();
    await queue.addJob("welcome-email", {
      payload: { to: payload.email, name: payload.name }
    });
  }
};

export class UserService {
  async createProfile(userId: string) {
    // Implementation
    
    // Can use queue here too!
    const queue = getQueue();
    await queue.addJob("setup-analytics", {
      payload: { userId }
    });
  }
}
```

### Setup
```typescript
// main.ts - ONE LINER SETUP!
import { createQueueWithRegistry, FileQueue } from 'adapter-queue';
import { userOnboardingJob } from './jobs/user-service.js';
import { welcomeEmailJob } from './jobs/email-service.js';

const queue = createQueueWithRegistry(
  [userOnboardingJob, welcomeEmailJob],
  () => new FileQueue({ name: 'app-queue', path: './queue' })
);

// Queue is ready, registry is set, jobs can access queue!
await queue.run();
```

### Benefits
- ✅ **One-liner setup**
- ✅ **Automatic registry configuration**
- ✅ **Supports mixed job patterns**
- ✅ **Zero boilerplate**

---

## 🏗️ **Recommended File Structure**

```
src/
├── jobs/
│   ├── email/
│   │   ├── welcome-email.ts      // Job + EmailService class
│   │   ├── notification.ts       // Job + NotificationService class
│   │   └── newsletter.ts         // Job + NewsletterService class
│   ├── user/
│   │   ├── onboarding.ts         // Job + UserService class  
│   │   └── profile.ts            // Job + ProfileService class
│   └── index.ts                  // Export all jobs
├── queue-setup.ts                // Create and configure queue
└── main.ts                       // Start application

Each job file contains:
✅ Job definition with full type safety
✅ Related service class that can use queue
✅ No circular dependencies
✅ Clean, modular code
```

---

## 🎯 **Which Pattern to Choose?**

### **For Most Applications: Pattern 1 (Global Registry)**
```typescript
// Simple, clean, works everywhere
const queue = getQueue();
await queue.addJob("my-job", { payload: data });
```

### **For Clean Architecture: Pattern 2 (Enhanced Context)**
```typescript
// Queue methods in job context, no globals
const { queue } = args;
await queue.addJob("my-job", { payload: data });
```

### **For One-Liner Setup: Pattern 5 (Auto-Registry)**
```typescript
// Handles everything automatically
const queue = createQueueWithRegistry(allJobs, () => new FileQueue(...));
```

---

## 🔧 **Migration from Circular Dependencies**

### Before (Circular Dependency)
```typescript
// ❌ job-file.ts
import { queue } from './queue-setup'; // Circular!
export const job = { handler: () => queue.addJob(...) };

// ❌ queue-setup.ts  
import { job } from './job-file'; // Circular!
queue.setHandlers({ job });
```

### After (No Circular Dependencies)
```typescript
// ✅ job-file.ts
import { getQueue } from 'adapter-queue';
export const job = { handler: () => getQueue().addJob(...) };

// ✅ queue-setup.ts
import { job } from './job-file'; // No circular dependency!
setQueue(queue); // Register globally
queue.setHandlers({ job });
```

---

## 🎉 **Summary**

All patterns solve circular dependencies while maintaining:
- ✅ **Full TypeScript type safety**
- ✅ **Clean, modular code organization**  
- ✅ **Ability to define jobs and services together**
- ✅ **Zero runtime overhead**
- ✅ **Easy testing and maintenance**

**Recommendation:** Start with **Pattern 1 (Global Registry)** for its simplicity, then consider other patterns if you need specific architectural constraints.