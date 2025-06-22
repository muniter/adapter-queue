import type { Queue } from '../../src/index.ts';

// Simple test job handler functions (not classes)
export const simpleJobHandler = async (payload: { data: string }): Promise<string> => {
  return `Processed: ${payload.data}`;
};

export const failingJobHandler = async (payload: { shouldFail?: boolean }): Promise<void> => {
  if (payload.shouldFail !== false) {
    throw new Error('Job intentionally failed');
  }
};

// Test job types for type safety
export interface TestJobs {
  'simple-job': { data: string };
  'failing-job': { shouldFail?: boolean };
}

