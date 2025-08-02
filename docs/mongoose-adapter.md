# Mongoose Adapter for adapter-queue

The Mongoose adapter allows you to use Mongoose models with the adapter-queue system, providing seamless integration with your existing Mongoose-based application. It implements the `DatabaseAdapter` interface directly, offering a native Mongoose experience.

**Key Feature**: No separate worker processes needed - each queue processes its own jobs through the `run()` method.

## Installation

First, ensure you have both `adapter-queue` and `mongoose` installed:

```bash
npm install adapter-queue mongoose
```

## Basic Usage

```typescript
import mongoose from 'mongoose';
import { createMongooseQueue } from 'adapter-queue/adapters/mongoose';

// Connect to MongoDB
await mongoose.connect('mongodb://localhost:27017/your-database');

// Create a queue
const queue = createMongooseQueue('my-app');

// Define job handlers
queue.setHandlers({
  'send-email': async (job, payload) => {
    console.log(`Sending email to ${payload.to}`);
  }
});

// Push a job
await queue.push('send-email', { to: 'user@example.com' });

// Process all jobs once
await queue.run();

// Or run continuously (polling every 5 seconds)
await queue.run(true, 5);
```

## Using Custom Models

You can use a custom Mongoose model if you need specific configuration:

```typescript
import mongoose from 'mongoose';
import { createQueueModel, createMongooseQueue } from 'adapter-queue/adapters/mongoose';

// Create a custom model
const JobModel = createQueueModel('MyJob', 'my_jobs_collection');

// Or use the schema directly
import { QueueJobSchema } from 'adapter-queue/adapters/mongoose';
const CustomJobModel = mongoose.model('CustomJob', QueueJobSchema, 'custom_jobs');

// Create queue with custom model
const queue = createMongooseQueue('my-app', CustomJobModel);
```

## Schema Structure

The Mongoose adapter uses the following schema for job documents:

```typescript
{
  payload: Buffer,              // Serialized job data
  ttr: Number,                  // Time to run (seconds)
  delaySeconds: Number,         // Delay before available
  priority: Number,             // Job priority
  pushTime: Date,               // When job was created
  delayTime: Date | null,       // When job becomes available
  reserveTime: Date | null,     // When job was reserved
  doneTime: Date | null,        // When job was completed
  expireTime: Date | null,      // When job reservation expires
  status: String,               // 'waiting' | 'reserved' | 'done' | 'failed'
  attempt: Number,              // Number of attempts
  errorMessage: String          // Error message if failed
}
```

## Indexes

The adapter automatically creates the following indexes for optimal performance:

1. `{ status: 1, delayTime: 1, priority: -1, pushTime: 1 }` - For job reservation
2. `{ status: 1, expireTime: 1 }` - For expired job recovery
3. `{ _id: 1, status: 1 }` - For job status lookup

## Integration with Existing Mongoose Apps

The Mongoose adapter integrates seamlessly with existing Mongoose applications:

```typescript
// Your existing Mongoose models
import { User } from './models/User';
import { createMongooseQueue } from 'adapter-queue/adapters/mongoose';

const queue = createMongooseQueue('my-app');

queue.setHandlers({
  'welcome-email': async (job, payload) => {
    const user = await User.findById(payload.userId);
    if (user) {
      await sendWelcomeEmail(user.email);
    }
  }
});

// When creating a user
const user = await User.create({ email: 'new@example.com' });
await queue.push('welcome-email', { userId: user._id });
```

## TypeScript Support

The Mongoose adapter provides full TypeScript support:

```typescript
interface MyJobs {
  'send-email': {
    to: string;
    subject: string;
    body: string;
  };
  'process-payment': {
    userId: string;
    amount: number;
  };
}

const queue = createMongooseQueue<MyJobs>('my-app');

// TypeScript will enforce correct payload types
await queue.push('send-email', {
  to: 'user@example.com',
  subject: 'Hello',
  body: 'Welcome!'
});
```

## Connection Management

The Mongoose adapter uses your existing Mongoose connection. Make sure to:

1. Connect to MongoDB before creating the queue
2. Handle connection errors appropriately
3. Close the connection when shutting down

```typescript
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});
```

## Differences from MongoDB Adapter

While the MongoDB adapter works with the native MongoDB driver, the Mongoose adapter:

- Uses Mongoose models and schemas
- Integrates with Mongoose middleware and plugins
- Follows Mongoose conventions and patterns
- Provides schema validation (though disabled for performance in queue operations)
- Works with existing Mongoose connections

Choose the Mongoose adapter when you're already using Mongoose in your application and want to maintain consistency.