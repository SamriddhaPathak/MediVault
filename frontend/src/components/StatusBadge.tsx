import React from "react";
import { ReportStatus } from "../types";

const STYLES: Record<ReportStatus, { label: string; className: string; icon: string }> = {
  UPLOADED: { label: "Uploaded", className: "bg-gray-100 text-gray-700", icon: "\u2191" },
  PROCESSING: { label: "Processing", className: "bg-blue-100 text-blue-700", icon: "\u25CF" },
  PENDING_REVIEW: { label: "Pending Review", className: "bg-amber-100 text-amber-800", icon: "\u26A0" },
  VERIFIED: { label: "Verified", className: "bg-brand-100 text-brand-800", icon: "\u2713" },
  OCR_FAILED: { label: "OCR Failed", className: "bg-red-100 text-red-700", icon: "\u2715" },
  ARCHIVED: { label: "Archived", className: "bg-gray-100 text-gray-500", icon: "\u25A1" },
};

export default function StatusBadge({ status }: { status: ReportStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.className}`}>
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}
