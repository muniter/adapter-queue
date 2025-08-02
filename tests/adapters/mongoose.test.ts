import { describe, it, expect, beforeAll, afterAll, beforeEach, assert } from 'vitest';
import mongoose from 'mongoose';
import { GenericContainer } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { 
  createMongooseQueue, 
  createQueueModel,
  MongooseDatabaseAdapter,
  QueueJobSchema 
} from '../../src/adapters/mongoose.ts';
import type { IQueueJob } from '../../src/adapters/mongoose.ts';
import type { JobMeta } from '../../src/interfaces/job.ts';

describe('Mongoose Adapter', () => {
  let mongoContainer: StartedTestContainer;
  let testModel: mongoose.Model<IQueueJob>;

  beforeAll(async () => {
    // Start MongoDB container
    mongoContainer = await new GenericContainer('mongo:7')
      .withExposedPorts(27017)
      .withEnvironment({ MONGO_INITDB_ROOT_USERNAME: 'root', MONGO_INITDB_ROOT_PASSWORD: 'root' })
      .start();
    
    const host = mongoContainer.getHost();
    const port = mongoContainer.getMappedPort(27017);
    const uri = `mongodb://root:root@${host}:${port}/test?authSource=admin`;
    
    await mongoose.connect(uri);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoContainer.stop();
  });

  beforeEach(async () => {
    // Clear all collections
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      if (collection) {
        await collection.deleteMany({});
      }
    }
    
    // Create fresh model for each test
    const modelName = `TestModel_${Date.now()}`;
    testModel = mongoose.model<IQueueJob>(modelName, QueueJobSchema.clone());
  });

  describe('MongooseDatabaseAdapter', () => {
    it('should implement insertJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const meta: JobMeta = {
        ttr: 300,
        delaySeconds: 0,
        priority: 0
      };

      const jobId = await adapter.insertJob(Buffer.from('test'), meta);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      // Verify document was inserted
      const found = await testModel.findById(jobId);
      expect(found).toBeDefined();
      expect(found?.status).toBe('waiting');
      expect(Buffer.compare(found?.payload || Buffer.alloc(0), Buffer.from('test'))).toBe(0);
    });

    it('should implement reserveJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      // Insert a job first
      const jobId = await adapter.insertJob(Buffer.from('test job'), { ttr: 300 });

      // Reserve it
      const job = await adapter.reserveJob(60);

      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
      expect(Buffer.compare(job?.payload || Buffer.alloc(0), Buffer.from('test job'))).toBe(0);
      expect(job?.meta.ttr).toBe(300);
      
      // Verify status changed
      const doc = await testModel.findById(jobId);
      expect(doc?.status).toBe('reserved');
    });

    it('should implement completeJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const jobId = await adapter.insertJob(Buffer.from('test'), { ttr: 300 });

      await adapter.completeJob(jobId);

      const updated = await testModel.findById(jobId);
      expect(updated?.status).toBe('done');
      expect(updated?.doneTime).toBeInstanceOf(Date);
    });

    it('should implement getJobStatus correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const jobId = await adapter.insertJob(Buffer.from('test'), { ttr: 300 });

      let status = await adapter.getJobStatus(jobId);
      expect(status).toBe('waiting');
      
      // Reserve the job
      await adapter.reserveJob(60);
      status = await adapter.getJobStatus(jobId);
      expect(status).toBe('reserved');
      
      // Complete the job
      await adapter.completeJob(jobId);
      status = await adapter.getJobStatus(jobId);
      expect(status).toBe('done');
    });

    it('should implement failJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const jobId = await adapter.insertJob(Buffer.from('test'), { ttr: 300 });

      await adapter.failJob(jobId, 'Test error');

      const doc = await testModel.findById(jobId);
      expect(doc?.status).toBe('failed');
      expect(doc?.errorMessage).toBe('Test error');
    });

    it('should implement releaseJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const jobId = await adapter.insertJob(Buffer.from('test'), { ttr: 300 });
      
      // Reserve then release
      await adapter.reserveJob(60);
      await adapter.releaseJob(jobId);

      const doc = await testModel.findById(jobId);
      expect(doc?.status).toBe('waiting');
      expect(doc?.reserveTime).toBeNull();
      expect(doc?.expireTime).toBeNull();
    });
  });

  describe('createMongooseQueue', () => {
    it('should create a queue with default model', () => {
      const queue = createMongooseQueue('test-queue');
      expect(queue).toBeDefined();
      expect(queue.name).toBe('test-queue');
    });

    it('should create a queue with custom model', () => {
      const queue = createMongooseQueue('test-queue', testModel);
      expect(queue).toBeDefined();
      expect(queue.name).toBe('test-queue');
    });

    it('should push and retrieve jobs', async () => {
      const queue = createMongooseQueue<{
        'test-job': { message: string };
      }>('test-queue', testModel);

      let processedMessage = '';
      queue.setHandlers({
        'test-job': async (job) => {
          processedMessage = job.payload.message;
        }
      });

      const jobId = await queue.addJob('test-job', { payload: { message: 'Hello Mongoose!' } });
      expect(jobId).toBeDefined();

      // Process the job
      await queue.run();
      
      expect(processedMessage).toBe('Hello Mongoose!');
    });

    it('should handle job priorities', async () => {
      const queue = createMongooseQueue<{
        'priority-job': { priority: number };
      }>('test-queue', testModel);

      // Push jobs with different priorities
      await queue.addJob('priority-job', { payload: { priority: 1 }, priority: 1 });
      await queue.addJob('priority-job', { payload: { priority: 3 }, priority: 3 });
      await queue.addJob('priority-job', { payload: { priority: 2 }, priority: 2 });

      // Reserve jobs - should get highest priority first
      const job1 = await queue.mongooseAdapter.reserveJob(60);
      assert(job1);
      const payload = JSON.parse(job1.payload.toString());
      expect(payload.payload.priority).toBe(3);
    });

    it('should handle delayed jobs', async () => {
      const queue = createMongooseQueue<{
        'delayed-job': { when: string };
      }>('test-queue', testModel);

      // Push a delayed job
      await queue.addJob('delayed-job', { payload: { when: 'future' }, delaySeconds: 2 });

      // Should not be available immediately
      const job1 = await queue.mongooseAdapter.reserveJob(60);
      expect(job1).toBeNull();

      // Wait for delay to pass
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Now should be available
      const job2 = await queue.mongooseAdapter.reserveJob(60);
      expect(job2).toBeDefined();
    });
  });

  describe('createQueueModel', () => {
    it('should create a model with default name', () => {
      const model = createQueueModel();
      expect(model.modelName).toBe('QueueJob');
    });

    it('should create a model with custom name and collection', () => {
      const modelName = `CustomJob_${Date.now()}`;
      const model = createQueueModel(modelName, 'custom_collection');
      expect(model.modelName).toBe(modelName);
      expect(model.collection.name).toBe('custom_collection');
    });

    it('should handle model already exists', () => {
      const modelName = `ExistingModel_${Date.now()}`;
      const model1 = createQueueModel(modelName);
      const model2 = createQueueModel(modelName);
      
      // Should return the same model instance
      expect(model1).toBe(model2);
    });
  });

  describe('Integration with Mongoose features', () => {
    it('should work with Mongoose queries', async () => {
      const queue = createMongooseQueue('test-queue', testModel);

      await queue.addJob('test-job', { payload: { data: 'test1' } });
      await queue.addJob('test-job', { payload: { data: 'test2' } });
      await queue.addJob('test-job', { payload: { data: 'test3' } });

      // Use Mongoose query directly
      const waitingJobs = await testModel.find({ status: 'waiting' });
      expect(waitingJobs.length).toBe(3);

      const count = await testModel.countDocuments({ status: 'waiting' });
      expect(count).toBe(3);
    });

    it('should maintain Mongoose document structure', async () => {
      const queue = createMongooseQueue('test-queue', testModel);
      
      const jobId = await queue.addJob('test-job', { payload: { test: true } });

      // Find using Mongoose
      const doc = await testModel.findOne({ _id: new mongoose.Types.ObjectId(jobId) });
      expect(doc).toBeDefined();
      expect(doc?.payload).toBeInstanceOf(Buffer);
      expect(doc?.status).toBe('waiting');
      expect(doc?.pushTime).toBeInstanceOf(Date);
    });
  });
});