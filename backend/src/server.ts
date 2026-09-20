import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { ocrService } from "./services/ocr.service";
import { queue } from "./jobs/queue";
import { recoverInterruptedJobs } from "./jobs/recovery";

const app = createApp();

const httpServer = app.listen(env.port, () => {
  logger.info(`MediVault API listening on port ${env.port}`, { env: env.nodeEnv });

  // The in-process queue is not durable, so anything that was queued or
  // running when this process last stopped needs picking back up. Without
  // this, a restart mid-OCR strands the report in PROCESSING permanently.
  void recoverInterruptedJobs();
});

let shuttingDown = false;

/**
 * Graceful shutdown. The previous version called process.exit(0)
 * immediately after closing the listener, killing any in-flight OCR job and
 * leaving its report stuck in PROCESSING. Now we stop accepting new
 * connections, give queued work a bounded window to finish, then release
 * the Tesseract worker (which otherwise holds the event loop open).
 *
 * Anything still unfinished when the window closes is recovered on next
 * boot by recoverInterruptedJobs(), so the worst case is a delay, never a
 * permanently stuck report.
 */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);

  httpServer.close();

  try {
    await queue.drain(15_000);
  } catch (err) {
    logger.error("Error while draining the job queue", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await ocrService.shutdown();
  } catch (err) {
    logger.error("Error while releasing the OCR worker", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// An unhandled rejection anywhere in the async job pipeline would otherwise
// terminate the process on modern Node with no explanation in the logs.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message });
  void shutdown("uncaughtException");
});
