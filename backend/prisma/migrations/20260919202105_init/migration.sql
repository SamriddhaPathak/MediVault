-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HealthProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "age" INTEGER,
    "bloodGroup" TEXT,
    "allergies" TEXT,
    "knownConditions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HealthProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "reportDate" DATETIME,
    "uploadTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalFileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "ocrConfidence" REAL,
    "extractedText" TEXT,
    "failureReason" TEXT,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "verifiedAt" DATETIME,
    CONSTRAINT "Report_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "confidence" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ocr',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExtractedField_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "numericValue" REAL NOT NULL,
    "unit" TEXT,
    "recordedDate" DATETIME NOT NULL,
    "referenceRangeText" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ocr',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestValue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "generatedFileKey" TEXT,
    "expirationDate" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exportJobId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    CONSTRAINT "ExportItem_exportJobId_fkey" FOREIGN KEY ("exportJobId") REFERENCES "ExportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthProfile_userId_key" ON "HealthProfile"("userId");

-- CreateIndex
CREATE INDEX "Report_ownerId_idx" ON "Report"("ownerId");

-- CreateIndex
CREATE INDEX "Report_ownerId_category_idx" ON "Report"("ownerId", "category");

-- CreateIndex
CREATE INDEX "Report_ownerId_reportDate_idx" ON "Report"("ownerId", "reportDate");

-- CreateIndex
CREATE INDEX "Report_ownerId_status_idx" ON "Report"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ExtractedField_reportId_idx" ON "ExtractedField"("reportId");

-- CreateIndex
CREATE INDEX "TestValue_reportId_idx" ON "TestValue"("reportId");

-- CreateIndex
CREATE INDEX "TestValue_testName_idx" ON "TestValue"("testName");

-- CreateIndex
CREATE INDEX "TestValue_recordedDate_idx" ON "TestValue"("recordedDate");

-- CreateIndex
CREATE INDEX "ExportJob_userId_idx" ON "ExportJob"("userId");

-- CreateIndex
CREATE INDEX "ExportItem_exportJobId_idx" ON "ExportItem"("exportJobId");

-- CreateIndex
CREATE INDEX "ExportItem_reportId_idx" ON "ExportItem"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportItem_exportJobId_reportId_key" ON "ExportItem"("exportJobId", "reportId");
