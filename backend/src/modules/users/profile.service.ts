import { prisma } from "../../config/prisma";

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
};
