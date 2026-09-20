import { createWorker } from "tesseract.js";
import { env } from "../config/env";

export interface OCRResult {
  rawText: string;
  confidence: number; // 0-100
}

/**
 * OCR abstraction. The rest of the app (ocr.job.ts, parser, categorizer)
 * only ever talks to this interface, so a CloudOCRService / PythonOCRService
 * / AdvancedOCRService can be swapped in later without touching the
 * report-processing workflow.
 *
 * Takes a raster image buffer (PNG/JPEG) — NOT a PDF. PDFs must be
 * rasterized page-by-page before reaching this service; see
 * jobs/ocr.job.ts and services/pdf-rasterize.service.ts. Tesseract has no
 * native PDF support, so handing it a PDF buffer previously produced
 * empty or garbage output for every PDF upload.
 */
export interface OCRService {
  extractText(imageBuffer: Buffer): Promise<OCRResult>;
}

export class TesseractOCRService implements OCRService {
  async extractText(imageBuffer: Buffer): Promise<OCRResult> {
    const worker = await createWorker(env.ocrLanguage);
    try {
      // Different medical documents need different layout assumptions:
      // reports are often blocks (6), scans can be sparse (11), and forms
      // benefit from automatic layout detection (3). A single PSM can return
      // plausible but incomplete text, so retain the strongest candidate.
      const candidates: OCRResult[] = [];
      for (const pageSegmentationMode of ["6", "11", "3"]) {
        await worker.setParameters({ tessedit_pageseg_mode: pageSegmentationMode as any });
        const { data } = await worker.recognize(imageBuffer);
        const rawText = (data.text ?? "").replace(/[ \t]+$/gm, "").trim();
        const confidence = typeof data.confidence === "number" ? data.confidence : 0;
        if (rawText) candidates.push({ rawText, confidence });
        if (confidence >= 88 && rawText.length >= 40) break;
      }

      return candidates.sort((left, right) => {
        const leftScore = left.confidence + Math.min(20, left.rawText.length / 200);
        const rightScore = right.confidence + Math.min(20, right.rawText.length / 200);
        return rightScore - leftScore;
      })[0] ?? { rawText: "", confidence: 0 };
    } finally {
      await worker.terminate();
    }
  }
}

export const ocrService: OCRService = new TesseractOCRService();
