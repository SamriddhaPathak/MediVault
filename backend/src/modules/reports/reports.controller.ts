import { Request, Response } from "express";
import { z } from "zod";
import { reportsService } from "./reports.service";
import { fieldsService } from "./fields.service";
import { ValidationError } from "../../utils/errors";
import { prisma } from "../../config/prisma";
import { storageService, verifySignedFileToken } from "../../services/storage.service";
import { NotFoundError } from "../../utils/errors";

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
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(["LABORATORY", "PRESCRIPTION", "RADIOLOGY", "IMAGING", "VACCINATION", "OTHER"]).optional(),
  reportDate: z.string().optional(),
  status: z.enum(["UPLOADED", "PROCESSING", "PENDING_REVIEW", "VERIFIED", "OCR_FAILED", "ARCHIVED"]).optional(),
});

const fieldEditsSchema = z.object({
  fields: z
    .array(
      z.object({
        id: z.string().optional(),
        fieldName: z.string(),
        value: z.string(),
        normalizedValue: z.string().optional(),
      })
    )
    .optional(),
  testValues: z
    .array(
      z.object({
        id: z.string().optional(),
        testName: z.string(),
        numericValue: z.number(),
        unit: z.string().optional(),
        recordedDate: z.string(),
        referenceRangeText: z.string().optional(),
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
    const [total, pending, verified, latest] = await Promise.all([
      prisma.report.count({ where: { ownerId } }),
      prisma.report.count({ where: { ownerId, status: "PENDING_REVIEW" } }),
      prisma.report.count({ where: { ownerId, status: "VERIFIED" } }),
      prisma.report.findFirst({ where: { ownerId }, orderBy: { uploadTime: "desc" } }),
    ]);
    res.json({ total, pending, verified, latest });
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

  // Public path (no auth header) but the token itself is HMAC-signed and
  // time-limited, and encodes the exact fileKey it grants access to — so
  // it can never be used to browse or guess another patient's files.
  async getFileByToken(req: Request, res: Response) {
    const verified = verifySignedFileToken(req.params.token);
    if (!verified) throw new NotFoundError("This link has expired or is invalid.");
    const buffer = await storageService.read(verified.fileKey);
    res.send(buffer);
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
