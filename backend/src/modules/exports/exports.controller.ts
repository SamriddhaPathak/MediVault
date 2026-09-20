import { Request, Response } from "express";
import { z } from "zod";
import { exportsService } from "./exports.service";
import { ValidationError } from "../../utils/errors";

const createSchema = z.object({
  reportIds: z.array(z.string()).min(1).max(50),
});

export const exportsController = {
  async create(req: Request, res: Response) {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Select at least one report to export.");
    const job = await exportsService.create(req.user!.sub, parsed.data.reportIds);
    res.status(201).json({ exportJob: job });
  },

  async getStatus(req: Request, res: Response) {
    const job = await exportsService.getStatus(req.params.id, req.user!.sub);
    res.json({ exportJob: job });
  },

  async download(req: Request, res: Response) {
    const buffer = await exportsService.download(req.params.id, req.user!.sub);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="medivault-export-${req.params.id}.pdf"`);
    res.send(buffer);
  },
};
