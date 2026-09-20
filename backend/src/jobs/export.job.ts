import { prisma } from "../config/prisma";
import { generateExportPdf } from "../services/pdf.service";
import { storageService } from "../services/storage.service";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

export interface ExportJobPayload {
  exportJobId: string;
}

const exportDir = path.resolve(env.export.localDir);
fs.mkdirSync(exportDir, { recursive: true });

// Explicit shapes for the query below, mirroring prisma/schema.prisma.
// Deep nested `include` payloads are not always inferred reliably across
// every TS/Prisma toolchain combination (and Prisma's own generated
// `Prisma.XGetPayload` helpers require a fully generated client, which a
// restricted/offline environment may not have) — spelling these out keeps
// `item`/`f`/`t` below fully typed (never `any`) either way.
interface ExportedField {
  fieldName: string;
  value: string;
  source: string;
  confidence: number;
}
interface ExportedTestValue {
  testName: string;
  numericValue: number;
  unit: string | null;
  recordedDate: Date;
  referenceRangeText: string | null;
  confidence: number | null;
}
interface ExportReportItem {
  report: {
    name: string;
    category: string;
    status: string;
    reportDate: Date | null;
    uploadTime: Date;
    extractedFields: ExportedField[];
    testValues: ExportedTestValue[];
  };
}
interface ExportJobWithItems {
  items: ExportReportItem[];
  user: {
    email: string;
    healthProfile: {
      age: number | null;
      bloodGroup: string | null;
      allergies: string | null;
      knownConditions: string | null;
    } | null;
  };
}

export async function processExportJob({ exportJobId }: ExportJobPayload): Promise<void> {
  const job: ExportJobWithItems | null = await prisma.exportJob.findUnique({
    where: { id: exportJobId },
    include: { items: { include: { report: { include: { extractedFields: true, testValues: true } } } }, user: { include: { healthProfile: true } } },
  });
  if (!job) return;

  await prisma.exportJob.update({ where: { id: exportJobId }, data: { status: "PROCESSING" } });

  try {
    // Ownership is guaranteed here because items were only ever attached
    // to this job for reports the requesting user owns (see exports.service).
    const reports = job.items.map((item: ExportReportItem) => ({
      name: item.report.name,
      category: item.report.category,
      status: item.report.status,
      reportDate: item.report.reportDate,
      uploadTime: item.report.uploadTime,
      fields: item.report.extractedFields.map((f: ExportedField) => ({ fieldName: f.fieldName, value: f.value, source: f.source, confidence: f.confidence })),
      testValues: item.report.testValues.map((t: ExportedTestValue) => ({
        testName: t.testName,
        numericValue: t.numericValue,
        unit: t.unit,
        recordedDate: t.recordedDate,
        referenceRangeText: t.referenceRangeText,
        confidence: t.confidence,
      })),
    }));

    const pdfBuffer = await generateExportPdf(
      {
        email: job.user.email,
        age: job.user.healthProfile?.age,
        bloodGroup: job.user.healthProfile?.bloodGroup,
        allergies: job.user.healthProfile?.allergies,
        knownConditions: job.user.healthProfile?.knownConditions,
      },
      reports
    );

    const fileName = `${uuid()}.pdf`;
    fs.writeFileSync(path.join(exportDir, fileName), pdfBuffer);

    const expirationDate = new Date(Date.now() + env.export.urlTtlMinutes * 60_000 * 4); // exports live a bit longer than a single file link
    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: "READY", generatedFileKey: fileName, expirationDate },
    });
  } catch (err) {
    logger.error("Export job failed", { exportJobId, error: err instanceof Error ? err.message : String(err) });
    await prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: "FAILED", failureReason: "We couldn't generate your PDF. Please try again." },
    });
  }
}

export function readExportFile(fileName: string): Buffer {
  const resolved = path.resolve(exportDir, fileName);
  if (!resolved.startsWith(exportDir)) throw new Error("Invalid export file");
  return fs.readFileSync(resolved);
}

// Best-effort cleanup used by account deletion (profile.service.ts). Unlike
// readExportFile, a missing file here is not exceptional — an EXPIRED job's
// PDF may already be gone — so this quietly no-ops instead of throwing.
export function deleteExportFile(fileName: string): void {
  const resolved = path.resolve(exportDir, fileName);
  if (!resolved.startsWith(exportDir)) return;
  if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
}
