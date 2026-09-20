-- AlterTable
ALTER TABLE "HealthProfile" ADD COLUMN "displayName" TEXT;
ALTER TABLE "HealthProfile" ADD COLUMN "phone" TEXT;
ALTER TABLE "HealthProfile" ADD COLUMN "emergencyContact" TEXT;
ALTER TABLE "HealthProfile" ADD COLUMN "preferredUnits" TEXT NOT NULL DEFAULT 'metric';
ALTER TABLE "HealthProfile" ADD COLUMN "profilePhotoKey" TEXT;
