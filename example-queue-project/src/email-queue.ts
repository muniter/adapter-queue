import { FileQueue } from "adapter-queue";
import { createSQSQueue } from "adapter-queue/sqs";
import type { QueueArgs, QueueHandler, JobPayload } from "adapter-queue";

interface EmailJobs {
  "welcome-email": { to: string; name: string };
  notification: { to: string; subject: string; body: string };
}

// File-based queue (for local development)
export const emailQueueFile = new FileQueue<EmailJobs>({
  name: "email-queue",
  path: "./email-queue",
});

// SQS-based queue (for production) - simple API
export const emailQueueSqs = createSQSQueue<EmailJobs>(
  "email-queue",
  "https://sqs.us-east-1.amazonaws.com/428011609647/test-queue",
  "delete"
);

export const emailQueue = emailQueueSqs;

// Example: Define handlers using the new types for better DX
const welcomeEmailHandler = async (args: QueueArgs<JobPayload<EmailJobs, "welcome-email">>) => {
  const { id, payload, meta } = args;
  const { to, name } = payload;
  
  console.log(`Sending welcome email to ${to} (${name})`);
  console.log(`Job ${id} was created at: ${meta.pushedAt}`);
  
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (Math.random() > 0.8) {
    throw new Error("Email service temporarily unavailable");
  }

  console.log(`Welcome email sent successfully to ${to}`);
};

const notificationHandler: QueueHandler<JobPayload<EmailJobs, "notification">> = async (args, queue) => {
  const { payload } = args;
  const { to, subject, body } = payload;
  
  console.log(`Sending notification email to ${to}: ${subject}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  // Example: Using the queue parameter to add follow-up jobs
  queue.addJob("welcome-email", {
    payload: {
      to: "javier@muniter.com",
      name: "Javier",
    },
  });
  
  console.log(`Notification sent successfully`);
};

// Register job handlers for email queue
emailQueue.setHandlers({
  "welcome-email": welcomeEmailHandler,
  "notification": notificationHandler,
});

emailQueue.on("beforeExec", (event) => {
  console.log(
    `\n[emailQueue][${
      emailQueue.constructor.name
    }][${new Date().toISOString()}] Starting ${event.name} job ${event.id}...`
  );
});

emailQueue.on("afterExec", (event) => {
  console.log(
    `[emailQueue][${
      emailQueue.constructor.name
    }][${new Date().toISOString()}] Email job ${event.id} (${
      event.name
    }) completed successfully`
  );
});

emailQueue.on("afterError", (event) => {
  console.error(
    `[emailQueue][${
      emailQueue.constructor.name
    }][${new Date().toISOString()}] Email job ${event.id} (${
      event.name
    }) failed:`,
    event.error
  );
});
