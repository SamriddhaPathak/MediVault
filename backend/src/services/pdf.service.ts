import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

export interface ExportReportData {
  name: string;
  category: string;
  status: string;
  reportDate: Date | null;
  uploadTime: Date;
  fields: { fieldName: string; value: string; source: string; confidence?: number }[];
  testValues: { testName: string; numericValue: number; unit: string | null; recordedDate: Date; referenceRangeText?: string | null; confidence?: number | null }[];
}

export interface ExportPatientInfo {
  email: string;
  age?: number | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  knownConditions?: string | null;
}

const COLORS = {
  ink: "#173b45",
  muted: "#61747a",
  line: "#d9e7e4",
  pale: "#f1f8f6",
  brand: "#17856a",
  amber: "#b7791f",
};

const FIELD_LABELS: Record<string, string> = {
  patientId: "Patient ID",
  patientName: "Patient name",
  patientAge: "Patient age",
  sex: "Sex",
  symptoms: "Symptoms",
  diagnosis: "Diagnosis",
  treatment: "Treatment",
  medications: "Medications",
  allergies: "Allergies",
  doctor: "Doctor",
  facility: "Facility",
  "vital.bloodPressure": "Blood pressure",
  "vital.heartRate": "Heart rate",
  "vital.temperature": "Temperature",
  "vital.respiratoryRate": "Respiratory rate",
  "vital.oxygenSaturation": "Oxygen saturation",
  "vital.weight": "Weight",
  "vital.height": "Height",
};

function fieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] ?? fieldName.replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: Date | null): string {
  return value ? value.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "Not recorded";
}

// Builds the PDF entirely in memory and returns a Buffer — no dependency
// on BullMQ; the caller (export.job.ts) decides how to run this async.
export function generateExportPdf(patient: ExportPatientInfo, reports: ExportReportData[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    doc.pipe(stream);

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 28;

    function sectionTitle(title: string, subtitle?: string) {
      if (doc.y > bottom() - 70) doc.addPage();
      doc.moveDown(0.65).fillColor(COLORS.brand).fontSize(9).font("Helvetica-Bold").text(title.toUpperCase(), { characterSpacing: 0.8 });
      if (subtitle) doc.moveDown(0.2).fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(subtitle);
      doc.moveDown(0.35);
    }

    function infoCard(items: Array<[string, string]>, columns = 2) {
      const columnWidth = contentWidth / columns;
      const rows = Math.ceil(items.length / columns);
      const rowHeight = 30;
      const height = rows * rowHeight + 18;
      if (doc.y + height > bottom()) doc.addPage();
      const top = doc.y;
      doc.roundedRect(doc.page.margins.left, top, contentWidth, height, 8).fillAndStroke(COLORS.pale, COLORS.line);
      items.forEach(([label, value], index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = doc.page.margins.left + column * columnWidth + 14;
        const y = top + 10 + row * rowHeight;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.muted).text(label.toUpperCase(), x, y, { width: columnWidth - 25 });
        doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(value, x, y + 10, { width: columnWidth - 25, ellipsis: true });
      });
      doc.y = top + height;
    }

    function fieldList(fields: ExportReportData["fields"]) {
      fields.forEach((field) => {
        const valueHeight = Math.max(22, doc.heightOfString(field.value, { width: contentWidth - 155 }));
        const rowHeight = valueHeight + 14;
        if (doc.y + rowHeight > bottom()) doc.addPage();
        const top = doc.y;
        doc.roundedRect(doc.page.margins.left, top, contentWidth, rowHeight, 5).fillAndStroke("#ffffff", COLORS.line);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.ink).text(fieldLabel(field.fieldName), doc.page.margins.left + 10, top + 8, { width: 130 });
        doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.ink).text(field.value, doc.page.margins.left + 145, top + 8, { width: contentWidth - 210 });
        const sourceLabel = field.source === "user" ? "Edited" : field.confidence != null ? `OCR ${Math.round(field.confidence * 100)}%` : "OCR";
        doc.fontSize(7.5).fillColor(field.source === "user" ? COLORS.brand : COLORS.muted).text(sourceLabel, doc.page.width - doc.page.margins.right - 55, top + 9, { width: 45, align: "right" });
        doc.y = top + rowHeight;
      });
    }

    doc.rect(0, 0, doc.page.width, 116).fill(COLORS.ink);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(24).text("MediVault", doc.page.margins.left, 42);
    doc.font("Helvetica").fontSize(10).fillColor("#b8d2d0").text("PERSONAL MEDICAL RECORD SUMMARY", doc.page.margins.left, 74, { characterSpacing: 1.1 });
    doc.fillColor(COLORS.muted).fontSize(9).text(`Generated ${formatDate(new Date())}`, doc.page.width - doc.page.margins.right - 120, 48, { width: 120, align: "right" });
    doc.y = 142;

    sectionTitle("Patient overview", "Selected account and health profile information");
    infoCard([
      ["Email", patient.email],
      ["Age", patient.age != null ? String(patient.age) : "Not recorded"],
      ["Blood group", patient.bloodGroup || "Not recorded"],
      ["Allergies", patient.allergies || "Not recorded"],
      ["Known conditions", patient.knownConditions || "Not recorded"],
    ], 2);
    doc.moveDown(0.5).font("Helvetica").fontSize(8.5).fillColor(COLORS.muted).text("This summary organizes patient-selected records. It does not provide diagnosis or medical interpretation.", { lineGap: 2 });

    reports.forEach((report, index) => {
      doc.addPage();
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(20).text(report.name, { width: contentWidth });
      doc.moveDown(0.25).font("Helvetica").fontSize(9).fillColor(COLORS.muted).text("Report record", { characterSpacing: 0.7 });
      doc.moveDown(0.7);
      infoCard([
        ["Category", report.category],
        ["Status", report.status.replace(/_/g, " ")],
        ["Report date", formatDate(report.reportDate)],
        ["Uploaded", formatDate(report.uploadTime)],
      ], 2);

      const clinicalFields = report.fields.filter((field) => field.fieldName !== "category" && field.fieldName !== "reportDate");
      if (clinicalFields.length) {
        sectionTitle("Clinical information", "Extracted details available for review");
        fieldList(clinicalFields);
      }

      if (report.testValues.length) {
        sectionTitle("Test results", "Recorded measurements and reference information");
        const tableTop = doc.y;
        const col = [0, 0.37, 0.58, 0.78].map((ratio) => doc.page.margins.left + contentWidth * ratio);
        doc.roundedRect(doc.page.margins.left, tableTop, contentWidth, 24, 5).fill(COLORS.ink);
        ["Test", "Value", "Reference", "Recorded"].forEach((heading, i) => doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff").text(heading, col[i] + 8, tableTop + 8, { width: (col[i + 1] ?? doc.page.width - doc.page.margins.right) - col[i] - 14 }));
        doc.y = tableTop + 24;
        report.testValues.forEach((test, testIndex) => {
          if (doc.y + 25 > bottom()) { doc.addPage(); sectionTitle("Test results continued"); }
          const rowTop = doc.y;
          if (testIndex % 2 === 0) doc.rect(doc.page.margins.left, rowTop, contentWidth, 25).fill("#f7fbfa");
          const confidence = test.confidence != null ? ` (${Math.round(test.confidence * 100)}%)` : "";
          const values = [test.testName, `${test.numericValue}${test.unit ? ` ${test.unit}` : ""}${confidence}`, test.referenceRangeText || "Not provided", formatDate(test.recordedDate)];
          values.forEach((value, i) => doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.ink).text(value, col[i] + 8, rowTop + 8, { width: (col[i + 1] ?? doc.page.width - doc.page.margins.right) - col[i] - 14, ellipsis: true }));
          doc.y = rowTop + 25;
        });
      }
    });

    doc.end();
  });
}
