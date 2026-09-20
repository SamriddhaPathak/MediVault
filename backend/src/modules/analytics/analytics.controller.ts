import { Request, Response } from "express";
import { analyticsService } from "./analytics.service";
import { ValidationError } from "../../utils/errors";

export const analyticsController = {
  async listTests(req: Request, res: Response) {
    const tests = await analyticsService.listTestNames(req.user!.sub);
    res.json({ tests });
  },

  async getTestHistory(req: Request, res: Response) {
    const { testName } = req.params;
    if (!testName) throw new ValidationError("A test name is required.");
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
    const values = await analyticsService.getTestHistory(req.user!.sub, testName, dateFrom, dateTo);
    res.json({ testName, values });
  },
};
