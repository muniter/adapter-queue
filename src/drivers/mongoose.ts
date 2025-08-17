import { Schema, model, Model, Document, Types } from "mongoose";
import type {
  DatabaseAdapter,
  QueueJobRecord,
} from "../interfaces/database.ts";
import type {
  JobMeta,
  JobStatus,
  BaseJobOptions,
  WithPriority,
  WithDelay,
} from "../interfaces/job.ts";
import { DbQueue } from "../drivers/db.ts";

// Driver-specific job request interface
export interface MongooseJobRequest<TPayload>
  extends BaseJobOptions,
    WithPriority,
    WithDelay {
  /** Job payload */
  payload: TPayload;
  // Mongoose/MongoDB queue supports both priority and delays
}

// MongoDB document structure for queue jobs
export interface IQueueJobDocument {
  payload: any;
  name: string;
  ttr: number;
  delaySeconds: number;
  priority: number;
  pushTime: Date;
  delayTime: Date | null;
  reserveTime: Date | null;
  doneTime: Date | null;
  expireTime: Date | null;
  status: "waiting" | "reserved" | "done" | "failed";
  attempt: number;
  errorMessage?: string;
}

// Mongoose document interface
export interface IQueueJob extends IQueueJobDocument, Document {
  _id: Types.ObjectId;
}

// Queue job schema
export const QueueJobSchema = new Schema<IQueueJob>(
  {
    name: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
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
      enum: ["waiting", "reserved", "done", "failed"],
      default: "waiting",
    },
    attempt: { type: Number, required: true, default: 0 },
    errorMessage: { type: String },
  },
  {
    collection: "queue_jobs",
    timestamps: false,
  }
);

// Add indexes
QueueJobSchema.index({ status: 1, delayTime: 1, priority: -1, pushTime: 1 });
QueueJobSchema.index({ status: 1, expireTime: 1 });
QueueJobSchema.index({ _id: 1, status: 1 });

// Mongoose database adapter implementing DatabaseAdapter interface
export class MongooseDatabaseAdapter implements DatabaseAdapter {
  constructor(private model: Model<IQueueJob>) {}

  async insertJob(payload: unknown, meta: JobMeta): Promise<string> {
    const now = new Date();

    const doc = await this.model
      .create({
        payload,
        name: meta.name,
        ttr: meta.ttr ?? 300,
        delaySeconds: meta.delaySeconds ?? 0,
        priority: meta.priority ?? 0,
        pushTime: now,
        delayTime: meta.delaySeconds
          ? new Date(now.getTime() + meta.delaySeconds * 1000)
          : null,
        status: "waiting",
        attempt: 0,
      })
      .catch((err) => {
        if (err instanceof Error && "code" in err) {
          if (err.code === 256) {
            const newError = new Error(
              "Error trying to insert job, you probably forgot to await the addJob call and the mongoose session was closed"
            );
            newError.cause = err;
            throw newError;
          }
        }
        throw err;
      });

    return doc._id.toHexString();
  }

  async reserveJob(timeout: number): Promise<QueueJobRecord | null> {
    const now = new Date();

    // First, recover timed-out jobs
    await this.model.updateMany(
      {
        status: "reserved",
        expireTime: { $lt: now },
      },
      {
        $set: {
          status: "waiting",
          reserveTime: null,
          expireTime: null,
        },
        $inc: { attempt: 1 },
      },
      {
        session: undefined,
      }
    );

    const doc = await this.model.findOneAndUpdate(
      // Atomically claim the next available job
      {
        status: "waiting",
        $or: [{ delayTime: null }, { delayTime: { $lte: now } }],
      },
      {
        $set: {
          status: "reserved",
          reserveTime: now,
        },
      },
      {
        sort: { priority: -1, pushTime: 1 },
        new: true,
        session: undefined,
      }
    );

    if (!doc) {
      return null;
    }

    // Update expireTime separately to include TTR
    const ttr = doc.ttr || 300;
    await this.model.updateOne(
      { _id: doc._id },
      { $set: { expireTime: new Date(now.getTime() + ttr * 1000) } },
      { session: undefined }
    );

    return {
      id: doc._id.toHexString(),
      meta: {
        name: doc.name,
        ttr: doc.ttr,
        delaySeconds: doc.delaySeconds,
        priority: doc.priority,
        pushedAt: doc.pushTime,
        reservedAt: now,
      },
      payload: doc.payload,
      pushedAt: doc.pushTime,
      reservedAt: now,
    };
  }

  async completeJob(id: string): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      { $set: { status: "done", doneTime: new Date() } },
      { session: undefined }
    );
  }

  async releaseJob(id: string): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      {
        $set: {
          status: "waiting",
          reserveTime: null,
          expireTime: null,
        },
      },
      { session: undefined }
    );
  }

  async failJob(id: string, error: string): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      {
        $set: {
          status: "failed",
          errorMessage: error,
          doneTime: new Date(),
        },
      },
      { session: undefined }
    );
  }

  async getJobStatus(id: string): Promise<JobStatus | null> {
    const doc = await this.model
      .findOne({ _id: id }, { status: 1, delayTime: 1 }, { session: undefined })
      .exec();

    if (!doc) {
      return null;
    }

    // Check if job is delayed
    if (
      doc.status === "waiting" &&
      doc.delayTime &&
      doc.delayTime > new Date()
    ) {
      return "delayed";
    }

    switch (doc.status) {
      case "waiting":
        return "waiting";
      case "reserved":
        return "reserved";
      case "done":
      case "failed":
        return "done";
      default:
        return null;
    }
  }
}

// Mongoose-specific queue class
export class MongooseQueue<
  TJobMap = Record<string, unknown>
> extends DbQueue<TJobMap> {
  mongooseAdapter: MongooseDatabaseAdapter;
  model: Model<IQueueJob>;

  constructor(config: { model?: Model<IQueueJob>; name: string }) {
    const model = config.model ?? createQueueModel(config.name);
    const adapter = new MongooseDatabaseAdapter(model);
    super(adapter, { name: config.name });
    this.model = model;
    this.mongooseAdapter = adapter;
  }
}

// Create a default queue model
export function createQueueModel(
  modelName: string = "QueueJob",
  collectionName?: string
): Model<IQueueJob> {
  // Check if model already exists
  try {
    return model<IQueueJob>(modelName);
  } catch {
    // Create new model
    const schema = QueueJobSchema.clone();
    if (collectionName) {
      schema.set("collection", collectionName);
    }
    return model<IQueueJob>(modelName, schema);
  }
}