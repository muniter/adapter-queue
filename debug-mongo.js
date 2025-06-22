import { MongoClient } from 'mongodb';
import { createMongoQueue } from './dist/adapters/mongodb.js';

// Simple debug script to test MongoDB adapter
async function debugMongo() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  
  const queue = createMongoQueue(client, 'debug_test', 'jobs');
  
  console.log('1. Adding a job...');
  const jobId = await queue.addJob('test-job', { payload: { data: 'debug test' } });
  console.log('Job added with ID:', jobId);
  
  console.log('2. Checking job status...');
  const status = await queue.status(jobId);
  console.log('Job status:', status);
  
  console.log('3. Checking database directly...');
  const db = client.db('debug_test');
  const collection = db.collection('jobs');
  const jobs = await collection.find({}).toArray();
  console.log('Jobs in database:', jobs.length);
  console.log('First job:', JSON.stringify(jobs[0], null, 2));
  
  console.log('4. Trying to reserve a job...');
  const adapter = queue.db;
  const reserved = await adapter.reserveJob(5);
  console.log('Reserved job:', reserved);
  
  await client.close();
}

debugMongo().catch(console.error);