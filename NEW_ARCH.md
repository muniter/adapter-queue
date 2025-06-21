# Complete Replacement: Event-Based Job Processing (No Class-Based Jobs)

 Goal

 Completely replace the class-based job system with a simpler event-based approach using TypeScript type inference.

 New API Design

 1. JobMap Interface (User-Defined)

 // Users define their job types once
 interface JobMap {
   'email': { to: string; subject: string; body: string };
   'image-resize': { url: string; width: number; height: number };
   'report-generate': { type: string; period: string };
 }

 2. Type-Inferred Job Addition (Replaces push())

 // REMOVED: await queue.push(new EmailJob(...))
 // NEW: Type-safe job addition with automatic inference
 await queue.addJob('email', { 
   to: 'user@example.com',
   subject: 'Hello', 
   body: 'Body'
 });

 await queue.addJob('image-resize', {
   url: 'https://...',
   width: 800,
   height: 600
 });

 3. Event-Based Job Processing (Replaces Job.execute())

 // REMOVED: EmailJob class with execute() method
 // NEW: Event handlers with automatic typing
 queue.on('job:email', async (payload) => {
   // payload automatically typed as { to: string; subject: string; body: string }
   const { to, subject, body } = payload;
   await sendEmail(to, subject, body);
 });

 queue.on('job:image-resize', async (payload) => {
   // payload automatically typed as { url: string; width: number; height: number }
   const { url, width, height } = payload;
   await resizeImage(url, width, height);
 });

 Implementation Changes

 1. Remove Job Interface & Classes

 - Delete Job<T> interface
 - Remove execute() method requirement
 - Delete all example Job classes

 2. Update Queue Class

 export class Queue<TJobMap = Record<string, any>> extends EventEmitter {
   // REMOVED: push(job: Job): Promise<string>
   // NEW: Type-safe job addition
   addJob<K extends keyof TJobMap>(
     name: K, 
     payload: TJobMap[K],
     options?: JobOptions
   ): Promise<string>;
   
   // Enhanced event typing
   on<K extends keyof TJobMap>(
     event: `job:${K}`, 
     handler: (payload: TJobMap[K]) => Promise<void>
   ): this;
 }

 3. Internal Serialization

 - Store jobs as { name: string, payload: any }
 - Use simple JSON serialization (no custom serializers)
 - Emit job:${name} events during processing

 4. Fluent API Integration

 // Keep fluent API but apply to addJob
 await queue
   .delay(5)
   .priority(10)
   .addJob('email', { to: '...', subject: '...', body: '...' });

 Breaking Changes

 - REMOVED: push(job) method
 - REMOVED: Job<T> interface and all job classes
 - REMOVED: Custom serializer requirement
 - REMOVED: execute() method pattern

 New Usage Pattern

 // 1. Define job types
 interface MyJobs {
   'welcome-email': { userId: string; email: string };
   'process-image': { imageId: string; filters: string[] };
 }

 // 2. Create typed queue
 const queue = new Queue<MyJobs>('my-queue', adapter);

 // 3. Register handlers (replaces Job classes)
 queue.on('job:welcome-email', async ({ userId, email }) => {
   await sendWelcomeEmail(userId, email);
 });

 queue.on('job:process-image', async ({ imageId, filters }) => {
   await processImage(imageId, filters);
 });

 // 4. Add jobs (replaces push)
 await queue.addJob('welcome-email', { userId: '123', email: 'user@example.com' });
 await queue.delay(10).addJob('process-image', { imageId: '456', filters: ['blur'] });

 // 5. Start processing
 await queue.run();

 Benefits

 - Eliminates all boilerplate: No Job classes, no serializers
 - Perfect type safety: Full IntelliSense with zero manual typing
 - Simpler mental model: name + payload + handler
 - Better separation: Job data separate from execution logic
 - More flexible: Easy to register multiple handlers per job type

 This completely modernizes the API while maintaining the robust driver architecture.