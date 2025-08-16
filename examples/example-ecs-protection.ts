#!/usr/bin/env node

/**
 * Example demonstrating ECS Task Protection plugin usage with SQS.
 * 
 * This example shows how to use the ECS Task Protection plugin
 * to prevent job loss during ECS container termination in a typical
 * ECS + SQS production setup.
 */

import { SQSQueue } from 'adapter-queue/sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { EcsProtectionManager, ecsTaskProtection } from 'adapter-queue/plugins/ecs-protection-manager';

interface EmailJobs {
  'send-welcome-email': { 
    to: string; 
    name: string; 
  };
  'send-notification': { 
    to: string; 
    subject: string; 
    body: string; 
  };
}

async function main() {
  console.log('🚀 Starting ECS Protected SQS Queue Worker Example');
  
  // Create ECS Protection Manager (shared across all queues in your application)
  const protectionManager = new EcsProtectionManager({
    // In production, these would be auto-detected from environment
    // For testing, you can provide custom values:
    // ecsAgentUri: 'http://169.254.170.2/v1',
    // fetch: customFetchFunction,
    // logger: customLogger
  });
  
  // Create SQS queue with ECS Task Protection (typical production setup)
  const emailQueue = new SQSQueue<EmailJobs>({
    client: new SQSClient({ 
      region: process.env.AWS_REGION || 'us-east-1'
    }),
    queueUrl: process.env.SQS_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/123456789012/email-queue',
    name: 'email-queue',
    onFailure: 'delete',
    plugins: [
      ecsTaskProtection(protectionManager)
    ]
  });

  // Register job handlers
  emailQueue.setHandlers({
    'send-welcome-email': async ({ payload }) => {
      console.log(`📧 Sending welcome email to ${payload.to}`);
      
      // Simulate email sending work
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simulate occasional failures
      if (Math.random() > 0.8) {
        throw new Error('Email service temporarily unavailable');
      }
      
      console.log(`✅ Welcome email sent to ${payload.to}`);
    },

    'send-notification': async ({ payload }) => {
      console.log(`📬 Sending notification to ${payload.to}: ${payload.subject}`);
      
      // Simulate longer processing time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`✅ Notification sent to ${payload.to}`);
    }
  });

  // Add some test jobs
  console.log('📝 Adding test jobs to the queue...');
  
  await emailQueue.addJob('send-welcome-email', {
    payload: {
      to: 'user@example.com',
      name: 'John Doe'
    }
  });

  await emailQueue.addJob('send-notification', {
    payload: {
      to: 'admin@example.com',
      subject: 'System Alert',
      body: 'A new user has registered'
    }
  });

  await emailQueue.addJob('send-welcome-email', {
    payload: {
      to: 'user2@example.com',
      name: 'Jane Smith'
    },
    delay: 5 // Process after 5 seconds
  });

  console.log('⚡ Starting SQS queue worker with ECS protection...');
  console.log('');
  console.log('🛡️  ECS Task Protection Features:');
  console.log('   • Automatically acquires protection when processing jobs');
  console.log('   • Releases protection when idle');
  console.log('   • Detects ECS draining and gracefully stops processing');
  console.log('   • Auto-renews protection for long-running jobs');
  console.log('');
  console.log('📋 Environment:');
  console.log(`   • AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  console.log(`   • SQS Queue: ${process.env.SQS_QUEUE_URL || '[using default]'}`);
  console.log(`   • ECS Agent: ${process.env.ECS_AGENT_URI || '[auto-detected]'}`);
  console.log('');
  console.log('Press Ctrl+C to stop the worker');
  console.log('');

  // Add event listeners for demonstration
  emailQueue.on('beforeExec', (event) => {
    console.log(`🔄 [${new Date().toISOString()}] Starting ${event.name} job ${event.id}`);
  });

  emailQueue.on('afterExec', (event) => {
    console.log(`✅ [${new Date().toISOString()}] Completed job ${event.id}`);
  });

  emailQueue.on('afterError', (event) => {
    console.error(`❌ [${new Date().toISOString()}] Job ${event.id} failed:`, event.error.message);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    
    // Clean up the protection manager
    await protectionManager.cleanup();
    console.log('✅ ECS protection released');
    
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    
    // Clean up the protection manager
    await protectionManager.cleanup();
    console.log('✅ ECS protection released');
    
    process.exit(0);
  });

  // Start processing jobs
  try {
    await emailQueue.run(true, 3); // Run continuously with 3-second timeout
  } catch (error) {
    console.error('❌ Queue worker error:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { main };