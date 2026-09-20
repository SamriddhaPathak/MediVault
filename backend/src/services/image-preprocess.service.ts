import sharp from "sharp";
import { logger } from "../utils/logger";

// A decompression bomb (a tiny file that expands to gigapixels) would
// otherwise be decoded straight into memory and take the process down.
// sharp has its own default ceiling; this one is deliberately lower and
// explicit, sized for documents rather than satellite imagery.
const MAX_INPUT_PIXELS = 120_000_000; // ~120MP

// Upper bound on what we hand to Tesseract. Recognition time and memory
// scale with pixel count, and there is no accuracy benefit to feeding it a
// 48MP phone photo of an A4 page — but there is a very real risk of a
// single upload occupying the OCR lane for minutes.
const MAX_OCR_EDGE = 3500;

// Below this, small scans and distant phone photos recognize noticeably
// worse, so they are upscaled.
const TARGET_MIN_EDGE = 1600;

const LOW_CONTRAST_STDEV = 45;

// 300 DPI is the sweet spot for OCR on printed text. Dropped to 200 for
// very long documents so a 30-page PDF does not spend its entire time
// budget rasterizing.
const PDF_DENSITY_DEFAULT = 300;
const PDF_DENSITY_LONG_DOCUMENT = 200;
const PDF_LONG_DOCUMENT_PAGES = 10;

function sharpFrom(input: Buffer, options: sharp.SharpOptions = {}) {
  return sharp(input, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS, ...options });
}

/**
 * Chooses a preprocessing pipeline appropriate to the input rather than
 * blindly applying every filter to every image (per product requirement —
 * over-processing a clean, high-res scan can hurt OCR as much as help a
 * poor one).
 *
 * Pipeline:
 *  1. Read metadata to decide what's actually needed.
 *  2. Auto-orient via EXIF, then grayscale — Tesseract works on luminance;
 *     color is noise for text recognition and grayscale cuts memory/CPU.
 *  3. Resize into a sane band: upscale genuinely small images, and downscale
 *     enormous ones (see MAX_OCR_EDGE).
 *  4. Normalize contrast — helps photos taken in poor/uneven lighting
 *     without blowing out clean scans.
 *  5. Adaptive contrast boost — applied ONLY when the image measures as
 *     genuinely low-contrast (faded thermal prints, weak scans), detected
 *     from actual pixel statistics rather than guessed.
 *  6. Light sharpen — recovers edge definition lost to camera compression,
 *     kept mild to avoid speckle that would be misread as characters.
 *  7. Output as PNG (lossless) so no compression artifacts are introduced
 *     before Tesseract sees it.
 *
 * True deskew/perspective-correction (for photographed, angled documents)
 * needs page-boundary + line-angle detection that isn't reliable to do
 * generically with sharp alone, so it is intentionally out of scope here.
 * Whole-page 90/180/270 misorientation IS handled, in ocr.service.ts.
 *
 * This never throws. A page that cannot be preprocessed is still worth
 * attempting to recognize as-is — previously a single unreadable page threw
 * out of a Promise.all and failed OCR for the entire multi-page document,
 * despite the per-page isolation the caller believed it had.
 */
export async function preprocessImageForOcr(input: Buffer): Promise<Buffer> {
  try {
    return await runPreprocessPipeline(input);
  } catch (err) {
    logger.warn("Image preprocessing failed; falling back to the original bytes", {
      error: err instanceof Error ? err.message : String(err),
    });
    return input;
  }
}

async function runPreprocessPipeline(input: Buffer): Promise<Buffer> {
  const metadata = await sharpFrom(input).metadata();

  let pipeline = sharpFrom(input).rotate().grayscale(); // rotate() auto-orients from EXIF

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);

  if (longEdge > MAX_OCR_EDGE) {
    // Downscale first: cheaper for every subsequent operation, and it keeps
    // a 50MP phone photo from monopolizing the OCR lane.
    pipeline = pipeline.resize({
      width: width >= height ? MAX_OCR_EDGE : undefined,
      height: height > width ? MAX_OCR_EDGE : undefined,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    });
  } else if (shortEdge > 0 && shortEdge < TARGET_MIN_EDGE) {
    const scale = TARGET_MIN_EDGE / shortEdge;
    pipeline = pipeline.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      kernel: "lanczos3",
    });
  }

  pipeline = pipeline.normalize();

  // Measure contrast on the grayscale, oriented, resized pixels — as close
  // as possible to what Tesseract will actually see — so the decision
  // reflects the real input rather than the original file's metadata.
  const measured = await pipeline.clone().toBuffer();

  let stdev = 100;
  try {
    const stats = await sharpFrom(measured).stats();
    stdev = stats.channels[0]?.stdev ?? 100;
  } catch (err) {
    // Statistics are an optimization, not a requirement. If they fail, skip
    // the adaptive boost rather than failing the page.
    logger.warn("Could not measure image contrast; skipping adaptive boost", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let finalPipeline = sharpFrom(measured);
  if (stdev < LOW_CONTRAST_STDEV) {
    // Stretch pixel values around the midpoint: a > 1 multiplier widens the
    // spread between ink and background, recovering legibility on faded
    // thermal prints and washed-out photos without the harshness of a hard
    // black/white threshold (which severs thin character strokes and hurts
    // the LSTM recognizer more than it helps).
    const gain = 1.35;
    finalPipeline = finalPipeline.linear(gain, -(128 * gain - 128));
  }

  return finalPipeline.sharpen({ sigma: 0.8 }).png().toBuffer();
}

/**
 * Rotates a preprocessed page buffer by an exact multiple of 90 degrees.
 * Used by ocr.service.ts to recover text from documents photographed or
 * scanned sideways/upside-down — a real, common failure mode for phone
 * uploads that EXIF-based auto-orientation cannot catch, since EXIF only
 * records how the camera was held, not how the page was laid out.
 */
export async function rotateImageBuffer(input: Buffer, degrees: 90 | 180 | 270): Promise<Buffer> {
  return sharpFrom(input).rotate(degrees).png().toBuffer();
}

export interface PdfPageSource {
  pageCount: number; // pages that will be rasterized
  totalPages: number; // pages the document actually contains
  /** Rasterizes one page on demand. Throws only for that page. */
  renderPage(index: number): Promise<Buffer>;
}

/**
 * Detects whether the installed sharp/libvips build can read PDFs at all,
 * and how many pages this document has, WITHOUT rasterizing anything.
 *
 * Pages are rendered lazily, one at a time, rather than all at once. The
 * previous `rasterizePdfPages` returned an array of every page and the
 * caller then ran `Promise.all` over them — so a 30-page PDF held 30
 * full-size 300-DPI PNGs plus 30 preprocessed copies in memory
 * simultaneously, hundreds of megabytes, with a real chance of taking the
 * whole process down. Only one page is resident at a time now.
 */
export async function openPdfPages(pdfBuffer: Buffer, maxPages: number): Promise<PdfPageSource> {
  const metadata = await sharpFrom(pdfBuffer, { density: PDF_DENSITY_DEFAULT }).metadata();
  const totalPages = Math.max(1, metadata.pages ?? 1);
  const pageCount = Math.min(totalPages, maxPages);
  const density = totalPages > PDF_LONG_DOCUMENT_PAGES ? PDF_DENSITY_LONG_DOCUMENT : PDF_DENSITY_DEFAULT;

  return {
    pageCount,
    totalPages,
    async renderPage(index: number): Promise<Buffer> {
      return sharpFrom(pdfBuffer, { density, page: index }).png().toBuffer();
    },
  };
}
