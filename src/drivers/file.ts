import { promises as fs } from 'fs';
import { open } from 'fs/promises';
import path from 'path';
import { Queue } from '../core/queue.js';
import type { QueueMessage, JobMeta, JobStatus, FileJobRequest } from '../interfaces/job.js';

interface IndexData {
  lastId: number;
  waiting: Array<[id: string, ttr: number]>;
  delayed: Array<[id: string, ttr: number, time: number]>;
  reserved: Array<[id: string, ttr: number, attempt: number, time: number]>;
}

interface ReservedInfo {
  id: string;
  ttr: number;
  attempt: number;
}

interface FileQueueOptions {
  path: string;
  dirMode?: number;
  fileMode?: number;
}

export class FileQueue<TJobMap = Record<string, any>> extends Queue<TJobMap, FileJobRequest<any>> {
  private path: string;
  private dirMode: number;
  private fileMode?: number;
  private indexPath: string;

  constructor(options: FileQueueOptions) {
    super();
    this.path = path.resolve(options.path);
    this.dirMode = options.dirMode ?? 0o755;
    this.fileMode = options.fileMode;
    this.indexPath = path.join(this.path, 'queue.index.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.path, { recursive: true, mode: this.dirMode });
    
    try {
      await fs.access(this.indexPath);
    } catch {
      await this.touchIndex(async (data) => {
        Object.assign(data, {
          lastId: 0,
          waiting: [],
          delayed: [],
          reserved: []
        });
      });
    }
  }

  protected async pushMessage(payload: string, meta: JobMeta): Promise<string> {
    const id = await this.touchIndex(async (data) => {
      const jobId = String(++data.lastId);
      const jobPath = path.join(this.path, `job${jobId}.data`);
      
      await fs.writeFile(jobPath, payload, 'utf8');
      if (this.fileMode !== undefined) {
        await fs.chmod(jobPath, this.fileMode);
      }

      const ttr = meta.ttr ?? 300;
      const delay = meta.delay ?? 0;

      if (delay === 0) {
        data.waiting.push([jobId, ttr]);
      } else {
        const executeTime = Math.floor(Date.now() / 1000) + delay;
        data.delayed.push([jobId, ttr, executeTime]);
        data.delayed.sort((a, b) => {
          if (a[2] !== b[2]) return a[2] - b[2];
          return parseInt(a[0]) - parseInt(b[0]);
        });
      }

      return jobId;
    });

    return id;
  }

  protected async reserve(timeout: number = 0): Promise<QueueMessage | null> {
    const startTime = Date.now();
    
    while (true) {
      const reserved = await this.touchIndex(async (data): Promise<ReservedInfo | null> => {
        const now = Math.floor(Date.now() / 1000);

        // Check for timed-out reserved jobs
        for (let i = data.reserved.length - 1; i >= 0; i--) {
          const item = data.reserved[i];
          if (item && item[3] + item[1] < now) {
            const [id, ttr, attempt] = item;
            // Remove from reserved and make it available again
            data.reserved.splice(i, 1);
            // Re-reserve it immediately with incremented attempt
            data.reserved.push([id, ttr, attempt + 1, now]);
            return { id, ttr, attempt: attempt + 1 };
          }
        }

        // Check delayed jobs
        if (data.delayed.length > 0 && data.delayed[0] && data.delayed[0][2] <= now) {
          const item = data.delayed.shift();
          if (item) {
            const [id, ttr] = item;
            data.reserved.push([id, ttr, 1, now]);
            return { id, ttr, attempt: 1 };
          }
        }

        // Check waiting jobs
        if (data.waiting.length > 0) {
          const item = data.waiting.shift();
          if (item) {
            const [id, ttr] = item;
            data.reserved.push([id, ttr, 1, now]);
            return { id, ttr, attempt: 1 };
          }
        }

        return null;
      });

      if (reserved) {
        const jobPath = path.join(this.path, `job${reserved.id}.data`);
        const payload = await fs.readFile(jobPath, 'utf8');
        return {
          id: reserved.id,
          payload,
          meta: {
            ttr: reserved.ttr
          }
        };
      }

      if (timeout === 0 || Date.now() - startTime >= timeout * 1000) {
        return null;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  protected async release(message: QueueMessage): Promise<void> {
    await this.complete(message.id);
  }

  async complete(id: string): Promise<void> {
    await this.touchIndex(async (data) => {
      const index = data.reserved.findIndex(item => item[0] === id);
      if (index !== -1) {
        data.reserved.splice(index, 1);
      }
    });

    const jobPath = path.join(this.path, `job${id}.data`);
    try {
      await fs.unlink(jobPath);
    } catch {
      // Job file may already be deleted
    }
  }

  async status(id: string): Promise<JobStatus> {
    const status = await this.getJobStatus(id);
    return status || 'done';
  }

  async getJobStatus(id: string): Promise<'waiting' | 'reserved' | 'done' | null> {
    const status = await this.touchIndex(async (data) => {
      if (data.waiting.some(item => item[0] === id)) {
        return 'waiting';
      }
      if (data.delayed.some(item => item[0] === id)) {
        return 'waiting';
      }
      if (data.reserved.some(item => item[0] === id)) {
        return 'reserved';
      }
      return null;
    });

    if (status) {
      return status;
    }

    // Check if job file exists
    const jobPath = path.join(this.path, `job${id}.data`);
    try {
      await fs.access(jobPath);
      return 'waiting';
    } catch {
      return 'done';
    }
  }

  async clear(): Promise<void> {
    await this.touchIndex(async (data) => {
      data.lastId = 0;
      data.waiting = [];
      data.delayed = [];
      data.reserved = [];
    });

    const files = await fs.readdir(this.path);
    await Promise.all(
      files
        .filter(file => file.startsWith('job') && file.endsWith('.data'))
        .map(file => fs.unlink(path.join(this.path, file)))
    );
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.touchIndex(async (data) => {
      // Check waiting
      const waitingIndex = data.waiting.findIndex(item => item[0] === id);
      if (waitingIndex !== -1) {
        data.waiting.splice(waitingIndex, 1);
        return true;
      }

      // Check delayed
      const delayedIndex = data.delayed.findIndex(item => item[0] === id);
      if (delayedIndex !== -1) {
        data.delayed.splice(delayedIndex, 1);
        return true;
      }

      // Check reserved
      const reservedIndex = data.reserved.findIndex(item => item[0] === id);
      if (reservedIndex !== -1) {
        data.reserved.splice(reservedIndex, 1);
        return true;
      }

      return false;
    });

    if (removed) {
      const jobPath = path.join(this.path, `job${id}.data`);
      try {
        await fs.unlink(jobPath);
      } catch {
        // Job file may already be deleted
      }
    }

    return removed;
  }

  private async touchIndex<T>(callback: (data: IndexData) => Promise<T> | T): Promise<T> {
    // Ensure directory exists first
    await fs.mkdir(this.path, { recursive: true, mode: this.dirMode });
    
    const lockPath = `${this.indexPath}.lock`;
    let lockHandle = null;
    let attempts = 0;
    const maxAttempts = 50;
    const retryDelay = 100;

    // Acquire lock with retries
    while (attempts < maxAttempts) {
      try {
        lockHandle = await open(lockPath, 'wx');
        break;
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Lock exists, wait and retry
          attempts++;
          if (attempts >= maxAttempts) {
            throw new Error('Failed to acquire lock after maximum attempts');
          }
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          throw err;
        }
      }
    }

    try {
      // Ensure index file exists
      let data: IndexData;
      try {
        const content = await fs.readFile(this.indexPath, 'utf-8');
        data = JSON.parse(content);
      } catch {
        data = {
          lastId: 0,
          waiting: [],
          delayed: [],
          reserved: []
        };
        await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2));
        if (this.fileMode !== undefined) {
          await fs.chmod(this.indexPath, this.fileMode);
        }
      }

      // Execute callback
      const result = await callback(data);

      // Write back
      await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2));

      return result;
    } finally {
      // Release lock
      if (lockHandle) {
        await lockHandle.close();
        try {
          await fs.unlink(lockPath);
        } catch {
          // Lock file may already be deleted
        }
      }
    }
  }
}