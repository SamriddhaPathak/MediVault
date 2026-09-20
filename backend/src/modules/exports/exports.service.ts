import { prisma } from "../../config/prisma";
import { queue } from "../../jobs/queue";
import { ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import { readExportFile } from "../../jobs/export.job";

export const exportsService = {
  async create(userId: string, reportIds: string[]) {
    if (reportIds.length === 0) throw new ValidationError("Select at least one report to export.");

    // Verify every requested report belongs to this user before attaching
    // it to the export job — this is what prevents exporting someone
    // else's records by guessing/passing another user's report id.
    const owned = await prisma.report.findMany({ where: { id: { in: reportIds }, ownerId: userId } });
    if (owned.length !== reportIds.length) {
      throw new ForbiddenError("One or more selected reports could not be found in your account.");
    }

    const job = await prisma.exportJob.create({
      data: {
        userId,
        status: "PENDING",
        items: { create: reportIds.map((reportId) => ({ reportId })) },
      },
    });

    queue.enqueue("export", { exportJobId: job.id });
    return job;
  },

  async getOwned(exportJobId: string, userId: string) {
    const job = await prisma.exportJob.findFirst({ where: { id: exportJobId, userId } });
    if (!job) throw new NotFoundError("Export not found.");
    return job;
  },

  async getStatus(exportJobId: string, userId: string) {
    return this.getOwned(exportJobId, userId);
  },

  async download(exportJobId: string, userId: string) {
    const job = await this.getOwned(exportJobId, userId);
    if (job.status !== "READY" || !job.generatedFileKey) {
      throw new ValidationError("This export is not ready yet.");
    }
    if (job.expirationDate && job.expirationDate < new Date()) {
      await prisma.exportJob.update({ where: { id: exportJobId }, data: { status: "EXPIRED" } });
      throw new ValidationError("This download link has expired. Please generate a new export.");
    }
    return readExportFile(job.generatedFileKey);
  },
};
