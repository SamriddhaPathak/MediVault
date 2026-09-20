import { ReportCategory, ReportStatus } from "../../types/enums";
import { prisma } from "../../config/prisma";
import { storageService } from "../../services/storage.service";
import { queue } from "../../jobs/queue";
import { NotFoundError, ValidationError } from "../../utils/errors";
import crypto from "crypto";
import { detectFileType, isProcessableType } from "../../services/file-type.service";
import { logger } from "../../utils/logger";

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
    if (!file.buffer || file.buffer.length === 0) {
      throw new ValidationError("This file appears to be empty. Please choose another file.");
    }

    // Validate the actual bytes, not the Content-Type the browser attached
    // to the multipart part — that is derived from the filename and is
    // entirely client-controlled. Accepting it at face value meant a
    // mislabelled file sailed through and failed deep inside the OCR job
    // with a message that told the user nothing useful.
    const detectedType = detectFileType(file.buffer);
    if (!isProcessableType(detectedType)) {
      throw new ValidationError(
        "We couldn't read this file. Please upload a JPG, PNG, WebP, TIFF, BMP, AVIF or PDF."
      );
    }
    if (detectedType !== file.mimetype) {
      logger.warn("Upload type mismatch; trusting the file contents", {
        declared: file.mimetype,
        detected: detectedType,
      });
    }

    if (detectedType === "application/pdf") {
      // Cheap page-count guard: PDF page objects are typically referenced
      // via "/Type /Page". This only sees uncompressed object definitions —
      // a PDF using compressed object streams hides them — so it is a fast
      // reject for the obvious cases, not a guarantee. The OCR job caps
      // pages again at rasterization time and records a notice when it
      // does, so an undercount here degrades to "first N pages processed",
      // never to an unbounded job.
      const occurrences = (file.buffer.subarray(0, 4 * 1024 * 1024).toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
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
        // Store what the file actually is, so every later decision (which
        // OCR branch to take, which viewer the UI renders) is made on
        // verified information.
        mimeType: detectedType,
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
    data: { name?: string; category?: ReportCategory; reportDate?: string | null; status?: ReportStatus }
  ) {
    const existing = await this.getOwned(reportId, ownerId); // throws if not found/owned

    let nextReportDate: Date | null | undefined;
    if (data.reportDate !== undefined) {
      if (data.reportDate === null || data.reportDate === "") {
        nextReportDate = null;
      } else {
        const parsed = new Date(data.reportDate);
        if (Number.isNaN(parsed.getTime())) throw new ValidationError("Enter a valid report date.");
        nextReportDate = parsed;
      }
    }

    // `editedByUser` must only be set when something genuinely changed. The
    // Review screen re-submits category and date on every save (and on every
    // verify), so stamping it unconditionally meant opening a report and
    // saving with zero edits marked it user-edited — the same provenance
    // erosion that fields.service.ts guards against at the field level.
    const changed =
      (data.name !== undefined && data.name !== existing.name) ||
      (data.category !== undefined && data.category !== existing.category) ||
      (nextReportDate !== undefined &&
        (existing.reportDate?.getTime() ?? null) !== (nextReportDate?.getTime() ?? null)) ||
      (data.status !== undefined && data.status !== existing.status);

    if (!changed) return existing;

    // Correcting the category or date by hand is manual entry too, so it
    // should lift a failed report out of OCR_FAILED the same way a field
    // edit does (fields.service.ts) — unless the caller set a status itself.
    const promoteFromOcrFailed =
      data.status === undefined && existing.status === "OCR_FAILED"
        ? { status: "PENDING_REVIEW" as ReportStatus, failureReason: null }
        : {};

    return prisma.report.update({
      where: { id: reportId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(nextReportDate !== undefined ? { reportDate: nextReportDate } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...promoteFromOcrFailed,
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
    if (report.status === "PROCESSING") {
      throw new ValidationError("This report is still processing. Please wait for it to finish, then verify.");
    }

    // A report whose OCR failed is still verifiable once the user has filled
    // in details by hand — that manual path is exactly what the failure
    // screen invites them to do. Previously this branch rejected OCR_FAILED
    // outright, so following that invitation dead-ended at an error with no
    // way forward. Applying any field/test-value edit promotes the report to
    // PENDING_REVIEW (see fields.service.ts); reaching here still in
    // OCR_FAILED means nothing was entered, so say that plainly.
    if (report.status === "OCR_FAILED") {
      throw new ValidationError(
        "Add at least one detail for this report before verifying it."
      );
    }
    return prisma.report.update({
      where: { id: reportId },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });
  },

  /**
   * Re-runs OCR for a report the user owns. This is the missing escape
   * hatch: before it existed, a report that failed OCR for a transient
   * reason — the language model still downloading, a timeout under load, a
   * restart mid-job — was stuck in OCR_FAILED permanently, and the only
   * remedy was deleting it and uploading the same file again.
   */
  async reprocess(reportId: string, ownerId: string) {
    const report = await this.getOwned(reportId, ownerId);

    if (report.status === "PROCESSING") {
      throw new ValidationError("This report is already being processed. Please wait for it to finish.");
    }
    if (report.status === "ARCHIVED") {
      throw new ValidationError("Restore this report from the archive before reprocessing it.");
    }

    const updated = await prisma.report.update({
      where: { id: reportId },
      data: {
        status: "UPLOADED",
        failureReason: null,
        processingNotice: null,
        // Reprocessing is a deliberate user action, so it resets the
        // automatic-attempt budget that startup recovery uses.
        ocrAttempts: 0,
      },
    });

    queue.enqueue("ocr", { reportId });
    return updated;
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
