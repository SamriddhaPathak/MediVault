import React from "react";
import { Report } from "../types";

/**
 * Renders the original uploaded document.
 *
 * The viewer is chosen from the report's MIME type, which is what the
 * server actually validated on upload — not from the filename, which a
 * user can set to anything. A PDF saved as "results" (no extension) used
 * to be handed to an <img> tag and silently render as a broken image.
 */
export default function DocumentPreview({ report, fileUrl }: { report: Report; fileUrl: string }) {
  const isPdf =
    report.mimeType === "application/pdf" || (!report.mimeType && report.name.toLowerCase().endsWith(".pdf"));

  return (
    <div className="surface overflow-hidden">
      {isPdf ? (
        <iframe src={fileUrl} title={`Original document: ${report.name}`} className="h-96 w-full" />
      ) : (
        <img src={fileUrl} alt={`Original report: ${report.name}`} className="max-h-96 w-full object-contain" />
      )}
    </div>
  );
}
