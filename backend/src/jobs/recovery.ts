import { prisma } from "../config/prisma";
import { queue } from "./queue";
import { logger } from "../utils/logger";

/**
 * The in-process queue holds jobs in memory, so a restart — a deploy, a
 * crash, an OOM kill, `ts-node-dev` reloading on file save — loses whatever
 * was queued or mid-flight.
 *
 * Without reconciliation the consequences are permanent and user-visible:
 * a report left in PROCESSING stays in PROCESSING forever, the upload
 * screen polls it indefinitely, and the record can never be reviewed,
 * verified or exported. A report left in UPLOADED is never picked up at
 * all. Neither state has any path back short of manual database surgery.
 *
 * This runs once at startup and re-enqueues that work. It is deliberately
 * conservative:
 *  - Reports are only rescued up to MAX_AUTOMATIC_ATTEMPTS. A file that
 *    reliably kills the process would otherwise be re-enqueued on every
 *    boot, crash again, and turn one bad upload into a restart loop.
 *  - Anything over that limit is marked OCR_FAILED with a message pointing
 *    at manual entry, which is always available.
 *  - Exports are cheap and deterministic, so they are simply retried.
 */
const MAX_AUTOMATIC_ATTEMPTS = 3;

export async function recoverInterruptedJobs(): Promise<void> {
  try {
    await recoverReports();
    await recoverExports();
  } catch (err) {
    // Recovery must never prevent the server from starting. A failure here
    // means some work stays stuck, which is bad; a failure that stops the
    // process from booting is worse.
    logger.error("Startup job recovery failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function recoverReports(): Promise<void> {
  const interrupted = await prisma.report.findMany({
    where: { status: { in: ["UPLOADED", "PROCESSING"] } },
    select: { id: true, ocrAttempts: true },
    orderBy: { uploadTime: "asc" },
  });

  if (interrupted.length === 0) return;

  const exhausted = interrupted.filter((report) => report.ocrAttempts >= MAX_AUTOMATIC_ATTEMPTS);
  const retryable = interrupted.filter((report) => report.ocrAttempts < MAX_AUTOMATIC_ATTEMPTS);

  if (exhausted.length > 0) {
    await prisma.report.updateMany({
      where: { id: { in: exhausted.map((report) => report.id) } },
      data: {
        status: "OCR_FAILED",
        failureReason:
          "We couldn't finish processing this document after several attempts. You can enter the information manually, or try uploading it again.",
      },
    });
    logger.warn("Gave up automatically reprocessing reports", { count: exhausted.length });
  }

  for (const report of retryable) {
    // Reset to UPLOADED first so the state is honest if the process dies
    // again before the job runs.
    await prisma.report.updateMany({
      where: { id: report.id },
      data: { status: "UPLOADED", failureReason: null },
    });
    queue.enqueue("ocr", { reportId: report.id });
  }

  logger.info("Re-enqueued reports interrupted by a restart", {
    requeued: retryable.length,
    abandoned: exhausted.length,
  });
}

async function recoverExports(): Promise<void> {
  const interrupted = await prisma.exportJob.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    select: { id: true },
  });

  if (interrupted.length === 0) return;

  for (const job of interrupted) {
    await prisma.exportJob.updateMany({ where: { id: job.id }, data: { status: "PENDING" } });
    queue.enqueue("export", { exportJobId: job.id });
  }

  logger.info("Re-enqueued export jobs interrupted by a restart", { count: interrupted.length });
}
