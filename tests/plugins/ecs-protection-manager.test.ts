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

    it('should warn when ECS_AGENT_URI is not set', () => {
      const originalEnv = process.env.ECS_AGENT_URI;
      delete process.env.ECS_AGENT_URI;
      
      new EcsProtectionManager({ fetch: mockFetch });
      
      expect(console.warn).toHaveBeenCalledWith('[ECS Protection] ECS_AGENT_URI not set - protection will be disabled');
      
      // Restore environment
      if (originalEnv) process.env.ECS_AGENT_URI = originalEnv;
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

      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      await plugin.beforeJob!(mockJob);
      await plugin.afterJob!(mockJob);

      // Should use custom logger instead of console
      expect(mockLogger.log).toHaveBeenCalledWith('[ECS Protection] Job test-job-1 starting (TTR: 300s)');
      expect(mockLogger.log).toHaveBeenCalledWith('[ECS Protection] Task protection acquired for 6 minutes');
      expect(mockLogger.log).toHaveBeenCalledWith('[ECS Protection] Job test-job-1 completed');
    });
  });

  describe('Plugin Configuration', () => {
    it('should create plugin with manager instance', () => {
      const manager = new EcsProtectionManager();
      const plugin = ecsTaskProtection(manager);
      expect(plugin).toBeDefined();
      expect(plugin.init).toBeDefined();
      expect(plugin.beforePoll).toBeDefined();
      expect(plugin.beforeJob).toBeDefined();
      expect(plugin.afterJob).toBeDefined();
    });
  });

  describe('Plugin Lifecycle', () => {
    it('should initialize and cleanup properly', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockQueue = { name: 'test-queue' } as any;
      
      // Test initialization
      const cleanup = await plugin.init!({ queue: mockQueue });
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Initializing for queue: test-queue');
      
      // Test cleanup
      if (cleanup) {
        await cleanup();
        expect(console.log).toHaveBeenCalledWith('[ECS Protection] Shutting down plugin for queue: test-queue');
      }
    });

    it('should continue polling when not draining', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const result = await plugin.beforePoll!();
      expect(result).toBe('continue');
    });

    it('should stop polling when draining', async () => {
      // First, trigger draining by making the fetch fail
      mockFetch.mockRejectedValueOnce(new Error('ECS Agent unavailable'));
      
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      // This should trigger draining
      await plugin.beforeJob!(mockJob);
      
      // Now beforePoll should return 'stop'
      const result = await plugin.beforePoll!();
      expect(result).toBe('stop');
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Task is draining - stopping job processing');
    });
  });

  describe('Job Processing', () => {
    it('should acquire protection on first job', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      await plugin.beforeJob!(mockJob);

      // Should have called ECS agent to acquire protection
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-ecs-agent/task-protection/v1/state',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ProtectionEnabled: true,
            ExpiresInMinutes: 6 // Math.ceil(300/60) + 1
          })
        }
      );

      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job test-job-1 starting (TTR: 300s)');
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Task protection acquired for 6 minutes');
    });

    it('should use default TTR when not specified', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: {} // No TTR specified
      };

      await plugin.beforeJob!(mockJob);

      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job test-job-1 starting (TTR: 300s)');
    });

    it('should release protection after last job completes', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      // Start job (acquire protection)
      await plugin.beforeJob!(mockJob);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Complete job (release protection)
      await plugin.afterJob!(mockJob);
      
      // Should have called ECS agent to release protection
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-ecs-agent/task-protection/v1/state',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ProtectionEnabled: false
          })
        }
      );

      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Job test-job-1 completed');
      expect(console.log).toHaveBeenCalledWith('[ECS Protection] Task protection released');
    });

    it('should handle job errors properly', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      const error = new Error('Job failed');

      await plugin.beforeJob!(mockJob);
      await plugin.afterJob!(mockJob, error);

      expect(console.error).toHaveBeenCalledWith('[ECS Protection] Job test-job-1 failed:', error);
    });

    it('should not acquire protection when ECS agent URI is missing', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: '' // Empty URI
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      await plugin.beforeJob!(mockJob);
      await plugin.afterJob!(mockJob);

      // Should not have made any fetch calls
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Jobs', () => {
    it('should maintain protection across multiple concurrent jobs', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const job1: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test1"}',
        meta: { ttr: 300 }
      };

      const job2: QueueMessage = {
        id: 'test-job-2',
        payload: '{"data":"test2"}',
        meta: { ttr: 300 }
      };

      // Start first job - should acquire protection
      await plugin.beforeJob!(job1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Start second job - should not acquire protection again
      await plugin.beforeJob!(job2);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Complete first job - should not release protection (job2 still running)
      await plugin.afterJob!(job1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Complete second job - should release protection
      await plugin.afterJob!(job2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle ECS agent errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      await plugin.beforeJob!(mockJob);

      expect(console.error).toHaveBeenCalledWith('[ECS Protection] Error acquiring protection:', expect.any(Error));
    });

    it('should handle HTTP error responses', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }));

      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const mockJob: QueueMessage = {
        id: 'test-job-1',
        payload: '{"data":"test"}',
        meta: { ttr: 300 }
      };

      await plugin.beforeJob!(mockJob);

      expect(console.warn).toHaveBeenCalledWith('[ECS Protection] Failed to acquire protection: 503 Service Unavailable');
    });
  });

  describe('Integration with Queue', () => {
    it('should work as a plugin with FileQueue', async () => {
      const manager = new EcsProtectionManager({
        fetch: mockFetch,
        ecsAgentUri: 'http://test-ecs-agent'
      });
      const plugin = ecsTaskProtection(manager);

      const queue = new FileQueue<TestJobs>({
        name: 'test-queue',
        path: './test-queue',
        plugins: [plugin]
      });

      expect(queue).toBeDefined();
      
      // Verify plugin is attached
      expect((queue as any).plugins).toContain(plugin);
    });
  });
});