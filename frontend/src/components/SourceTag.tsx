import React from "react";

export default function SourceTag({ source }: { source: "ocr" | "user" }) {
  return source === "ocr" ? (
    <span className="text-xs font-medium text-gray-400">OCR extracted</span>
  ) : (
    <span className="text-xs font-medium text-brand-600">Edited by you</span>
  );
}
