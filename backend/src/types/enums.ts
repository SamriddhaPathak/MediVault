/**
 * Shared status/category/source value sets.
 *
 * SQLite (used in local dev) has no native Prisma enum support, so the
 * corresponding database columns are plain String — these TS union types
 * are what give us type safety in application code, and the Zod schemas
 * in each module (see modules/<module>/schemas.ts, reports.controller.ts) are
 * what enforce the same value set at the API boundary.
 *
 * If you migrate to Postgres, these can become real `enum` blocks in
 * schema.prisma and these types can be imported from "@prisma/client"
 * instead — nothing else needs to change since the value sets match.
 */

export type ReportStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "OCR_FAILED"
  | "ARCHIVED";

export type ReportCategory =
  | "LABORATORY"
  | "PRESCRIPTION"
  | "RADIOLOGY"
  | "IMAGING"
  | "VACCINATION"
  | "OTHER";

export type FieldSource = "ocr" | "user";

export type ExportStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";
