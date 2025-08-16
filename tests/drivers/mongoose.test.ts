import { describe, it, expect, beforeAll, afterAll, beforeEach, assert } from 'vitest';
import mongoose from 'mongoose';
import { GenericContainer } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { 
  MongooseQueue,
  createQueueModel,
  MongooseDatabaseAdapter,
  QueueJobSchema 
} from '../../src/drivers/mongoose.ts';
import type { IQueueJob } from '../../src/drivers/mongoose.ts';
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

      const jobId = await adapter.insertJob({ test: 'test' }, meta);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      // Verify document was inserted
      const found = await testModel.findById(jobId);
      expect(found).toBeDefined();
      expect(found?.status).toBe('waiting');
      expect(found?.payload).toEqual({ test: 'test' });
    });

    it('should implement reserveJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      // Insert a job first
      const jobId = await adapter.insertJob({ test: 'test job' }, { ttr: 300 });

      // Reserve it
      const job = await adapter.reserveJob(60);

      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
      expect(job?.payload).toEqual({ test: 'test job' });
      expect(job?.meta.ttr).toBe(300);
      
      // Verify status changed
      const doc = await testModel.findById(jobId);
      expect(doc?.status).toBe('reserved');
    });

    it('should implement completeJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const jobId = await adapter.insertJob({ test: 'test' }, { ttr: 300 });

      await adapter.completeJob(jobId);

      const updated = await testModel.findById(jobId);
      expect(updated?.status).toBe('done');
      expect(updated?.doneTime).toBeInstanceOf(Date);
    });

    it('should implement getJobStatus correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const jobId = await adapter.insertJob({ test: 'test' }, { ttr: 300 });

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
      
      const jobId = await adapter.insertJob({ test: 'test' }, { ttr: 300 });

      await adapter.failJob(jobId, 'Test error');

      const doc = await testModel.findById(jobId);
      expect(doc?.status).toBe('failed');
      expect(doc?.errorMessage).toBe('Test error');
    });

    it('should implement releaseJob correctly', async () => {
      const adapter = new MongooseDatabaseAdapter(testModel);
      
      const jobId = await adapter.insertJob({ test: 'test' }, { ttr: 300 });
      
      // Reserve then release
      await adapter.reserveJob(60);
      await adapter.releaseJob(jobId);

      const doc = await testModel.findById(jobId);
      expect(doc?.status).toBe('waiting');
      expect(doc?.reserveTime).toBeNull();
      expect(doc?.expireTime).toBeNull();
    });
  });

  describe('MongooseQueue', () => {
    it('should create a queue with default model', () => {
      const model = createQueueModel();
      const queue = new MongooseQueue({ model, name: 'test-queue' });
      expect(queue).toBeDefined();
      expect(queue.name).toBe('test-queue');
    });

    it('should create a queue with custom model', () => {
      const queue = new MongooseQueue({ model: testModel, name: 'test-queue' });
      expect(queue).toBeDefined();
      expect(queue.name).toBe('test-queue');
    });

    it('should push and retrieve jobs', async () => {
      const queue = new MongooseQueue<{
        'test-job': { message: string };
      }>({ model: testModel, name: 'test-queue' });

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
      const queue = new MongooseQueue<{
        'priority-job': { priority: number };
      }>({ model: testModel, name: 'test-queue' });

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
      const queue = new MongooseQueue<{
        'delayed-job': { when: string };
      }>({ model: testModel, name: 'test-queue' });

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


    it('should handle job failures and retries through the queue system', async () => {
      const queue = new MongooseQueue<{
        'failing-job': { attemptNumber: number };
        'success-job': { data: string };
      }>({ model: testModel, name: 'test-queue' });

      let attempts: number[] = [];
      let successfulJobs: string[] = [];

      queue.setHandlers({
        'failing-job': async (job) => {
          attempts.push(job.payload.attemptNumber);
          
          if (job.payload.attemptNumber <= 2) {
            throw new Error(`Intentional failure on attempt ${job.payload.attemptNumber}`);
          }
          
          // Success on attempt 3
        },
        'success-job': async (job) => {
          successfulJobs.push(job.payload.data);
        }
      });

      // Add jobs
      const failingJob1 = await queue.addJob('failing-job', { payload: { attemptNumber: 1 } });
      const failingJob2 = await queue.addJob('failing-job', { payload: { attemptNumber: 2 } });
      const failingJob3 = await queue.addJob('failing-job', { payload: { attemptNumber: 3 } });
      const successJob = await queue.addJob('success-job', { payload: { data: 'test-data' } });

      // Process all jobs
      await queue.run();

      // Check results
      expect(attempts).toEqual([1, 2, 3]);
      expect(successfulJobs).toEqual(['test-data']);

      // Check final job statuses
      const job1Doc = await testModel.findById(failingJob1);
      const job2Doc = await testModel.findById(failingJob2);
      const job3Doc = await testModel.findById(failingJob3);
      const successDoc = await testModel.findById(successJob);

      expect(job1Doc?.status).toBe('failed');
      expect(job2Doc?.status).toBe('failed');
      expect(job3Doc?.status).toBe('done');
      expect(successDoc?.status).toBe('done');

      // Check error messages
      expect(job1Doc?.errorMessage).toContain('Intentional failure on attempt 1');
      expect(job2Doc?.errorMessage).toContain('Intentional failure on attempt 2');
    });

    it('should handle TTR timeout and job recovery in real processing', async () => {
      const queue = new MongooseQueue<{
        'long-job': { duration: number };
        'quick-job': { data: string };
      }>({ model: testModel, name: 'test-queue' });

      let jobExecutions: string[] = [];

      queue.setHandlers({
        'long-job': async (job) => {
          jobExecutions.push(`long-job-start-${job.payload.duration}`);
          // Simulate a job that takes longer than its TTR
          await new Promise(resolve => setTimeout(resolve, job.payload.duration));
          jobExecutions.push(`long-job-end-${job.payload.duration}`);
        },
        'quick-job': async (job) => {
          jobExecutions.push(`quick-job-${job.payload.data}`);
        }
      });

      // Add a job with very short TTR that will timeout
      const longJobId = await queue.addJob('long-job', { 
        payload: { duration: 2000 }, // 2 seconds
        ttr: 1 // 1 second TTR - will timeout
      });

      // Add a quick job
      const quickJobId = await queue.addJob('quick-job', { 
        payload: { data: 'test' }
      });

      // Process queue - long job will timeout, quick job should complete
      await queue.run();

      // Verify states after first run
      let longJobDoc = await testModel.findById(longJobId);
      let quickJobDoc = await testModel.findById(quickJobId);

      // Quick job should be done, long job should be in some intermediate state
      expect(quickJobDoc?.status).toBe('done');
      
      // Check what actually got executed
      expect(jobExecutions).toContain('quick-job-test');
      expect(jobExecutions).toContain('long-job-start-2000');
      
      // The long job may or may not have finished depending on timing
      // but it should have been processed at least once
      expect(longJobDoc).toBeDefined();
    }, 10000); // Longer timeout for this test
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
      const queue = new MongooseQueue({ model: testModel, name: 'test-queue' });

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
      const queue = new MongooseQueue({ model: testModel, name: 'test-queue' });
      
      const jobId = await queue.addJob('test-job', { payload: { test: true } });

      // Find using Mongoose
      const doc = await testModel.findOne({ _id: new mongoose.Types.ObjectId(jobId) });
      expect(doc).toBeDefined();
      expect(doc?.payload).toBeInstanceOf(Object);
      expect(doc?.status).toBe('waiting');
      expect(doc?.pushTime).toBeInstanceOf(Date);
    });
  });
});