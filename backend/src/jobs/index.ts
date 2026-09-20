import { queue } from "./queue";
import { processOcrJob } from "./ocr.job";
import { processExportJob } from "./export.job";

// Registers all background job handlers on the in-process queue. Called
// once at server startup (see server.ts) and by createApp() for tests.
//
// Retry policy: OCR handles its own terminal failures (marking the report
// OCR_FAILED with a user-facing message), so queue-level retries exist only
// for the failures it cannot catch — the handler itself throwing, or an
// attempt exceeding the job timeout. Exports are cheap and idempotent, so
// they get a couple of attempts.
export function registerJobs() {
  queue.register("ocr", processOcrJob, {
    attempts: 2,
    retryDelayMs: 3_000,
    // A 30-page scanned PDF at three PSM passes per page is genuinely slow.
    // Generous, but finite: an unbounded job would hold the OCR lane and
    // stall every upload behind it.
    timeoutMs: 20 * 60_000,
  });

  queue.register("export", processExportJob, {
    attempts: 2,
    retryDelayMs: 1_000,
    timeoutMs: 2 * 60_000,
  });
}
