import { ReportCategory, ReportStatus } from "../../types/enums";
import { prisma } from "../../config/prisma";
import { storageService } from "../../services/storage.service";
import { queue } from "../../jobs/queue";
import { ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import crypto from "crypto";

const MAX_PDF_PAGES = 30; // basic sanity bound; full page-count check happens where a PDF lib is available
const DUPLICATE_WINDOW_DAYS = 30;

export interface ListFilters {
  search?: string;
  category?: ReportCategory;
  status?: ReportStatus;
  dateFrom?: string;
  dateTo?: string;
  sort?: "newest" | "oldest";
  page: number;
  pageSize: number;
}

export const reportsService = {
  async upload(ownerId: string, file: Express.Multer.File) {
    if (file.mimetype === "application/pdf") {
      // Cheap page-count guard: PDF page objects are typically referenced via "/Type /Page".
      const occurrences = (file.buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
      if (occurrences > MAX_PDF_PAGES) {
        throw new ValidationError(`PDF exceeds the maximum of ${MAX_PDF_PAGES} pages.`);
      }
    }

    const fileHash = crypto.createHash("sha256").update(file.buffer).digest("hex");

    // Duplicate-upload detection: warn (never block) if this exact file was
    // already uploaded recently by this same user.
    const duplicateWindowStart = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const existingDuplicate = await prisma.report.findFirst({
      where: { ownerId, fileHash, uploadTime: { gte: duplicateWindowStart } },
      orderBy: { uploadTime: "desc" },
    });

    const fileKey = await storageService.save(file.buffer, file.originalname, ownerId);

    const report = await prisma.report.create({
      data: {
        ownerId,
        name: file.originalname,
        originalFileKey: fileKey,
        fileHash,
        mimeType: file.mimetype,
        fileSize: file.size,
        status: "UPLOADED",
      },
    });

    queue.enqueue("ocr", { reportId: report.id });

    return { report, duplicateOf: existingDuplicate ? { id: existingDuplicate.id, name: existingDuplicate.name, uploadTime: existingDuplicate.uploadTime } : null };
  },

  async list(ownerId: string, filters: ListFilters) {
    const where: any = { ownerId };

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search } },
        { extractedText: { contains: filters.search } },
      ];
    }
    if (filters.category) where.category = filters.category;
    if (filters.status) where.status = filters.status;
    if (filters.dateFrom || filters.dateTo) {
      where.reportDate = {};
      if (filters.dateFrom) where.reportDate.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.reportDate.lte = new Date(filters.dateTo);
    }

    const [items, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { uploadTime: filters.sort === "oldest" ? "asc" : "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.report.count({ where }),
    ]);

    return { items, total, page: filters.page, pageSize: filters.pageSize };
  },

  // Every lookup is scoped to (id AND ownerId) — never by id alone. This is
  // the single most important invariant in the app; see security tests.
  async getOwned(reportId: string, ownerId: string) {
    const report = await prisma.report.findFirst({ where: { id: reportId, ownerId } });
    if (!report) throw new NotFoundError("Report not found.");
    return report;
  },

  async getDetail(reportId: string, ownerId: string) {
    const report = await this.getOwned(reportId, ownerId);
    const [fields, testValues] = await Promise.all([
      prisma.extractedField.findMany({ where: { reportId }, orderBy: { createdAt: "asc" } }),
      prisma.testValue.findMany({ where: { reportId }, orderBy: { recordedDate: "asc" } }),
    ]);
    return { report, fields, testValues };
  },

  async update(
    reportId: string,
    ownerId: string,
    data: { name?: string; category?: ReportCategory; reportDate?: string; status?: ReportStatus }
  ) {
    await this.getOwned(reportId, ownerId); // ownership check, throws if not found/owned
    return prisma.report.update({
      where: { id: reportId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.reportDate !== undefined ? { reportDate: new Date(data.reportDate) } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        editedByUser: true,
      },
    });
  },

  async delete(reportId: string, ownerId: string) {
    const report = await this.getOwned(reportId, ownerId);
    await storageService.delete(report.originalFileKey);
    await prisma.report.delete({ where: { id: reportId } });
  },

  async verify(reportId: string, ownerId: string) {
    const report = await this.getOwned(reportId, ownerId);
    if (report.status === "OCR_FAILED" || report.status === "PROCESSING") {
      throw new ValidationError("This report cannot be verified until review information is complete.");
    }
    return prisma.report.update({
      where: { id: reportId },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });
  },

  async archive(reportId: string, ownerId: string) {
    await this.getOwned(reportId, ownerId);
    return prisma.report.update({ where: { id: reportId }, data: { status: "ARCHIVED" } });
  },

  async getFileForOwner(reportId: string, ownerId: string) {
    const report = await this.getOwned(reportId, ownerId);
    const buffer = await storageService.read(report.originalFileKey);
    return { buffer, mimeType: report.mimeType, name: report.name };
  },

  async getSignedFileUrl(reportId: string, ownerId: string, ttlMinutes = 15) {
    const report = await this.getOwned(reportId, ownerId);
    return storageService.getSignedUrl(report.originalFileKey, ttlMinutes);
  },
};
