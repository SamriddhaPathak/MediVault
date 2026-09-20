import { ReportCategory } from "../../types/enums";

/**
 * Transparent, rule-based extraction (per spec, no ML classifier in V1).
 * Every result here is provisional and MUST remain user-editable — this
 * module never writes directly to the DB, it only proposes values.
 */

export interface ParsedTestValue {
  testName: string;
  numericValue: number;
  unit?: string;
  referenceRangeText?: string;
  recordedDate?: string;
  confidence: number; // 0-1
}

export interface ParsedDate {
  value: string; // ISO date
  confidence: number;
  kind?: "report" | "collection" | "performed" | "issued" | "birth" | "other";
}

export interface ParsedMedicalField {
  fieldName: string;
  value: string;
  normalizedValue?: string;
  confidence: number; // 0-1
}

const CATEGORY_KEYWORDS: Record<ReportCategory, string[]> = {
  LABORATORY: ["laboratory", "lab report", "pathology", "blood test", "cbc", "hemoglobin", "glucose"],
  PRESCRIPTION: ["prescription", "rx", "dosage", "tablet", "capsule", "sig:", "refill"],
  RADIOLOGY: ["radiology", "x-ray", "xray", "ct scan", "mri", "ultrasound", "sonography"],
  IMAGING: ["imaging", "scan report", "impression:", "findings:"],
  VACCINATION: ["vaccination", "vaccine", "immunization", "dose 1", "dose 2", "booster"],
  OTHER: [],
};

export function categorize(text: string): { category: ReportCategory; confidence: number } {
  const lower = text.toLowerCase();
  let best: ReportCategory = "OTHER";
  let bestHits = 0;

  (Object.keys(CATEGORY_KEYWORDS) as ReportCategory[]).forEach((cat) => {
    if (cat === "OTHER") return;
    const hits = CATEGORY_KEYWORDS[cat].filter((kw) => lower.includes(kw)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = cat;
    }
  });

  const confidence = bestHits === 0 ? 0.3 : Math.min(0.95, 0.5 + bestHits * 0.15);
  return { category: best, confidence };
}

const DATE_PATTERNS: { regex: RegExp; toISO: (m: RegExpMatchArray) => string | null }[] = [
  {
    regex: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g,
    toISO: (m) => `${m[1]}-${m[2]}-${m[3]}`,
  },
  {
    regex: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g,
    toISO: (m) => {
      const first = Number(m[1]);
      const second = Number(m[2]);
      // Prefer month/day for ambiguous US-style dates, but switch to
      // day/month when the first component cannot be a month.
      const month = first > 12 ? second : first;
      const day = first > 12 ? first : second;
      return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    },
  },
  {
    regex: /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/gi,
    toISO: (m) => isoFromMonthName(m[2], m[1], m[3]),
  },
  {
    regex: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/gi,
    toISO: (m) => isoFromMonthName(m[1], m[2], m[3]),
  },
];

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function isoFromMonthName(monthStr: string, dayStr: string, yearStr: string): string | null {
  const key = monthStr.slice(0, 3).toLowerCase();
  const mm = MONTHS[key];
  if (!mm) return null;
  const dd = dayStr.padStart(2, "0");
  return `${yearStr}-${mm}-${dd}`;
}

function isValidISODate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateKind(context: string): ParsedDate["kind"] {
  const lower = context.toLowerCase();
  if (/date\s+of\s+(birth|dob)|\bbirth\b/.test(lower)) return "birth";
  if (/collect|specimen|sample|drawn/.test(lower)) return "collection";
  if (/perform|exam|study|service/.test(lower)) return "performed";
  if (/issu|released|printed/.test(lower)) return "issued";
  if (/report\s+date|visit|admission|encounter/.test(lower)) return "report";
  return "other";
}

export function extractDates(text: string): ParsedDate[] {
  const results: ParsedDate[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const parts = Array.from(match);
      const iso = pattern.toISO(parts as RegExpMatchArray);
      if (iso && isValidISODate(iso)) {
        const start = match.index ?? 0;
        const lineStart = text.lastIndexOf("\n", start - 1) + 1;
        const lineEndIndex = text.indexOf("\n", start + match[0].length);
        const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
        const context = text.slice(lineStart, lineEnd);
        results.push({ value: iso, confidence: dateKind(context) === "other" ? 0.58 : 0.78, kind: dateKind(context) });
      }
    }
  }
  return results.filter((date, index, all) => all.findIndex((candidate) => candidate.value === date.value && candidate.kind === date.kind) === index);
}

function bestDateForText(text: string): string | undefined {
  const dates = extractDates(text);
  return dates.find((date) => date.kind === "collection" || date.kind === "performed" || date.kind === "report")?.value ?? dates.find((date) => date.kind !== "birth")?.value;
}

function removeDateTokens(text: string): string {
  return DATE_PATTERNS.reduce((current, pattern) => current.replace(pattern.regex, " "), text).replace(/[ \t]+/g, " ").trim();
}

const FIELD_LABELS: Array<{ fieldName: string; labels: string[] }> = [
  { fieldName: "patientId", labels: ["patient id", "patient no", "patient number", "mrn", "medical record number"] },
  { fieldName: "patientName", labels: ["patient name", "name of patient"] },
  { fieldName: "patientAge", labels: ["age", "patient age"] },
  { fieldName: "sex", labels: ["sex", "gender"] },
  { fieldName: "symptoms", labels: ["symptoms", "presenting symptoms", "chief complaint", "complaint", "reason for visit"] },
  { fieldName: "diagnosis", labels: ["diagnosis", "clinical diagnosis", "impression", "assessment"] },
  { fieldName: "treatment", labels: ["treatment", "treatment plan", "management", "plan", "recommendations"] },
  { fieldName: "medications", labels: ["medications", "medication", "prescription", "current medicines", "drug"] },
  { fieldName: "allergies", labels: ["allergies", "drug allergies", "known allergies"] },
  { fieldName: "doctor", labels: ["doctor", "physician", "consultant", "attending"] },
  { fieldName: "facility", labels: ["hospital", "clinic", "facility", "laboratory", "lab"] },
];

const VITAL_LABELS: Array<{ fieldName: string; labels: string[]; pattern: RegExp }> = [
  { fieldName: "vital.bloodPressure", labels: ["blood pressure", "bp"], pattern: /\b(\d{2,3})\s*[/|]\s*(\d{2,3})\s*(?:mm\s*hg)?\b/i },
  { fieldName: "vital.heartRate", labels: ["heart rate", "pulse", "hr"], pattern: /\b(\d{2,3})\s*(?:bpm|beats?\s*(?:per|\/)\s*min(?:ute)?)\b/i },
  { fieldName: "vital.temperature", labels: ["temperature", "temp"], pattern: /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:°?\s*[cf])\b/i },
  { fieldName: "vital.respiratoryRate", labels: ["respiratory rate", "resp rate", "rr"], pattern: /\b(\d{1,2})\s*(?:breaths?\s*(?:per|\/)\s*min(?:ute)?|\/min)\b/i },
  { fieldName: "vital.oxygenSaturation", labels: ["oxygen saturation", "spo2", "o2 saturation"], pattern: /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*%/i },
  { fieldName: "vital.weight", labels: ["weight"], pattern: /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(kg|kgs?|lb|lbs?)\b/i },
  { fieldName: "vital.height", labels: ["height"], pattern: /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(cm|centimeters?|in|inches?)\b/i },
];

const SECTION_BOUNDARY = /^(?:patient details?|demographics?|vitals?|vital signs?|symptoms?|chief complaint|diagnosis|assessment|impression|treatment|management|plan|medications?|prescription|allergies?|history|findings?|observations?|recommendations?)\s*[:\-]?\s*$/i;

function cleanFieldValue(value: string): string {
  return value
    .replace(/^[\s:;|\-]+|[\s;|]+$/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function labelMatches(line: string, labels: string[]): boolean {
  const lower = line.toLowerCase();
  return labels.some((label) => lower === label || lower.startsWith(`${label}:`) || lower.startsWith(`${label} -`));
}

function valueAfterLabel(line: string, labels: string[]): string | null {
  for (const label of [...labels].sort((left, right) => right.length - left.length)) {
    const match = line.match(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?::|-)?\\s*(.+)$`, "i"));
    if (match?.[1]) return cleanFieldValue(match[1]);
  }
  return null;
}

/**
 * Extracts clinical context as editable fields. This deliberately uses
 * labelled lines and bounded sections instead of guessing from free prose;
 * a wrong diagnosis is more harmful than leaving a field for review.
 */
export function extractMedicalFields(text: string): ParsedMedicalField[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => cleanFieldValue(line))
    .filter(Boolean);
  const results: ParsedMedicalField[] = [];
  const seen = new Set<string>();

  const add = (fieldName: string, value: string, confidence: number, normalizedValue?: string) => {
    const cleaned = cleanFieldValue(value);
    if (cleaned.length < 2 || cleaned.length > 1000) return;
    const key = `${fieldName}:${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ fieldName, value: cleaned, confidence, normalizedValue });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const definition of FIELD_LABELS) {
      const inlineValue = valueAfterLabel(line, definition.labels);
      if (inlineValue) add(definition.fieldName, inlineValue, 0.82);
      else if (labelMatches(line, definition.labels)) {
        const sectionLines: string[] = [];
        for (let next = index + 1; next < Math.min(lines.length, index + 5); next += 1) {
          if (SECTION_BOUNDARY.test(lines[next]) || valueAfterLabel(lines[next], FIELD_LABELS.flatMap((item) => item.labels))) break;
          sectionLines.push(lines[next]);
        }
        if (sectionLines.length) add(definition.fieldName, sectionLines.join(" "), 0.68);
      }
    }

    for (const definition of VITAL_LABELS) {
      if (!labelMatches(line, definition.labels) && !definition.labels.some((label) => line.toLowerCase().includes(`${label}:`))) continue;
      const match = line.match(definition.pattern);
      if (!match) continue;
      const value = match[0].replace(/[|]/g, "/").replace(/,/g, ".");
      add(definition.fieldName, value, 0.88, value);
    }
  }

  return results;
}

/**
 * Corrects the specific OCR digit-confusions that show up constantly in
 * printed medical reports: capital "I"/"l"/"|" read as "1", "O" read as
 * "0", "S" read as "5", "B" read as "8" — but ONLY inside a token that is
 * otherwise numeric, so we don't mangle real words. Applied to a single
 * whitespace-delimited "value token" candidate before parseFloat, e.g.
 * "I2.5" -> "12.5", "9O" -> "90", but "IU/L" (a unit, all letters) is left
 * untouched because it has no digit to anchor the correction against.
 */
function correctOcrDigitConfusion(token: string): string {
  if (!/\d/.test(token)) return token; // no digit anchor — don't touch pure-letter tokens like units
  return token
    .replace(/[Il|](?=\d|\.\d)/g, "1") // leading I/l/| before a digit
    .replace(/(?<=\d)[Il|]/g, "1") // trailing I/l/| after a digit
    .replace(/O/g, "0")
    .replace(/(?<=\d)S(?=\d|$)/g, "5")
    .replace(/(?<=\d)B(?=\d|$)/g, "8");
}

function normalizeOcrNumber(token: string): string {
  const value = token.trim();
  if (value.includes(",") && !value.includes(".")) {
    const parts = value.split(",");
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1) return parts.join("");
    return parts.join(".");
  }
  return value.replace(/,/g, "");
}

function normalizeTestName(name: string): string {
  return name
    .replace(/^[#*•\-\s]+|[\s:]+$/g, "")
    .replace(/[._]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const NON_TEST_LABELS = new Set([
  "patient",
  "patient id",
  "patient age",
  "age",
  "sex",
  "gender",
  "symptoms",
  "diagnosis",
  "assessment",
  "impression",
  "treatment",
  "treatment plan",
  "medications",
  "medication",
  "allergies",
  "doctor",
  "physician",
  "hospital",
  "clinic",
  "blood pressure",
  "bp",
  "pulse",
  "heart rate",
  "temperature",
  "respiratory rate",
  "oxygen saturation",
  "spo2",
]);

// Matches lines like "Hemoglobin 13.5 g/dL" or "Glucose: 95 mg/dL (70-110)"
const TEST_VALUE_REGEX =
  /^([A-Za-z][A-Za-z0-9 /()%._#-]{1,50}?)[\s:]{1,3}([-+]?[\dOISBl|]+(?:[.,][\dOISBl|]+)?)\s*([A-Za-z%\/µμ^0-9-]{0,15})\s*(?:\(?\s*(?:ref(?:erence)?\s*(?:range)?|normal|参考)?[:\s]*([<>]?\s*[\dOISBl|.,]+\s*(?:[-–]|to)\s*[<>]?\s*[\dOISBl|.,]+)\s*\)?)?\s*$/i;

const VALUE_RANGE_UNIT_REGEX =
  /^([A-Za-z][A-Za-z0-9 /()%._#-]{1,50}?)\s+([-+]?[\dOISBl|]+(?:[.,][\dOISBl|]+)?)\s+([<>]?\s*[\dOISBl|.,]+\s*(?:[-–]|to)\s*[<>]?\s*[\dOISBl|.,]+)\s+([A-Za-z%\/µμ^0-9-]{1,15})$/i;

const UNIT_VALUE_RANGE_REGEX =
  /^([A-Za-z][A-Za-z0-9 /()%._#-]{1,50}?)\s+([A-Za-z%\/µμ^0-9-]{1,15})\s+([-+]?[\dOISBl|]+(?:[.,][\dOISBl|]+)?)\s+([<>]?\s*[\dOISBl|.,]+\s*(?:[-–]|to)\s*[<>]?\s*[\dOISBl|.,]+)$/i;

export function extractTestValues(text: string): ParsedTestValue[] {
  const linesWithSource = text
    .split(/\r?\n/)
    .map((rawLine) => ({ rawLine, line: rawLine.replace(/[|¦]/g, " ").replace(/[ \t]+/g, " ").trim() }))
    .filter((entry) => Boolean(entry.line));
  const lines = linesWithSource.map((entry) => entry.line);
  const results: ParsedTestValue[] = [];

  function parseLine(line: string, confidenceBoost = 0): ParsedTestValue | null {
    if (!line || line.length > 160) return null;
    const recordedDate = bestDateForText(line);
    const normalizedLine = removeDateTokens(line)
      .replace(/(?<![A-Za-z\/])(?:high|low|normal|abnormal|critical|positive|negative|[HL])\b/gi, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    const directMatch = normalizedLine.match(TEST_VALUE_REGEX);
    const rangeAfterValue = normalizedLine.match(VALUE_RANGE_UNIT_REGEX);
    const unitBeforeValue = normalizedLine.match(UNIT_VALUE_RANGE_REGEX);
    const match = unitBeforeValue ?? rangeAfterValue ?? directMatch;
    if (!match) return null;

    const [, nameRaw, firstValue, firstUnitOrRange, fourthValue] = match;
    const rangeFirst = Boolean(rangeAfterValue);
    const unitFirst = Boolean(unitBeforeValue);
    const valueRaw = unitFirst ? firstUnitOrRange : firstValue;
    const unitRaw = unitFirst ? firstValue : rangeFirst ? fourthValue : firstUnitOrRange;
    const refRangeRaw = unitFirst || rangeFirst ? (unitFirst ? fourthValue : firstUnitOrRange) : fourthValue;
    const testName = normalizeTestName(nameRaw);
    if (testName.length < 2 || NON_TEST_LABELS.has(testName.toLowerCase())) return null;

    const correctedValueRaw = normalizeOcrNumber(correctOcrDigitConfusion(valueRaw));
    const numericValue = Number.parseFloat(correctedValueRaw);
    if (!Number.isFinite(numericValue) || Math.abs(numericValue) > 1_000_000_000) return null;

    // Confidence reflects how much we had to infer: an explicit unit and a
    // clean (uncorrected) numeric token both raise confidence; a
    // digit-confusion correction lowers it since the value is a guess.
    const wasCorrected = correctedValueRaw !== valueRaw;
    let confidence = unitRaw ? 0.75 : 0.55;
    if (wasCorrected) confidence -= 0.2;

    return {
      testName,
      numericValue,
      unit: unitRaw ? unitRaw.trim() : undefined,
      referenceRangeText: refRangeRaw ? refRangeRaw.replace(/\s+/g, "").replace(/to/i, "-") : undefined,
      recordedDate,
      confidence: Math.max(0.2, Math.min(0.95, confidence + confidenceBoost)),
    };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = linesWithSource[index]?.rawLine ?? "";
    const tableCells = rawLine.split(/[|¦]/).map((cell) => cell.trim()).filter(Boolean);
    if (tableCells.length >= 3) {
      const tableValueIndex = tableCells.findIndex((cell) => /^[+-]?[\dOISBl|]+(?:[.,][\dOISBl|]+)?$/i.test(cell));
      if (tableValueIndex > 0) {
        const tableName = tableCells[tableValueIndex - 1];
        const tableValue = tableCells[tableValueIndex];
        const trailing = tableCells.slice(tableValueIndex + 1);
        const tableUnit = trailing.find((cell) => /[A-Za-z%µμ]/.test(cell) && !/\d+\s*[-–]\s*\d+/.test(cell));
        const tableRange = trailing.find((cell) => /\d+\s*[-–]\s*\d+|\d+\s+to\s+\d+/i.test(cell));
        const tableLine = `${tableName} ${tableValue} ${tableUnit ?? ""}${tableRange ? ` (${tableRange})` : ""}`;
        const tableResult = parseLine(tableLine, 0.02);
        if (tableResult) results.push(tableResult);
      }
    }

    const direct = parseLine(lines[index]);
    if (direct) results.push(direct);

    // Tesseract may place a label, value, and unit on separate rows. Join a
    // small window only when the direct row did not already yield a value.
    if (!direct && !/\d/.test(lines[index])) {
      let bestJoined: ParsedTestValue | null = null;
      for (let width = 2; width <= 3 && index + width <= lines.length; width += 1) {
        const joined = parseLine(lines.slice(index, index + width).join(" "), -0.08);
        if (joined && (!bestJoined || (joined.unit ? 1 : 0) > (bestJoined.unit ? 1 : 0))) bestJoined = joined;
      }
      if (bestJoined) results.push(bestJoined);
    }
  }

  return results.filter((value, index, all) => {
    const key = `${value.testName.toLowerCase()}|${value.numericValue}|${value.unit?.toLowerCase() ?? ""}|${value.referenceRangeText ?? ""}`;
    return all.findIndex((candidate) => `${candidate.testName.toLowerCase()}|${candidate.numericValue}|${candidate.unit?.toLowerCase() ?? ""}|${candidate.referenceRangeText ?? ""}` === key) === index;
  });
}
