import { detectFileType, isProcessableType } from "../services/file-type.service";
import { preprocessImageForOcr } from "../services/image-preprocess.service";
import { extractMedicalFields, extractTestValues, extractDates, categorize } from "../modules/ocr/parser";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("File type detection", () => {
  // Uploads were previously routed by the browser-supplied Content-Type,
  // which is derived from the filename and entirely client-controlled.
  it("identifies a PNG by its magic bytes", () => {
    expect(detectFileType(PNG_1X1)).toBe("image/png");
  });

  it("identifies a PDF regardless of what it is named", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
    expect(detectFileType(pdf)).toBe("application/pdf");
  });

  it("identifies JPEG, BMP, TIFF and WebP containers", () => {
    expect(detectFileType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]))).toBe("image/jpeg");
    expect(detectFileType(Buffer.concat([Buffer.from("BM"), Buffer.alloc(16)]))).toBe("image/bmp");
    expect(detectFileType(Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(16)]))).toBe("image/tiff");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
    expect(detectFileType(webp)).toBe("image/webp");
  });

  it("rejects arbitrary bytes", () => {
    const junk = Buffer.from("this is definitely not a medical report at all");
    expect(detectFileType(junk)).toBe("unknown");
    expect(isProcessableType("unknown")).toBe(false);
  });

  it("does not crash on a truncated file", () => {
    expect(detectFileType(Buffer.alloc(0))).toBe("unknown");
    expect(detectFileType(Buffer.from([0xff]))).toBe("unknown");
  });
});

describe("Image preprocessing never throws", () => {
  // preprocessImageForOcr sits inside the per-page loop. If it can throw, a
  // single unreadable page fails OCR for an entire multi-page PDF — which
  // is exactly what used to happen, despite the per-page isolation the
  // caller believed it had.
  it("returns a usable buffer for a valid image", async () => {
    const out = await preprocessImageForOcr(PNG_1X1);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it("falls back to the original bytes for undecodable input", async () => {
    const garbage = Buffer.from("not an image, not even close");
    const out = await preprocessImageForOcr(garbage);
    expect(Buffer.isBuffer(out)).toBe(true);
  });

  it("falls back rather than throwing on an empty buffer", async () => {
    const out = await preprocessImageForOcr(Buffer.alloc(0));
    expect(Buffer.isBuffer(out)).toBe(true);
  });
});

describe("Parser is bounded on pathological input", () => {
  it("handles a very long noisy document without hanging", () => {
    // The shape of a badly degraded multi-page scan: thousands of short
    // junk lines with occasional label-like fragments.
    const noise = Array.from({ length: 4000 }, (_, i) => `~=|${i} ### ,,, ;;`).join("\n");
    const started = Date.now();
    const values = extractTestValues(noise);
    const fields = extractMedicalFields(noise);
    const elapsed = Date.now() - started;

    expect(Array.isArray(values)).toBe(true);
    expect(Array.isArray(fields)).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  });

  it("truncates absurdly long lines instead of scanning them", () => {
    const monster = `Diagnosis: ${"a".repeat(50_000)}`;
    const fields = extractMedicalFields(monster);
    const diagnosis = fields.find((f) => f.fieldName === "diagnosis");
    expect(diagnosis).toBeDefined();
    expect(diagnosis!.value.length).toBeLessThanOrEqual(1000);
  });

  it("still extracts correctly from a real report buried in noise", () => {
    const text = [
      "LABORATORY REPORT",
      "Patient Name: Jane Doe",
      "Report Date: 2026-03-14",
      "Hemoglobin 13.5 g/dL (12.0-16.0)",
      "Glucose: 95 mg/dL (70-110)",
      ...Array.from({ length: 500 }, () => "|||  ~~~  ..."),
    ].join("\n");

    expect(categorize(text).category).toBe("LABORATORY");
    const values = extractTestValues(text);
    expect(values.find((v) => v.testName.toLowerCase().includes("hemoglobin"))?.numericValue).toBe(13.5);
    expect(values.find((v) => v.testName.toLowerCase().includes("glucose"))?.numericValue).toBe(95);
    expect(extractDates(text).some((d) => d.value === "2026-03-14")).toBe(true);
  });

  it("deduplicates without quadratic blowup on repeated rows", () => {
    const repeated = Array.from({ length: 2000 }, () => "Hemoglobin 13.5 g/dL").join("\n");
    const started = Date.now();
    const values = extractTestValues(repeated);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(values.length).toBe(1);
  });

  it("returns empty results for empty input rather than throwing", () => {
    expect(extractTestValues("")).toEqual([]);
    expect(extractMedicalFields("")).toEqual([]);
    expect(extractDates("")).toEqual([]);
    expect(categorize("").category).toBe("OTHER");
  });
});
