import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { Report, ReportCategory, ReportStatus } from "../types";
import ErrorState from "../components/ErrorState";
import { SkeletonBlock } from "../components/Skeleton";
import StatusBadge from "../components/StatusBadge";

interface ImageRecord extends Report {
  imageUrl: string;
}

type ViewFilter = "all" | "verified" | "review";

// The vault fetches one large page rather than paginating (it's meant to
// be a browsable grid, not a list) — this cap keeps that request bounded.
// If a user's total report count exceeds it, `truncated` below drives a
// disclosure banner rather than silently hiding records with no
// indication anything was left out.
const FETCH_PAGE_SIZE = 500;

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  LABORATORY: "Laboratory",
  PRESCRIPTION: "Prescriptions",
  RADIOLOGY: "Radiology",
  IMAGING: "Imaging",
  VACCINATION: "Vaccinations",
  OTHER: "Other records",
};

const CATEGORY_ORDER: ReportCategory[] = ["LABORATORY", "RADIOLOGY", "IMAGING", "PRESCRIPTION", "VACCINATION", "OTHER"];

export default function ImageVault() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [category, setCategory] = useState<ReportCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get("/reports", { params: { page: 1, pageSize: FETCH_PAGE_SIZE, sort: "newest" } });
      setTruncated((response.data.total ?? 0) > FETCH_PAGE_SIZE);
      const reports = (response.data.items as Report[]).filter((report) => report.mimeType?.startsWith("image/"));
      const withUrls = await Promise.all(
        reports.map(async (report) => {
          try {
            const urlResponse = await api.get(`/reports/${report.id}/file-url`);
            return { ...report, imageUrl: urlResponse.data.url };
          } catch {
            return null;
          }
        })
      );
      setImages(withUrls.filter((image): image is ImageRecord => image !== null));
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "We couldn't load your image vault. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visibleImages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return images.filter((image) => {
      const matchesFilter = filter === "all" || (filter === "verified" ? image.status === "VERIFIED" : image.status !== "VERIFIED");
      const matchesCategory = category === "all" || image.category === category;
      const matchesSearch = !query || image.name.toLowerCase().includes(query) || image.category.toLowerCase().includes(query);
      return matchesFilter && matchesCategory && matchesSearch;
    });
  }, [category, filter, images, search]);

  const groupedImages = CATEGORY_ORDER.map((group) => ({
    category: group,
    images: visibleImages.filter((image) => image.category === group),
  })).filter((group) => group.images.length > 0);

  const verifiedCount = images.filter((image) => image.status === "VERIFIED").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Visual record library</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#173b45]">Image Vault</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">Browse uploaded report images grouped by the content MediVault recognized.</p>
        </div>
        <Link to="/upload" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:bg-brand-700">+ Add image</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Image records" value={images.length} />
        <Summary label="Verified by you" value={verifiedCount} accent="brand" />
        <Summary label="Needs review" value={images.length - verifiedCount} accent="amber" />
      </div>

      <div className="surface space-y-4 p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Image status filter">
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All images</FilterButton>
          <FilterButton active={filter === "verified"} onClick={() => setFilter("verified")}>Verified by you</FilterButton>
          <FilterButton active={filter === "review"} onClick={() => setFilter("review")}>Needs review</FilterButton>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input aria-label="Search image records" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search image reports..." className="field-control" />
          <select aria-label="Filter image category" value={category} onChange={(event) => setCategory(event.target.value as ReportCategory | "all")} className="field-control md:w-52">
            <option value="all">All categories</option>
            {CATEGORY_ORDER.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
          </select>
        </div>
      </div>

      {truncated && !loading && !error && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing your most recent {FETCH_PAGE_SIZE} records. Use Records for your full, searchable history.
        </p>
      )}

      {loading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><SkeletonCards /></div>}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && groupedImages.length === 0 && (
        <div className="surface p-12 text-center"><p className="text-base font-bold text-[#365861]">No image records match this view</p><p className="mt-1 text-sm text-gray-500">Upload a report image or change the filters to explore your vault.</p></div>
      )}
      {!loading && !error && groupedImages.map((group) => (
        <section key={group.category} aria-labelledby={`image-group-${group.category}`}>
          <div className="mb-3 flex items-center justify-between"><div><p className="eyebrow">{group.images.length} {group.images.length === 1 ? "record" : "records"}</p><h2 id={`image-group-${group.category}`} className="text-lg font-bold text-[#173b45]">{CATEGORY_LABELS[group.category]}</h2></div></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.images.map((image) => <ImageCard key={image.id} image={image} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function ImageCard({ image }: { image: ImageRecord }) {
  const verified = image.status === "VERIFIED";
  return (
    <article className="group overflow-hidden rounded-2xl border border-[#dce9e7] bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
      <Link to={`/records/${image.id}`} className="block" aria-label={`Open ${image.name}`}>
        <div className="relative flex h-52 items-center justify-center overflow-hidden bg-[#eef5f3]">
          <img src={image.imageUrl} alt={`Preview of ${image.name}`} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
          <div className="absolute left-3 top-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold shadow-sm ${verified ? "bg-brand-100 text-brand-800" : "bg-white/95 text-amber-700"}`}>{verified ? "✓ Verified by you" : "Review needed"}</span></div>
        </div>
      </Link>
      <div className="space-y-3 p-4">
        <div className="min-w-0"><h3 className="truncate text-sm font-bold text-[#173b45]" title={image.name}>{image.name}</h3><p className="mt-1 text-xs text-gray-500">{image.reportDate ? new Date(image.reportDate).toLocaleDateString() : "No report date"}</p></div>
        <div className="flex items-center justify-between gap-2"><StatusBadge status={image.status} /><Link to={verified ? `/records/${image.id}` : `/records/${image.id}/review`} className="text-xs font-bold text-brand-700 hover:underline">{verified ? "View details" : "Review details"}</Link></div>
      </div>
    </article>
  );
}

function Summary({ label, value, accent }: { label: string; value: number; accent?: "brand" | "amber" }) {
  return <div className="surface p-4"><p className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p><p className={`mt-2 text-2xl font-bold ${accent === "brand" ? "text-brand-700" : accent === "amber" ? "text-amber-600" : "text-[#173b45]"}`}>{value}</p></div>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`rounded-xl px-3 py-2 text-sm font-bold ${active ? "bg-brand-600 text-white" : "bg-[#f1f8f6] text-[#365861] hover:bg-brand-100"}`}>{children}</button>;
}

function SkeletonCards() {
  return <>{[1, 2, 3].map((item) => <SkeletonBlock key={item} className="h-80 w-full" />)}</>;
}
