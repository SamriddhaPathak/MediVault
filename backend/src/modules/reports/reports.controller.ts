import { Request, Response } from "express";
import { z } from "zod";
import { reportsService } from "./reports.service";
import { fieldsService } from "./fields.service";
import { ValidationError } from "../../utils/errors";
import { prisma } from "../../config/prisma";

const listQuerySchema = z.object({
  search: z.string().optional(),
  category: z.enum(["LABORATORY", "PRESCRIPTION", "RADIOLOGY", "IMAGING", "VACCINATION", "OTHER"]).optional(),
  status: z
    .enum(["UPLOADED", "PROCESSING", "PENDING_REVIEW", "VERIFIED", "OCR_FAILED", "ARCHIVED"])
    .optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Exports and the Image Vault are deliberately non-paginated browsable
  // views: they fetch one large page (frontend FETCH_PAGE_SIZE = 500) rather
  // than paging through the picker/grid. The cap here must be at least that
  // large, or every request from those two pages fails validation outright
  // — which is exactly what was happening at 100.
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(["LABORATORY", "PRESCRIPTION", "RADIOLOGY", "IMAGING", "VACCINATION", "OTHER"]).optional(),
  // Nullable so a wrongly-extracted report date can be cleared, not just
  // overwritten.
  reportDate: z.string().nullable().optional(),
  status: z.enum(["UPLOADED", "PROCESSING", "PENDING_REVIEW", "VERIFIED", "OCR_FAILED", "ARCHIVED"]).optional(),
});

const fieldEditsSchema = z.object({
  fields: z
    .array(
      z.object({
        id: z.string().optional(),
        fieldName: z.string().min(1).max(120),
        value: z.string().max(2000),
        // Nullable, not just optional: `null` is how the review screen says
        // "clear this", which Prisma cannot express with `undefined`.
        normalizedValue: z.string().max(2000).nullable().optional(),
      })
    )
    .optional(),
  testValues: z
    .array(
      z.object({
        id: z.string().optional(),
        testName: z.string().min(1).max(120),
        numericValue: z.number().finite(),
        unit: z.string().max(30).nullable().optional(),
        recordedDate: z.string(),
        referenceRangeText: z.string().max(120).nullable().optional(),
      })
    )
    .optional(),
});

export const reportsController = {
  async upload(req: Request, res: Response) {
    if (!req.file) throw new ValidationError("We couldn't upload this file. Please check the file type and size and try again.");
    const { report, duplicateOf } = await reportsService.upload(req.user!.sub, req.file);
    res.status(201).json({ report, duplicateOf });
  },

  async list(req: Request, res: Response) {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError("Invalid query parameters.");
    const result = await reportsService.list(req.user!.sub, parsed.data);
    res.json(result);
  },

  async dashboardSummary(req: Request, res: Response) {
    const ownerId = req.user!.sub;
    const attentionStatuses: Array<"PENDING_REVIEW" | "OCR_FAILED"> = ["PENDING_REVIEW", "OCR_FAILED"];

    const [total, pending, verified, latest, needsAttentionCount, attention, categoryGroups] = await Promise.all([
      prisma.report.count({ where: { ownerId } }),
      prisma.report.count({ where: { ownerId, status: "PENDING_REVIEW" } }),
      prisma.report.count({ where: { ownerId, status: "VERIFIED" } }),
      prisma.report.findFirst({ where: { ownerId }, orderBy: { uploadTime: "desc" } }),
      // Reports that need the user to act: awaiting review or failed OCR
      // outright. Surfaced as its own count and list, rather than left for
      // the user to notice buried in Records, is what turns "you have 3
      // pending reports" from a static stat into something actionable.
      prisma.report.count({ where: { ownerId, status: { in: attentionStatuses } } }),
      prisma.report.findMany({
        where: { ownerId, status: { in: attentionStatuses } },
        orderBy: { uploadTime: "desc" },
        take: 5,
      }),
      // Only categories the user actually has reports in are returned —
      // an always-six-bar chart with mostly-empty rows reads as a template
      // default, not as this account's real vault.
      prisma.report.groupBy({ by: ["category"], where: { ownerId }, _count: { category: true } }),
    ]);

    const categoryCounts = categoryGroups
      .map((group) => ({ category: group.category, count: group._count.category }))
      .sort((a, b) => b.count - a.count);

    res.json({ total, pending, verified, latest, needsAttentionCount, attention, categoryCounts });
  },

  async getOne(req: Request, res: Response) {
    const detail = await reportsService.getDetail(req.params.id, req.user!.sub);
    res.json(detail);
  },

  async update(req: Request, res: Response) {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid report update.");
    const report = await reportsService.update(req.params.id, req.user!.sub, parsed.data);
    res.json({ report });
  },

  async remove(req: Request, res: Response) {
    await reportsService.delete(req.params.id, req.user!.sub);
    res.status(204).send();
  },

  async verify(req: Request, res: Response) {
    const report = await reportsService.verify(req.params.id, req.user!.sub);
    res.json({ report });
  },

  async reprocess(req: Request, res: Response) {
    const report = await reportsService.reprocess(req.params.id, req.user!.sub);
    res.json({ report });
  },

  async archive(req: Request, res: Response) {
    const report = await reportsService.archive(req.params.id, req.user!.sub);
    res.json({ report });
  },

  async getFile(req: Request, res: Response) {
    const { buffer, mimeType, name } = await reportsService.getFileForOwner(req.params.id, req.user!.sub);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(name)}"`);
    res.send(buffer);
  },

  async getFileUrl(req: Request, res: Response) {
    const url = await reportsService.getSignedFileUrl(req.params.id, req.user!.sub);
    res.json({ url });
  },

  async listFields(req: Request, res: Response) {
    const fields = await fieldsService.list(req.params.id, req.user!.sub);
    res.json({ fields });
  },

  async updateFields(req: Request, res: Response) {
    const parsed = fieldEditsSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid field edits.");
    const fields = parsed.data.fields ? await fieldsService.applyFieldEdits(req.params.id, req.user!.sub, parsed.data.fields) : [];
    const testValues = parsed.data.testValues
      ? await fieldsService.applyTestValueEdits(req.params.id, req.user!.sub, parsed.data.testValues)
      : [];
    res.json({ fields, testValues });
  },

  async deleteField(req: Request, res: Response) {
    await fieldsService.deleteField(req.params.id, req.user!.sub, req.params.fieldId);
    res.status(204).send();
  },

  async deleteTestValue(req: Request, res: Response) {
    await fieldsService.deleteTestValue(req.params.id, req.user!.sub, req.params.testValueId);
    res.status(204).send();
  },
};
