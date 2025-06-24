import { createRedisQueue } from "@muniter/queue/redis";

interface EmailJobs {
  "welcome-email": { to: string; name: string };
  "notification": { to: string; subject: string; body: string };
}

// Create Redis queue with simple API
export const emailQueue = createRedisQueue<EmailJobs>('redis://localhost:6379');

// Register job handlers
emailQueue.setHandlers({
  "welcome-email": async ({ payload }) => {
    const { to, name } = payload;
    console.log(`[Redis] Sending welcome email to ${to} (${name})`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`[Redis] Welcome email sent successfully to ${to}`);
  },
  "notification": async ({ payload }) => {
    const { to, subject, body } = payload;
    console.log(`[Redis] Sending notification email to ${to}: ${subject}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(`[Redis] Notification sent successfully`);
  }
});

// Event listeners
emailQueue.on("beforeExec", (event) => {
  console.log(
    `\n[Redis Queue][${new Date().toISOString()}] Starting ${event.name} job ${event.id}...`
  );
});

emailQueue.on("afterExec", (event) => {
  console.log(
    `[Redis Queue][${new Date().toISOString()}] Job ${event.id} (${event.name}) completed successfully`
  );
});

emailQueue.on("afterError", (event) => {
  console.error(
    `[Redis Queue][${new Date().toISOString()}] Job ${event.id} (${event.name}) failed:`,
    event.error
  );
});