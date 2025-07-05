export { Queue } from './core/queue.ts';
export { DbQueue } from './drivers/db.ts';
export { FileQueue } from './drivers/file.ts';
export { InMemoryQueue } from './drivers/memory.ts';
export { Worker, runWorker } from './worker/worker.ts';

// Job assembly utilities
export { 
  assembleJobs, 
  createQueueSetup, 
  defineJob,
  // Enhanced assembly functions for circular dependency avoidance
  assembleJobsWithQueue,
  assembleJobFactories,
  assembleJobsWithLocator,
  assembleJobsUniversal,
  createQueueWithRegistry,
  // Legacy functions for backward compatibility
  assembleHandlers, 
  createQueueWithModules, 
  defineJobWithPayload, 
  defineJobType 
} from './utils/job-assembly.ts';

// Queue factory utilities for eliminating circular dependencies
export {
  createQueueFactory,
  createLazyQueueFactory,
  createMultiQueueFactory,
  createQueueWithJobs,
  createQueueFactoryWithWarnings
} from './utils/queue-factory.ts';

// Queue registry for circular dependency avoidance (legacy approach)
export {
  QueueRegistry,
  setQueue,
  getQueue,
  getQueueSafe,
  hasQueue,
  clearQueue,
  createQueueGetter
} from './utils/queue-registry.ts';

export type { 
  JobStatus, 
  JobMeta, 
  QueueMessage, 
  QueueEvent,
  JobData,
  JobOptions,
  BaseJobRequest,
  BaseJobOptions,
  DbJobRequest,
  DbJobOptions,
  SqsJobRequest,
  SqsJobOptions,
  FileJobRequest,
  FileJobOptions,
  InMemoryJobRequest,
  InMemoryJobOptions,
  // Main convenience types
  QueueArgs,
  QueueHandler,
  JobPayload,
  // Simple job definition types
  JobDefinition,
  JobDefinitionPayload,
  JobDefinitionName,
  JobDefinitionToMapEntry,
  JobDefinitionsToMap,
  JobDefinitionsToHandlers,
  // Circular dependency avoidance types
  JobContextWithQueue,
  JobDefinitionWithQueue,
  JobFactory,
  JobDefinitionWithLocator,
  // Legacy modular job definition types
  JobDefinitionComplex,
  JobName,
  JobPayloadType,
  JobDefinitionHandler,
  JobModule,
  JobModuleToMapEntry,
  JobModulesToMap,
  JobModulesToHandlers
} from './interfaces/job.ts';

export type {
  DatabaseAdapter,
  QueueJobRecord
} from './interfaces/database.ts';


export type { WorkerOptions } from './worker/worker.ts';