-- Non-fatal notices produced while processing a report (e.g. a PDF longer
-- than the page limit, or an extraction capped at the maximum row count).
-- Kept separate from `failureReason`, which the UI only ever shows for a
-- report in OCR_FAILED — a notice stored there on a successful extraction
-- would never be displayed.
ALTER TABLE "Report" ADD COLUMN "processingNotice" TEXT;
ALTER TABLE "Report" ADD COLUMN "ocrAttempts" INTEGER NOT NULL DEFAULT 0;
