import { logger } from "../utils/logger";

/**
 * Minimal in-process background job queue.
 *
 * This stands in for Redis/BullMQ in the single-container/no-Docker setup:
 * it gives the same guarantee that matters functionally — the HTTP request
 * that enqueues a job returns immediately, and the job runs asynchronously
 * on the Node event loop — without an external Redis dependency.
 *
 * What it deliberately does NOT provide is durability. Jobs live in memory,
 * so a process restart loses whatever was queued or mid-flight. That is
 * survivable only because startup reconciliation (jobs/recovery.ts) finds
 * reports and exports left in a working state and re-enqueues them. Any
 * change here should keep that contract intact.
 *
 * To move to real BullMQ workers later: replace `enqueue` with
 * `queue.add(jobName, data)` and move each handler into a worker consuming
 * from the same queue name. No calling code elsewhere needs to change,
 * since callers only depend on `enqueue(jobName, payload)`.
 */
type JobHandler<T> = (payload: T) => Promise<void>;

interface JobOptions {
  /** Attempts in total, including the first. Default 1 (no retry). */
  attempts?: number;
  /** Base delay between attempts; doubles each time. Default 2s. */
  retryDelayMs?: number;
  /** Hard ceiling on a single attempt. Default 10 minutes. */
  timeoutMs?: number;
}

interface RegisteredJob<T> {
  handler: JobHandler<T>;
  options: Required<JobOptions>;
}

const DEFAULT_OPTIONS: Required<JobOptions> = {
  attempts: 1,
  retryDelayMs: 2_000,
  timeoutMs: 10 * 60_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A job that hangs forever would stall its lane permanently, so every
 * attempt races a timeout. Note this bounds how long the *queue* waits, not
 * the work itself — a handler that ignores the abort keeps running in the
 * background. Handlers that own external resources (the Tesseract worker)
 * do their own cleanup on timeout; see ocr.service.ts.
 */
async function withTimeout(promise: Promise<void>, ms: number, label: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Job "${label}" exceeded ${ms}ms`)), ms);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class InProcessQueue {
  private jobs = new Map<string, RegisteredJob<any>>();

  // One serialization chain per job name rather than a single global chain.
  // OCR is CPU-heavy and must stay serialized (the Tesseract worker is
  // shared), but a PDF export used to queue behind every pending OCR job
  // for no reason — a user exporting records right after a bulk upload
  // could wait minutes for a job that takes a second.
  private lanes = new Map<string, Promise<void>>();

  private inFlight = 0;

  register<T>(jobName: string, handler: JobHandler<T>, options: JobOptions = {}) {
    this.jobs.set(jobName, { handler, options: { ...DEFAULT_OPTIONS, ...options } });
  }

  /** Number of jobs currently queued or running — used by tests and shutdown. */
  get pending(): number {
    return this.inFlight;
  }

  enqueue<T>(jobName: string, payload: T) {
    const job = this.jobs.get(jobName);
    if (!job) {
      throw new Error(`No handler registered for job "${jobName}"`);
    }
    if (process.env.NODE_ENV === "test") return;

    this.inFlight += 1;
    const lane = this.lanes.get(jobName) ?? Promise.resolve();

    const next = lane.then(
      () =>
        new Promise<void>((resolve) => {
          // setImmediate ensures this runs after the current request/response
          // cycle completes.
          setImmediate(async () => {
            try {
              await this.runWithRetries(jobName, job, payload);
            } finally {
              this.inFlight -= 1;
              resolve();
            }
          });
        })
    );

    // A rejected lane promise would poison every subsequent job on it, so
    // the lane can only ever resolve — failures are handled inside.
    this.lanes.set(jobName, next);
  }

  private async runWithRetries<T>(jobName: string, job: RegisteredJob<T>, payload: T): Promise<void> {
    const { attempts, retryDelayMs, timeoutMs } = job.options;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await withTimeout(job.handler(payload), timeoutMs, jobName);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isFinalAttempt = attempt === attempts;
        logger.error(`Job "${jobName}" attempt ${attempt} of ${attempts} failed`, {
          error: message,
          willRetry: !isFinalAttempt,
        });
        if (isFinalAttempt) {
          // The handler is responsible for recording its own terminal
          // failure state (e.g. marking the report OCR_FAILED). This is the
          // last-resort log so a bug in that path is still visible.
          logger.error(`Job "${jobName}" gave up after ${attempts} attempt(s)`, { error: message });
          return;
        }
        await sleep(retryDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  /** Waits for every queued job to settle. Used on graceful shutdown. */
  async drain(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await sleep(100);
    }
  }
}

export const queue = new InProcessQueue();
