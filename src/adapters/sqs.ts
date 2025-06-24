import { SQSClient, type SQSClientConfig } from '@aws-sdk/client-sqs';
import { SqsQueue } from '../drivers/sqs.ts';

export interface SQSConfig extends SQSClientConfig { 
  region?: string;
}

// Main export - constructor pattern
export class SQSQueue<T = Record<string, any>> extends SqsQueue<T> {
  constructor(config: { client: SQSClient; queueUrl: string; name: string; onFailure: "delete" | "leaveInQueue" }) {
    super(config.client, config.queueUrl, { name: config.name, onFailure: config.onFailure });
  }
}

// Convenience factory for AWS SDK v3
export function createSQSQueue<T = Record<string, any>>(
  name: string, 
  queueUrl: string, 
  onFailure: "delete" | "leaveInQueue",
  sqsConfig?: SQSConfig
): SQSQueue<T> {
  const client = new SQSClient({
    region: sqsConfig?.region || process.env.AWS_REGION || 'us-east-1',
    ...sqsConfig
  });
  
  return new SQSQueue<T>({ client, queueUrl, name, onFailure });
}

// Re-export for convenience
export { SqsQueue };