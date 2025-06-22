import { SQSClient, type SQSClientConfig } from '@aws-sdk/client-sqs';
import { SqsQueue } from '../drivers/sqs.ts';

export interface SQSConfig extends SQSClientConfig { 
  region?: string;
}

// Main export - constructor pattern
export class SQSQueue<T = Record<string, any>> extends SqsQueue<T> {
  constructor(config: { client: SQSClient; queueUrl: string }) {
    super(config.client, config.queueUrl);
  }
}

// Convenience factory for AWS SDK v3
export function createSQSQueue<T = Record<string, any>>(queueUrl: string, sqsConfig?: SQSConfig): SQSQueue<T> {
  const client = new SQSClient({
    region: sqsConfig?.region || process.env.AWS_REGION || 'us-east-1',
    ...sqsConfig
  });
  
  return new SQSQueue<T>({ client, queueUrl });
}

// Re-export for convenience
export { SqsQueue };