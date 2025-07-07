import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EcsProtectionManager, ecsTaskProtection } from '../../src/plugins/ecs-protection-manager.ts';
import { FileQueue } from '../../src/drivers/file.ts';
import type { QueueMessage } from '../../src/interfaces/job.ts';

interface TestJobs {
  'test-job': { data: string };
}

describe('ECS Task Protection Plugin', () => {
  // Mock fetch function
  const mockFetch = vi.fn();
  
  // Mock console methods to reduce noise in tests
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockFetch.mockClear();
    
    // Mock console methods
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    
    // Default successful mock responses
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('EcsProtectionManager', () => {
    it('should create manager with default options', () => {
      const manager = new EcsProtectionManager();
      expect(manager).toBeDefined();
    });

    it('should create manager with custom fetch and ECS URI', () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      expect(manager).toBeDefined();
    });

    it('should create manager with custom logger', () => {
      const mockLogger = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent',
        logger: mockLogger
      });

      expect(manager).toBeDefined();
    });

    it('should use custom logger when provided', async () => {
      const mockLogger = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent',
        logger: mockLogger
      });

      const plugin = ecsTaskProtection({ manager });

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        name: 'test-job',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      // Acquire protection before polling
      await plugin.beforePoll!();
      await plugin.beforeJob!(mockJob);
      await plugin.afterJob!(mockJob);

      // Should use custom logger instead of console
      expect(mockLogger.log).toHaveBeenCalledWith('[ECS Protection] Task protection acquired for 11 minutes');
      expect(mockLogger.log).toHaveBeenCalledWith('[ECS Protection] Job test-job-1 starting (TTR: 300s)');
    });

    it('should warn when ECS_AGENT_URI is not set', () => {
      new EcsProtectionManager();
      expect(console.warn).toHaveBeenCalledWith('[ECS Protection] ECS_AGENT_URI not set - protection will be disabled');
    });

    it('should not warn when ECS_AGENT_URI is provided', () => {
      new EcsProtectionManager({ ecsAgentUri: 'http://test-ecs-agent' });
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('Plugin Configuration', () => {
    it('should accept default protection timeout', () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      
      const plugin = ecsTaskProtection({ 
        manager,
        defaultProtectionTimeout: 1200 // 20 minutes
      });

      expect(plugin).toBeDefined();
    });

    it('should use default timeout of 600 seconds if not specified', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      
      const plugin = ecsTaskProtection({ manager });
      
      await plugin.beforePoll!();

      // Should request 11 minutes (600/60 + 1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            ProtectionEnabled: true,
            ExpiresInMinutes: 11
          })
        })
      );
    });
  });

  describe('Plugin Lifecycle', () => {
    it('should have all required plugin methods', () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      expect(plugin.init).toBeDefined();
      expect(plugin.beforePoll).toBeDefined();
      expect(plugin.beforeJob).toBeDefined();
      expect(plugin.afterJob).toBeDefined();
    });

    it('should initialize properly', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });
      const mockQueue = { name: 'test-queue' };

      const cleanup = await plugin.init!({ queue: mockQueue as any });
      expect(cleanup).toBeDefined();
      expect(typeof cleanup).toBe('function');

      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Initializing for queue: test-queue');
    });

    it('should allow polling when protection can be acquired', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      const result = await plugin.beforePoll!();
      expect(result).toBe('continue');
    });

    it('should stop polling when draining', async () => {
      // Mock fetch to return error (simulating ECS draining)
      mockFetch.mockResolvedValue(new Response('Service Unavailable', { 
        status: 503, 
        statusText: 'Service Unavailable' 
      }));

      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      // First call fails to acquire protection
      const result = await plugin.beforePoll!();
      expect(result).toBe('stop');

      // Subsequent calls should also return stop
      const result2 = await plugin.beforePoll!();
      expect(result2).toBe('stop');

      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Failed to acquire protection - ECS task is draining');
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Cannot acquire protection - task is draining, stopping job processing');
    });
  });

  describe('Reference Counting Workflow', () => {
    it('should acquire protection before polling and maintain while jobs active', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      const job1: QueueMessage = {
        id: 'job-1',
        name: 'test-job',
        payload: '{"data":"test1"}',
        meta: { ttr: 300 }
      };

      const job2: QueueMessage = {
        id: 'job-2',
        name: 'test-job',
        payload: '{"data":"test2"}',
        meta: { ttr: 300 }
      };

      // Acquire protection before polling
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Start first job
      await plugin.beforeJob!(job1);
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job job-1 starting (TTR: 300s)');

      // Start second job
      await plugin.beforeJob!(job2);
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job job-2 starting (TTR: 300s)');

      // Complete first job - should NOT release protection yet
      await plugin.afterJob!(job1);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call (initial acquire)
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job job-1 completed');

      // Complete second job - should release protection now
      await plugin.afterJob!(job2);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Now 2 calls (acquire + release)
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] No jobs in progress, releasing protection');
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job job-2 completed');

      // Verify release was called
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://test-ecs-agent/task-protection/v1/state',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ProtectionEnabled: false
          })
        }
      );
    });

    it('should extend protection for jobs with longer TTR', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      
      const plugin = ecsTaskProtection({ 
        manager,
        defaultProtectionTimeout: 300 // 5 minutes default
      });

      const longJob: QueueMessage = {
        id: 'long-job',
        name: 'test-job',
        payload: '{"data":"test"}',
        meta: { ttr: 900 } // 15 minutes - longer than default
      };

      // Acquire protection with default timeout
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            ProtectionEnabled: true,
            ExpiresInMinutes: 6 // ceil(300/60) + 1
          })
        })
      );

      // Start long job - should extend protection
      await plugin.beforeJob!(longJob);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job long-job needs 900s but protection expires in 300s, extending protection');
      
      // Verify extension request
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            ProtectionEnabled: true,
            ExpiresInMinutes: 16 // ceil(900/60) + 1
          })
        })
      );
    });

    it('should handle concurrent job completions correctly', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      // Create multiple jobs
      const jobs = Array.from({ length: 5 }, (_, i) => ({
        id: `job-${i}`,
        name: 'test-job',
        payload: `{"data":"test${i}"}`,
        meta: { ttr: 300 }
      }));

      // Acquire protection
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Start all jobs
      for (const job of jobs) {
        await plugin.beforeJob!(job);
      }

      // Complete jobs concurrently
      const completionPromises = jobs.map(job => plugin.afterJob!(job));
      await Promise.all(completionPromises);

      // Should have released protection only once
      expect(mockFetch).toHaveBeenCalledTimes(2); // acquire + release
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] No jobs in progress, releasing protection');
    });

    it('should track jobs independently per plugin instance', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      
      // Two separate plugin instances sharing the same manager
      const plugin1 = ecsTaskProtection({ manager });
      const plugin2 = ecsTaskProtection({ manager });

      const job1: QueueMessage = {
        id: 'queue1-job',
        name: 'test-job',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      const job2: QueueMessage = {
        id: 'queue2-job',
        name: 'test-job',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      // Both plugins acquire protection
      await plugin1.beforePoll!();
      await plugin2.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(2); // Each beforePoll calls attemptProtect

      // Start jobs on different plugins
      await plugin1.beforeJob!(job1);
      await plugin2.beforeJob!(job2);

      // Complete job1 - plugin1 tries to release
      await plugin1.afterJob!(job1);
      expect(mockFetch).toHaveBeenCalledTimes(3); // 2 acquires + 1 release
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] No jobs in progress, releasing protection');

      // Complete job2 - plugin2 also tries to release
      await plugin2.afterJob!(job2);
      expect(mockFetch).toHaveBeenCalledTimes(4); // 2 acquires + 2 releases
    });
  });

  describe('Error Handling', () => {
    it('should handle job failures correctly', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      const job: QueueMessage = {
        id: 'failing-job',
        name: 'test-job',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      await plugin.beforePoll!();
      await plugin.beforeJob!(job);

      const error = new Error('Job processing failed');
      await plugin.afterJob!(job, error);

      // Should still release protection after error
      expect(mockFetch).toHaveBeenCalledTimes(2); // acquire + release
      expect(console.error).toHaveBeenCalledWith('[ECS Protection] Job failing-job failed:', error);
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] No jobs in progress, releasing protection');
    });

    it('should handle ECS agent errors gracefully', async () => {
      // Mock fetch to throw an error
      mockFetch.mockRejectedValue(new Error('Network error'));

      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      const result = await plugin.beforePoll!();
      expect(result).toBe('stop');

      expect(console.error).toHaveBeenCalledWith('[ECS Protection] Error acquiring protection:', expect.any(Error));
    });

    it('should handle HTTP error responses', async () => {
      // Mock fetch to return HTTP error
      mockFetch.mockResolvedValue(new Response('Service Unavailable', { 
        status: 503, 
        statusText: 'Service Unavailable' 
      }));

      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      const result = await plugin.beforePoll!();
      expect(result).toBe('stop');

      expect(console.warn).toHaveBeenCalledWith('[ECS Protection] Failed to acquire protection: 503 Service Unavailable');
    });

    it('should handle cleanup gracefully', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });

      // Acquire protection first
      await manager.attemptProtect(300);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Cleanup should release protection
      await manager.cleanup();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Task protection released');
    });
  });

  describe('No ECS Agent URI', () => {
    it('should not make HTTP calls when ECS_AGENT_URI is not set', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch
        // No ecsAgentUri provided
      });
      const plugin = ecsTaskProtection({ manager });

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        name: 'test-job',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      await plugin.beforePoll!();
      await plugin.beforeJob!(mockJob);
      await plugin.afterJob!(mockJob);

      // Should not have called fetch at all
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty job queue correctly', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      // Poll but no jobs come
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1); // Acquire

      // No jobs processed, but next poll should not re-acquire protection (still valid)
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should not re-acquire (protection still valid)
    });

    it('should handle rapid job turnover', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ manager });

      await plugin.beforePoll!();

      // Rapid job processing
      for (let i = 0; i < 10; i++) {
        const job: QueueMessage = {
          id: `rapid-job-${i}`,
          name: 'test-job',
          payload: '{"data":"test"}',
          meta: { ttr: 60 }
        };
        
        await plugin.beforeJob!(job);
        await plugin.afterJob!(job);
      }

      // Should have acquired once, released 10 times
      expect(mockFetch).toHaveBeenCalledTimes(11);
    });

    it('should track protection expiration and avoid unnecessary re-acquisition', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection({ 
        manager,
        defaultProtectionTimeout: 600 // 10 minutes
      });

      // First poll should acquire protection
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second poll within protection window should not re-acquire
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Third poll should also not re-acquire (still within 10 minutes)
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/Protection still valid for \d+s, skipping acquisition/)
      );
    });

    it('should extend protection only when needed for longer jobs', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      
      const plugin = ecsTaskProtection({ 
        manager,
        defaultProtectionTimeout: 300 // 5 minutes default
      });

      // Acquire initial protection
      await plugin.beforePoll!();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Short job within protection window - should not extend
      const shortJob: QueueMessage = {
        id: 'short-job',
        name: 'test-job',
        payload: '{\"data\":\"test\"}',
        meta: { ttr: 120 } // 2 minutes - shorter than default
      };

      await plugin.beforeJob!(shortJob);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No extension needed
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/Job short-job TTR 120s fits within existing protection/)
      );

      // Long job beyond protection window - should extend
      const longJob: QueueMessage = {
        id: 'long-job',
        name: 'test-job',
        payload: '{\"data\":\"test\"}',
        meta: { ttr: 600 } // 10 minutes - longer than remaining protection
      };

      await plugin.beforeJob!(longJob);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Extended protection
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/Job long-job needs 600s but protection expires in \d+s, extending protection/)
      );
    });
  });
});