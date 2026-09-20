import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, getErrorMessage } from "../services/api";
import { ExtractedField, Report, TestValue } from "../types";
import SourceTag from "../components/SourceTag";
import ConfidenceBadge from "../components/ConfidenceBadge";
import PageHeader from "../components/PageHeader";
import DocumentPreview from "../components/DocumentPreview";
import ErrorState from "../components/ErrorState";
import { SkeletonBlock } from "../components/Skeleton";
import { useToast } from "../components/ToastProvider";

const CATEGORIES = ["LABORATORY", "PRESCRIPTION", "RADIOLOGY", "IMAGING", "VACCINATION", "OTHER"];

// Fields the review UI manages separately (category/date have their own
// dedicated controls above); everything else extracted (patient name,
// doctor, hospital, or any test:* field) is shown in the general editor.
const MANAGED_FIELD_NAMES = new Set(["category", "reportDate"]);

// Temporary client-side ids for rows that have not been saved yet.
// A `Date.now()`-based id collides when two rows are added inside the same
// millisecond (easy with a keyboard shortcut or a fast double-click), which
// produces duplicate React keys and makes "Remove" delete the wrong row.
let tempIdCounter = 0;
function nextTempId() {
  tempIdCounter += 1;
  return `new-${tempIdCounter}-${Date.now()}`;
}

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
      setLoadError(getErrorMessage(err, "We couldn't load this report. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  // "test:*" fields duplicate what's already editable in the Test Values
  // section above (the OCR job records both a TestValue row and an
  // ExtractedField audit row per test); showing them again here would be
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
        id: nextTempId(),
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
    // A rejected delete used to surface as an unhandled promise rejection,
    // and the row stayed on screen with no explanation. Remove it locally
    // only once the server has confirmed, and say so when it hasn't.
    if (!tv.id.startsWith("new-")) {
      try {
        await api.delete(`/reports/${id}/test-values/${tv.id}`);
      } catch (err: any) {
        showToast(getErrorMessage(err, "We couldn't remove that test value. Please try again."), "error");
        return;
      }
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
      try {
        await api.delete(`/reports/${id}/fields/${fieldId}`);
      } catch (err: any) {
        showToast(getErrorMessage(err, "We couldn't remove that field. Please try again."), "error");
        return;
      }
    }
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  }

  function addOtherField() {
    setFields((prev) => [
      ...prev,
      {
        id: nextTempId(),
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
    const invalidTestValue = testValues.find((tv) => tv.testName.trim() && !Number.isFinite(tv.numericValue));
    if (invalidTestValue) {
      setSaveError(`Enter a valid number for "${invalidTestValue.testName}" before saving.`);
      return false;
    }

    // Rows missing their name are filtered out of the request below. Saying
    // so is important: silently discarding a row the user just typed into
    // looks exactly like the save failing, or worse, like it succeeded.
    if (testValues.some((tv) => !tv.testName.trim() && Number.isFinite(tv.numericValue) && tv.numericValue !== 0)) {
      setSaveError("Give every test value a name, or remove the empty row, before saving.");
      return false;
    }
    if (otherFields.some((f) => !f.fieldName.trim() && f.value.trim())) {
      setSaveError("Give every field a name, or remove the empty row, before saving.");
      return false;
    }

    setSaving(true);
    setSaveError(null);
    try {
      // null (not undefined) so an emptied date field actually clears the
      // stored report date instead of leaving the old value in place.
      await api.patch(`/reports/${id}`, { category, reportDate: reportDate || null });

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
            // null, not undefined: an emptied input means "clear this".
            // Sending undefined dropped the key entirely, and Prisma reads a
            // missing key as "leave unchanged", so a wrong unit that OCR
            // guessed could never be erased, only overwritten.
            unit: tv.unit?.trim() ? tv.unit.trim() : null,
            recordedDate: tv.recordedDate,
            referenceRangeText: tv.referenceRangeText?.trim() ? tv.referenceRangeText.trim() : null,
          })),
      });
      await load();
      return true;
    } catch (err: any) {
      setSaveError(getErrorMessage(err, "We couldn't save your changes. Please try again."));
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
      setSaveError(getErrorMessage(err, "We couldn't verify this report. Please try again."));
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
            <DocumentPreview report={report} fileUrl={fileUrl} />
          )}
        </div>

        <div className="space-y-5">
          {saveError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {saveError}
            </p>
          )}

          {report.processingNotice && (
            <p role="status" className="rounded-lg border border-[#cbdedb] bg-[#f3f9f7] px-3 py-2 text-sm text-[#365861]">
              {report.processingNotice}
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
                        className="mt-0.5 w-full rounded-md border border-[#cbdedb] px-2 py-1.5 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Value
                      <input
                        type="number"
                        step="any"
                        value={Number.isFinite(tv.numericValue) ? tv.numericValue : ""}
                        onChange={(e) => {
                          const parsed = parseFloat(e.target.value);
                          updateTestValue(idx, { numericValue: Number.isFinite(parsed) ? parsed : NaN });
                        }}
                        className="mt-0.5 w-full rounded-md border border-[#cbdedb] px-2 py-1.5 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Unit
                      <input
                        value={tv.unit ?? ""}
                        placeholder="e.g. g/dL"
                        onChange={(e) => updateTestValue(idx, { unit: e.target.value })}
                        className="mt-0.5 w-full rounded-md border border-[#cbdedb] px-2 py-1.5 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                    <label className="col-span-2 text-xs text-gray-500">
                      Date recorded
                      <input
                        type="date"
                        value={tv.recordedDate?.slice(0, 10)}
                        onChange={(e) => updateTestValue(idx, { recordedDate: e.target.value })}
                        className="mt-0.5 w-full rounded-md border border-[#cbdedb] px-2 py-1.5 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
                <div key={f.id} className="rounded-xl border border-[#e1eeeb] bg-[#f8fbfa] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SourceTag source={f.source} />
                      <ConfidenceBadge confidence={f.source === "ocr" ? f.confidence : null} />
                    </div>
                    <button onClick={() => removeOtherField(f.id)} className="text-xs text-red-600 hover:underline">
                      Remove
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs text-gray-500">
                      Field name
                      <input
                        value={f.fieldName}
                        onChange={(e) => updateOtherField(idx, { fieldName: e.target.value })}
                        placeholder="Field name (e.g. Doctor)"
                        className="mt-0.5 w-full rounded-md border border-[#cbdedb] px-2 py-1.5 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                    <label className="block text-xs text-gray-500">
                      Value
                      <input
                        value={f.value}
                        onChange={(e) => updateOtherField(idx, { value: e.target.value })}
                        placeholder="Value"
                        className="mt-0.5 w-full rounded-md border border-[#cbdedb] px-2 py-1.5 text-sm text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onSaveClick}
              disabled={saving}
              className="flex-1 rounded-lg border border-[#cbdedb] bg-white py-2.5 text-sm font-bold text-[#365861] hover:bg-[#f3f9f7] disabled:opacity-60"
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
