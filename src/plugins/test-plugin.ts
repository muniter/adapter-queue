import type { QueuePlugin } from "../interfaces/plugin.ts";
import type { QueueMessage } from "../interfaces/job.ts";

/**
 * Simple test plugin that tracks the lifecycle of jobs and plugin hooks.
 * Used for testing plugin functionality.
 */
export interface TestPluginState {
  initialized: boolean;
  disposed: boolean;
  beforePollCalls: number;
  beforeJobCalls: number;
  afterJobCalls: number;
  processedJobs: string[];
  errors: unknown[];
  queueName?: string;
}

export function createTestPlugin(): {
  plugin: QueuePlugin;
  state: TestPluginState;
} {
  const state: TestPluginState = {
    initialized: false,
    disposed: false,
    beforePollCalls: 0,
    beforeJobCalls: 0,
    afterJobCalls: 0,
    processedJobs: [],
    errors: [],
    queueName: undefined,
  };

  const plugin: QueuePlugin = {
    async init({ queue }) {
      state.initialized = true;
      state.queueName = queue.name;

      // Return cleanup function
      return async () => {
        state.disposed = true;
      };
    },

    async beforePoll() {
      state.beforePollCalls++;
      return "continue";
    },

    async beforeJob(job: QueueMessage) {
      state.beforeJobCalls++;
      state.processedJobs.push(job.id);
    },

    async afterJob(job: QueueMessage, error?: unknown) {
      state.afterJobCalls++;
      if (error) {
        state.errors.push(error);
      }
    },
  };

  return { plugin, state };
}

/**
 * Test plugin that stops processing after a certain number of polls.
 */
export function createStopAfterPlugin(stopAfter: number): {
  plugin: QueuePlugin;
  state: { pollCount: number };
} {
  const state = { pollCount: 0 };

  const plugin: QueuePlugin = {
    async beforePoll() {
      state.pollCount++;
      if (state.pollCount > stopAfter) {
        return "stop";
      }
      return "continue";
    },
  };

  return { plugin, state };
}

/**
 * Test plugin that enriches jobs with additional metadata.
 */
export function createEnrichmentPlugin(): QueuePlugin {
  return {
    async beforeJob(job: QueueMessage) {
      // Add processing timestamp
      (job.meta as any).processedAt = new Date();

      // Add a test flag
      (job.meta as any).enriched = true;

      // Parse and enrich payload if it's JSON
      // Enrich the actual payload, not the job wrapper
      if (typeof job.payload === "object" && job.payload !== null) {
        (job.payload as any).enriched = true;
        (job.payload as any).processedBy = "test-plugin";
      }
    },
  };
}
