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

export interface Report {
  id: string;
  name: string;
  mimeType?: string;
  category: ReportCategory;
  status: ReportStatus;
  reportDate: string | null;
  uploadTime: string;
  ocrConfidence: number | null;
  failureReason: string | null;
  editedByUser: boolean;
  verifiedAt: string | null;
}

export interface ExtractedField {
  id: string;
  reportId: string;
  fieldName: string;
  value: string;
  normalizedValue: string | null;
  confidence: number;
  source: "ocr" | "user";
}

export interface TestValue {
  id: string;
  reportId: string;
  testName: string;
  numericValue: number;
  unit: string | null;
  recordedDate: string;
  referenceRangeText: string | null;
  source: "ocr" | "user";
  confidence: number | null;
}

export interface HealthProfile {
  displayName?: string | null;
  phone?: string | null;
  emergencyContact?: string | null;
  preferredUnits?: "metric" | "imperial" | null;
  profilePhotoUrl?: string | null;
  age?: number | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  knownConditions?: string | null;
}

export interface ExportJob {
  id: string;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";
  generatedFileKey: string | null;
}
