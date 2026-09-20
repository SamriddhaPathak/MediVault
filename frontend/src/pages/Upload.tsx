import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { Report } from "../types";
import { useToast } from "../components/ToastProvider";
import ConfidenceBadge from "../components/ConfidenceBadge";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/tiff", "image/bmp", "image/avif", "application/pdf"];
const MAX_SIZE = 15 * 1024 * 1024;

type Stage = "select" | "uploading" | "processing" | "error";

export default function Upload() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Tracks the active polling interval so it can be torn down on unmount —
  // without this, navigating away mid-upload left a setInterval running
  // forever in the background, hitting the API every 1.5s and leaking.
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  function validate(f: File): string | null {
    if (!ACCEPTED.includes(f.type)) return "We couldn't upload this file. Please check the file type and size and try again.";
    if (f.size > MAX_SIZE) return "This file is too large. Please choose a file under 15MB.";
    return null;
  }

  function handleFile(f: File) {
    const err = validate(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
    if (f.type.startsWith("image/")) setPreview(URL.createObjectURL(f));
    else setPreview(null);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, []);

  async function doUpload() {
    if (!file) return;
    setStage("uploading");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post("/reports/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setReport(res.data.report);
      setStage("processing");
      if (res.data.duplicateOf) {
        showToast(
          `This looks like the same file as "${res.data.duplicateOf.name}", uploaded ${new Date(
            res.data.duplicateOf.uploadTime
          ).toLocaleDateString()}. Both are kept — you can delete either from Records.`,
          "info"
        );
      }
      pollStatus(res.data.report.id);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "We couldn't upload this file. Please check the file type and size and try again.");
      setStage("error");
    }
  }

  function pollStatus(reportId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/reports/${reportId}`);
        const r: Report = res.data.report;
        setReport(r);
        if (r.status === "PENDING_REVIEW" || r.status === "OCR_FAILED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      } catch {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      }
    }, 1500);
  }

  if (stage === "processing" && report) {
    return <ProcessingView report={report} onReview={() => navigate(`/records/${report.id}/review`)} />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="eyebrow mb-1">Add to your vault</p>
        <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">Upload a report</h1>
        <p className="mt-1 text-sm text-gray-500">Add a clear scan or photo and we’ll prepare it for your review.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!file ? (
        <>
          {/* Mobile: camera + file picker buttons */}
          <div className="space-y-3 md:hidden">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-4 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700"
            >
              <span aria-hidden="true">📷</span> Take Photo
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#cbdedb] bg-white py-4 text-sm font-bold text-[#365861] shadow-sm hover:bg-[#f3f9f7]"
            >
              <span aria-hidden="true">📁</span> Choose From Device
            </button>
          </div>

          {/* Desktop: drag and drop */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`hidden flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-20 text-center shadow-sm md:flex ${
              dragOver ? "border-brand-500 bg-brand-50" : "border-[#bdd8d2] bg-white"
            }`}
          >
            <p className="text-2xl" aria-hidden="true">📄</p>
            <p className="mt-3 text-sm font-medium text-gray-700">Drag & drop your report</p>
            <p className="my-2 text-xs text-gray-400">or</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Choose File
            </button>
              <p className="mt-3 text-xs text-gray-400">JPG • PNG • WebP • TIFF • PDF</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            aria-label="Choose a file to upload"
            accept="image/jpeg,image/png,image/webp,image/tiff,image/bmp,image/avif,application/pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <input
            ref={cameraInputRef}
            type="file"
            aria-label="Take a photo to upload"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </>
      ) : (
        <div className="surface p-5">
          {preview && <img src={preview} alt="Selected file preview" className="mb-4 max-h-64 w-full rounded-lg object-contain" />}
          <div className="flex items-center justify-between text-sm">
            <div>
              <p className="font-medium text-gray-900">{file.name}</p>
              <p className="text-gray-500">
                {file.type.split("/")[1]?.toUpperCase()} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <button
              onClick={() => {
                setFile(null);
                setPreview(null);
              }}
              className="text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
          <button
            onClick={doUpload}
            disabled={stage === "uploading"}
            className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {stage === "uploading" ? "Uploading..." : "Upload"}
          </button>
        </div>
      )}
    </div>
  );
}

function ProcessingView({ report, onReview }: { report: Report; onReview: () => void }) {
  const steps = [
    { key: "uploaded", label: "File uploaded", done: true },
    { key: "processing", label: "OCR processing", done: report.status !== "UPLOADED" },
    {
      key: "extracting",
      label: "Extracting information",
      done: report.status === "PENDING_REVIEW" || report.status === "OCR_FAILED",
    },
    { key: "ready", label: "Preparing review", done: report.status === "PENDING_REVIEW" },
  ];

  if (report.status === "OCR_FAILED") {
    return (
      <div className="surface mx-auto max-w-lg space-y-4 p-7 text-center" role="status">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-2xl text-amber-700">!</div>
        <p className="text-lg font-bold text-[#173b45]">We couldn't extract information from this document.</p>
        <p className="text-sm text-gray-500">
          {report.failureReason ?? "You can review the original document and enter the information manually."}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={onReview}
            className="rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Enter Information Manually
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface mx-auto max-w-lg space-y-6 p-7">
      <div className="text-center">
        <p className="text-lg font-semibold text-gray-900">Upload successful</p>
        <p className="text-sm text-gray-500">Processing your report...</p>
      </div>
      {/* aria-live: screen-reader users hear each step complete instead of
          only seeing the final state once processing finishes. */}
      <ul className="space-y-3" aria-live="polite" aria-atomic="false">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                s.done ? "bg-brand-600 text-white" : "border border-gray-300 text-transparent"
              }`}
            >
              {s.done ? "✓" : "○"}
            </span>
            <span className={s.done ? "text-gray-900" : "text-gray-400"}>
              {s.label}
              {s.done && <span className="sr-only"> — complete</span>}
            </span>
          </li>
        ))}
      </ul>
      {report.status === "PENDING_REVIEW" && (
        <div className="text-center">
          <p className="mb-3 text-sm font-medium text-gray-900">Your report is ready to review.</p>
          {report.ocrConfidence != null && report.ocrConfidence < 0.8 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900">
              <div className="flex items-center gap-2"><ConfidenceBadge confidence={report.ocrConfidence} /><span className="font-semibold">Some extracted information may be inaccurate.</span></div>
              <p className="mt-1 text-xs leading-5">Please compare every extracted value with the original document before verifying.</p>
            </div>
          )}
          <button onClick={onReview} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
            Review Report
          </button>
        </div>
      )}
    </div>
  );
}
