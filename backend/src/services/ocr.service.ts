import fs from "fs";
import path from "path";
import { createWorker, PSM, OEM, type Worker } from "tesseract.js";
import { env } from "../config/env";
import { rotateImageBuffer } from "./image-preprocess.service";
import { logger } from "../utils/logger";

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
 * jobs/ocr.job.ts and services/image-preprocess.service.ts. Tesseract has
 * no native PDF support, so handing it a PDF buffer produces empty or
 * garbage output.
 */
export interface OCRService {
  extractText(imageBuffer: Buffer): Promise<OCRResult>;
}

// Page segmentation modes to try, in order. Reports are usually laid out
// as blocks of text (SINGLE_BLOCK), scans/photos can be sparse (SPARSE_TEXT),
// and forms/mixed layouts benefit from full automatic layout detection
// (AUTO). A single mode can return plausible-but-incomplete text, so every
// candidate is kept and the strongest one wins.
const PSM_CANDIDATES = [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT, PSM.AUTO];

// Per-attempt safety valve: Tesseract very rarely hangs on a pathological
// image (e.g. dense noise it keeps trying to segment).
const RECOGNIZE_TIMEOUT_MS = 45_000;

// If the strongest upright candidate is this weak, the page is worth
// re-trying rotated: real documents rarely score this low unless the text
// is genuinely sideways/upside-down (EXIF auto-orientation only corrects
// for how the camera was held, not how the page was framed in the shot).
const ROTATION_RETRY_CONFIDENCE = 55;
const ROTATION_RETRY_MIN_CHARS = 25;

// Worker startup occasionally fails for transient reasons (a cold cache, a
// slow filesystem). Retrying once costs little and avoids failing a report
// over a blip.
const WORKER_START_ATTEMPTS = 2;

/**
 * Where Tesseract looks for language data.
 *
 * A checked-in `eng.traineddata` ships with the repo but nothing used it,
 * so the very first OCR request downloaded ~5MB from a CDN — meaning OCR
 * simply did not work on an offline, air-gapped or firewalled host, and the
 * first upload after any deploy was at the mercy of that download. When the
 * configured language is present on disk, use it and disable the gzip
 * suffix lookup; otherwise fall back to the default network behaviour.
 */
function resolveLangPath(language: string): { langPath: string; gzip: boolean } | null {
  const candidateDirs = [
    process.env.TESSDATA_DIR,
    path.resolve(process.cwd(), "tessdata"),
    path.resolve(process.cwd()),
    path.resolve(__dirname, "..", ".."),
    path.resolve(__dirname, "..", "..", ".."),
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(path.join(dir, `${language}.traineddata`))) {
        return { langPath: dir, gzip: false };
      }
    } catch {
      // An unreadable candidate directory is not an error — try the next.
    }
  }
  return null;
}

function scoreResult(result: OCRResult): number {
  return result.confidence + Math.min(20, result.rawText.length / 200);
}

function isWeak(result: OCRResult): boolean {
  return result.confidence < ROTATION_RETRY_CONFIDENCE || result.rawText.length < ROTATION_RETRY_MIN_CHARS;
}

class TimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class TesseractOCRService implements OCRService {
  // A single worker is created lazily and reused for the lifetime of the
  // process instead of being spun up and torn down on every page. Worker
  // startup (loading the language model) is the most expensive and most
  // failure-prone part of the pipeline, so paying that cost once is both
  // faster and more resilient than a fresh worker per page.
  private workerPromise: Promise<Worker> | null = null;

  // Serializes recognize() calls *within this service* rather than relying
  // on the queue to do it. The previous code was correct only as long as
  // nothing else ever called extractText concurrently — an assumption that
  // silently broke the moment a second caller appeared (a reprocess
  // endpoint, a second queue lane, a test). A shared Tesseract worker is
  // not re-entrant: two overlapping setParameters/recognize pairs corrupt
  // each other's results.
  private lock: Promise<unknown> = Promise.resolve();

  private shuttingDown = false;

  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    // Keep the chain alive regardless of outcome so one failure does not
    // deadlock every later caller.
    this.lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async getWorker(): Promise<Worker> {
    if (this.shuttingDown) throw new Error("OCR service is shutting down");
    if (!this.workerPromise) {
      this.workerPromise = this.createWorkerWithRetries().catch((err) => {
        // Let the next call retry worker creation instead of caching a
        // rejected promise forever.
        this.workerPromise = null;
        throw err;
      });
    }
    return this.workerPromise;
  }

  private async createWorkerWithRetries(): Promise<Worker> {
    const language = env.ocrLanguage;
    const local = resolveLangPath(language);
    if (local) {
      logger.info("Using local Tesseract language data", { language, langPath: local.langPath });
    } else {
      logger.warn("No local Tesseract language data found; it will be downloaded on first use", { language });
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= WORKER_START_ATTEMPTS; attempt += 1) {
      try {
        return await createWorker(
          language,
          OEM.LSTM_ONLY,
          local ? { langPath: local.langPath, cachePath: local.langPath, gzip: local.gzip } : undefined
        );
      } catch (err) {
        lastError = err;
        logger.error("Tesseract worker creation failed", {
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not start the OCR engine");
  }

  /**
   * Disposes the current worker. Called after a timeout or a fatal engine
   * error, because a worker abandoned mid-recognize is not safe to reuse:
   * the timed-out recognition keeps running inside it, and the next
   * setParameters/recognize pair can hang behind it or return the previous
   * page's text. Previously the worker was kept and the whole pipeline
   * degraded from the first timeout onwards.
   */
  private async discardWorker(reason: string): Promise<void> {
    const existing = this.workerPromise;
    this.workerPromise = null;
    if (!existing) return;
    logger.warn("Discarding OCR worker", { reason });
    try {
      const worker = await existing;
      await worker.terminate();
    } catch {
      // best-effort — we are throwing this worker away either way
    }
  }

  private async recognizeOnce(imageBuffer: Buffer, psm: PSM, label: string): Promise<OCRResult | null> {
    try {
      const worker = await this.getWorker();
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data } = await withTimeout(worker.recognize(imageBuffer), RECOGNIZE_TIMEOUT_MS, label);
      const rawText = (data.text ?? "").replace(/[ \t]+$/gm, "").trim();
      const confidence = typeof data.confidence === "number" && Number.isFinite(data.confidence) ? data.confidence : 0;
      return rawText ? { rawText, confidence } : null;
    } catch (err) {
      // One failed attempt (a bad PSM for this image, a transient timeout)
      // should not sink the whole extraction — log it and let the caller
      // fall back to the other candidates/orientations.
      logger.error("OCR attempt failed", { label, error: err instanceof Error ? err.message : String(err) });
      if (err instanceof TimeoutError) {
        await this.discardWorker(`recognize timed out (${label})`);
      }
      return null;
    }
  }

  private async bestForBuffer(imageBuffer: Buffer, orientationLabel: string): Promise<OCRResult> {
    const candidates: OCRResult[] = [];
    for (const psm of PSM_CANDIDATES) {
      const result = await this.recognizeOnce(imageBuffer, psm, `${orientationLabel} psm=${psm}`);
      if (result) candidates.push(result);
      if (result && result.confidence >= 88 && result.rawText.length >= 40) break;
    }
    return candidates.sort((left, right) => scoreResult(right) - scoreResult(left))[0] ?? { rawText: "", confidence: 0 };
  }

  async extractText(imageBuffer: Buffer): Promise<OCRResult> {
    if (!imageBuffer || imageBuffer.length === 0) return { rawText: "", confidence: 0 };

    return this.runExclusive(async () => {
      const upright = await this.bestForBuffer(imageBuffer, "0deg");
      if (!isWeak(upright)) return upright;

      // The upright pass came back weak — likely a sideways or upside-down
      // page. Retry at each other 90-degree rotation (a single, reliable PSM
      // is enough here; we're screening orientations, not re-running the
      // full candidate sweep) and keep whichever orientation scores best
      // overall, upright included.
      let best = upright;
      for (const degrees of [90, 180, 270] as const) {
        let rotatedBuffer: Buffer;
        try {
          rotatedBuffer = await rotateImageBuffer(imageBuffer, degrees);
        } catch (err) {
          logger.error("Rotation retry failed to produce a buffer", {
            degrees,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        const rotated = await this.recognizeOnce(rotatedBuffer, PSM.AUTO, `${degrees}deg psm=${PSM.AUTO}`);
        if (rotated && scoreResult(rotated) > scoreResult(best)) best = rotated;
      }
      return best;
    });
  }

  /** Releases the underlying worker. Call on process shutdown. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.discardWorker("shutdown");
  }
}

export const ocrService = new TesseractOCRService();
