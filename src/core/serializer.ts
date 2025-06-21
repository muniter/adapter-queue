export interface Serializer {
  serialize(job: any): Buffer;
  deserialize(payload: Buffer): any;
}

export class JsonSerializer implements Serializer {
  serialize(job: any): Buffer {
    return Buffer.from(JSON.stringify(job), 'utf8');
  }

  deserialize(payload: Buffer): any {
    return JSON.parse(payload.toString('utf8'));
  }
}

export class DefaultSerializer implements Serializer {
  private jobRegistry: Map<string, any> = new Map();

  registerJob(name: string, jobClass: any): void {
    this.jobRegistry.set(name, jobClass);
  }

  serialize(job: any): Buffer {
    if (typeof job.serialize === 'function') {
      return Buffer.from(JSON.stringify(job.serialize()), 'utf8');
    }
    
    // For jobs without custom serialization, include constructor name
    const data = {
      constructor: job.constructor.name,
      ...job
    };
    return Buffer.from(JSON.stringify(data), 'utf8');
  }

  deserialize(payload: Buffer): any {
    const data = JSON.parse(payload.toString('utf8'));
    
    // If job is registered and has deserialize method
    if (data.constructor && this.jobRegistry.has(data.constructor)) {
      const JobClass = this.jobRegistry.get(data.constructor);
      if (JobClass.deserialize) {
        return JobClass.deserialize(data);
      }
    }
    
    // Default behavior - return data as is
    return data;
  }
}