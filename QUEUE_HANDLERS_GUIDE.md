# Queue Handler Developer Experience Guide

This guide demonstrates how to use the new `QueueArgs` and `QueueHandler` types to define queue handlers anywhere in your application with full type safety.

## New Types Available

### `QueueArgs<T>`
A convenient type alias for the arguments passed to queue handlers. This is equivalent to `JobContext<T>` but provides a more intuitive name.

### `QueueHandler<T>`
A complete handler function type that includes both the job arguments and the queue parameter.

### `JobPayload<TJobMap, K>`
A utility type for extracting the payload type for a specific job from your job map.

## Usage Examples

### 1. Define Job Types

First, define your job types in a centralized location:

```typescript
// types/jobs.ts
export interface EmailJobs {
  'welcome-email': { to: string; name: string };
  'notification': { to: string; subject: string; body: string };
  'newsletter': { subscribers: string[]; template: string };
}

export interface ImageJobs {
  'resize-image': { url: string; width: number; height: number };
  'compress-image': { url: string; quality: number };
}
```

### 2. Method 1: Using `QueueArgs<T>` (Recommended)

The most convenient way to define handlers when you don't need access to the queue:

```typescript
// handlers/email-handlers.ts
import type { QueueArgs, JobPayload } from 'adapter-queue';
import type { EmailJobs } from '../types/jobs.js';

export const welcomeEmailHandler = async (args: QueueArgs<JobPayload<EmailJobs, 'welcome-email'>>) => {
  const { id, payload, meta } = args;
  const { to, name } = payload;
  
  console.log(`Processing welcome email job ${id} for ${name} (${to})`);
  console.log(`Job was created at: ${meta.pushedAt}`);
  
  // Your email sending logic here
  await sendWelcomeEmail(to, name);
  
  console.log(`Welcome email sent successfully to ${to}`);
};

export const notificationHandler = async (args: QueueArgs<JobPayload<EmailJobs, 'notification'>>) => {
  const { payload } = args;
  const { to, subject, body } = payload;
  
  await sendNotificationEmail(to, subject, body);
};
```

### 3. Method 2: Using `QueueHandler<T>` (When you need the queue)

Use this when you need access to the queue instance (e.g., to add follow-up jobs):

```typescript
// handlers/email-handlers.ts
import type { QueueHandler, JobPayload } from 'adapter-queue';
import type { EmailJobs } from '../types/jobs.js';

export const newsletterHandler: QueueHandler<JobPayload<EmailJobs, 'newsletter'>> = async (args, queue) => {
  const { payload } = args;
  const { subscribers, template } = payload;
  
  // Send newsletter to all subscribers
  for (const subscriber of subscribers) {
    await sendNewsletter(subscriber, template);
    
    // Add follow-up welcome email for new subscribers
    await queue.addJob('welcome-email', {
      payload: {
        to: subscriber,
        name: 'New Subscriber'
      }
    });
  }
};
```

### 4. Method 3: Generic Handler Factory

Create a reusable factory for consistent handler creation:

```typescript
// utils/handler-factory.ts
import type { QueueArgs, QueueHandler } from 'adapter-queue';

export const createHandler = <T>(
  handler: (args: QueueArgs<T>) => Promise<void>
): QueueHandler<T> => {
  return async (args, queue) => {
    try {
      await handler(args);
    } catch (error) {
      console.error(`Handler failed for job ${args.id}:`, error);
      throw error;
    }
  };
};

// Usage:
export const customEmailHandler = createHandler<JobPayload<EmailJobs, 'welcome-email'>>(
  async (args) => {
    // TypeScript infers the correct payload type automatically
    const { payload } = args;
    console.log(`Custom handler for ${payload.name} at ${payload.to}`);
  }
);
```

### 5. Advanced: Type-Safe Handler Registration

You can create a type-safe handler registry:

```typescript
// registry/email-registry.ts
import type { JobHandlers } from 'adapter-queue';
import type { EmailJobs } from '../types/jobs.js';
import { welcomeEmailHandler, notificationHandler, newsletterHandler } from '../handlers/email-handlers.js';

// This ensures all job types have handlers and maintains type safety
export const emailHandlers: JobHandlers<EmailJobs> = {
  'welcome-email': welcomeEmailHandler,
  'notification': notificationHandler,
  'newsletter': newsletterHandler
};
```

### 6. Register Handlers in One Place

Finally, register all handlers in a centralized location:

```typescript
// queue-setup.ts
import { emailQueue } from './queues/email-queue.js';
import { emailHandlers } from './registry/email-registry.js';

// Register all handlers
emailQueue.setHandlers(emailHandlers);

// Or register individual handlers
emailQueue.setHandler('welcome-email', welcomeEmailHandler);
```

## Benefits

1. **Type Safety**: Full TypeScript support with intellisense
2. **Modular**: Define handlers anywhere in your application
3. **Consistent**: Standard signature across all handlers
4. **Flexible**: Support for both simple and complex handler patterns
5. **Maintainable**: Clear separation between handler definition and registration

## Migration from Previous Versions

If you're upgrading from a previous version, you can gradually migrate:

```typescript
// Before
emailQueue.setHandlers({
  'welcome-email': async ({ payload }) => {
    // handler logic
  }
});

// After - define handler separately
const welcomeEmailHandler = async (args: QueueArgs<JobPayload<EmailJobs, 'welcome-email'>>) => {
  const { payload } = args;
  // handler logic
};

// Register in centralized location
emailQueue.setHandler('welcome-email', welcomeEmailHandler);
```

This approach provides the nice developer experience you requested while maintaining full type safety!