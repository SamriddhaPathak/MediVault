import { prisma } from "../../config/prisma";
import { reportsService } from "./reports.service";
import { NotFoundError } from "../../utils/errors";

export interface FieldEdit {
  id?: string; // present = update existing, absent = create new
  fieldName: string;
  value: string;
  normalizedValue?: string;
}

export interface TestValueEdit {
  id?: string;
  testName: string;
  numericValue: number;
  unit?: string;
  recordedDate: string;
  referenceRangeText?: string;
}

export const fieldsService = {
  async list(reportId: string, ownerId: string) {
    await reportsService.getOwned(reportId, ownerId);
    return prisma.extractedField.findMany({ where: { reportId }, orderBy: { createdAt: "asc" } });
  },

  // Applies user corrections. A field is only re-stamped source="user" if
  // its value actually changed — the review screen re-submits every field
  // on every "Save Changes" click, so without this check, simply opening
  // and saving a report with no edits would silently overwrite every
  // OCR-sourced field's provenance, destroying the OCR-vs-user distinction
  // the app promises to preserve.
  async applyFieldEdits(reportId: string, ownerId: string, edits: FieldEdit[]) {
    await reportsService.getOwned(reportId, ownerId);

    const results = [];
    for (const edit of edits) {
      if (edit.id) {
        const existing = await prisma.extractedField.findFirst({ where: { id: edit.id, reportId } });
        if (!existing) throw new NotFoundError("Field not found.");

        const changed =
          existing.value !== edit.value || (edit.normalizedValue ?? null) !== (existing.normalizedValue ?? null);

        results.push(
          await prisma.extractedField.update({
            where: { id: edit.id },
            data: changed
              ? { value: edit.value, normalizedValue: edit.normalizedValue, source: "user", confidence: 1 }
              : {},
          })
        );
      } else {
        results.push(
          await prisma.extractedField.create({
            data: {
              reportId,
              fieldName: edit.fieldName,
              value: edit.value,
              normalizedValue: edit.normalizedValue,
              confidence: 1,
              source: "user",
            },
          })
        );
      }
    }
    if (edits.length > 0) await prisma.report.update({ where: { id: reportId }, data: { editedByUser: true } });
    return results;
  },

  async deleteField(reportId: string, ownerId: string, fieldId: string) {
    await reportsService.getOwned(reportId, ownerId);
    const existing = await prisma.extractedField.findFirst({ where: { id: fieldId, reportId } });
    if (!existing) throw new NotFoundError("Field not found.");
    await prisma.extractedField.delete({ where: { id: fieldId } });
  },

  async applyTestValueEdits(reportId: string, ownerId: string, edits: TestValueEdit[]) {
    await reportsService.getOwned(reportId, ownerId);

    const results = [];
    let anyChanged = false;

    for (const edit of edits) {
      const recordedDate = new Date(edit.recordedDate);

      if (edit.id) {
        const existing = await prisma.testValue.findFirst({ where: { id: edit.id, reportId } });
        if (!existing) throw new NotFoundError("Test value not found.");

        const changed =
          existing.testName !== edit.testName ||
          existing.numericValue !== edit.numericValue ||
          (existing.unit ?? null) !== (edit.unit ?? null) ||
          existing.recordedDate.getTime() !== recordedDate.getTime() ||
          (existing.referenceRangeText ?? null) !== (edit.referenceRangeText ?? null);

        if (!changed) {
          results.push(existing);
          continue;
        }

        anyChanged = true;
        results.push(
          await prisma.testValue.update({
            where: { id: edit.id },
            data: {
              testName: edit.testName,
              numericValue: edit.numericValue,
              unit: edit.unit,
              recordedDate,
              referenceRangeText: edit.referenceRangeText,
              source: "user",
              confidence: null, // a value the user typed carries no OCR uncertainty
            },
          })
        );
      } else {
        anyChanged = true;
        results.push(
          await prisma.testValue.create({
            data: {
              reportId,
              testName: edit.testName,
              numericValue: edit.numericValue,
              unit: edit.unit,
              recordedDate,
              referenceRangeText: edit.referenceRangeText,
              source: "user",
              confidence: null,
            },
          })
        );
      }
    }
    if (anyChanged) await prisma.report.update({ where: { id: reportId }, data: { editedByUser: true } });
    return results;
  },

  async deleteTestValue(reportId: string, ownerId: string, testValueId: string) {
    await reportsService.getOwned(reportId, ownerId);
    const existing = await prisma.testValue.findFirst({ where: { id: testValueId, reportId } });
    if (!existing) throw new NotFoundError("Test value not found.");
    await prisma.testValue.delete({ where: { id: testValueId } });
  },
};
