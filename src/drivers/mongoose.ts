import { Schema, model, Model, Document, Types } from 'mongoose';
import type { UpdateQuery, FilterQuery, QueryOptions } from 'mongoose';
import type { DatabaseAdapter, QueueJobRecord } from '../interfaces/database.ts';
import type { JobMeta, JobStatus } from '../interfaces/job.ts';
import { DbQueue } from '../drivers/db.ts';

// MongoDB document structure for queue jobs
export interface IQueueJobDocument {
  payload: Buffer;
  ttr: number;
  delaySeconds: number;
  priority: number;
  pushTime: Date;
  delayTime: Date | null;
  reserveTime: Date | null;
  doneTime: Date | null;
  expireTime: Date | null;
  status: 'waiting' | 'reserved' | 'done' | 'failed';
  attempt: number;
  errorMessage?: string;
}

// Mongoose document interface
export interface IQueueJob extends IQueueJobDocument, Document {
  _id: Types.ObjectId;
}

// Queue job schema
export const QueueJobSchema = new Schema<IQueueJob>({
  payload: { type: Buffer, required: true },
  ttr: { type: Number, required: true, default: 300 },
  delaySeconds: { type: Number, required: true, default: 0 },
  priority: { type: Number, required: true, default: 0 },
  pushTime: { type: Date, required: true },
  delayTime: { type: Date, default: null },
  reserveTime: { type: Date, default: null },
  doneTime: { type: Date, default: null },
  expireTime: { type: Date, default: null },
  status: { 
    type: String, 
    required: true, 
    enum: ['waiting', 'reserved', 'done', 'failed'],
    default: 'waiting'
  },
  attempt: { type: Number, required: true, default: 0 },
  errorMessage: { type: String }
}, {
  collection: 'queue_jobs',
  timestamps: false
});

// Add indexes
QueueJobSchema.index({ status: 1, delayTime: 1, priority: -1, pushTime: 1 });
QueueJobSchema.index({ status: 1, expireTime: 1 });
QueueJobSchema.index({ _id: 1, status: 1 });

// Type definitions for MongoDB operations
type MongoFilter = FilterQuery<IQueueJobDocument>;
type MongoUpdate = UpdateQuery<IQueueJobDocument>;

// Mongoose database adapter implementing DatabaseAdapter interface
export class MongooseDatabaseAdapter implements DatabaseAdapter {
  constructor(private model: Model<IQueueJob>) {}

  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    const now = new Date();
    
    const doc = await this.model.create({
      payload,
      ttr: meta.ttr ?? 300,
      delaySeconds: meta.delaySeconds ?? 0,
      priority: meta.priority ?? 0,
      pushTime: now,
      delayTime: meta.delaySeconds ? new Date(now.getTime() + meta.delaySeconds * 1000) : null,
      status: 'waiting',
      attempt: 0
    });

    return doc._id.toHexString();
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = new Date();

    // First, recover timed-out jobs
    await this.model.updateMany(
      { 
        status: 'reserved', 
        expireTime: { $lt: now } 
      },
      { 
        $set: { 
          status: 'waiting', 
          reserveTime: null, 
          expireTime: null 
        }, 
        $inc: { attempt: 1 } 
      }
    );

    // Atomically claim the next available job
    const filter: MongoFilter = {
      status: 'waiting',
      $or: [
        { delayTime: null }, 
        { delayTime: { $lte: now } }
      ]
    };

    const update: MongoUpdate = {
      $set: {
        status: 'reserved',
        reserveTime: now
      }
    };

    const options: QueryOptions = {
      sort: { priority: -1, pushTime: 1 },
      new: true
    };

    const doc = await this.model.findOneAndUpdate(filter, update, options);
    
    if (!doc) {
      return null;
    }

    // Update expireTime separately to include TTR
    const ttr = doc.ttr || 300;
    await this.model.updateOne(
      { _id: doc._id },
      { $set: { expireTime: new Date(now.getTime() + ttr * 1000) } }
    );

    return {
      id: doc._id.toHexString(),
      payload: doc.payload,
      meta: {
        ttr: doc.ttr,
        delaySeconds: doc.delaySeconds,
        priority: doc.priority,
        pushedAt: doc.pushTime,
        reservedAt: now
      },
      pushedAt: doc.pushTime,
      reservedAt: now
    };
  }

  async completeJob(id: string): Promise<void> {
    await this.model.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { status: 'done', doneTime: new Date() } }
    );
  }

  async releaseJob(id: string): Promise<void> {
    await this.model.updateOne(
      { _id: new Types.ObjectId(id) },
      { 
        $set: { 
          status: 'waiting', 
          reserveTime: null, 
          expireTime: null 
        } 
      }
    );
  }

  async failJob(id: string, error: string): Promise<void> {
    await this.model.updateOne(
      { _id: new Types.ObjectId(id) },
      { 
        $set: { 
          status: 'failed', 
          errorMessage: error, 
          doneTime: new Date() 
        } 
      }
    );
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    const doc = await this.model.findOne(
      { _id: new Types.ObjectId(id) }, 
      { status: 1, delayTime: 1 }
    ).exec();
    
    if (!doc) {
      return null;
    }
    
    // Check if job is delayed
    if (doc.status === 'waiting' && doc.delayTime && doc.delayTime > new Date()) {
      return 'delayed';
    }
    
    switch (doc.status) {
      case 'waiting':
        return 'waiting';
      case 'reserved':
        return 'reserved';
      case 'done':
      case 'failed':
        return 'done';
      default:
        return null;
    }
  }
}

// Mongoose-specific queue class
export class MongooseQueue<TJobMap = Record<string, unknown>> extends DbQueue<TJobMap> {
  mongooseAdapter: MongooseDatabaseAdapter;
  
  constructor(config: { model: Model<IQueueJob>; name: string }) {
    const adapter = new MongooseDatabaseAdapter(config.model);
    super(adapter, { name: config.name });
    this.mongooseAdapter = adapter;
  }
}


// Create a default queue model
export function createQueueModel(
  modelName: string = 'QueueJob',
  collectionName?: string
): Model<IQueueJob> {
  // Check if model already exists
  try {
    return model<IQueueJob>(modelName);
  } catch {
    // Create new model
    const schema = QueueJobSchema.clone();
    if (collectionName) {
      schema.set('collection', collectionName);
    }
    return model<IQueueJob>(modelName, schema);
  }
}

// Export the default QueueJob model
export const QueueJob = createQueueModel();

// Re-export for convenience
export { DbQueue };

// Re-export job interface for Mongoose adapter
export type { MongooseJobRequest } from '../interfaces/job.ts';