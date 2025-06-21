import { FileQueue } from "@muniter/queue";

interface EmailJobs {
    'welcome-email': { to: string; name: string };
    'notification': { to: string; subject: string; body: string };
}


export const emailQueue = new FileQueue<EmailJobs>({
    path: "./email-queue",
})

// Register job handlers for email queue
emailQueue.onJob('welcome-email', async (payload) => {
    const { to, name } = payload;
    console.log(`Sending welcome email to ${to} (${name})`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (Math.random() > 0.8) {
        throw new Error('Email service temporarily unavailable');
    }

    console.log(`Welcome email sent successfully to ${to}`);
});

emailQueue.onJob('notification', async (payload) => {
    const { to, subject, body } = payload;
    console.log(`Sending notification email to ${to}: ${subject}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`Notification sent successfully`);
});

emailQueue.on('beforeExec', (event) => {
    console.log(`\n[emailQueue][${new Date().toISOString()}] Starting ${event.name} job ${event.id}...`);
});

emailQueue.on('afterExec', (event) => {
    console.log(`[emailQueue][${new Date().toISOString()}] Email job ${event.id} (${event.name}) completed successfully`);
});

emailQueue.on('afterError', (event) => {
    console.error(`[emailQueue][${new Date().toISOString()}] Email job ${event.id} (${event.name}) failed:`, event.error);
});
