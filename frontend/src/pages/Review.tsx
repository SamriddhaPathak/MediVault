import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../services/api";
import { ExtractedField, Report, TestValue } from "../types";
import SourceTag from "../components/SourceTag";
import ConfidenceBadge from "../components/ConfidenceBadge";
import PageHeader from "../components/PageHeader";
import ErrorState from "../components/ErrorState";
import { SkeletonBlock } from "../components/Skeleton";
import { useToast } from "../components/ToastProvider";

const CATEGORIES = ["LABORATORY", "PRESCRIPTION", "RADIOLOGY", "IMAGING", "VACCINATION", "OTHER"];

// Fields the review UI manages separately (category/date have their own
// dedicated controls above) — everything else extracted (patient name,
// doctor, hospital, or any test:* field) is shown in the general editor.
const MANAGED_FIELD_NAMES = new Set(["category", "reportDate"]);

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [report, setReport] = useState<Report | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [testValues, setTestValues] = useState<TestValue[]>([]);
  const [category, setCategory] = useState("OTHER");
  const [reportDate, setReportDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/reports/${id}`);
      setReport(res.data.report);
      setFields(res.data.fields);
      setTestValues(res.data.testValues);
      setCategory(res.data.report.category);
      setReportDate(res.data.report.reportDate ? res.data.report.reportDate.slice(0, 10) : "");
      const urlRes = await api.get(`/reports/${id}/file-url`);
      setFileUrl(urlRes.data.url);
    } catch (err: any) {
      setLoadError(err?.response?.data?.error ?? "We couldn't load this report. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // "test:*" fields duplicate what's already editable in the Test Values
  // section above (the OCR job records both a TestValue row and an
  // ExtractedField audit row per test) — showing them again here would be
  // confusing and let the two editors drift out of sync with each other.
  const otherFields = fields.filter(
    (f) => !MANAGED_FIELD_NAMES.has(f.fieldName) && !f.fieldName.startsWith("test:")
  );

  function updateTestValue(idx: number, patch: Partial<TestValue>) {
    setTestValues((prev) => prev.map((tv, i) => (i === idx ? { ...tv, ...patch } : tv)));
  }

  function addTestValue() {
    setTestValues((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        reportId: id!,
        testName: "",
        numericValue: 0,
        unit: "",
        recordedDate: reportDate || new Date().toISOString().slice(0, 10),
        referenceRangeText: "",
        source: "user",
        confidence: null,
      },
    ]);
  }

  async function removeTestValue(tv: TestValue) {
    if (!tv.id.startsWith("new-")) {
      await api.delete(`/reports/${id}/test-values/${tv.id}`);
    }
    setTestValues((prev) => prev.filter((t) => t.id !== tv.id));
  }

  function updateOtherField(idx: number, patch: Partial<ExtractedField>) {
    setFields((prev) => {
      const next = [...prev];
      const target = otherFields[idx];
      const realIdx = next.findIndex((f) => f.id === target.id);
      if (realIdx >= 0) next[realIdx] = { ...next[realIdx], ...patch };
      return next;
    });
  }

  async function removeOtherField(fieldId: string) {
    if (!fieldId.startsWith("new-")) {
      await api.delete(`/reports/${id}/fields/${fieldId}`);
    }
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  }

  function addOtherField() {
    setFields((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        reportId: id!,
        fieldName: "",
        value: "",
        normalizedValue: null,
        confidence: 1,
        source: "user",
      },
    ]);
  }

  async function saveChanges(): Promise<boolean> {
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/reports/${id}`, { category, reportDate: reportDate || undefined });

      await api.patch(`/reports/${id}/fields`, {
        fields: otherFields
          .filter((f) => f.fieldName.trim() && f.value.trim())
          .map((f) => ({
            id: f.id.startsWith("new-") ? undefined : f.id,
            fieldName: f.fieldName,
            value: f.value,
          })),
        testValues: testValues
          .filter((tv) => tv.testName.trim())
          .map((tv) => ({
            id: tv.id.startsWith("new-") ? undefined : tv.id,
            testName: tv.testName,
            numericValue: tv.numericValue,
            unit: tv.unit || undefined,
            recordedDate: tv.recordedDate,
            referenceRangeText: tv.referenceRangeText || undefined,
          })),
      });
      await load();
      return true;
    } catch (err: any) {
      setSaveError(err?.response?.data?.error ?? "We couldn't save your changes. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onSaveClick() {
    const ok = await saveChanges();
    if (ok) showToast("Changes saved.");
  }

  async function verify() {
    const ok = await saveChanges();
    if (!ok) return;
    setSaving(true);
    try {
      await api.post(`/reports/${id}/verify`);
      showToast("Report verified.");
      navigate(`/records/${id}`);
    } catch (err: any) {
      setSaveError(err?.response?.data?.error ?? "We couldn't verify this report. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonBlock className="h-8 w-64" />
        <SkeletonBlock className="h-96 w-full" />
      </div>
    );
  }

  if (loadError || !report) {
    return <ErrorState message={loadError ?? "Report not found."} onRetry={load} />;
  }

  const uncertainExtractions = [
    ...testValues.filter((value) => value.source === "ocr" && value.confidence != null && value.confidence < 0.8),
    ...fields.filter((field) => field.source === "ocr" && field.confidence < 0.8),
  ];
  const reportDateConfidence = fields.find((field) => field.fieldName === "reportDate")?.confidence ?? null;
  const categoryConfidence = fields.find((field) => field.fieldName === "category")?.confidence ?? null;

  return (
    <div>
      <PageHeader title="Review Report" subtitle="Correct anything OCR got wrong before you verify." backTo={`/records/${id}`} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          {fileUrl && (
            <div className="surface overflow-hidden">
              {report.name.toLowerCase().endsWith(".pdf") ? (
                <iframe src={fileUrl} title="Original document" className="h-96 w-full" />
              ) : (
                <img src={fileUrl} alt="Original report" className="max-h-96 w-full object-contain" />
              )}
            </div>
          )}
        </div>

        <div className="space-y-5">
          {saveError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {saveError}
            </p>
          )}

          {report.status === "OCR_FAILED" && (
            <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              OCR couldn't extract reliable information from this report. You can still add the information
              manually below.
            </p>
          )}

          {uncertainExtractions.length > 0 && (
            <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-bold">{uncertainExtractions.length} extraction{uncertainExtractions.length === 1 ? " needs" : "s need"} your review</p>
              <p className="mt-1 leading-5">OCR confidence is below 80% for some values. Compare them with the original document before verifying this report.</p>
            </div>
          )}

          <div className="surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <label htmlFor="review-category" className="text-sm font-medium text-gray-700">
                Report Category
              </label>
              <div className="flex items-center gap-2"><SourceTag source="ocr" /><ConfidenceBadge confidence={categoryConfidence} /></div>
            </div>
            <select
              id="review-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="field-control"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </option>
              ))}
            </select>

            <label htmlFor="review-date" className="mb-1 mt-4 block text-sm font-medium text-gray-700">
              Report Date
            </label>
            <input
              id="review-date"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="field-control"
            />
            <ConfidenceBadge confidence={reportDateConfidence} />
          </div>

          <div className="surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Test Values</h2>
              <button onClick={addTestValue} className="text-sm font-medium text-brand-700 hover:underline">
                + Add value
              </button>
            </div>

            <div className="space-y-3">
              {testValues.length === 0 && <p className="text-sm text-gray-400">No test values extracted yet.</p>}
              {testValues.map((tv, idx) => (
                <div key={tv.id} className="rounded-xl border border-[#e1eeeb] bg-[#f8fbfa] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SourceTag source={tv.source} />
                      <ConfidenceBadge confidence={tv.confidence} />
                    </div>
                    <button onClick={() => removeTestValue(tv)} className="text-xs text-red-600 hover:underline">
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="col-span-2 text-xs text-gray-500">
                      Test name
                      <input
                        value={tv.testName}
                        placeholder="e.g. Hemoglobin"
                        onChange={(e) => updateTestValue(idx, { testName: e.target.value })}
                        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Value
                      <input
                        type="number"
                        step="any"
                        value={tv.numericValue}
                        onChange={(e) => updateTestValue(idx, { numericValue: parseFloat(e.target.value) })}
                        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Unit
                      <input
                        value={tv.unit ?? ""}
                        placeholder="e.g. g/dL"
                        onChange={(e) => updateTestValue(idx, { unit: e.target.value })}
                        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                      />
                    </label>
                    <label className="col-span-2 text-xs text-gray-500">
                      Date recorded
                      <input
                        type="date"
                        value={tv.recordedDate?.slice(0, 10)}
                        onChange={(e) => updateTestValue(idx, { recordedDate: e.target.value })}
                        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Other Extracted Information</h2>
              <button onClick={addOtherField} className="text-sm font-medium text-brand-700 hover:underline">
                + Add field
              </button>
            </div>
            <div className="space-y-2">
              {otherFields.length === 0 && (
                <p className="text-sm text-gray-400">No other fields extracted for this report.</p>
              )}
              {otherFields.map((f, idx) => (
                <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e1eeeb] bg-[#f8fbfa] p-2.5">
                  <ConfidenceBadge confidence={f.source === "ocr" ? f.confidence : null} />
                  <input
                    value={f.fieldName}
                    onChange={(e) => updateOtherField(idx, { fieldName: e.target.value })}
                    placeholder="Field name (e.g. Doctor)"
                    className="w-32 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    value={f.value}
                    onChange={(e) => updateOtherField(idx, { value: e.target.value })}
                    placeholder="Value"
                    className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <SourceTag source={f.source} />
                  <button onClick={() => removeOtherField(f.id)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onSaveClick}
              disabled={saving}
              className="flex-1 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={verify}
              disabled={saving}
              className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Verify Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
