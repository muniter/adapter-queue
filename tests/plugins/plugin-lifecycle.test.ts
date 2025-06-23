import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileQueue } from '../../src/drivers/file.ts';
import { createTestPlugin, createStopAfterPlugin, createEnrichmentPlugin } from '../../src/plugins/test-plugin.ts';
import type { QueuePlugin } from '../../src/interfaces/plugin.ts';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';

interface TestJobs {
  'test-job': { message: string };
}

describe('Plugin Lifecycle', () => {
  let queuePath: string;
  let queue: FileQueue<TestJobs>;

  beforeEach(async () => {
    queuePath = join(tmpdir(), `test-queue-${Date.now()}`);
  });

  afterEach(() => {
    try {
      rmSync(queuePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Plugin Initialization', () => {
    it('should initialize plugins when queue starts', async () => {
      const { plugin, state } = createTestPlugin();
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        name: 'test-queue',
        plugins: [plugin],
      });

      expect(state.initialized).toBe(false);

      // Initialize queue
      await queue.init();
      
      // Register a job handler
      queue.onJob('test-job', async () => {});

      // Run queue briefly (should initialize plugins)
      await queue.run(false, 0);

      expect(state.initialized).toBe(true);
      expect(state.queueName).toBe('test-queue');
    });

    it('should call plugin cleanup on disposal', async () => {
      const { plugin, state } = createTestPlugin();
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [plugin],
      });

      await queue.init();
      queue.onJob('test-job', async () => {});

      // Run and then the cleanup should happen
      await queue.run(false, 0);

      expect(state.initialized).toBe(true);
      expect(state.disposed).toBe(true);
    });

    it('should handle plugins without init hook', async () => {
      const plugin: QueuePlugin = {
        async beforeJob() {},
      };
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [plugin],
      });

      await queue.init();
      queue.onJob('test-job', async () => {});

      // Should not throw
      await expect(queue.run(false, 0)).resolves.not.toThrow();
    });
  });

  describe('Plugin Hooks', () => {
    it('should call beforePoll hooks', async () => {
      const { plugin, state } = createTestPlugin();
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [plugin],
      });

      await queue.init();
      queue.onJob('test-job', async () => {});

      // Run queue briefly
      await queue.run(false, 0);

      expect(state.beforePollCalls).toBeGreaterThan(0);
    });

    it('should stop when beforePoll returns stop', async () => {
      const { plugin: stopPlugin, state: stopState } = createStopAfterPlugin(2);
      const { plugin: testPlugin, state: testState } = createTestPlugin();
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [stopPlugin, testPlugin],
      });

      await queue.init();
      queue.onJob('test-job', async () => {});

      // Run queue - should stop after 3 polls (stop after 2)
      await queue.run(true, 0);

      expect(stopState.pollCount).toBe(3);
      // The test plugin may be called fewer times since stopPlugin stops the loop
      expect(testState.beforePollCalls).toBeGreaterThanOrEqual(2);
      expect(testState.beforePollCalls).toBeLessThanOrEqual(3);
    });

    it('should call beforeJob and afterJob hooks', async () => {
      const { plugin, state } = createTestPlugin();
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [plugin],
      });

      await queue.init();
      
      let jobExecuted = false;
      queue.onJob('test-job', async () => {
        jobExecuted = true;
      });

      // Add a job
      await queue.addJob('test-job', { payload: { message: 'test' } });

      // Process the job
      await queue.run(false, 0);

      expect(jobExecuted).toBe(true);
      expect(state.beforeJobCalls).toBe(1);
      expect(state.afterJobCalls).toBe(1);
      expect(state.processedJobs).toHaveLength(1);
      expect(state.errors).toHaveLength(0);
    });

    it('should track errors in afterJob hook', async () => {
      const { plugin, state } = createTestPlugin();
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [plugin],
      });

      await queue.init();
      
      queue.onJob('test-job', async () => {
        throw new Error('Test error');
      });

      // Add a job
      await queue.addJob('test-job', { payload: { message: 'test' } });

      // Process the job (should handle error gracefully)
      await queue.run(false, 0);

      expect(state.beforeJobCalls).toBe(1);
      expect(state.afterJobCalls).toBe(1);
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0]).toBeInstanceOf(Error);
      expect((state.errors[0] as Error).message).toBe('Test error');
    });
  });

  describe('Job Enrichment', () => {
    it('should enrich jobs with additional metadata', async () => {
      const enrichmentPlugin = createEnrichmentPlugin();
      let processedJob: any;
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [enrichmentPlugin],
      });

      await queue.init();
      
      queue.onJob('test-job', async (payload) => {
        processedJob = payload;
      });

      // Add a job
      await queue.addJob('test-job', { payload: { message: 'test' } });

      // Process the job
      await queue.run(false, 0);

      expect(processedJob).toEqual({
        message: 'test',
        enriched: true,
        processedBy: 'test-plugin',
      });
    });
  });

  describe('Multiple Plugins', () => {
    it('should execute plugins in order', async () => {
      const callOrder: string[] = [];
      
      const plugin1: QueuePlugin = {
        async beforeJob() {
          callOrder.push('plugin1-beforeJob');
        },
        async afterJob() {
          callOrder.push('plugin1-afterJob');
        },
      };

      const plugin2: QueuePlugin = {
        async beforeJob() {
          callOrder.push('plugin2-beforeJob');
        },
        async afterJob() {
          callOrder.push('plugin2-afterJob');
        },
      };
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [plugin1, plugin2],
      });

      await queue.init();
      queue.onJob('test-job', async () => {});

      // Add a job
      await queue.addJob('test-job', { payload: { message: 'test' } });

      // Process the job
      await queue.run(false, 0);

      expect(callOrder).toEqual([
        'plugin1-beforeJob',
        'plugin2-beforeJob',
        'plugin1-afterJob',
        'plugin2-afterJob',
      ]);
    });
  });

  describe('Plugin Error Handling', () => {
    it('should handle plugin errors gracefully', async () => {
      const errorPlugin: QueuePlugin = {
        async beforeJob() {
          throw new Error('Plugin error');
        },
      };
      
      queue = new FileQueue<TestJobs>({
        path: queuePath,
        plugins: [errorPlugin],
      });

      await queue.init();
      
      let jobExecuted = false;
      queue.onJob('test-job', async () => {
        jobExecuted = true;
      });

      // Add a job
      await queue.addJob('test-job', { payload: { message: 'test' } });

      // Process should continue despite plugin error
      await expect(queue.run(false, 0)).resolves.not.toThrow();
      
      // Job should still execute (depending on error handling implementation)
      // This test verifies the queue doesn't crash
    });
  });
});