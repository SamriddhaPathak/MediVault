import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { Report } from "../types";
import StatusBadge from "../components/StatusBadge";
import ErrorState from "../components/ErrorState";
import { SkeletonList } from "../components/Skeleton";

const CATEGORIES = ["", "LABORATORY", "PRESCRIPTION", "RADIOLOGY", "IMAGING", "VACCINATION", "OTHER"];

export default function Records() {
  const [items, setItems] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order responses: if the user types quickly, an
  // earlier (slower) request can resolve after a later (faster) one and
  // silently overwrite it with stale results. Only the most recent
  // request's response is ever applied.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, dateFrom, dateTo, sort, page]);

  async function load() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/reports", {
        params: {
          search: search || undefined,
          category: category || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          sort,
          page,
          pageSize,
        },
      });
      if (requestId !== requestIdRef.current) return; // a newer request superseded this one
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return;
      setError(err?.response?.data?.error ?? "We couldn't load your records. Please try again.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Your library</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">Medical records</h1>
          <p className="mt-1 text-sm text-gray-500">Find reports quickly by name, category, or date.</p>
        </div>
        <Link to="/upload" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700">+ Upload report</Link>
      </div>

      <div className="surface grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:grid-cols-5">
        <input
          aria-label="Search reports"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search reports..."
          className="field-control md:col-span-2"
        />
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
          className="field-control"
        >
          <option value="">All categories</option>
          {CATEGORIES.filter(Boolean).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="From date"
          value={dateFrom}
          onChange={(e) => {
            setPage(1);
            setDateFrom(e.target.value);
          }}
          className="field-control"
        />
        <input
          type="date"
          aria-label="To date"
          value={dateTo}
          onChange={(e) => {
            setPage(1);
            setDateTo(e.target.value);
          }}
          className="field-control"
        />
        <select
          aria-label="Sort order"
          value={sort}
          onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
          className="field-control md:col-span-1"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && loading && <SkeletonList rows={5} />}

      {!error && !loading && items.length === 0 && (
            <div className="surface p-10 text-center"><p className="text-base font-bold text-[#365861]">No reports match your search</p><p className="mt-1 text-sm text-gray-500">Try a different keyword or clear one of the filters.</p></div>
      )}

      {!error && !loading && (
        <div className="space-y-2">
          {items.map((r) => (
            <Link
              key={r.id}
              to={`/records/${r.id}`}
              className="surface flex items-center justify-between p-4 hover:-translate-y-0.5 hover:border-brand-300"
            >
              <div>
                <p className="font-medium text-gray-900">{r.name}</p>
                <p className="text-xs text-gray-500">
                  {r.category} · {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "No date"}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
