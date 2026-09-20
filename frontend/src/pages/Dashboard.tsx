import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { Report } from "../types";
import StatusBadge from "../components/StatusBadge";
import ErrorState from "../components/ErrorState";

interface Summary {
  total: number;
  pending: number;
  verified: number;
  latest: Report | null;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, listRes] = await Promise.all([
        api.get("/reports/dashboard-summary"),
        api.get("/reports", { params: { page: 1, pageSize: 5, sort: "newest" } }),
      ]);
      setSummary(summaryRes.data);
      setRecent(listRes.data.items);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "We couldn't load your dashboard. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageSkeleton />;

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (summary && summary.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-20 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Your medical vault is empty</h2>
        <p className="mt-2 max-w-sm text-sm text-gray-500">
          Upload your first medical report to start organizing your health records.
        </p>
        <Link
          to="/upload"
          className="mt-6 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Upload First Report
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Overview</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">Your health record, at a glance</h1>
          <p className="mt-1 text-sm text-gray-500">A clear view of what is new, pending, and verified.</p>
        </div>
        <Link to="/upload" className="hidden rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700 sm:block">
          + Upload report
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Reports" value={summary?.total ?? 0} />
        <SummaryCard label="Pending Review" value={summary?.pending ?? 0} accent="amber" />
        <SummaryCard label="Verified" value={summary?.verified ?? 0} accent="brand" />
        <SummaryCard
          label="Latest Report"
          value={summary?.latest ? summary.latest.name : "—"}
          small
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Link
          to="/upload"
          className="col-span-2 rounded-xl bg-brand-600 px-4 py-4 text-center text-sm font-semibold text-white hover:bg-brand-700 md:col-span-1"
        >
          Upload Report
        </Link>
        <Link to="/records" className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center text-sm font-medium text-gray-700 hover:bg-gray-50">
          View Records
        </Link>
        <Link to="/images" className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center text-sm font-medium text-gray-700 hover:bg-gray-50">
          Image Vault
        </Link>
        <Link to="/exports" className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center text-sm font-medium text-gray-700 hover:bg-gray-50">
          Export Records
        </Link>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent Reports</h2>
          <Link to="/records" className="text-sm font-medium text-brand-700 hover:underline">
            View all
          </Link>
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Report</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Report Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 text-gray-500">{r.category}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/records/${r.id}`} className="text-brand-700 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 md:hidden">
          {recent.map((r) => (
            <Link
              key={r.id}
              to={`/records/${r.id}`}
              className="block rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{r.name}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {r.category} · {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "No date"}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string | number;
  accent?: "amber" | "brand";
  small?: boolean;
}) {
  return (
    <div className="surface p-4">
      <div className="mb-4 h-1.5 w-8 rounded-full bg-brand-200" />
      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p
        className={`mt-1 truncate font-semibold ${small ? "text-sm" : "text-2xl"} ${
          accent === "amber" ? "text-amber-600" : accent === "brand" ? "text-brand-700" : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-200" />
        ))}
      </div>
    </div>
  );
}
