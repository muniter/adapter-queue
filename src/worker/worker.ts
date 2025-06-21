import { Queue } from '../core/queue.ts';

export interface WorkerOptions {
  timeout?: number;
}

export class Worker {
  constructor(
    private queue: Queue,
    private options: WorkerOptions = {}
  ) {}

  async start(repeat: boolean = true, timeout: number = 3): Promise<void> {
    const actualTimeout = this.options.timeout ?? timeout;
    await this.queue.run(repeat, actualTimeout);
  }
}

export async function runWorker(
  queue: Queue, 
  options: WorkerOptions & { repeat?: boolean; timeout?: number } = {}
): Promise<void> {
  const worker = new Worker(queue, options);
  await worker.start(options.repeat ?? true, options.timeout ?? 3);
}