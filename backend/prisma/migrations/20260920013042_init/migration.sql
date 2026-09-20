-- AlterTable
ALTER TABLE "Report" ADD COLUMN "fileHash" TEXT;

-- AlterTable
ALTER TABLE "TestValue" ADD COLUMN "confidence" REAL;

-- CreateIndex
CREATE INDEX "Report_ownerId_fileHash_idx" ON "Report"("ownerId", "fileHash");
