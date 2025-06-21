import { DefaultSerializer } from '../core/serializer.ts';

const serializer = new DefaultSerializer();

(async () => {
  const chunks: Buffer[] = [];
  
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  
  try {
    const payload = Buffer.concat(chunks);
    const job = serializer.deserialize(payload);
    
    if (typeof job.execute !== 'function') {
      throw new Error('Job must have an execute method');
    }
    
    await job.execute();
    process.exit(0);
  } catch (error) {
    console.error('Job execution failed:', error);
    process.exit(1);
  }
})();