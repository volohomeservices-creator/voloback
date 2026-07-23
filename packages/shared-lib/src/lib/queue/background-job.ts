/**
 * Enterprise Background Processing Abstraction (PERF-013)
 * 
 * This module abstracts long-running operations (like Emails, Push Notifications,
 * Report generation, Settlement processing) away from the immediate API response
 * lifecycle.
 * 
 * Currently uses an InMemoryJobService adapter which uses setImmediate/setTimeout 
 * to free up the request thread while maintaining compatibility with 
 * Hostinger Managed Node.js (No Redis/BullMQ required yet).
 * 
 * Future Adapters:
 * - BullMQJobService
 * - AWSSQSJobService
 */

export interface JobPayload {
  [key: string]: any;
}

export interface IBackgroundJobService {
  dispatch(queueName: string, payload: JobPayload): Promise<void>;
}

class InMemoryJobService implements IBackgroundJobService {
  public async dispatch(queueName: string, payload: JobPayload): Promise<void> {
    // Fire and forget in the background (microtask queue)
    if (typeof setImmediate !== 'undefined') {
      setImmediate(() => {
        this.processJob(queueName, payload);
      });
    } else {
      setTimeout(() => {
        this.processJob(queueName, payload);
      }, 0);
    }
    
    // API returns immediately without waiting for processJob
    return Promise.resolve();
  }

  private async processJob(queueName: string, payload: JobPayload): Promise<void> {
    try {
      // In a real production setup, this router would dispatch to specific workers.
      // E.g., switch(queueName) { case 'SEND_EMAIL': await sendEmail(payload); break; }
      console.log(`[BackgroundWorker] Executing job on queue: ${queueName}`, payload);
      
      // Simulate heavy processing (mock)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log(`[BackgroundWorker] Completed job on queue: ${queueName}`);
    } catch (error) {
      console.error(`[BackgroundWorker] Job failed on queue: ${queueName}`, error);
      // Future: add to Dead Letter Queue (DLQ)
    }
  }
}

// Export a singleton instance
export const BackgroundQueue: IBackgroundJobService = new InMemoryJobService();
