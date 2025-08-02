import mongoose from 'mongoose';
import { MongooseQueue, QueueJob, createQueueModel } from '../src/drivers/mongoose.ts';

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
  const model = createQueueModel();
  const queue = new MongooseQueue<MyJobs>({ model, name: 'my-app' });

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

  // Process all jobs once
  console.log('\nProcessing jobs...');
  await queue.run();
  console.log('All jobs processed!');
}

// Alternative: Using a custom model
async function customModelExample(): Promise<void> {
  await mongoose.connect('mongodb://localhost:27017/queue-example');

  // Create a custom model with a different collection name
  const JobModel = mongoose.model('CustomJob', QueueJob.schema, 'custom_jobs');
  
  // Create queue with custom model
  const queue = new MongooseQueue<MyJobs>({ model: JobModel, name: 'custom-app' });
  
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

// Continuous processing example
async function continuousProcessingExample(): Promise<void> {
  await mongoose.connect('mongodb://localhost:27017/queue-example');
  
  const model = createQueueModel();
  const queue = new MongooseQueue<MyJobs>({ model, name: 'continuous-queue' });
  
  queue.setHandlers({
    'send-email': async (job) => {
      console.log(`[${new Date().toISOString()}] Processing email job: ${job.id}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`Email sent to ${job.payload.to}`);
    },
    'process-image': async (job) => {
      console.log(`[${new Date().toISOString()}] Processing image job: ${job.id}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log(`Image processed: ${job.payload.url}`);
    }
  });

  console.log('Starting continuous job processing (polling every 3 seconds)...');
  console.log('Add jobs from another process and watch them get processed!');
  
  // This will run forever, polling every 3 seconds
  await queue.run(true, 3);
}

// Run the example (uncomment the one you want to test)
main().catch(console.error);

// For continuous processing, run this instead:
// continuousProcessingExample().catch(console.error);

// Export for testing
export { main, customModelExample, continuousProcessingExample };