import argon2 from "argon2";
import { prisma } from "../../config/prisma";
import { storageService } from "../../services/storage.service";
import { deleteExportFile } from "../../jobs/export.job";
import { UnauthorizedError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export const profileService = {
  async get(userId: string) {
    const profile = await prisma.healthProfile.findUnique({ where: { userId } });
    return profile;
  },

  async upsert(
    userId: string,
    data: {
      displayName?: string;
      phone?: string;
      emergencyContact?: string;
      preferredUnits?: string;
      profilePhotoKey?: string | null;
      age?: number;
      bloodGroup?: string;
      allergies?: string;
      knownConditions?: string;
    }
  ) {
    return prisma.healthProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  },

  /**
   * Permanently deletes the user's account and everything that belongs to
   * it: health profile, uploaded report files, extracted fields/test
   * values, export jobs and their generated PDFs, and refresh tokens.
   * Requires the current password so a session left signed in on a shared
   * device — or a leaked access token with a few minutes left on it —
   * can't be used to wipe the account without the credential.
   *
   * File deletion happens first, while we still have the file keys, and
   * each one is best-effort: a file already missing from disk must never
   * block the account from being deleted. Deleting the User row is the
   * single source of truth for the database side — Prisma's
   * `onDelete: Cascade` (see schema.prisma) takes care of every dependent
   * row: HealthProfile, Report (and its ExtractedField/TestValue
   * children), ExportJob (and its ExportItems), and RefreshToken, so no
   * separately-issued refresh token can be used again after this returns.
   */
  async deleteAccount(userId: string, password: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError("Your session has expired. Please log in again.");

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedError("Incorrect password.");

    const [profile, reports, exportJobs] = await Promise.all([
      prisma.healthProfile.findUnique({ where: { userId } }),
      prisma.report.findMany({ where: { ownerId: userId }, select: { id: true, originalFileKey: true } }),
      prisma.exportJob.findMany({ where: { userId }, select: { id: true, generatedFileKey: true } }),
    ]);

    for (const report of reports) {
      try {
        await storageService.delete(report.originalFileKey);
      } catch (err) {
        logger.warn("Failed to delete report file during account deletion", {
          reportId: report.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (profile?.profilePhotoKey) {
      try {
        await storageService.delete(profile.profilePhotoKey);
      } catch (err) {
        logger.warn("Failed to delete profile photo during account deletion", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const job of exportJobs) {
      if (!job.generatedFileKey) continue;
      try {
        deleteExportFile(job.generatedFileKey);
      } catch (err) {
        logger.warn("Failed to delete export file during account deletion", {
          exportJobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await prisma.user.delete({ where: { id: userId } });
  },
};
