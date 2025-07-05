import { InMemoryQueue as MemoryQueue, type InMemoryQueueOptions } from '../drivers/memory.ts';

// Re-export the main class for convenience
export { InMemoryQueue, type InMemoryQueueOptions } from '../drivers/memory.ts';

/**
 * Convenience factory for creating in-memory queues.
 * 
 * @param name Queue name (required)
 * @param options Optional configuration
 * @returns InMemoryQueue instance
 * 
 * @example
 * ```typescript
 * import { createMemoryQueue } from 'adapter-queue/memory';
 * 
 * interface MyJobs {
 *   'send-email': { to: string; subject: string };
 *   'process-image': { url: string; width: number };
 * }
 * 
 * const queue = createMemoryQueue<MyJobs>('test-queue', {
 *   maxJobs: 1000
 * });
 * 
 * queue.setHandlers({
 *   'send-email': async ({ payload }) => {
 *     console.log(`Sending email to ${payload.to}`);
 *   },
 *   'process-image': async ({ payload }) => {
 *     console.log(`Processing image: ${payload.url}`);
 *   }
 * });
 * 
 * await queue.addJob('send-email', {
 *   payload: { to: 'user@example.com', subject: 'Test' },
 *   priority: 5,
 *   delay: 10
 * });
 * 
 * await queue.run(true, 1);
 * ```
 */
export function createMemoryQueue<T = Record<string, any>>(
  name: string,
  options: Omit<InMemoryQueueOptions, 'name'> = {}
): MemoryQueue<T> {
  return new MemoryQueue<T>({ name, ...options });
}

// Export for convenience
export { MemoryQueue };