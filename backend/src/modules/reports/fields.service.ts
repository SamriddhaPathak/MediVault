import { prisma } from "../../config/prisma";
import { reportsService } from "./reports.service";
import { NotFoundError, ValidationError } from "../../utils/errors";

export interface FieldEdit {
  id?: string; // present = update existing, absent = create new
  fieldName: string;
  value: string;
  // `null` means "clear this". Optional fields are sent as null rather than
  // omitted by the review screen, because Prisma treats `undefined` as
  // "leave unchanged" — which previously made it impossible to erase a unit
  // or a reference range once OCR had guessed one.
  normalizedValue?: string | null;
}

export interface TestValueEdit {
  id?: string;
  testName: string;
  numericValue: number;
  unit?: string | null;
  recordedDate: string;
  referenceRangeText?: string | null;
}

// Normalizes an optional text field to `null` (clear) instead of `undefined`
// (no-op), so an emptied input actually clears the stored value.
function clearable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Manual entry on a report whose OCR failed is a supported path: once the
// user supplies any detail, the report is no longer "unreadable", it is
// awaiting their review — and it must leave OCR_FAILED so it can be verified.
async function promoteFromOcrFailed(reportId: string) {
  await prisma.report.updateMany({
    where: { id: reportId, status: "OCR_FAILED" },
    data: { status: "PENDING_REVIEW", failureReason: null },
  });
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

        const nextNormalized = clearable(edit.normalizedValue);
        const changed =
          existing.value !== edit.value || nextNormalized !== (existing.normalizedValue ?? null);

        results.push(
          await prisma.extractedField.update({
            where: { id: edit.id },
            data: changed
              ? { value: edit.value, normalizedValue: nextNormalized, source: "user", confidence: 1 }
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
              normalizedValue: clearable(edit.normalizedValue),
              confidence: 1,
              source: "user",
            },
          })
        );
      }
    }
    if (edits.length > 0) {
      await prisma.report.update({ where: { id: reportId }, data: { editedByUser: true } });
      await promoteFromOcrFailed(reportId);
    }
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
      // An unparseable date would otherwise reach Prisma as `Invalid Date`
      // and fail deep in the driver with an opaque error.
      if (Number.isNaN(recordedDate.getTime())) {
        throw new ValidationError(`Enter a valid date for "${edit.testName}".`);
      }

      const nextUnit = clearable(edit.unit);
      const nextReferenceRange = clearable(edit.referenceRangeText);

      if (edit.id) {
        const existing = await prisma.testValue.findFirst({ where: { id: edit.id, reportId } });
        if (!existing) throw new NotFoundError("Test value not found.");

        const changed =
          existing.testName !== edit.testName ||
          existing.numericValue !== edit.numericValue ||
          (existing.unit ?? null) !== nextUnit ||
          existing.recordedDate.getTime() !== recordedDate.getTime() ||
          (existing.referenceRangeText ?? null) !== nextReferenceRange;

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
              unit: nextUnit,
              recordedDate,
              referenceRangeText: nextReferenceRange,
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
              unit: nextUnit,
              recordedDate,
              referenceRangeText: nextReferenceRange,
              source: "user",
              confidence: null,
            },
          })
        );
      }
    }
    if (anyChanged) {
      await prisma.report.update({ where: { id: reportId }, data: { editedByUser: true } });
      await promoteFromOcrFailed(reportId);
    }
    return results;
  },

  async deleteTestValue(reportId: string, ownerId: string, testValueId: string) {
    await reportsService.getOwned(reportId, ownerId);
    const existing = await prisma.testValue.findFirst({ where: { id: testValueId, reportId } });
    if (!existing) throw new NotFoundError("Test value not found.");
    await prisma.testValue.delete({ where: { id: testValueId } });
  },
};
