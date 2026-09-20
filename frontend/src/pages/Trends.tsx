import React, { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import TrendChart, { TrendPoint } from "../charts/TrendChart";
import ErrorState from "../components/ErrorState";
import { SkeletonBlock } from "../components/Skeleton";

export default function Trends() {
  const [tests, setTests] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [range, setRange] = useState<"3m" | "12m" | "all">("12m");
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [unit, setUnit] = useState<string | undefined>();
  const [loadingTests, setLoadingTests] = useState(true);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTests = useCallback(async () => {
    setLoadingTests(true);
    setError(null);
    try {
      const res = await api.get("/analytics/tests");
      setTests(res.data.tests);
      if (res.data.tests.length > 0) setSelected((prev) => prev || res.data.tests[0]);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "We couldn't load your test history. Please try again.");
    } finally {
      setLoadingTests(false);
    }
  }, []);

  useEffect(() => {
    loadTests();
  }, [loadTests]);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setLoadingPoints(true);
      setError(null);
      try {
        const params: Record<string, string> = {};
        if (range !== "all") {
          const months = range === "3m" ? 3 : 12;
          const from = new Date();
          from.setMonth(from.getMonth() - months);
          params.dateFrom = from.toISOString().slice(0, 10);
        }
        const res = await api.get(`/analytics/tests/${encodeURIComponent(selected)}`, { params });
        const values = res.data.values;
        setPoints(values.map((v: any) => ({
          date: v.recordedDate,
          value: v.numericValue,
          unit: v.unit,
          confidence: v.confidence,
          referenceRangeText: v.referenceRangeText,
        })));
        const units = [...new Set(values.map((value: any) => value.unit).filter(Boolean))] as string[];
        setUnit(units.length === 1 ? units[0] : units.length > 1 ? "mixed units" : undefined);
      } catch (err: any) {
        setError(err?.response?.data?.error ?? "We couldn't load this test's history. Please try again.");
      } finally {
        setLoadingPoints(false);
      }
    })();
  }, [selected, range]);

  if (loadingTests) {
    return (
      <div className="space-y-4">
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-64 w-full" />
      </div>
    );
  }

  if (error && tests.length === 0) return <ErrorState message={error} onRetry={loadTests} />;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">Patterns over time</p>
        <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">Health trends</h1>
        <p className="mt-1 text-sm text-gray-500">See how your recorded test values change over time.</p>
      </div>

      {tests.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Verified numerical test results will appear here once you have records containing test values.
        </p>
      ) : (
        <>
          <div className="surface flex flex-wrap items-center gap-4 p-4">
            <label className="flex min-w-[13rem] flex-1 flex-col gap-1 text-xs font-bold uppercase tracking-wider text-gray-400">
              Test to view
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="field-control mt-1 normal-case tracking-normal"
              >
                {tests.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[13rem] flex-1 flex-col gap-1 text-xs font-bold uppercase tracking-wider text-gray-400">
              Date range
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as any)}
                className="field-control mt-1 normal-case tracking-normal"
              >
                <option value="3m">Last 3 months</option>
                <option value="12m">Last 12 months</option>
                <option value="all">All time</option>
              </select>
            </label>
          </div>

          <div className="surface p-5" aria-busy={loadingPoints}>
            {error ? (
              <ErrorState message={error} />
            ) : loadingPoints ? (
              <SkeletonBlock className="h-64 w-full" />
            ) : points.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">No recorded values in this date range.</p>
            ) : (
              <TrendChart testName={selected} unit={unit} points={points} />
            )}
          </div>
          <p className="text-xs text-gray-400">
            MediVault charts only your recorded results. It does not interpret trends or abnormal values.
          </p>
        </>
      )}
    </div>
  );
}
