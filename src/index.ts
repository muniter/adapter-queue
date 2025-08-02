export { Queue } from './core/queue.ts';

export type { 
  JobStatus, 
  JobMeta, 
  QueueMessage, 
  QueueEvent,
  JobData,
  BaseJobRequest,
  BaseJobOptions,
  DbJobRequest,
  DbJobOptions,
  SqsJobRequest,
  SqsJobOptions,
  FileJobRequest,
  FileJobOptions,
  InMemoryJobRequest,
  InMemoryJobOptions
} from './interfaces/job.ts';

export type {
  DatabaseAdapter,
  QueueJobRecord
} from './interfaces/database.ts';


export { DbQueue } from './drivers/db.ts';
export { FileQueue } from './drivers/file.ts';
export { InMemoryQueue } from './drivers/memory.ts';

// Mongoose adapter exports
export { 
  MongooseQueue,
  createMongooseQueue,
  createQueueModel,
  QueueJob,
  MongooseDatabaseAdapter,
  QueueJobSchema
} from './adapters/mongoose.ts';
export type { IQueueJob } from './adapters/mongoose.ts';