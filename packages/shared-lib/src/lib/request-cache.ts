import 'server-only';

type PromiseCreator<T> = () => Promise<T>;

class RequestCoalescer {
  private activeRequests = new Map<string, Promise<any>>();

  /**
   * Deduplicates/coalesces concurrent requests.
   * If a request with the same key is already in flight, returns the existing promise.
   */
  async coalesce<T>(key: string, fn: PromiseCreator<T>): Promise<T> {
    const active = this.activeRequests.get(key);
    if (active) {
      return active;
    }

    const promise = fn().finally(() => {
      this.activeRequests.delete(key);
    });

    this.activeRequests.set(key, promise);
    return promise;
  }
}

export const requestCoalescer = new RequestCoalescer();
