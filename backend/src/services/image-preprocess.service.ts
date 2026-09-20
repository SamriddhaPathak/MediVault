import sharp from "sharp";

/**
 * Chooses a preprocessing pipeline appropriate to the input rather than
 * blindly applying every filter to every image (per product requirement —
 * over-processing a clean, high-res scan can hurt OCR as much as help a
 * poor one).
 *
 * Pipeline:
 *  1. Read metadata to decide what's actually needed.
 *  2. Grayscale — Tesseract works on luminance; color information is
 *     noise for text recognition and grayscale also cuts memory/CPU cost.
 *  3. Upscale small images — phone photos taken from far away or
 *     low-resolution scans recognize far worse below ~1200px on the
 *     short edge; only upscale when actually undersized.
 *  4. Normalize contrast — stretches the tonal range, which helps with
 *     photos taken in poor/uneven lighting without blowing out clean scans
 *     (normalize() is a no-op-ish pass on already-high-contrast images).
 *  5. Light sharpen — recovers edge definition lost to phone-camera
 *     compression/blur, kept mild to avoid introducing speckle noise that
 *     would be misread as characters.
 *  6. Output as PNG (lossless) so no further compression artifacts are
 *     introduced before Tesseract sees it.
 *
 * True deskew/perspective-correction (for photographed, angled documents)
 * needs page-boundary + line-angle detection that isn't reliable to do
 * generically with sharp alone; Tesseract's own OSD (orientation and
 * script detection) is used downstream as a lighter-weight mitigation —
 * see ocr.job.ts. This is flagged here rather than silently skipped.
 */
export async function preprocessImageForOcr(input: Buffer): Promise<Buffer> {
  const image = sharp(input, { failOn: "none" });
  const metadata = await image.metadata();

  let pipeline = image.rotate(); // auto-orients using EXIF data from phone cameras
  pipeline = pipeline.grayscale();

  const shortEdge = Math.min(metadata.width ?? 0, metadata.height ?? 0);
  const TARGET_MIN_EDGE = 1600;
  if (shortEdge > 0 && shortEdge < TARGET_MIN_EDGE) {
    const scale = TARGET_MIN_EDGE / shortEdge;
    pipeline = pipeline.resize({
      width: Math.round((metadata.width ?? TARGET_MIN_EDGE) * scale),
      height: Math.round((metadata.height ?? TARGET_MIN_EDGE) * scale),
      kernel: "lanczos3",
    });
  }

  pipeline = pipeline.normalize();
  pipeline = pipeline.sharpen({ sigma: 0.8 });

  return pipeline.png().toBuffer();
}

/**
 * Rasterizes a PDF into one PNG buffer per page. Relies on libvips' PDF
 * support (bundled with prebuilt sharp binaries via pdfium); if the
 * installed sharp build lacks PDF support this throws — callers should
 * surface that as an OCR_FAILED report state with a clear message rather
 * than crash the job (see ocr.job.ts).
 */
export async function rasterizePdfPages(pdfBuffer: Buffer, maxPages: number): Promise<Buffer[]> {
  const probe = sharp(pdfBuffer, { density: 300 });
  const metadata = await probe.metadata();
  const pageCount = Math.min(metadata.pages ?? 1, maxPages);

  const pages: Buffer[] = [];
  for (let i = 0; i < pageCount; i++) {
    const pageBuffer = await sharp(pdfBuffer, { density: 300, page: i }).png().toBuffer();
    pages.push(pageBuffer);
  }
  return pages;
}
