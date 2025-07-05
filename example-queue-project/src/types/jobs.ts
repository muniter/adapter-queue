// Centralized job type definitions
export interface EmailJobs {
  "welcome-email": { to: string; name: string };
  "notification": { to: string; subject: string; body: string };
}