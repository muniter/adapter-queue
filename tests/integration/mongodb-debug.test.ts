import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { MongoClient, ObjectId } from 'mongodb';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { MongoQueue, createMongoQueue, MongoDatabaseAdapter } from '../../src/adapters/mongodb.ts';

interface TestJobs {
  'debug-job': { data: string };
}

describe.only('MongoDB Debug Tests', () => {
  let mongoContainer: StartedTestContainer;
  let client: MongoClient;
  let queue: MongoQueue<TestJobs>;
  let mongoUrl: string;
  const testDatabase = 'debug_test';
  const testCollection = 'debug_jobs';

  beforeAll(async () => {
    mongoContainer = await new GenericContainer('mongo:7')
      .withExposedPorts({ container: 27017, host: 0 })
      .withStartupTimeout(60000)
      .start();
    
    const mongoPort = mongoContainer.getMappedPort(27017);
    const mongoHost = mongoContainer.getHost();
    mongoUrl = `mongodb://${mongoHost}:${mongoPort}`;
    
    console.log(`MongoDB container started at ${mongoUrl}`);
    
    client = new MongoClient(mongoUrl);
    await client.connect();
  }, 90000);

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (mongoContainer) {
      await mongoContainer.stop();
    }
  });

  beforeEach(async () => {
    const db = client.db(testDatabase);
    await db.collection(testCollection).deleteMany({});
    queue = createMongoQueue<TestJobs>(client, testDatabase, testCollection);
  });

  it('should debug job insertion and reservation step by step', async () => {
    const db = client.db(testDatabase);
    const collection = db.collection(testCollection);
    
    console.log('=== STEP 1: Adding job ===');
    const jobId = await queue.addJob('debug-job', { payload: { data: 'debug test' } });
    console.log('Job added with ID:', jobId);
    expect(jobId).toBeTruthy();
    
    console.log('=== STEP 2: Checking database directly ===');
    const jobs = await collection.find({}).toArray();
    console.log('Jobs in database:', jobs.length);
    console.log('First job document:', JSON.stringify(jobs[0], null, 2));
    expect(jobs).toHaveLength(1);
    
    const job = jobs[0];
    expect(job?.status).toBe('waiting');
    expect(job?.payload).toBeTruthy();
    
    console.log('=== STEP 3: Checking job status ===');
    const status = await queue.status(jobId);
    console.log('Job status via queue:', status);
    expect(status).toBe('waiting');
    
    console.log('=== STEP 4: Testing adapter directly ===');
    const adapter = (queue as any).db as MongoDatabaseAdapter;
    console.log('Adapter:', !!adapter);
    
    console.log('=== STEP 5: Trying to reserve job ===');
    const reserved = await adapter.reserveJob(5);
    console.log('Reserved job:', reserved);
    
    if (reserved) {
      console.log('Reserved job ID:', reserved.id);
      console.log('Reserved job payload:', reserved.payload);
      console.log('Reserved job meta:', reserved.meta);
    } else {
      console.log('No job was reserved - investigating...');
      
      // Check what jobs are available after reservation attempt
      const waitingJobs = await collection.find({ status: 'waiting' }).toArray();
      console.log('Waiting jobs count:', waitingJobs.length);
      
      const reservedJobs = await collection.find({ status: 'reserved' }).toArray();
      console.log('Reserved jobs count:', reservedJobs.length);
      
      if (reservedJobs.length > 0) {
        console.log('Reserved job in DB:', JSON.stringify(reservedJobs[0], null, 2));
      }
      
      // Let's test the findOneAndUpdate directly
      console.log('=== Testing findOneAndUpdate directly ===');
      const now = new Date();
      const testResult = await collection.findOneAndUpdate(
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
      
      console.log('Direct findOneAndUpdate result:', testResult);
      console.log('Result value:', testResult?.value);
      console.log('Result type:', typeof testResult);
    }
    
    expect(reserved).toBeTruthy();
  });

  it('should debug queue run process', async () => {
    const processedJobs: string[] = [];
    
    console.log('=== STEP 1: Setting up job handler ===');
    queue.onJob('debug-job', async (payload) => {
      console.log('Job handler called with payload:', payload);
      processedJobs.push(payload.data);
    });
    
    console.log('=== STEP 2: Adding job ===');
    await queue.addJob('debug-job', { payload: { data: 'run test' } });
    
    console.log('=== STEP 3: Running queue once ===');
    await queue.run(false);
    
    console.log('=== STEP 4: Checking results ===');
    console.log('Processed jobs:', processedJobs);
    expect(processedJobs).toEqual(['run test']);
  });
});