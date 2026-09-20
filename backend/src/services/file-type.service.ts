/**
 * Detects a file's real type from its leading bytes.
 *
 * Uploads were previously routed through the pipeline on the strength of
 * the `Content-Type` the browser attached to the multipart part, which is
 * derived from the filename and is entirely client-controlled. A PDF saved
 * as `results.png` therefore went down the image branch and produced
 * garbage, and a JPEG named `scan.pdf` went to the PDF rasterizer and
 * failed outright — both reported to the user as "we couldn't read this",
 * with nothing in the logs pointing at the real cause.
 *
 * This is a small, dependency-free sniffer covering exactly the formats the
 * upload endpoint accepts. It is used to decide how to *process* a file and
 * to reject mismatches at upload time; it is not a security boundary on its
 * own (the extension and declared type are still checked separately).
 */
export type DetectedFileType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/tiff"
  | "image/bmp"
  | "image/avif"
  | "unknown";

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

export function detectFileType(buffer: Buffer): DetectedFileType {
  if (buffer.length < 12) return "unknown";

  // %PDF — the spec allows leading junk, so scan a small prefix.
  const prefix = buffer.subarray(0, 1024).toString("latin1");
  if (prefix.includes("%PDF-")) return "application/pdf";

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buffer, [0x42, 0x4d])) return "image/bmp";

  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
  if (startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "image/tiff";
  }

  // RIFF containers: bytes 0-3 "RIFF", bytes 8-11 identify the format.
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  // ISO-BMFF box: bytes 4-7 "ftyp", brand follows. AVIF brands: avif, avis.
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return "image/avif";
  }

  return "unknown";
}

/** True when the detected type is one the OCR pipeline can rasterize. */
export function isProcessableType(type: DetectedFileType): boolean {
  return type !== "unknown";
}
