import { Serializer } from '@muniter/queue';
import { EmailJob, ImageProcessingJob, ReportGeneratorJob } from './job-processors.js';

export class JobSerializer implements Serializer {
  serialize(job: any): Buffer {
    const data = {
      constructor: job.constructor.name,
      ...job
    };
    return Buffer.from(JSON.stringify(data));
  }

  deserialize(payload: Buffer): any {
    const data = JSON.parse(payload.toString());
    
    switch (data.constructor) {
      case 'EmailJob':
        return new EmailJob(data.to, data.subject, data.body);
      
      case 'ImageProcessingJob':
        return new ImageProcessingJob(data.url, data.resize);
      
      case 'ReportGeneratorJob':
        return new ReportGeneratorJob(data.type, data.period);
      
      default:
        throw new Error(`Unknown job type: ${data.constructor}`);
    }
  }
}