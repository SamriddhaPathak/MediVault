import React from "react";

export default function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null;
  if (confidence >= 0.8) return null;
  const low = confidence < 0.6;
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
        low ? "bg-red-50 text-red-700 ring-red-200" : "bg-amber-50 text-amber-700 ring-amber-200"
      }`}
    >
      <span aria-hidden="true">{"\u26A0"}</span> {low ? "Low confidence" : "Review suggested"}
    </span>
  );
}
