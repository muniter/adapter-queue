import { Collection, ObjectId, MongoClient } from 'mongodb';
import type { DatabaseAdapter, QueueJobRecord } from '../interfaces/database.ts';
import type { JobMeta, JobStatus } from '../interfaces/job.ts';
import { DbQueue } from '../drivers/db.ts';

// Generic MongoDB collection interface - works with mongodb driver
export interface MongoCollection {
  insertOne(doc: any): Promise<{ insertedId: ObjectId }>;
  findOneAndUpdate(filter: any, update: any, options?: any): Promise<any>;
  updateOne(filter: any, update: any): Promise<any>;
  updateMany(filter: any, update: any): Promise<any>;
  findOne(filter: any, options?: any): Promise<any>;
  deleteOne(filter: any): Promise<any>;
  createIndex(keys: any, options?: any): Promise<any>;
}

export interface MongoConfig {
  url?: string;
  database?: string;
  collection?: string;
}

export class MongoDatabaseAdapter implements DatabaseAdapter {
  private indexesInitialized: Promise<void>;

  constructor(private col: MongoCollection) {
    this.indexesInitialized = this.initializeIndexes();
  }

  private async initializeIndexes(): Promise<void> {
    try {
      // Create indexes for performance
      await Promise.all([
        // Index for job reservation (status + delayTime + priority + pushTime)
        this.col.createIndex(
          { status: 1, delayTime: 1, priority: -1, pushTime: 1 },
          { background: true }
        ),
        // Index for expired job recovery
        this.col.createIndex(
          { status: 1, expireTime: 1 },
          { background: true }
        ),
        // Index for job status lookup
        this.col.createIndex({ _id: 1, status: 1 }, { background: true })
      ]);
    } catch (error) {
      // Indexes might already exist or collection might not support them
      console.warn('MongoDB index creation warning:', error);
    }
  }

  async ensureIndexes(): Promise<void> {
    await this.indexesInitialized;
  }

  async insertJob(payload: Buffer, meta: JobMeta): Promise<string> {
    const now = new Date();

    const res = await this.col.insertOne({
      payload,
      ttr: meta.ttr ?? 300,
      delay: meta.delay ?? 0,
      priority: meta.priority ?? 0,
      pushTime: now,
      delayTime: meta.delay ? new Date(now.getTime() + meta.delay * 1000) : null,
      status: 'waiting',
      attempt: 0
    });

    return res.insertedId.toHexString();
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = new Date();

    // Recover timed-out jobs in one bulk operation
    await this.col.updateMany(
      { status: 'reserved', expireTime: { $lt: now } },
      { 
        $set: { status: 'waiting', reserveTime: null, expireTime: null }, 
        $inc: { attempt: 1 } 
      }
    );

    // Atomically claim the next job - use simpler approach
    const result = await this.col.findOneAndUpdate(
      {
        status: 'waiting',
        $or: [{ delayTime: null }, { delayTime: { $lte: now } }]
      },
      {
        $set: {
          status: 'reserved',
          reserveTime: now
        }
      },
      { 
        sort: { priority: -1, pushTime: 1 }, 
        returnDocument: 'after' 
      }
    );

    const doc = result;
    if (!doc) return null;

    // Update expireTime after we have the job document with its TTR
    await this.col.updateOne(
      { _id: doc._id },
      { $set: { expireTime: new Date(now.getTime() + doc.ttr * 1000) } }
    );

    return {
      id: doc._id.toHexString(),
      payload: Buffer.from(doc.payload?.buffer || doc.payload || []), // Handle Binary/Buffer/empty
      meta: {
        ttr: doc.ttr,
        delay: doc.delay,
        priority: doc.priority,
        pushedAt: doc.pushTime,
        reservedAt: now
      },
      pushedAt: doc.pushTime,
      reservedAt: now
    };
  }

  async completeJob(id: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'done', doneTime: new Date() } }
    );
  }

  async releaseJob(id: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'waiting', reserveTime: null, expireTime: null } }
    );
  }

  async failJob(id: string, error: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'failed', errorMessage: error, doneTime: new Date() } }
    );
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    const doc = await this.col.findOne(
      { _id: new ObjectId(id) }, 
      { projection: { status: 1 } }
    );
    
    if (!doc) return null;
    
    switch (doc.status) {
      case 'waiting':
        return 'waiting';
      case 'reserved':
        return 'reserved';
      case 'done':
        return 'done';
      case 'failed':
        return 'done'; // Map failed to done for consistency
      default:
        return null;
    }
  }

  async deleteJob(id: string): Promise<void> {
    await this.col.deleteOne({ _id: new ObjectId(id) });
  }

  async markJobDone(id: string): Promise<void> {
    return this.completeJob(id);
  }

  async close(): Promise<void> {
    // MongoDB collections don't need explicit closing
    // The client connection should be managed by the user
  }
}

// Main export - constructor pattern
export class MongoQueue<T = Record<string, any>> extends DbQueue<T> {
  mongoAdapter: MongoDatabaseAdapter;
  constructor(config: { collection: MongoCollection }) {
    const adapter = new MongoDatabaseAdapter(config.collection);
    super(adapter);
    this.mongoAdapter = adapter;
  }
}

// Convenience factory for MongoDB driver
export function createMongoQueue<T = Record<string, any>>(
  client: MongoClient,
  database: string,
  collection: string = 'jobs'
): MongoQueue<T> {
  const db = client.db(database);
  const col = db.collection(collection);
  return new MongoQueue<T>({ collection: col });
}

// Convenience factory with connection string
export async function createMongoQueueFromUrl<T = Record<string, any>>(
  url: string,
  database: string,
  collection: string = 'jobs'
): Promise<MongoQueue<T>> {
  const client = new MongoClient(url);
  await client.connect();
  return createMongoQueue<T>(client, database, collection);
}

// Re-export for convenience
export { DbQueue };