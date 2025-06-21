import { FileQueue } from '@muniter/queue';
import path from 'path';

// Define the job types for this application
interface MyJobs {
  'send-email': {
    to: string;
    subject: string;
    body: string;
  };
  'resize-image': {
    url: string;
    width: number;
    height: number;
  };
  'generate-report': {
    type: string;
    period: string;
  };
}

// Create a typed queue
const queue = new FileQueue<MyJobs>({
  path: path.join(process.cwd(), 'queue-data-events'),
  dirMode: 0o755,
  fileMode: 0o644
});

async function main() {
  // Register job handlers - no more Job classes needed!
  queue.onJob('send-email', async (payload) => {
    // payload is automatically typed as { to: string; subject: string; body: string }
    const { to, subject, body } = payload;
    
    console.log(`Sending email to ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);
    
    // Simulate email sending with random failure
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (Math.random() > 0.8) {
      throw new Error('Email service temporarily unavailable');
    }
    
    console.log(`Email sent successfully to ${to}`);
  });

  queue.onJob('resize-image', async (payload) => {
    // payload is automatically typed as { url: string; width: number; height: number }
    const { url, width, height } = payload;
    
    console.log(`Resizing image from ${url} to ${width}x${height}`);
    
    // Simulate image processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`Image resized successfully`);
  });

  queue.onJob('generate-report', async (payload) => {
    // payload is automatically typed as { type: string; period: string }
    const { type, period } = payload;
    
    console.log(`Generating ${type} report for ${period}`);
    
    const steps = ['Fetching data', 'Processing', 'Formatting', 'Saving'];
    
    for (const step of steps) {
      console.log(`  - ${step}...`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`Report generated: ${type} for ${period}`);
  });

  // Setup event listeners for queue lifecycle
  queue.on('beforeExec', (event) => {
    console.log(`\nStarting job ${event.id} (${event.name})...`);
  });

  queue.on('afterExec', (event) => {
    console.log(`Completed job ${event.id} (${event.name})`);
  });

  queue.on('afterError', (event) => {
    console.error(`Job ${event.id} (${event.name}) failed:`, event.error);
  });

  // Add jobs using the new type-safe API
  console.log('Adding jobs to queue...\n');
  
  // TypeScript will provide full autocomplete and type checking
  const emailJobId = await queue.addJob('send-email', {
    payload: {
      to: 'user@example.com',
      subject: 'Welcome!',
      body: 'Thanks for signing up!'
    }
  });
  console.log(`Added email job: ${emailJobId}`);

  // Job with delay using options
  const delayedImageJobId = await queue.addJob('resize-image', {
    payload: {
      url: 'https://example.com/image.jpg',
      width: 800,
      height: 600
    },
    delay: 3
  });
  console.log(`Added delayed image job: ${delayedImageJobId}`);

  // Job with custom TTR (FileQueue doesn't support priority)
  const reportJobId = await queue.addJob('generate-report', {
    payload: {
      type: 'monthly',
      period: 'December 2024'
    },
    ttr: 300
    // Note: FileQueue doesn't support priority - would cause TypeScript error
  });
  console.log(`Added priority report job: ${reportJobId}`);

  // Check job statuses
  console.log(`\nJob ${emailJobId} status: ${await queue.status(emailJobId)}`);
  console.log(`Job ${delayedImageJobId} status: ${await queue.status(delayedImageJobId)}`);
  console.log(`Job ${reportJobId} status: ${await queue.status(reportJobId)}`);

  // Start processing jobs
  console.log('\nStarting worker...');
  await queue.run(false); // Process all jobs then exit
}

main().catch(console.error);