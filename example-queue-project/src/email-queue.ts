import { SQS } from "@aws-sdk/client-sqs";
import { FileQueue, SqsQueue } from "@muniter/queue";

interface EmailJobs {
  "welcome-email": { to: string; name: string };
  notification: { to: string; subject: string; body: string };
}

// File-based queue (for local development)
export const emailQueueFile = new FileQueue<EmailJobs>({
  path: "./email-queue",
});

// SQS-based queue (for production)
const sqsClient = new SQS({
  region: "us-east-1",
  profile: "javier",
});

export const emailQueueSqs = new SqsQueue<EmailJobs>(
  sqsClient,
  "https://sqs.us-east-1.amazonaws.com/428011609647/test-queue"
);

export const emailQueue = emailQueueSqs;

// Register job handlers for email queue
emailQueue.onJob("welcome-email", async (payload) => {
  const { to, name } = payload;
  console.log(`Sending welcome email to ${to} (${name})`);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (Math.random() > 0.8) {
    throw new Error("Email service temporarily unavailable");
  }

  console.log(`Welcome email sent successfully to ${to}`);
});

emailQueue.onJob("notification", async (payload) => {
  const { to, subject, body } = payload;
  console.log(`Sending notification email to ${to}: ${subject}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  emailQueue.addJob("welcome-email", {
    payload: {
      to: "javier@muniter.com",
      name: "Javier",
    },
  });
  console.log(`Notification sent successfully`);
});

emailQueue.on("beforeExec", (event) => {
  console.log(
    `\n[emailQueue][${emailQueue.constructor.name}][${new Date().toISOString()}] Starting ${event.name} job ${
      event.id
    }...`
  );
});

emailQueue.on("afterExec", (event) => {
  console.log(
    `[emailQueue][${emailQueue.constructor.name}][${new Date().toISOString()}] Email job ${event.id} (${
      event.name
    }) completed successfully`
  );
});

emailQueue.on("afterError", (event) => {
  console.error(
    `[emailQueue][${emailQueue.constructor.name}][${new Date().toISOString()}] Email job ${event.id} (${
      event.name
    }) failed:`,
    event.error
  );
});