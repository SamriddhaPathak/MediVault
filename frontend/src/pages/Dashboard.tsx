import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../services/api";
import { HealthProfile, Report } from "../types";
import StatusBadge from "../components/StatusBadge";
import ErrorState from "../components/ErrorState";
import { formatCategory, categoryColor } from "../lib/categories";
import { AllCaughtUpIllustration, DocumentStackIllustration, EmptyVaultIllustration, VaultPulseIllustration } from "../components/illustrations";

interface CategoryCount {
  category: string;
  count: number;
}

interface Summary {
  total: number;
  pending: number;
  verified: number;
  latest: Report | null;
  needsAttentionCount: number;
  attention: Report[];
  categoryCounts: CategoryCount[];
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  // "Good night" as a *greeting* reads like a farewell rather than a
  // welcome; nobody wants to be told goodbye the moment they open the
  // app. Late-night/early-morning hours get a warmer, greeting-shaped
  // line instead of the literal time-of-day.
  if (hour < 5) return "Welcome back";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Welcome back";
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<Report[]>([]);
  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, listRes, profileRes] = await Promise.all([
        api.get("/reports/dashboard-summary"),
        api.get("/reports", { params: { page: 1, pageSize: 5, sort: "newest" } }),
        // Used only to personalize the greeting and gauge onboarding
        // progress below; a failure here shouldn't take down the whole
        // dashboard, so it's allowed to reject independently.
        api.get("/profile").catch(() => null),
      ]);
      setSummary(summaryRes.data);
      setRecent(listRes.data.items);
      if (profileRes?.data?.profile) setProfile(profileRes.data.profile);
    } catch (err: any) {
      setError(getErrorMessage(err, "We couldn't load your dashboard. Please try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PageSkeleton />;

  if (error) return <ErrorState message={error} onRetry={load} />;

  const name = profile?.displayName?.trim() || null;
  const greeting = `${timeGreeting()}${name ? `, ${name.split(" ")[0]}` : ""}`;

  if (summary && summary.total === 0) {
    return <EmptyDashboard greeting={greeting} />;
  }

  const profileComplete = Boolean(
    profile?.displayName &&
      (profile?.bloodGroup || profile?.emergencyContact || profile?.allergies || profile?.knownConditions)
  );
  const checklist = [
    { done: true, label: "Upload your first report", to: "/upload" },
    { done: (summary?.verified ?? 0) > 0, label: "Review and verify a report", to: "/records" },
    { done: profileComplete, label: "Complete your health profile", to: "/profile" },
  ];
  const showChecklist = checklist.some((step) => !step.done);

  const attentionCount = summary?.needsAttentionCount ?? 0;
  const recordWord = summary?.total === 1 ? "record" : "records";
  const statusLine =
    attentionCount > 0
      ? `${summary?.total} ${recordWord} safely stored – ${attentionCount} ${
          attentionCount === 1 ? "is" : "are"
        } waiting on a quick review.`
      : `${summary?.total} ${recordWord} safely stored, all reviewed and organized.`;

  return (
    <div className="space-y-6">
      <section className="surface relative overflow-hidden p-6 sm:p-8">
        <VaultPulseIllustration className="pointer-events-none absolute -right-4 -top-4 hidden h-36 w-36 opacity-60 sm:block lg:h-44 lg:w-44" />
        <div className="relative max-w-lg">
          <p className="eyebrow mb-1">Overview</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#173b45] sm:text-3xl">{greeting}.</h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">{statusLine}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              to="/upload"
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700"
            >
              Upload a report
            </Link>
            {attentionCount > 0 && (
              <Link
                to={`/records/${summary!.attention[0].id}`}
                className="rounded-xl border border-[#cbdedb] bg-white px-4 py-2.5 text-sm font-bold text-[#365861] hover:bg-[#f3f9f7]"
              >
                Review what's waiting
              </Link>
            )}
          </div>
        </div>
      </section>

      {showChecklist && (
        <section className="surface p-5 sm:p-6">
          <p className="mb-3 text-sm font-bold text-[#173b45]">Get the most out of your vault</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {checklist.map((step, index) => (
              <Link
                key={step.label}
                to={step.to}
                className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors ${
                  step.done
                    ? "border-transparent bg-[#f3f9f7] text-[#7c9b96]"
                    : "border-[#dce9e7] bg-white text-[#173b45] hover:border-brand-300 hover:bg-[#f6faf9]"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    step.done ? "bg-brand-500 text-white" : "border border-[#cbdedb] text-[#7c9b96]"
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? "\u2713" : index + 1}
                </span>
                <span className={step.done ? "line-through decoration-1" : "font-medium"}>{step.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Reports" value={summary?.total ?? 0} />
        <SummaryCard label="Pending Review" value={summary?.pending ?? 0} accent="amber" />
        <SummaryCard label="Verified" value={summary?.verified ?? 0} accent="brand" />
        <SummaryCard label="Latest Report" value={summary?.latest ? summary.latest.name : "–"} small />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="surface overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-[#eef3f2] px-5 py-4">
            <div className="flex items-center gap-2">
              <DocumentStackIllustration className="h-8 w-8" />
              <h2 className="text-sm font-bold text-[#173b45]">Recent Reports</h2>
            </div>
            <Link to="/records" className="text-sm font-bold text-brand-700 hover:underline">
              View all
            </Link>
          </div>

          <table className="hidden w-full text-left text-sm md:table">
            <thead className="bg-[#f6faf9] text-xs font-bold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Report</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Report Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef3f2]">
              {recent.map((r) => (
                <tr key={r.id} className="hover:bg-[#f9fcfb]">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 text-gray-500">{formatCategory(r.category)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "–"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/records/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="divide-y divide-[#eef3f2] md:hidden">
            {recent.map((r) => (
              <Link key={r.id} to={`/records/${r.id}`} className="block p-4 hover:bg-[#f9fcfb]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{r.name}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {formatCategory(r.category)} · {r.reportDate ? new Date(r.reportDate).toLocaleDateString() : "No date"}
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <AttentionPanel attention={summary?.attention ?? []} />
          <CategoryPanel counts={summary?.categoryCounts ?? []} total={summary?.total ?? 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickAction to="/upload" label="Upload Report" primary />
        <QuickAction to="/records" label="View Records" />
        <QuickAction to="/images" label="Image Vault" />
        <QuickAction to="/exports" label="Export Records" />
      </div>
    </div>
  );
}

function QuickAction({ to, label, primary }: { to: string; label: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? "rounded-xl bg-brand-600 px-4 py-4 text-center text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700 sm:col-span-3"
          : "rounded-xl border border-[#dce9e7] bg-white px-4 py-4 text-center text-sm font-semibold text-[#365861] hover:bg-[#f6faf9]"
      }
    >
      {label}
    </Link>
  );
}

/**
 * Reports awaiting the user's action (PENDING_REVIEW or OCR_FAILED),
 * surfaced as direct links rather than left for the person to notice
 * buried in Records. Previously the only signal was a bare "Pending
 * Review" count with nothing to click through to.
 */
function AttentionPanel({ attention }: { attention: Report[] }) {
  return (
    <section className="surface p-5">
      <p className="mb-3 text-sm font-bold text-[#173b45]">Needs your attention</p>
      {attention.length === 0 ? (
        <div className="flex flex-col items-center py-4 text-center">
          <AllCaughtUpIllustration className="h-14 w-14" />
          <p className="mt-2 text-sm font-semibold text-[#365861]">You're all caught up</p>
          <p className="mt-0.5 text-xs text-gray-400">Nothing is waiting for review right now.</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {attention.map((r) => (
            <li key={r.id}>
              <Link
                to={`/records/${r.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[#f6faf9]"
              >
                <span className="truncate font-medium text-gray-900">{r.name}</span>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A simple bar breakdown of the vault's own categories, never a fixed
 * six-row chart, only the categories the account actually has. */
function CategoryPanel({ counts, total }: { counts: CategoryCount[]; total: number }) {
  if (counts.length === 0 || total === 0) return null;
  const max = Math.max(...counts.map((c) => c.count), 1);
  return (
    <section className="surface p-5">
      <p className="mb-3 text-sm font-bold text-[#173b45]">By category</p>
      <div className="space-y-2.5">
        {counts.map((c) => (
          <div key={c.category}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-[#365861]">{formatCategory(c.category)}</span>
              <span className="text-gray-400">{c.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#eef3f2]">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${Math.max(6, (c.count / max) * 100)}%`, backgroundColor: categoryColor(c.category) }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyDashboard({ greeting }: { greeting: string }) {
  const steps = [
    { title: "Upload a report", body: "Add a photo or PDF of any prescription, lab result, or scan." },
    { title: "We read the details", body: "Dates, test values, and key fields are pulled out automatically." },
    { title: "Review and verify", body: "Confirm what's right, fix anything that's not, and it's yours to keep." },
  ];
  return (
    <div className="surface flex flex-col items-center overflow-hidden px-6 py-14 text-center sm:px-10">
      <EmptyVaultIllustration className="h-32 w-32" />
      <p className="eyebrow mb-1 mt-2">Overview</p>
      <h1 className="text-2xl font-bold tracking-tight text-[#173b45] sm:text-3xl">{greeting}.</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-gray-500">
        This is where every report, prescription, and scan will live once you add one – organized, searchable, and
        private to you.
      </p>
      <Link
        to="/upload"
        className="mt-6 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700"
      >
        Upload your first report
      </Link>

      <div className="mt-12 grid w-full max-w-2xl gap-4 text-left sm:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.title} className="rounded-xl border border-[#dce9e7] bg-white/70 p-4">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {index + 1}
            </span>
            <p className="mt-2.5 text-sm font-bold text-[#173b45]">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">{step.body}</p>
          </div>
        ))}
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
  const barColor = accent === "amber" ? "bg-amber-300" : accent === "brand" ? "bg-brand-400" : "bg-brand-200";
  return (
    <div className="surface p-4">
      <div className={`mb-4 h-1.5 w-8 rounded-full ${barColor}`} />
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
    <div className="space-y-6">
      <div className="surface h-40 w-full animate-pulse" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="surface h-20 animate-pulse" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="surface h-64 animate-pulse" />
        <div className="space-y-6">
          <div className="surface h-32 animate-pulse" />
          <div className="surface h-40 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
