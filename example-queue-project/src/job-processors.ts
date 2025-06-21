import { Job, Queue } from '@muniter/queue';

export class EmailJob implements Job {
  constructor(
    private to: string,
    private subject: string,
    private body: string
  ) {}

  async execute(queue: Queue): Promise<void> {
    console.log(`Sending email to ${this.to}`);
    console.log(`Subject: ${this.subject}`);
    console.log(`Body: ${this.body}`);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (Math.random() > 0.8) {
      throw new Error('Email service temporarily unavailable');
    }
    
    console.log(`Email sent successfully to ${this.to}`);
  }
}

export class ImageProcessingJob implements Job<{ width: number; height: number }> {
  constructor(
    private url: string,
    private resize?: { width: number; height: number }
  ) {}

  async execute(queue: Queue): Promise<{ width: number; height: number }> {
    console.log(`Processing image from ${this.url}`);
    
    if (this.resize) {
      console.log(`Resizing to ${this.resize.width}x${this.resize.height}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const result = {
      width: this.resize?.width || 1920,
      height: this.resize?.height || 1080
    };
    
    console.log(`Image processed: ${result.width}x${result.height}`);
    return result;
  }
}

export class ReportGeneratorJob implements Job {
  constructor(
    private type: string,
    private period: string
  ) {}

  async execute(queue: Queue): Promise<void> {
    console.log(`Generating ${this.type} report for ${this.period}`);
    
    const steps = ['Fetching data', 'Processing', 'Formatting', 'Saving'];
    
    for (const step of steps) {
      console.log(`  - ${step}...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`Report generated: ${this.type} for ${this.period}`);
  }
}