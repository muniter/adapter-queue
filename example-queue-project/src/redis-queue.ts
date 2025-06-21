import { RedisQueue } from "@muniter/queue";
import { createClient } from "redis";

interface EmailJobs {
  "welcome-email": { to: string; name: string };
  "notification": { to: string; subject: string; body: string };
}

// Create Redis client directly
const redisClient = createClient({ url: 'redis://localhost:6379' });

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));
redisClient.on('ready', () => console.log('Redis Client Ready'));

await redisClient.connect();

// Create Redis queue - no adapter needed!
export const emailQueue = new RedisQueue<EmailJobs>(redisClient, 'email');

// Register job handlers
emailQueue.onJob("welcome-email", async (payload) => {
  const { to, name } = payload;
  console.log(`[Redis] Sending welcome email to ${to} (${name})`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(`[Redis] Welcome email sent successfully to ${to}`);
});

emailQueue.onJob("notification", async (payload) => {
  const { to, subject, body } = payload;
  console.log(`[Redis] Sending notification email to ${to}: ${subject}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(`[Redis] Notification sent successfully`);
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