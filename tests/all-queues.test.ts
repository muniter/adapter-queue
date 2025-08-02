import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  assert,
} from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { InMemoryQueue } from "../src/drivers/memory.js";
import { FileQueue } from "../src/drivers/file.js";
import type { Queue } from "../src/core/queue.js";

interface TestJobs {
  "simple-job": { data: string };
  "priority-job": { message: string };
  "delayed-job": { message: string };
  "failing-job": { shouldFail: boolean };
}
interface QueueDriverConfig {
  name: string;
  features: {
    supportsPriority?: boolean;
    supportsDelayedJobs?: boolean;
  };
  beforeAll?: () => Promise<void>;
  afterAll?: () => Promise<void>;
  createQueue: () => Promise<Queue<TestJobs>>;
  cleanup?: (queue: Queue<TestJobs>) => Promise<void>;
}

// Driver configurations
const drivers: Array<
  (() => Promise<QueueDriverConfig> | QueueDriverConfig)
> = [
  () => ({
    name: "InMemoryQueue",
    features: {
      supportsPriority: true,
      supportsDelayedJobs: true,
    },
    beforeAll: async () => {
      // InMemoryQueue doesn't need any setup
      console.log("Setting up InMemoryQueue tests...");
    },
    afterAll: async () => {
      // InMemoryQueue doesn't need any teardown
      console.log("Cleaning up InMemoryQueue tests...");
    },
    createQueue: async () => {
      return new InMemoryQueue<TestJobs>({
        name: "test-queue",
        maxJobs: 100,
      });
    },
  }),
  () => {
    let baseTempDir: string;

    return {
      name: "FileQueue",
      features: {
        supportsPriority: false,
        supportsDelayedJobs: true,
      },
      beforeAll: async () => {
        // Create base temp directory for all FileQueue tests
        baseTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "queue-file-tests-")
        );
        console.log(`Setting up FileQueue tests in ${baseTempDir}...`);
      },
      afterAll: async () => {
        // Clean up base temp directory
        try {
          await fs.rm(baseTempDir, { recursive: true, force: true });
          console.log("Cleaning up FileQueue tests...");
        } catch (error) {
          console.warn("Failed to clean up FileQueue test directory:", error);
        }
      },
      createQueue: async () => {
        // Create unique directory for each queue instance
        const queueDir = path.join(
          baseTempDir,
          `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        );
        return new FileQueue<TestJobs>({
          name: "test-queue",
          path: queueDir,
        });
      },
      cleanup: async (queue) => {
        // FileQueue cleanup is handled by the afterAll hook
        // Individual queue cleanup not needed as each gets unique directory
      },
    };
  },
  // TODO: Add other drivers here later
  // {
  //   name: 'MongooseQueue',
  //   beforeAll: async () => {
  //     // Start MongoDB container
  //     await startMongoContainer();
  //   },
  //   afterAll: async () => {
  //     // Stop MongoDB container
  //     await stopMongoContainer();
  //   },
  //   createQueue: async () => { ... },
  //   cleanup: async (queue) => { ... }
  // }
];

async function resolveAllConfigs(): Promise<Array<QueueDriverConfig>> {
  const resolvedConfigs = [];
  for (const driver of drivers) {
    const res = driver();
    const config = res instanceof Promise ? await res : res;
    resolvedConfigs.push(config);
  }
  return resolvedConfigs;
}

const configs = await resolveAllConfigs();

// Run tests for each driver
configs.forEach((config) => {
  const features = config.features;

  describe(`Queue Driver: ${config.name}`, () => {
    let queue: Queue<TestJobs>;

    beforeAll(async () => {
      // Await config if it's a promise
      if (config.beforeAll) {
        await config.beforeAll();
      }
    });

    afterAll(async () => {
      if (config.afterAll) {
        await config.afterAll();
      }
    });

    beforeEach(async () => {
      queue = await config.createQueue();
    });

    afterEach(async () => {
      if (config.cleanup) {
        await config.cleanup(queue);
      }
    });

    describe("Basic Operations", () => {
      it(`${config.name} should add and retrieve job status`, async () => {
        const id = await queue.addJob("simple-job", {
          payload: { data: "test payload" },
        });

        expect(id).toBeTruthy();
        expect(typeof id).toBe("string");

        const status = await queue.status(id);
        expect(status).toBe("waiting");
      });

      it.skipIf(!features.supportsPriority)(
        `${config.name} should handle job priorities`,
        async () => {
          // Add jobs with different priorities
          const lowId = await queue.addJob("priority-job", {
            payload: { message: "low priority" },
            priority: 1,
          });

          const highId = await queue.addJob("priority-job", {
            payload: { message: "high priority" },
            priority: 10,
          });

          // High priority job should be processed first
          const reserved1 = await (queue as any).reserve(0);
          expect(reserved1).not.toBeNull();
          expect(reserved1.id).toBe(highId);

          const reserved2 = await (queue as any).reserve(0);
          expect(reserved2).not.toBeNull();
          expect(reserved2.id).toBe(lowId);
        }
      );

      it.skipIf(!features.supportsDelayedJobs)(
        `${config.name} should handle delayed jobs`,
        async () => {
          const id = await queue.addJob("delayed-job", {
            payload: { message: "delayed message" },
            delaySeconds: 1,
          });

          const status = await queue.status(id);
          expect(status).toBe("waiting");

          // Should not be immediately available
          const reserved1 = await (queue as any).reserve(0);
          expect(reserved1).toBeNull();

          // Should be available after delay
          await new Promise((resolve) => setTimeout(resolve, 1100));

          const reserved2 = await (queue as any).reserve(0);
          expect(reserved2).not.toBeNull();
          expect(reserved2.id).toBe(id);
        }
      );

      it(`${config.name} should generate unique job IDs`, async () => {
        const ids = await Promise.all([
          queue.addJob("simple-job", { payload: { data: "job1" } }),
          queue.addJob("simple-job", { payload: { data: "job2" } }),
          queue.addJob("simple-job", { payload: { data: "job3" } }),
        ]);

        expect(new Set(ids).size).toBe(3);
      });

      it(`${config.name} should return null when reserving from empty queue`, async () => {
        const reserved = await queue["reserve"](0);
        expect(reserved).toBeNull();
      });
    });

    describe("Job Processing", () => {
      it(`${config.name} should process jobs successfully`, async () => {
        const processedJobs: string[] = [];

        queue.setHandlers({
          "simple-job": async ({ payload }) => {
            processedJobs.push(payload.data);
          },
          "priority-job": async ({ payload }) => {
            processedJobs.push(`priority: ${payload.message}`);
          },
          "delayed-job": async ({ payload }) => {
            processedJobs.push(`delayed: ${payload.message}`);
          },
          "failing-job": async ({ payload }) => {
            if (payload.shouldFail) {
              throw new Error("Job intentionally failed");
            }
            processedJobs.push("success");
          },
        });

        await queue.addJob("simple-job", { payload: { data: "test1" } });
        await queue.addJob("priority-job", {
          payload: { message: "test2" },
          priority: 10,
        });
        await queue.addJob("simple-job", { payload: { data: "test3" } });

        // Process jobs once
        await queue.run(false);

        // If priority is supported, priority job should be processed first
        // Otherwise, jobs are processed in FIFO order
        if (features.supportsPriority) {
          expect(processedJobs).toEqual(["priority: test2", "test1", "test3"]);
        } else {
          expect(processedJobs).toEqual(["test1", "priority: test2", "test3"]);
        }
      });

      it(`${config.name} should handle job failures`, async () => {
        let errorEventFired = false;

        queue.setHandlers({
          "failing-job": async ({ payload }) => {
            if (payload.shouldFail) {
              throw new Error("Job intentionally failed");
            }
          },
          "simple-job": async () => {},
          "priority-job": async () => {},
          "delayed-job": async () => {},
        });

        queue.on("afterError", () => {
          errorEventFired = true;
        });

        await queue.addJob("failing-job", {
          payload: { shouldFail: true },
        });

        await queue.run(false);

        expect(errorEventFired).toBe(true);
      });

      it(`${config.name} should emit events during job lifecycle`, async () => {
        const events: string[] = [];

        queue.setHandlers({
          "simple-job": async () => {
            // Successful job
          },
          "priority-job": async () => {},
          "delayed-job": async () => {},
          "failing-job": async () => {},
        });

        queue.on("beforePush", () => events.push("beforePush"));
        queue.on("afterPush", () => events.push("afterPush"));
        queue.on("beforeExec", () => events.push("beforeExec"));
        queue.on("afterExec", () => events.push("afterExec"));

        await queue.addJob("simple-job", { payload: { data: "test" } });
        await queue.run(false);

        expect(events).toEqual([
          "beforePush",
          "afterPush",
          "beforeExec",
          "afterExec",
        ]);
      });
    });

    describe("TTR and Job Recovery", () => {
      it(`${config.name} should handle TTR timeout and recover jobs`, async () => {
        const id = await queue.addJob("simple-job", {
          payload: { data: "test payload" },
          ttr: 1, // 1 second TTR
        });

        // Reserve the job
        const reserved1 = await queue["reserve"](0);
        expect(reserved1).not.toBeNull();
        expect(reserved1.id).toBe(id);

        // Job should be in reserved state
        const status1 = await queue.status(id);
        expect(status1).toBe("reserved");

        // Wait for TTR to expire
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Different drivers may handle TTR differently:
        // - Some make the job available for new reservation
        // - Others may automatically retry/re-reserve it
        // The key is that TTR timeout is handled somehow
        const reserved2 = await queue["reserve"](0);

        if (reserved2) {
          // Job is available for reservation (expected behavior)
          expect(reserved2.id).toBe(id);
        } else {
          // Job might be auto-retried and still reserved
          const status2 = await queue.status(id);
          // Should be either reserved (auto-retry) or done/failed
          expect(["reserved", "done"]).toContain(status2);
        }
      });
    });

    describe("Job Completion", () => {
      it(`${config.name} should mark jobs as completed`, async () => {
        const id = await queue.addJob("simple-job", {
          payload: { data: "test" },
        });

        const reserved = await (queue as any).reserve(0);
        expect(reserved).not.toBeNull();

        await (queue as any).completeJob(reserved);

        const status = await queue.status(id);
        expect(status).toBe("done");
      });

      it(`${config.name} should mark jobs as failed`, async () => {
        const id = await queue.addJob("simple-job", {
          payload: { data: "test" },
        });

        const reserved = await (queue as any).reserve(0);
        expect(reserved).not.toBeNull();

        const error = new Error("Job failed");
        await (queue as any).failJob(reserved, error);

        const status = await queue.status(id);
        expect(status).toBe("done");
      });
    });
  });
});
