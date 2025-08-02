import mongoose from 'mongoose';
import { createMongooseQueue, QueueJob } from '../src/adapters/mongoose.ts';

// Define your job types
interface MyJobs {
  'send-email': {
    to: string;
    subject: string;
    body: string;
  };
  'process-image': {
    url: string;
    width: number;
    height: number;
  };
}

async function main() {
  // Connect to MongoDB
  await mongoose.connect('mongodb://localhost:27017/queue-example');
  console.log('Connected to MongoDB');

  // Create a queue instance
  const queue = createMongooseQueue<MyJobs>('my-app');

  // Set up job handlers
  queue.setHandlers({
    'send-email': async (job, payload) => {
      console.log(`Sending email to ${payload.to}`);
      console.log(`Subject: ${payload.subject}`);
      console.log(`Body: ${payload.body}`);
      // Simulate email sending
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Email sent successfully!');
    },

    'process-image': async (job, payload) => {
      console.log(`Processing image: ${payload.url}`);
      console.log(`Dimensions: ${payload.width}x${payload.height}`);
      // Simulate image processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('Image processed successfully!');
    }
  });

  // Push some jobs
  const emailJobId = await queue.addJob('send-email', {
    payload: {
      to: 'user@example.com',
      subject: 'Welcome!',
      body: 'Thank you for signing up!'
    }
  });
  console.log(`Email job created with ID: ${emailJobId}`);

  const imageJobId = await queue.addJob('process-image', {
    payload: {
      url: 'https://example.com/image.jpg',
      width: 800,
      height: 600
    },
    delaySeconds: 5,  // Delay for 5 seconds
    priority: 10  // Higher priority
  });
  console.log(`Image job created with ID: ${imageJobId}`);

  // Run the queue worker
  console.log('\nStarting queue worker...');
  await queue.run();
}

// Alternative: Using a custom model
async function customModelExample(): Promise<void> {
  await mongoose.connect('mongodb://localhost:27017/queue-example');

  // Create a custom model with a different collection name
  const JobModel = mongoose.model('CustomJob', QueueJob.schema, 'custom_jobs');
  
  // Create queue with custom model
  const queue = createMongooseQueue<MyJobs>('custom-app', JobModel);
  
  // Set handlers and use as normal
  queue.setHandlers({
    'send-email': async (job, payload) => {
      console.log(`Custom handler: Sending email to ${payload.to}`);
    }
  });

  await queue.addJob('send-email', {
    payload: {
      to: 'custom@example.com',
      subject: 'Custom Queue',
      body: 'This uses a custom model!'
    }
  });
}

// Run the example
main().catch(console.error);

// Export for testing
export { main, customModelExample };