import { Job, RetryableJob, Queue } from '../../src/index.ts';

export class SimpleJob implements Job<string> {
  constructor(public data: string) {}

  async execute(queue: Queue): Promise<string> {
    return `Processed: ${this.data}`;
  }

  serialize() {
    return {
      constructor: 'SimpleJob',
      data: this.data
    };
  }

  static deserialize(data: any): SimpleJob {
    return new SimpleJob(data.data);
  }
}

export class FailingJob implements Job<void> {
  constructor(public shouldFail: boolean = true) {}

  async execute(queue: Queue): Promise<void> {
    if (this.shouldFail) {
      throw new Error('Job intentionally failed');
    }
  }

  serialize() {
    return {
      constructor: 'FailingJob',
      shouldFail: this.shouldFail
    };
  }

  static deserialize(data: any): FailingJob {
    return new FailingJob(data.shouldFail);
  }
}

export class RetryableTestJob implements RetryableJob<string> {
  constructor(
    public data: string,
    public maxAttempts: number = 3,
    public shouldFailUntil: number = 2
  ) {}

  getTtr(): number {
    return 30;
  }

  canRetry(attempt: number, error: unknown): boolean {
    return attempt < this.maxAttempts;
  }

  async execute(queue: Queue): Promise<string> {
    if (this.shouldFailUntil > 0) {
      this.shouldFailUntil--;
      throw new Error(`Attempt failed, ${this.shouldFailUntil} failures remaining`);
    }
    return `Success after retries: ${this.data}`;
  }

  serialize() {
    return {
      constructor: 'RetryableTestJob',
      data: this.data,
      maxAttempts: this.maxAttempts,
      shouldFailUntil: this.shouldFailUntil
    };
  }

  static deserialize(data: any): RetryableTestJob {
    return new RetryableTestJob(data.data, data.maxAttempts, data.shouldFailUntil);
  }
}