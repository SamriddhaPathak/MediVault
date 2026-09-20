import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../services/api";
import { ExtractedField, Report, TestValue } from "../types";
import StatusBadge from "../components/StatusBadge";
import SourceTag from "../components/SourceTag";
import PageHeader from "../components/PageHeader";
import DocumentPreview from "../components/DocumentPreview";
import ErrorState from "../components/ErrorState";
import ConfirmDialog from "../components/ConfirmDialog";
import ConfidenceBadge from "../components/ConfidenceBadge";
import { SkeletonBlock } from "../components/Skeleton";
import { useToast } from "../components/ToastProvider";

export default function RecordDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [report, setReport] = useState<Report | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [testValues, setTestValues] = useState<TestValue[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/reports/${id}`);
      setReport(res.data.report);
      setFields(res.data.fields.filter((f: ExtractedField) => !f.fieldName.startsWith("test:")));
      setTestValues(res.data.testValues);
      const urlRes = await api.get(`/reports/${id}/file-url`);
      setFileUrl(urlRes.data.url);
    } catch (err: any) {
      setError(
        err?.response?.status === 404
          ? "This report could not be found. It may have been deleted."
          : err?.response?.data?.error ?? "We couldn't load this report. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function reprocess() {
    setReprocessing(true);
    try {
      await api.post(`/reports/${id}/reprocess`);
      showToast("Processing this document again. This page will update when it finishes.");
      await load();
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? "We couldn't start processing again.", "error");
    } finally {
      setReprocessing(false);
    }
  }

  async function archive() {
    try {
      await api.post(`/reports/${id}/archive`);
      showToast("Report archived.");
      load();
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? "We couldn't archive this report.", "error");
    }
  }

  async function confirmAndDelete() {
    setConfirmDelete(false);
    try {
      await api.delete(`/reports/${id}`);
      showToast("Report deleted.");
      navigate("/records");
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? "We couldn't delete this report.", "error");
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

  if (error || !report) {
    return (
      <>
        <PageHeader title="Report" backTo="/records" />
        <ErrorState message={error ?? "Report not found."} onRetry={load} />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title={report.name}
        backTo="/records"
        actions={
          <>
            {report.status !== "VERIFIED" && (
              <Link
                to={`/records/${id}/review`}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Edit
              </Link>
            )}
            {report.status !== "ARCHIVED" && report.status !== "PROCESSING" && (
              <button
                onClick={reprocess}
                disabled={reprocessing}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {reprocessing ? "Starting..." : "Run OCR again"}
              </button>
            )}
            {report.status !== "ARCHIVED" && (
              <button
                onClick={archive}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Archive
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <StatusBadge status={report.status} />
        <span className="text-xs text-gray-500">{report.category}</span>
        {report.editedByUser && <span className="text-xs text-gray-400">· Edited by you</span>}
      </div>

      {report.ocrConfidence != null && report.ocrConfidence < 0.8 && report.status !== "VERIFIED" && (
        <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Review recommended before verification</p>
          <p className="mt-1">Overall OCR confidence is {Math.round(report.ocrConfidence * 100)}%. Check each extracted field against the original document.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="surface p-4 text-sm">
            <dl className="grid grid-cols-2 gap-y-2">
              <dt className="text-gray-500">Report Date</dt>
              <dd className="text-gray-900">{report.reportDate ? new Date(report.reportDate).toLocaleDateString() : "—"}</dd>
              <dt className="text-gray-500">Uploaded</dt>
              <dd className="text-gray-900">{new Date(report.uploadTime).toLocaleDateString()}</dd>
              <dt className="text-gray-500">OCR Confidence</dt>
              <dd className="text-gray-900">{report.ocrConfidence != null ? `${Math.round(report.ocrConfidence * 100)}%` : "—"}</dd>
              <dt className="text-gray-500">Verified</dt>
              <dd className="text-gray-900">{report.verifiedAt ? new Date(report.verifiedAt).toLocaleDateString() : "Not yet"}</dd>
            </dl>
          </div>

          {report.status === "OCR_FAILED" && report.failureReason && (
            <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {report.failureReason}
            </p>
          )}

          {/* A successful extraction can still be partial — a PDF longer
              than the page limit, or a table that hit the extracted-value
              cap. Saying so is the difference between a known limitation
              and a silently incomplete medical record. */}
          {report.processingNotice && (
            <p role="status" className="rounded-lg border border-[#cbdedb] bg-[#f3f9f7] px-3 py-2 text-sm text-[#365861]">
              {report.processingNotice}
            </p>
          )}

          {report.status === "PROCESSING" && (
            <p role="status" className="rounded-lg border border-[#cbdedb] bg-[#f3f9f7] px-3 py-2 text-sm text-[#365861]">
              This document is being processed. Reload in a moment to see the extracted information.
            </p>
          )}

          {fileUrl && (
            <DocumentPreview report={report} fileUrl={fileUrl} />
          )}
        </div>

        <div className="space-y-4">
          <div className="surface p-4">
            <div className="mb-3 flex items-center justify-between"><div><p className="eyebrow">Extracted data</p><h2 className="text-sm font-bold text-[#173b45]">Test results</h2></div><span className="text-xs text-gray-400">{testValues.length} values</span></div>
            {testValues.length === 0 ? (
              <p className="text-sm text-gray-400">No test values recorded for this report.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-400">
                    <tr>
                      <th className="py-1.5 pr-2">Test</th>
                      <th className="py-1.5 pr-2">Value</th>
                      <th className="py-1.5 pr-2">Reference Range</th>
                      <th className="py-1.5">Date</th>
                      <th className="py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {testValues.map((tv) => (
                      <tr key={tv.id}>
                        <td className="py-1.5 pr-2">{tv.testName}</td>
                        <td className="py-1.5 pr-2">
                          {tv.numericValue} {tv.unit}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-500">{tv.referenceRangeText ?? "—"}</td>
                        <td className="py-1.5 pr-2 text-gray-500">{new Date(tv.recordedDate).toLocaleDateString()}</td>
                        <td className="py-1.5">
                          <ConfidenceBadge confidence={tv.source === "ocr" ? tv.confidence : null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="surface p-4">
            <h2 className="mb-3 text-sm font-bold text-[#173b45]">Extracted information</h2>
            {fields.length === 0 ? (
              <p className="text-sm text-gray-400">No additional information extracted.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {fields.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 border-b border-gray-50 pb-2 last:border-0">
                    <div className="min-w-0">
                      <span className="block text-xs font-bold uppercase tracking-wider text-gray-400">{formatFieldName(f.fieldName)}</span>
                      <span className="text-gray-900">{f.value}</span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1"><SourceTag source={f.source} /><ConfidenceBadge confidence={f.source === "ocr" ? f.confidence : null} /></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this report?"
        description="This permanently deletes the report, the original document, and all extracted information. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmAndDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function formatFieldName(fieldName: string): string {
  const labels: Record<string, string> = {
    patientId: "Patient ID",
    patientName: "Patient name",
    patientAge: "Patient age",
    symptoms: "Symptoms",
    diagnosis: "Diagnosis",
    treatment: "Treatment",
    medications: "Medications",
    allergies: "Allergies",
    doctor: "Doctor",
    facility: "Facility",
    bloodGroup: "Blood group",
    dateOfBirth: "Date of birth",
    contactNumber: "Contact number",
    address: "Address",
    dosageInstructions: "Dosage instructions",
    duration: "Duration",
    reportNumber: "Report / accession number",
    specimenType: "Specimen type",
    vaccineName: "Vaccine name",
    vaccineBatch: "Batch / lot number",
    doseNumber: "Dose number",
    vaccinationSite: "Injection site",
    nextDoseDate: "Next dose due",
    "vital.bloodPressure": "Blood pressure",
    "vital.heartRate": "Heart rate",
    "vital.temperature": "Temperature",
    "vital.respiratoryRate": "Respiratory rate",
    "vital.oxygenSaturation": "Oxygen saturation",
    "vital.weight": "Weight",
    "vital.height": "Height",
    "vital.bmi": "BMI",
  };
  return labels[fieldName] ?? fieldName.replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
