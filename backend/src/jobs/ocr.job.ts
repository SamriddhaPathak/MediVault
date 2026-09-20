import { prisma } from "../config/prisma";
import { ocrService, type OCRResult } from "../services/ocr.service";
import { storageService } from "../services/storage.service";
import { openPdfPages, preprocessImageForOcr } from "../services/image-preprocess.service";
import { detectFileType } from "../services/file-type.service";
import { categorize, extractDates, extractMedicalFields, extractTestValues } from "../modules/ocr/parser";
import { logger } from "../utils/logger";

export interface OCRJobPayload {
  reportId: string;
}

const MAX_PDF_PAGES_TO_OCR = 30; // matches the upload guard

// Hard caps on what one document may contribute. A pathological scan can
// make the line parser emit thousands of "test values" from table borders
// and page furniture; writing all of them would bloat the database, make
// the review screen unusable. Truncation is
// recorded so the user is told rather than silently given a partial view.
const MAX_TEST_VALUES = 300;
const MAX_MEDICAL_FIELDS = 200;

// SQLite stores this inline; a 30-page OCR dump can run to megabytes and is
// only ever used for substring search. Cap it.
const MAX_EXTRACTED_TEXT_CHARS = 500_000;

const PAGE_BREAK = "\n\n--- page break ---\n\n";

/**
 * Terminal/status writes use updateMany rather than update so that a report
 * deleted mid-job (entirely possible — the job runs asynchronously, the
 * user is still in the app) is a no-op instead of an exception thrown from
 * inside an error handler, which would escape as an unhandled rejection.
 */
async function setReportState(reportId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await prisma.report.updateMany({ where: { id: reportId }, data });
  } catch (err) {
    logger.error("Could not update report state", {
      reportId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function failReport(reportId: string, failureReason: string): Promise<void> {
  await setReportState(reportId, { status: "OCR_FAILED", failureReason });
}

interface PageOutcome extends OCRResult {
  ok: boolean;
}

/**
 * Full OCR pipeline for one report:
 * UPLOADED -> PROCESSING -> (rasterize if PDF, preprocess, extract, parse,
 * categorize) -> PENDING_REVIEW, or -> OCR_FAILED with the original file
 * always preserved either way.
 *
 * Every stage is individually fallible and individually contained: a page
 * that will not rasterize, will not preprocess, or will not recognize
 * contributes an empty result and the remaining pages carry on. The job
 * only fails as a whole when there is genuinely nothing usable to show.
 */
export async function processOcrJob({ reportId }: OCRJobPayload): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    logger.info("OCR job skipped: report no longer exists", { reportId });
    return;
  }
  if (report.status === "ARCHIVED") {
    logger.info("OCR job skipped: report is archived", { reportId });
    return;
  }

  await setReportState(reportId, {
    status: "PROCESSING",
    failureReason: null,
    processingNotice: null,
    ocrAttempts: { increment: 1 },
  });

  let original: Buffer;
  try {
    original = await storageService.read(report.originalFileKey);
  } catch (err) {
    // The stored file is gone or unreadable. Nothing downstream can help,
    // and retrying will not fix it, so fail with a message that tells the
    // user the honest situation.
    logger.error("Could not read the stored file for OCR", {
      reportId,
      error: err instanceof Error ? err.message : String(err),
    });
    await failReport(
      reportId,
      "We couldn't open the stored file for this report. You can re-upload it, or enter the information manually."
    );
    return;
  }

  if (original.length === 0) {
    await failReport(reportId, "This file appears to be empty. You can enter the information manually.");
    return;
  }

  try {
    // Trust the bytes, not the declared MIME type: the latter comes from the
    // client and a mislabelled file previously went down the wrong branch
    // and failed with a misleading message.
    const detectedType = detectFileType(original);
    const effectiveType = detectedType === "unknown" ? report.mimeType : detectedType;
    if (detectedType !== "unknown" && detectedType !== report.mimeType) {
      logger.warn("Uploaded file type does not match its declared type", {
        reportId,
        declared: report.mimeType,
        detected: detectedType,
      });
    }

    const { pages, truncatedPages } =
      effectiveType === "application/pdf"
        ? await recognizePdf(reportId, original)
        : await recognizeSingleImage(original);

    if (pages === null) {
      await failReport(
        reportId,
        "We couldn't read this PDF for processing. You can still enter information manually."
      );
      return;
    }

    const successfulPages = pages.filter((page) => page.ok);
    const rawText = pages
      .map((page) => page.rawText)
      .join(PAGE_BREAK)
      .slice(0, MAX_EXTRACTED_TEXT_CHARS);

    // Average confidence over pages that actually produced a reading. The
    // previous average included failed pages as zeroes, so one blank or
    // torn page in an otherwise clean ten-page PDF could drag the mean
    // below the noise threshold and fail the whole document.
    const ocrConfidenceRaw =
      successfulPages.length > 0
        ? successfulPages.reduce((sum, page) => sum + page.confidence, 0) / successfulPages.length
        : 0;

    const meaningfulText = rawText.replace(/---\s*page break\s*---/g, "").trim();

    if (!isUsableText(meaningfulText, ocrConfidenceRaw)) {
      await failReport(
        reportId,
        "No readable text detected in document. You can still enter information manually."
      );
      return;
    }

    await persistExtraction({
      reportId,
      rawText,
      ocrConfidenceRaw,
      uploadTime: report.uploadTime,
      truncatedPages,
      pageCount: pages.length,
    });
  } catch (err) {
    logger.error("OCR processing failed", { reportId, error: err instanceof Error ? err.message : String(err) });
    await failReport(
      reportId,
      "OCR processing encountered an error. You can still enter information manually."
    );
  }
}

/**
 * Beyond "is there any text at all", reject output that is mostly
 * symbol/noise garbage (a common failure signature for a badly degraded
 * scan that still produces a few stray recognized glyphs) — saving that as
 * a "successful" OCR result would hand the categorizer and field parser
 * noise to work with instead of surfacing a clear failure the user can act
 * on.
 */
function isUsableText(meaningfulText: string, ocrConfidence: number): boolean {
  if (!meaningfulText || meaningfulText.length < 3) return false;

  const alnumCount = meaningfulText.match(/[A-Za-z0-9]/g)?.length ?? 0;
  const alnumRatio = alnumCount / meaningfulText.length;
  if (meaningfulText.length >= 20 && alnumRatio < 0.35) return false;

  // A blanket "isn't a document" case the alnum-ratio check misses: fed pure
  // visual noise, Tesseract's language model hallucinates short,
  // plausible-looking word fragments that keep the alnum ratio deceptively
  // high while the engine's OWN confidence in that reading stays very low.
  if (meaningfulText.length >= 20 && ocrConfidence < 30) return false;

  return true;
}

async function recognizeSingleImage(original: Buffer): Promise<{ pages: PageOutcome[]; truncatedPages: number }> {
  return { pages: [await recognizePage(original, 0)], truncatedPages: 0 };
}

async function recognizePdf(
  reportId: string,
  original: Buffer
): Promise<{ pages: PageOutcome[] | null; truncatedPages: number }> {
  let source;
  try {
    source = await openPdfPages(original, MAX_PDF_PAGES_TO_OCR);
  } catch (err) {
    // Almost always means the installed sharp/libvips build has no PDF
    // support. Surface it as a clean OCR_FAILED rather than a crash.
    logger.error("PDF rasterization unavailable", {
      reportId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { pages: null, truncatedPages: 0 };
  }

  const pages: PageOutcome[] = [];
  for (let index = 0; index < source.pageCount; index += 1) {
    let pageBuffer: Buffer;
    try {
      pageBuffer = await source.renderPage(index);
    } catch (err) {
      // One page that will not rasterize (a corrupt object, an unsupported
      // embedded font) must not cost the user the other 29.
      logger.error("Could not rasterize one PDF page; continuing", {
        reportId,
        pageIndex: index,
        error: err instanceof Error ? err.message : String(err),
      });
      pages.push({ rawText: "", confidence: 0, ok: false });
      continue;
    }
    pages.push(await recognizePage(pageBuffer, index));
  }

  if (pages.length === 0) {
    return { pages: null, truncatedPages: 0 };
  }

  const truncatedPages = Math.max(0, source.totalPages - source.pageCount);
  if (truncatedPages > 0) {
    logger.warn("PDF exceeded the page limit; later pages were not processed", {
      reportId,
      totalPages: source.totalPages,
      processed: source.pageCount,
    });
  }
  return { pages, truncatedPages };
}

async function recognizePage(pageBuffer: Buffer, pageIndex: number): Promise<PageOutcome> {
  // preprocessImageForOcr never throws — it falls back to the original
  // bytes — but recognition still can, so it stays wrapped.
  const prepared = await preprocessImageForOcr(pageBuffer);
  try {
    const result = await ocrService.extractText(prepared);
    return { ...result, ok: result.rawText.length > 0 };
  } catch (err) {
    logger.error("OCR failed for one page; continuing with remaining pages", {
      pageIndex,
      error: err instanceof Error ? err.message : String(err),
    });
    return { rawText: "", confidence: 0, ok: false };
  }
}

function safeDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function persistExtraction(input: {
  reportId: string;
  rawText: string;
  ocrConfidenceRaw: number;
  uploadTime: Date;
  truncatedPages: number;
  pageCount: number;
}): Promise<void> {
  const { reportId, rawText, ocrConfidenceRaw, uploadTime, truncatedPages, pageCount } = input;

  const { category, confidence: categoryConfidence } = categorize(rawText);
  const dates = extractDates(rawText);
  const allMedicalFields = extractMedicalFields(rawText);
  const allTestValues = extractTestValues(rawText);

  const medicalFields = allMedicalFields.slice(0, MAX_MEDICAL_FIELDS);
  const testValues = allTestValues.slice(0, MAX_TEST_VALUES);
  const truncatedValues = allTestValues.length - testValues.length;
  if (truncatedValues > 0 || allMedicalFields.length > medicalFields.length) {
    logger.warn("Extraction output was capped", {
      reportId,
      testValues: allTestValues.length,
      fields: allMedicalFields.length,
    });
  }

  const parserConfidence =
    testValues.length > 0 ? testValues.reduce((sum, t) => sum + t.confidence, 0) / testValues.length : 0.4;

  // Overall confidence blends the OCR engine's own confidence (0-100) with
  // how confident the rule-based parser was in what it found.
  const overallConfidence =
    Math.round(Math.min(100, Math.max(0, ocrConfidenceRaw * 0.6 + parserConfidence * 100 * 0.4))) / 100;

  const primaryDate =
    dates.find((date) => date.kind === "report" || date.kind === "collection" || date.kind === "performed") ??
    dates.find((date) => date.kind !== "birth");
  const reportDate = primaryDate?.value ? safeDate(primaryDate.value, uploadTime) : null;

  const notices: string[] = [];
  if (truncatedPages > 0) {
    notices.push(
      `Only the first ${pageCount} pages were processed; this document has ${pageCount + truncatedPages}.`
    );
  }
  if (truncatedValues > 0) {
    notices.push(`Showing the first ${testValues.length} extracted values of ${testValues.length + truncatedValues}.`);
  }

  // Rows are built outside the transaction and written with createMany so
  // the transaction is three statements rather than two per extracted
  // value. A dense lab report could previously issue 600+ sequential
  // inserts inside one interactive transaction and blow past Prisma's
  // 5-second default timeout — failing an otherwise perfectly good
  // extraction and reporting it to the user as an OCR error.
  const fieldRows: Array<{
    reportId: string;
    fieldName: string;
    value: string;
    normalizedValue?: string | null;
    confidence: number;
    source: string;
  }> = [];

  if (reportDate) {
    fieldRows.push({
      reportId,
      fieldName: "reportDate",
      value: reportDate.toISOString().slice(0, 10),
      confidence: primaryDate?.confidence ?? 0.5,
      source: "ocr",
    });
  }

  fieldRows.push({
    reportId,
    fieldName: "category",
    value: category,
    confidence: categoryConfidence,
    source: "ocr",
  });

  for (const field of medicalFields) {
    fieldRows.push({
      reportId,
      fieldName: field.fieldName,
      value: field.value,
      normalizedValue: field.normalizedValue ?? null,
      confidence: field.confidence,
      source: "ocr",
    });
  }

  const testValueRows = testValues.map((tv) => ({
    reportId,
    testName: tv.testName,
    numericValue: tv.numericValue,
    unit: tv.unit ?? null,
    recordedDate: safeDate(tv.recordedDate, reportDate ?? uploadTime),
    referenceRangeText: tv.referenceRangeText ?? null,
    source: "ocr",
    confidence: tv.confidence,
  }));

  for (const tv of testValues) {
    fieldRows.push({
      reportId,
      fieldName: `test:${tv.testName}`,
      value: `${tv.numericValue}${tv.unit ? " " + tv.unit : ""}`,
      normalizedValue: String(tv.numericValue),
      confidence: tv.confidence,
      source: "ocr",
    });
  }

  await prisma.$transaction(
    async (tx) => {
      // A retry/reprocess must replace prior OCR proposals without touching
      // user edits. This keeps one canonical OCR row set per extraction.
      await tx.testValue.deleteMany({ where: { reportId, source: "ocr" } });
      await tx.extractedField.deleteMany({ where: { reportId, source: "ocr" } });

      await tx.report.updateMany({
        where: { id: reportId },
        data: {
          status: "PENDING_REVIEW",
          category,
          reportDate,
          extractedText: rawText,
          ocrConfidence: overallConfidence,
          failureReason: null,
          processingNotice: notices.length > 0 ? notices.join(" ") : null,
        },
      });

      if (fieldRows.length > 0) await tx.extractedField.createMany({ data: fieldRows });
      if (testValueRows.length > 0) await tx.testValue.createMany({ data: testValueRows });
    },
    { timeout: 30_000, maxWait: 10_000 }
  );

  logger.info("OCR processing complete", {
    reportId,
    category,
    pageCount,
    testValueCount: testValues.length,
    medicalFieldCount: medicalFields.length,
    overallConfidence,
  });
}
