import { Queue } from '../core/queue.ts';
export interface WorkerOptions {
    isolate?: boolean;
    timeout?: number;
    childScriptPath?: string;
}
export declare class Worker {
    private queue;
    private options;
    constructor(queue: Queue, options?: WorkerOptions);
    start(repeat?: boolean, timeout?: number): Promise<void>;
    private setupIsolatedHandler;
}
export declare function runWorker(queue: Queue, options?: WorkerOptions & {
    repeat?: boolean;
    timeout?: number;
}): Promise<void>;
