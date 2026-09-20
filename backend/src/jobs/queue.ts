/**
 * Minimal in-process background job queue.
 *
 * This stands in for Redis/BullMQ in the single-container/no-Docker setup:
 * it gives the same guarantee that matters functionally — the HTTP request
 * that enqueues a job returns immediately, and the job runs asynchronously
 * on the Node event loop — without an external Redis dependency.
 *
 * To move to real BullMQ workers later: replace `enqueue` with
 * `queue.add(jobName, data)` and move each handler below into
 * workers/src/*.worker.ts consuming from the same queue name. No calling
 * code elsewhere in the app needs to change, since callers only depend on
 * `enqueue(jobName, payload)`.
 */
type JobHandler<T> = (payload: T) => Promise<void>;

class InProcessQueue {
  private handlers = new Map<string, JobHandler<any>>();
  private tail: Promise<void> = Promise.resolve();

  register<T>(jobName: string, handler: JobHandler<T>) {
    this.handlers.set(jobName, handler);
  }

  enqueue<T>(jobName: string, payload: T) {
    const handler = this.handlers.get(jobName);
    if (!handler) {
      throw new Error(`No handler registered for job "${jobName}"`);
    }
    if (process.env.NODE_ENV === "test") return;
    // setImmediate ensures this runs after the current request/response
    // cycle completes. Serialize jobs of the same type so local OCR work
    // cannot saturate CPU/memory and destabilize concurrent API requests.
    const next = this.tail
      .then(
        () =>
          new Promise<void>((resolve) => {
            setImmediate(async () => {
              try {
                await handler(payload);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`Job "${jobName}" failed:`, err);
              } finally {
                resolve();
              }
            });
          })
      );
    this.tail = next;
  }
}

export const queue = new InProcessQueue();
