import { prisma } from "../config/prisma";
import { ocrService } from "../services/ocr.service";
import { storageService } from "../services/storage.service";
import { preprocessImageForOcr, rasterizePdfPages } from "../services/image-preprocess.service";
import { categorize, extractDates, extractMedicalFields, extractTestValues } from "../modules/ocr/parser";
import { logger } from "../utils/logger";

export interface OCRJobPayload {
  reportId: string;
}

const MAX_PDF_PAGES_TO_OCR = 30; // matches the upload guard so later pages are not silently discarded

/**
 * Full OCR pipeline for one report:
 * UPLOADED -> PROCESSING -> (rasterize if PDF, preprocess, extract, parse,
 * categorize) -> PENDING_REVIEW, or -> OCR_FAILED with the original file
 * always preserved either way.
 *
 * Tesseract has no native PDF support, so PDFs are rasterized to one PNG
 * per page first (image-preprocess.service.ts) — this was previously
 * missing, which meant every PDF upload silently produced empty/garbage
 * OCR output.
 */
export async function processOcrJob({ reportId }: OCRJobPayload): Promise<void> {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return;

  await prisma.report.update({ where: { id: reportId }, data: { status: "PROCESSING" } });

  try {
    const original = await storageService.read(report.originalFileKey);

    let pageBuffers: Buffer[];
    if (report.mimeType === "application/pdf") {
      try {
        pageBuffers = await rasterizePdfPages(original, MAX_PDF_PAGES_TO_OCR);
      } catch (rasterErr) {
        logger.error("PDF rasterization failed", {
          reportId,
          error: rasterErr instanceof Error ? rasterErr.message : String(rasterErr),
        });
        await prisma.report.update({
          where: { id: reportId },
          data: {
            status: "OCR_FAILED",
            failureReason: "We couldn't read this PDF for processing. You can still enter information manually.",
          },
        });
        return;
      }
    } else {
      pageBuffers = [original];
    }

    // Preprocess each page (grayscale, upscale-if-small, normalize contrast,
    // light sharpen — see image-preprocess.service.ts for why each step is
    // chosen conditionally rather than always-applied).
    const preprocessed = await Promise.all(pageBuffers.map((buf) => preprocessImageForOcr(buf)));

    const pageResults = [];
    for (const pageBuffer of preprocessed) {
      pageResults.push(await ocrService.extractText(pageBuffer));
    }

    const rawText = pageResults.map((r) => r.rawText).join("\n\n--- page break ---\n\n");
    const ocrConfidenceRaw =
      pageResults.reduce((sum, r) => sum + r.confidence, 0) / Math.max(1, pageResults.length);

    if (!rawText || rawText.replace(/---\s*page break\s*---/g, "").trim().length < 3) {
      await prisma.report.update({
        where: { id: reportId },
        data: {
          status: "OCR_FAILED",
          failureReason: "No readable text detected in document. You can still enter information manually.",
        },
      });
      return;
    }

    const { category, confidence: categoryConfidence } = categorize(rawText);
    const dates = extractDates(rawText);
    const medicalFields = extractMedicalFields(rawText);
    const testValues = extractTestValues(rawText);

    const parserConfidence =
      testValues.length > 0
        ? testValues.reduce((sum, t) => sum + t.confidence, 0) / testValues.length
        : 0.4;

    // Overall confidence blends the OCR engine's own confidence (0-100)
    // with how confident the rule-based parser was in what it found.
    const overallConfidence =
      Math.round(Math.min(100, ocrConfidenceRaw * 0.6 + parserConfidence * 100 * 0.4)) / 100;

    const primaryDate = dates.find((date) => date.kind === "report" || date.kind === "collection" || date.kind === "performed") ?? dates.find((date) => date.kind !== "birth");
    const reportDate = primaryDate?.value ? new Date(primaryDate.value) : null;

    await prisma.$transaction(async (tx) => {
      // A retry/reprocess must replace prior OCR proposals without touching
      // user edits. This keeps one canonical OCR test row per extraction.
      await tx.testValue.deleteMany({ where: { reportId, source: "ocr" } });
      await tx.extractedField.deleteMany({ where: { reportId, source: "ocr" } });

      await tx.report.update({
        where: { id: reportId },
        data: {
          status: "PENDING_REVIEW",
          category,
          reportDate,
          extractedText: rawText,
          ocrConfidence: overallConfidence,
        },
      });

      if (reportDate) {
        await tx.extractedField.create({
          data: {
            reportId,
            fieldName: "reportDate",
            value: reportDate.toISOString().slice(0, 10),
            confidence: primaryDate?.confidence ?? 0.5,
            source: "ocr",
          },
        });
      }

      await tx.extractedField.create({
        data: {
          reportId,
          fieldName: "category",
          value: category,
          confidence: categoryConfidence,
          source: "ocr",
        },
      });

      for (const field of medicalFields) {
        await tx.extractedField.create({
          data: {
            reportId,
            fieldName: field.fieldName,
            value: field.value,
            normalizedValue: field.normalizedValue,
            confidence: field.confidence,
            source: "ocr",
          },
        });
      }

      for (const tv of testValues) {
        await tx.testValue.create({
          data: {
            reportId,
            testName: tv.testName,
            numericValue: tv.numericValue,
            unit: tv.unit,
            recordedDate: tv.recordedDate ? new Date(tv.recordedDate) : reportDate ?? report.uploadTime,
            referenceRangeText: tv.referenceRangeText,
            source: "ocr",
            confidence: tv.confidence,
          },
        });
        await tx.extractedField.create({
          data: {
            reportId,
            fieldName: `test:${tv.testName}`,
            value: `${tv.numericValue}${tv.unit ? " " + tv.unit : ""}`,
            normalizedValue: String(tv.numericValue),
            confidence: tv.confidence,
            source: "ocr",
          },
        });
      }
    });

    logger.info("OCR processing complete", {
      reportId,
      category,
      pageCount: pageResults.length,
      testValueCount: testValues.length,
      medicalFieldCount: medicalFields.length,
      overallConfidence,
    });
  } catch (err) {
    logger.error("OCR processing failed", { reportId, error: err instanceof Error ? err.message : String(err) });
    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: "OCR_FAILED",
        failureReason: "OCR processing encountered an error. You can still enter information manually.",
      },
    });
  }
}
