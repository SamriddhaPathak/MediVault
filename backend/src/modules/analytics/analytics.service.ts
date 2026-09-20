import { prisma } from "../../config/prisma";

export const analyticsService = {
  // Distinct test names the user has recorded, for the trend-selector dropdown.
  async listTestNames(ownerId: string) {
    const rows = await prisma.testValue.findMany({
      where: { report: { ownerId } },
      select: { testName: true },
      distinct: ["testName"],
      orderBy: { testName: "asc" },
    });
    return rows.map((r) => r.testName);
  },

  async getTestHistory(ownerId: string, testName: string, dateFrom?: string, dateTo?: string) {
    const where: any = { testName, report: { ownerId } };
    if (dateFrom || dateTo) {
      where.recordedDate = {};
      if (dateFrom) where.recordedDate.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.recordedDate.lte = end;
      }
    }

    // Only ever chart data points that actually exist — never interpolated
    // or invented values for missing dates (per product rules).
    const values = await prisma.testValue.findMany({
      where,
      orderBy: { recordedDate: "asc" },
      select: {
        id: true,
        testName: true,
        numericValue: true,
        unit: true,
        recordedDate: true,
        referenceRangeText: true,
        confidence: true,
        source: true,
        reportId: true,
      },
    });

    return values;
  },
};
