import { 
  SQSClient, 
  SendMessageCommand, 
  ReceiveMessageCommand, 
  DeleteMessageCommand, 
  ChangeMessageVisibilityCommand,
  type SendMessageCommandInput,
  type ReceiveMessageCommandInput,
  type DeleteMessageCommandInput,
  type ChangeMessageVisibilityCommandInput
} from '@aws-sdk/client-sqs';
import type { SimplifiedSQSClient } from '../../src/drivers/sqs.ts';

/**
 * Adapter that wraps AWS SDK v3 SQSClient to match the v2 interface
 * expected by the SqsQueue driver
 */
export class SQSClientV3Adapter implements SimplifiedSQSClient {
  constructor(private client: SQSClient) {}

  async sendMessage(params: SendMessageCommandInput) {
    return this.client.send(new SendMessageCommand(params));
  }

  async receiveMessage(params: ReceiveMessageCommandInput) {
    return this.client.send(new ReceiveMessageCommand(params));
  }

  async deleteMessage(params: DeleteMessageCommandInput) {
    return this.client.send(new DeleteMessageCommand(params));
  }

  async changeMessageVisibility(params: ChangeMessageVisibilityCommandInput) {
    return this.client.send(new ChangeMessageVisibilityCommand(params));
  }
}