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

export async function processExportJob({ exportJobId }: ExportJobPayload): Promise<void> {
  const job = await prisma.exportJob.findUnique({
    where: { id: exportJobId },
    include: { items: { include: { report: { include: { extractedFields: true, testValues: true } } } }, user: { include: { healthProfile: true } } },
  });
  if (!job) return;

  await prisma.exportJob.update({ where: { id: exportJobId }, data: { status: "PROCESSING" } });

  try {
    // Ownership is guaranteed here because items were only ever attached
    // to this job for reports the requesting user owns (see exports.service).
    const reports = job.items.map((item) => ({
      name: item.report.name,
      category: item.report.category,
      status: item.report.status,
      reportDate: item.report.reportDate,
      uploadTime: item.report.uploadTime,
      fields: item.report.extractedFields.map((f) => ({ fieldName: f.fieldName, value: f.value, source: f.source, confidence: f.confidence })),
      testValues: item.report.testValues.map((t) => ({
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
