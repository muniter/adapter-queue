import { all } from './database.js';
import { initializeDatabase } from './database.js';

async function debug() {
  await initializeDatabase();
  
  console.log('Checking jobs in database...');
  const jobs = await all('SELECT * FROM jobs');
  console.log('Jobs in database:', jobs.length);
  
  jobs.forEach((job, index) => {
    console.log(`\nJob ${index + 1}:`);
    console.log('  ID:', job.id);
    console.log('  Status:', job.status);
    console.log('  Payload:', job.payload);
    console.log('  Payload (decoded):', job.payload.toString());
    console.log('  Priority:', job.priority);
    console.log('  Push time:', new Date(job.push_time));
    console.log('  Delay time:', job.delay_time ? new Date(job.delay_time) : 'None');
  });
}

debug().catch(console.error);