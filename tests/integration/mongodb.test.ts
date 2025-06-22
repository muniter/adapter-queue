import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { MongoClient, ObjectId } from 'mongodb';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { MongoQueue, createMongoQueue, createMongoQueueFromUrl, MongoDatabaseAdapter } from '../../src/adapters/mongodb.ts';

interface TestJobs {
  'simple-job': { data: string };
  'delayed-job': { message: string };
  'failing-job': { shouldFail: boolean };
  'priority-job': { priority: number; data: string };
}

describe('MongoDB Integration Tests (with TestContainers)', () => {
  let mongoContainer: StartedTestContainer;
  let client: MongoClient;
  let queue: MongoQueue<TestJobs>;
  let mongoUrl: string;
  const testDatabase = 'queue_test';
  const testCollection = 'test_jobs';

  beforeAll(async () => {
    // Start MongoDB container with non-default port to avoid conflicts
    mongoContainer = await new GenericContainer('mongo:7')
      .withExposedPorts({ container: 27017, host: 0 }) // Let Docker assign a random available port
      .withStartupTimeout(60000)
      .start();
    
    const mongoPort = mongoContainer.getMappedPort(27017);
    const mongoHost = mongoContainer.getHost();
    mongoUrl = `mongodb://${mongoHost}:${mongoPort}`;
    
    console.log(`MongoDB container started at ${mongoUrl}`);
    
    client = new MongoClient(mongoUrl);
    await client.connect();
  }, 90000); // 90 second timeout for container startup

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (mongoContainer) {
      await mongoContainer.stop();
    }
  });

  beforeEach(async () => {
    // Clean up any existing test data
    const db = client.db(testDatabase);
    await db.collection(testCollection).deleteMany({});
    
    queue = createMongoQueue<TestJobs>(client, testDatabase, testCollection);
  });

  afterEach(async () => {
    // Clean up test data
    const db = client.db(testDatabase);
    await db.collection(testCollection).deleteMany({});
  });

  describe('MongoQueue Constructor Pattern', () => {
    it('should create queue with collection instance', () => {
      expect(queue).toBeInstanceOf(MongoQueue);
    });

    it('should create indexes automatically', async () => {
      // Add a job to trigger index creation
      await queue.addJob('simple-job', { payload: { data: 'test' } });
      
      // Check that indexes exist
      const db = client.db(testDatabase);
      const collection = db.collection(testCollection);
      const indexes = await collection.listIndexes().toArray();
      
      expect(indexes.length).toBeGreaterThan(1); // Should have more than just the default _id index
    });
  });

  describe('Convenience Factories', () => {
    it('should create queue with createMongoQueue factory', () => {
      const factoryQueue = createMongoQueue<TestJobs>(client, testDatabase, 'factory_test');
      expect(factoryQueue).toBeInstanceOf(MongoQueue);
    });

    it('should create queue with createMongoQueueFromUrl factory', async () => {
      const factoryQueue = await createMongoQueueFromUrl<TestJobs>(mongoUrl, testDatabase, 'url_test');
      expect(factoryQueue).toBeInstanceOf(MongoQueue);
      
      // Clean up the client created by the factory
      const factoryClient = (factoryQueue as any).db.col.client;
      if (factoryClient && factoryClient.close) {
        await factoryClient.close();
      }
    });
  });

  describe('Job Lifecycle', () => {
    it('should add and process jobs successfully', async () => {
      const processedJobs: string[] = [];
      
      queue.onJob('simple-job', async (payload) => {
        processedJobs.push(payload.data);
      });

      const id1 = await queue.addJob('simple-job', { payload: { data: 'test1' } });
      const id2 = await queue.addJob('simple-job', { payload: { data: 'test2' } });

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);

      // Process jobs once
      await queue.run(false);

      expect(processedJobs).toEqual(expect.arrayContaining(['test1', 'test2']));
    });

    it('should handle job status tracking', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'status test' } });
      
      // Initially waiting
      expect(await queue.status(id)).toBe('waiting');
      
      // Verify job is stored in MongoDB
      const db = client.db(testDatabase);
      const collection = db.collection(testCollection);
      const job = await collection.findOne({ _id: new ObjectId(id) });
      expect(job).toBeTruthy();
      expect(job?.status).toBe('waiting');
    });

    it('should handle job delays correctly', async () => {
      const processedJobs: string[] = [];
      
      queue.onJob('delayed-job', async (payload) => {
        processedJobs.push(payload.message);
      });

      // Add delayed job (1 second delay)
      await queue.addJob('delayed-job', { 
        payload: { message: 'delayed' }, 
        delay: 1 
      });

      // Should not process immediately
      await queue.run(false);
      expect(processedJobs).toHaveLength(0);

      // Wait for delay and process again
      await new Promise(resolve => setTimeout(resolve, 1100));
      await queue.run(false);
      expect(processedJobs).toEqual(['delayed']);
    });

    it('should handle job priorities correctly', async () => {
      const processedJobs: Array<{ priority: number; data: string }> = [];
      
      queue.onJob('priority-job', async (payload) => {
        processedJobs.push(payload);
      });

      // Add jobs with different priorities (higher number = higher priority)
      await queue.addJob('priority-job', { 
        payload: { priority: 1, data: 'low' }, 
        priority: 1 
      });
      await queue.addJob('priority-job', { 
        payload: { priority: 5, data: 'high' }, 
        priority: 5 
      });
      await queue.addJob('priority-job', { 
        payload: { priority: 3, data: 'medium' }, 
        priority: 3 
      });

      await queue.run(false);

      // Should process in priority order (high to low)
      expect(processedJobs.map(j => j.data)).toEqual(['high', 'medium', 'low']);
    });

    it('should handle job failures and errors', async () => {
      const errors: any[] = [];
      
      queue.onJob('failing-job', async (payload) => {
        if (payload.shouldFail) {
          throw new Error('Job intentionally failed');
        }
      });

      queue.on('afterError', (event) => {
        errors.push(event.error);
      });

      await queue.addJob('failing-job', { payload: { shouldFail: true } });
      await queue.run(false);

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Job intentionally failed');
    });
  });

  describe('TTR (Time To Run) Handling', () => {
    it('should respect job TTR settings', async () => {
      const id = await queue.addJob('simple-job', { 
        payload: { data: 'ttr test' },
        ttr: 10 // 10 seconds
      });

      // Verify TTR is stored correctly
      const db = client.db(testDatabase);
      const collection = db.collection(testCollection);
      const job = await collection.findOne({ _id: new ObjectId(id) });
      expect(job?.ttr).toBe(10);
    });
  });

  describe('MongoDB Persistence', () => {
    it('should persist jobs across queue instances', async () => {
      // Add job with first queue instance
      const id = await queue.addJob('simple-job', { payload: { data: 'persistent' } });
      
      // Create new queue instance with same collection
      const queue2 = createMongoQueue<TestJobs>(client, testDatabase, testCollection);
      
      // Should be able to see the job
      const status = await queue2.status(id);
      expect(status).toBe('waiting');
    });
  });

  describe('Adapter Direct Usage', () => {
    it('should work with adapter directly', async () => {
      const db = client.db(testDatabase);
      const collection = db.collection('direct_test');
      const adapter = new MongoDatabaseAdapter(collection);
      
      const payload = Buffer.from(JSON.stringify({ data: 'direct adapter test' }));
      
      const id = await adapter.insertJob(payload, { ttr: 300 });
      expect(id).toBeTruthy();
      
      const job = await adapter.reserveJob(5);
      expect(job).toBeTruthy();
      expect(job!.id).toBe(id);
      expect(job!.payload).toEqual(payload);
      
      await adapter.completeJob(id);
      const status = await adapter.getJobStatus(id);
      expect(status).toBe('done');
      
      // Clean up
      await collection.deleteMany({});
    });
  });

  describe('MongoDB-Specific Features', () => {
    it('should handle ObjectId conversion correctly', async () => {
      const id = await queue.addJob('simple-job', { payload: { data: 'objectid test' } });
      
      // ID should be a valid MongoDB ObjectId hex string
      expect(id).toMatch(/^[0-9a-fA-F]{24}$/);
      
      // Should be able to retrieve job by ID
      const status = await queue.status(id);
      expect(status).toBe('waiting');
    });

    it('should handle atomic job reservation with server-side TTR calculation', async () => {
      const processedJobs: string[] = [];
      let reservedJobDoc: any;
      
      queue.onJob('simple-job', async (payload) => {
        processedJobs.push(payload.data);
        
        // Check the job document during processing to verify TTR calculation
        const db = client.db(testDatabase);
        const collection = db.collection(testCollection);
        reservedJobDoc = await collection.findOne({ status: 'reserved' });
      });

      await queue.addJob('simple-job', { 
        payload: { data: 'atomic test' },
        ttr: 30 
      });
      await queue.run(false);

      expect(processedJobs).toEqual(['atomic test']);
      expect(reservedJobDoc).toBeTruthy();
      expect(reservedJobDoc.expireTime).toBeInstanceOf(Date);
      expect(reservedJobDoc.reserveTime).toBeInstanceOf(Date);
    });

    it('should handle large payloads efficiently', async () => {
      const largeData = 'x'.repeat(10000); // 10KB payload
      const processedJobs: string[] = [];
      
      queue.onJob('simple-job', async (payload) => {
        processedJobs.push(payload.data.substring(0, 10) + '...');
      });

      await queue.addJob('simple-job', { payload: { data: largeData } });
      await queue.run(false);

      expect(processedJobs).toEqual(['xxxxxxxxxx...']);
    });

    it('should handle concurrent job processing correctly', async () => {
      const processedJobs: string[] = [];
      
      queue.onJob('simple-job', async (payload) => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        processedJobs.push(payload.data);
      });

      // Add multiple jobs
      for (let i = 0; i < 5; i++) {
        await queue.addJob('simple-job', { payload: { data: `job-${i}` } });
      }

      // Process jobs concurrently
      await Promise.all([
        queue.run(false),
        queue.run(false)
      ]);

      expect(processedJobs).toHaveLength(5);
      expect(new Set(processedJobs).size).toBe(5); // All jobs should be unique
    });
  });
});