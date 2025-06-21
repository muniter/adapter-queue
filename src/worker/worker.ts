import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { Queue } from '../core/queue.ts';
import type { QueueMessage } from '../interfaces/job.ts';

export interface WorkerOptions {
  isolate?: boolean;
  timeout?: number;
  childScriptPath?: string;
}

export class Worker {
  constructor(
    private queue: Queue,
    private options: WorkerOptions = {}
  ) {
    if (this.options.isolate) {
      this.setupIsolatedHandler();
    }
  }

  async start(repeat: boolean = true, timeout: number = 3): Promise<void> {
    await this.queue.run(repeat, timeout);
  }

  private setupIsolatedHandler(): void {
    const originalHandleMessage = this.queue['handleMessage'].bind(this.queue);
    
    this.queue['handleMessage'] = async (message: QueueMessage): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const childScriptPath = this.options.childScriptPath || 
          path.resolve(__dirname, 'worker-child.js');
        
        const child: ChildProcess = spawn(process.execPath, [childScriptPath], {
          stdio: ['pipe', 'inherit', 'inherit'],
          timeout: (message.meta.ttr || 300) * 1000
        });

        child.stdin!.end(message.payload);
        
        child.on('close', (code) => {
          resolve(code === 0);
        });

        child.on('error', (error) => {
          console.error('Child process error:', error);
          resolve(false);
        });
      });
    };
  }
}

export async function runWorker(
  queue: Queue, 
  options: WorkerOptions & { repeat?: boolean; timeout?: number } = {}
): Promise<void> {
  const worker = new Worker(queue, options);
  await worker.start(options.repeat ?? true, options.timeout ?? 3);
}