import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { Queue } from "../core/queue.js";
export class Worker {
    queue;
    options;
    constructor(queue, options = {}) {
        this.queue = queue;
        this.options = options;
        if (this.options.isolate) {
            this.setupIsolatedHandler();
        }
    }
    async start(repeat = true, timeout = 3) {
        await this.queue.run(repeat, timeout);
    }
    setupIsolatedHandler() {
        const originalHandleMessage = this.queue['handleMessage'].bind(this.queue);
        this.queue['handleMessage'] = async (message) => {
            return new Promise((resolve) => {
                const childScriptPath = this.options.childScriptPath ||
                    path.resolve(__dirname, 'worker-child.js');
                const child = spawn(process.execPath, [childScriptPath], {
                    stdio: ['pipe', 'inherit', 'inherit'],
                    timeout: (message.meta.ttr || 300) * 1000
                });
                child.stdin.end(message.payload);
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
export async function runWorker(queue, options = {}) {
    const worker = new Worker(queue, options);
    await worker.start(options.repeat ?? true, options.timeout ?? 3);
}
//# sourceMappingURL=worker.js.map