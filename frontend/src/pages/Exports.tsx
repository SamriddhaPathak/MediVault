import React, { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { Report } from "../types";
import StatusBadge from "../components/StatusBadge";
import ErrorState from "../components/ErrorState";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../components/ToastProvider";

type JobStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";

export default function Exports() {
  const { showToast } = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get("/reports", { params: { page: 1, pageSize: 100, sort: "newest" } });
      setReports(res.data.items);
    } catch (err: any) {
      setLoadError(err?.response?.data?.error ?? "We couldn't load your reports. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!jobId || jobStatus === "READY" || jobStatus === "FAILED") return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/exports/${jobId}`);
        setJobStatus(res.data.exportJob.status);
      } catch {
        clearInterval(interval);
        setJobStatus("FAILED");
        showToast("We lost track of your export's progress. Please try generating it again.", "error");
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [jobId, jobStatus, showToast]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    setError(null);
    if (selected.size === 0) {
      setError("Select at least one report to export.");
      return;
    }
    if (selected.size > 50) {
      setError("Select 50 reports or fewer for one PDF export.");
      return;
    }
    try {
      const res = await api.post("/exports", { reportIds: Array.from(selected) });
      setJobId(res.data.exportJob.id);
      setJobStatus(res.data.exportJob.status);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "We couldn't generate your PDF. Please try again.");
    }
  }

  async function download() {
    if (!jobId) return;
    try {
      const res = await api.get(`/exports/${jobId}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "medivault-export.pdf";
      a.click();
      URL.revokeObjectURL(url);
      showToast("Download started.");
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? "We couldn't download your export.", "error");
    }
  }

  function selectAll() {
    setSelected(new Set(reports.slice(0, 50).map((r) => r.id)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="eyebrow mb-1">Take your records with you</p>
        <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">Export records</h1>
        <p className="mt-1 text-sm text-gray-500">Create a clean PDF summary from the reports you choose.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <SkeletonList rows={4} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : (
        <>
          {reports.length > 0 && (
            <div className="surface flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <span className="font-semibold text-[#365861]">{selected.size} of {reports.length} selected</span>
              <div className="flex gap-3">
                <button onClick={selectAll} className="font-medium text-brand-700 hover:underline">
                  Select up to 50
                </button>
                <button onClick={clearSelection} className="font-medium text-gray-500 hover:underline">
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="surface space-y-2 p-4">
            {reports.length === 0 && <p className="text-sm text-gray-400">No reports yet.</p>}
            {reports.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border-b border-gray-50 px-2 py-3 last:border-0 hover:bg-[#f6faf9]">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="h-5 w-5"
                    aria-label={`Select ${r.name} for export`}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-500">
                      {r.category} · {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "No date"}
                    </p>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </label>
            ))}
          </div>
        </>
      )}

      {!loading && !loadError && !jobId && (
        <button
          onClick={generate}
          disabled={reports.length === 0}
          className="w-full rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Generate PDF
        </button>
      )}

      {jobId && jobStatus !== "READY" && jobStatus !== "FAILED" && (
        <div className="surface p-6 text-center">
          <p className="text-sm font-bold text-[#173b45]">Preparing your PDF...</p>
          <p className="text-sm text-gray-500">Processing...</p>
        </div>
      )}

      {jobStatus === "READY" && (
        <div className="surface p-6 text-center">
          <p className="mb-3 text-sm font-bold text-[#173b45]">Your PDF is ready.</p>
          <button onClick={download} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
            Download PDF
          </button>
        </div>
      )}

      {jobStatus === "FAILED" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          We couldn't generate your PDF. Please try again.
        </p>
      )}
    </div>
  );
}
