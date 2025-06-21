import { Job, Queue } from '../../src/index.ts';

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

