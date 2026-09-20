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

// Each keyword carries a weight: highly specific, single-meaning terms
// (a named modality like "mri", a named test like "hemoglobin") outweigh
// generic terms that multiple categories could plausibly share
// ("findings:", "report") so a document that mixes vocabulary still lands
// on the more specific category instead of whichever list is longest.
const CATEGORY_KEYWORDS: Record<ReportCategory, Array<{ term: string; weight: number }>> = {
  LABORATORY: [
    { term: "laboratory", weight: 2 },
    { term: "lab report", weight: 2 },
    { term: "pathology", weight: 2 },
    { term: "blood test", weight: 2 },
    { term: "cbc", weight: 2 },
    { term: "complete blood count", weight: 2 },
    { term: "hemoglobin", weight: 1.5 },
    { term: "hematology", weight: 1.5 },
    { term: "biochemistry", weight: 1.5 },
    { term: "glucose", weight: 1 },
    { term: "specimen", weight: 1 },
    { term: "reference range", weight: 1 },
    { term: "serology", weight: 1.5 },
    { term: "urinalysis", weight: 1.5 },
    { term: "lipid profile", weight: 1.5 },
    { term: "liver function", weight: 1.5 },
    { term: "kidney function", weight: 1.5 },
    { term: "thyroid panel", weight: 1.5 },
  ],
  PRESCRIPTION: [
    { term: "prescription", weight: 2 },
    { term: "rx", weight: 1 },
    { term: "dosage", weight: 1 },
    { term: "tablet", weight: 1 },
    { term: "capsule", weight: 1 },
    { term: "sig:", weight: 1.5 },
    { term: "refill", weight: 1.5 },
    { term: "pharmacy", weight: 1.5 },
    { term: "take as directed", weight: 1.5 },
    { term: "twice daily", weight: 1 },
    { term: "once daily", weight: 1 },
    { term: "dispense", weight: 1.5 },
  ],
  RADIOLOGY: [
    { term: "radiology", weight: 2 },
    { term: "radiologist", weight: 2 },
    { term: "x-ray", weight: 2 },
    { term: "xray", weight: 2 },
    { term: "ct scan", weight: 2 },
    { term: "computed tomography", weight: 2 },
    { term: "mri", weight: 2 },
    { term: "magnetic resonance", weight: 2 },
    { term: "ultrasound", weight: 2 },
    { term: "sonography", weight: 2 },
    { term: "doppler", weight: 1.5 },
    { term: "contrast", weight: 1 },
    { term: "pet scan", weight: 2 },
    { term: "mammogram", weight: 2 },
  ],
  IMAGING: [
    { term: "imaging", weight: 1.5 },
    { term: "scan report", weight: 1.5 },
    { term: "impression:", weight: 1 },
    { term: "findings:", weight: 1 },
    { term: "radiograph", weight: 1.5 },
  ],
  VACCINATION: [
    { term: "vaccination", weight: 2 },
    { term: "vaccine", weight: 2 },
    { term: "immunization", weight: 2 },
    { term: "dose 1", weight: 1.5 },
    { term: "dose 2", weight: 1.5 },
    { term: "booster", weight: 1.5 },
    { term: "batch no", weight: 1 },
    { term: "lot no", weight: 1 },
    { term: "vaccine card", weight: 2 },
    { term: "immunization record", weight: 2 },
  ],
  OTHER: [],
};

// A document's title/header area is by far the strongest signal for what
// kind of document it is (e.g. "LABORATORY REPORT" printed at the top), so
// keyword hits there count extra. Keeps the effect local and cheap — no
// need for real layout analysis, just the first few lines of OCR text.
const TITLE_WINDOW_CHARS = 200;
const TITLE_BOOST_MULTIPLIER = 1.5;

export function categorize(text: string): { category: ReportCategory; confidence: number } {
  const lower = text.toLowerCase();
  const titleArea = lower.slice(0, TITLE_WINDOW_CHARS);
  let best: ReportCategory = "OTHER";
  let bestScore = 0;
  let bestHitCount = 0;

  (Object.keys(CATEGORY_KEYWORDS) as ReportCategory[]).forEach((cat) => {
    if (cat === "OTHER") return;
    let score = 0;
    let hitCount = 0;
    for (const { term, weight } of CATEGORY_KEYWORDS[cat]) {
      if (!lower.includes(term)) continue;
      hitCount += 1;
      score += titleArea.includes(term) ? weight * TITLE_BOOST_MULTIPLIER : weight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestHitCount = hitCount;
      best = cat;
    }
  });

  const confidence = bestHitCount === 0 ? 0.3 : Math.min(0.97, 0.5 + bestScore * 0.12);
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
    regex: /\b(\d{1,2})[\s-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]+(\d{4})\b/gi,
    toISO: (m) => isoFromMonthName(m[2], m[1], m[3]),
  },
  {
    regex: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]+(\d{1,2}),?[\s-]+(\d{4})\b/gi,
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
  // Set-based dedupe: the previous filter/findIndex pair was quadratic, and
  // a dense document can produce hundreds of date matches.
  const seenDates = new Set<string>();
  return results.filter((date) => {
    const key = `${date.value}|${date.kind}`;
    if (seenDates.has(key)) return false;
    seenDates.add(key);
    return true;
  });
}

function bestDateForText(text: string): string | undefined {
  const dates = extractDates(text);
  return dates.find((date) => date.kind === "collection" || date.kind === "performed" || date.kind === "report")?.value ?? dates.find((date) => date.kind !== "birth")?.value;
}

function removeDateTokens(text: string): string {
  return DATE_PATTERNS.reduce((current, pattern) => current.replace(pattern.regex, " "), text).replace(/[ \t]+/g, " ").trim();
}

const FIELD_LABELS: Array<{ fieldName: string; labels: string[] }> = [
  { fieldName: "patientId", labels: ["patient id", "patient no", "patient number", "mrn", "medical record number", "uhid", "registration no", "registration number"] },
  { fieldName: "patientName", labels: ["patient name", "name of patient", "name"] },
  { fieldName: "patientAge", labels: ["age", "patient age", "age/sex", "age / sex"] },
  { fieldName: "sex", labels: ["sex", "gender"] },
  { fieldName: "bloodGroup", labels: ["blood group", "bloodgroup", "blood type"] },
  { fieldName: "dateOfBirth", labels: ["date of birth", "dob", "birth date"] },
  { fieldName: "contactNumber", labels: ["contact no", "contact number", "phone", "phone no", "mobile", "mobile no", "tel"] },
  { fieldName: "address", labels: ["address", "patient address", "residential address"] },
  { fieldName: "symptoms", labels: ["symptoms", "presenting symptoms", "chief complaint", "complaint", "reason for visit"] },
  { fieldName: "diagnosis", labels: ["diagnosis", "clinical diagnosis", "provisional diagnosis", "impression", "assessment"] },
  { fieldName: "treatment", labels: ["treatment", "treatment plan", "management", "plan", "recommendations", "advice"] },
  { fieldName: "medications", labels: ["medications", "medication", "prescription", "current medicines", "drug", "medicines"] },
  { fieldName: "dosageInstructions", labels: ["sig", "instructions", "directions", "how to take", "take as directed"] },
  { fieldName: "duration", labels: ["duration", "course duration", "treatment duration"] },
  { fieldName: "allergies", labels: ["allergies", "drug allergies", "known allergies"] },
  { fieldName: "doctor", labels: ["doctor", "physician", "consultant", "attending", "referred by", "referring doctor", "referring physician", "ordering physician", "administered by", "vaccinator", "prescribed by"] },
  { fieldName: "facility", labels: ["hospital", "clinic", "facility", "laboratory", "lab", "health center", "healthcare center", "vaccination center", "vaccination centre"] },
  { fieldName: "reportNumber", labels: ["accession no", "accession number", "report no", "report number", "lab no", "lab number", "order no", "order number"] },
  { fieldName: "specimenType", labels: ["specimen type", "sample type", "specimen", "sample"] },
  { fieldName: "vaccineName", labels: ["vaccine name", "vaccine", "immunization type", "vaccine type"] },
  { fieldName: "vaccineBatch", labels: ["batch no", "batch number", "lot no", "lot number"] },
  { fieldName: "doseNumber", labels: ["dose number", "dose no"] },
  { fieldName: "vaccinationSite", labels: ["injection site", "site of injection"] },
  { fieldName: "nextDoseDate", labels: ["next dose date", "next dose due", "due date", "next appointment"] },
];

const VITAL_LABELS: Array<{ fieldName: string; labels: string[]; pattern: RegExp }> = [
  { fieldName: "vital.bloodPressure", labels: ["blood pressure", "bp"], pattern: /\b(\d{2,3})\s*[/|]\s*(\d{2,3})\s*(?:mm\s*hg)?\b/i },
  { fieldName: "vital.heartRate", labels: ["heart rate", "pulse", "hr"], pattern: /\b(\d{2,3})\s*(?:bpm|beats?\s*(?:per|\/)\s*min(?:ute)?)\b/i },
  { fieldName: "vital.temperature", labels: ["temperature", "temp"], pattern: /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:°?\s*[cf])\b/i },
  { fieldName: "vital.respiratoryRate", labels: ["respiratory rate", "resp rate", "rr"], pattern: /\b(\d{1,2})\s*(?:breaths?\s*(?:per|\/)\s*min(?:ute)?|\/min)\b/i },
  { fieldName: "vital.oxygenSaturation", labels: ["oxygen saturation", "spo2", "o2 saturation"], pattern: /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*%/i },
  { fieldName: "vital.weight", labels: ["weight"], pattern: /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(kg|kgs?|lb|lbs?)\b/i },
  { fieldName: "vital.height", labels: ["height"], pattern: /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(cm|centimeters?|in|inches?)\b/i },
  { fieldName: "vital.bmi", labels: ["bmi", "body mass index"], pattern: /\b(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:kg\/m2|kg\/m\^2)?\b/i },
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

// Compiled label matchers are cached and the label list is pre-sorted once.
// Previously a fresh RegExp was constructed for every label, on every line,
// for every field definition — and again for all ~70 labels on each of up
// to five lookahead lines. On a 30-page document that is millions of regex
// compilations, and it showed: extraction time grew super-linearly with
// document length, inside a job that already holds the OCR lane.
const LABEL_PATTERN_CACHE = new Map<string, RegExp>();

function labelPattern(label: string): RegExp {
  let pattern = LABEL_PATTERN_CACHE.get(label);
  if (!pattern) {
    pattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?::|-)?\\s*(.+)$`, "i");
    LABEL_PATTERN_CACHE.set(label, pattern);
  }
  return pattern;
}

const LABELS_BY_LENGTH = new WeakMap<string[], string[]>();

function longestFirst(labels: string[]): string[] {
  let sorted = LABELS_BY_LENGTH.get(labels);
  if (!sorted) {
    sorted = [...labels].sort((left, right) => right.length - left.length);
    LABELS_BY_LENGTH.set(labels, sorted);
  }
  return sorted;
}

// Flattened once at module load rather than rebuilt per lookahead line.
const ALL_FIELD_LABELS: string[] = FIELD_LABELS.flatMap((item) => item.labels);

function valueAfterLabel(line: string, labels: string[]): string | null {
  for (const label of longestFirst(labels)) {
    const match = line.match(labelPattern(label));
    if (match?.[1]) return cleanFieldValue(match[1]);
  }
  return null;
}

/**
 * Extracts clinical context as editable fields. This deliberately uses
 * labelled lines and bounded sections instead of guessing from free prose;
 * a wrong diagnosis is more harmful than leaving a field for review.
 */
// Upper bounds for pathological input. A badly degraded scan can produce
// tens of thousands of short junk lines; without a ceiling the parser
// happily grinds through all of them inside the OCR lane.
const MAX_LINES_TO_SCAN = 20_000;
const MAX_LINE_LENGTH = 400;

export function extractMedicalFields(text: string): ParsedMedicalField[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => cleanFieldValue(line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line))
    .filter(Boolean)
    .slice(0, MAX_LINES_TO_SCAN);
  const results: ParsedMedicalField[] = [];
  const seen = new Set<string>();

  const add = (fieldName: string, value: string, confidence: number, normalizedValue?: string) => {
    const cleaned = cleanFieldValue(value);
    // A minimum length of 2 silently dropped perfectly valid single-character
    // values — "Sex: M", "Dose Number: 2" — treating real extracted data as
    // noise. Only reject a truly empty value; anything the label matched is
    // worth surfacing for the user to confirm.
    if (cleaned.length < 1 || cleaned.length > 1000) return;
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
          if (SECTION_BOUNDARY.test(lines[next]) || valueAfterLabel(lines[next], ALL_FIELD_LABELS)) break;
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
    .replace(/[Oo]/g, "0") // capital and lowercase O both commonly misread for zero
    .replace(/(?<=\d)S(?=[\d.]|$)/g, "5")
    .replace(/(?<=\d)s(?=[\d.]|$)/g, "5")
    .replace(/(?<=\d)B(?=[\d.]|$)/g, "8")
    .replace(/(?<=\d)Z(?=[\d.]|$)/g, "2")
    .replace(/(?<=\d)z(?=[\d.]|$)/g, "2");
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
  "bmi",
  "blood group",
  "date of birth",
  "dob",
  "contact no",
  "contact number",
  "phone",
  "mobile",
  "address",
  "dose number",
  "dose no",
  "batch no",
  "batch number",
  "lot no",
  "lot number",
  "report no",
  "report number",
  "accession no",
  "accession number",
  "duration",
]);

// Matches lines like "Hemoglobin 13.5 g/dL" or "Glucose: 95 mg/dL (70-110)"
const TEST_VALUE_REGEX =
  /^([A-Za-z][A-Za-z0-9 /()%._#-]{1,50}?)[\s:]{1,3}([-+]?[\dOISBlZ|]+(?:[.,][\dOISBlZ|]+)?)\s*([A-Za-z%\/µμ^0-9-]{0,15})\s*(?:\(?\s*(?:ref(?:erence)?\s*(?:range)?|normal|参考)?[:\s]*([<>]?\s*[\dOISBlZ|.,]+\s*(?:[-–]|to)\s*[<>]?\s*[\dOISBlZ|.,]+)\s*\)?)?\s*$/i;

const VALUE_RANGE_UNIT_REGEX =
  /^([A-Za-z][A-Za-z0-9 /()%._#-]{1,50}?)\s+([-+]?[\dOISBlZ|]+(?:[.,][\dOISBlZ|]+)?)\s+([<>]?\s*[\dOISBlZ|.,]+\s*(?:[-–]|to)\s*[<>]?\s*[\dOISBlZ|.,]+)\s+([A-Za-z%\/µμ^0-9-]{1,15})$/i;

const UNIT_VALUE_RANGE_REGEX =
  /^([A-Za-z][A-Za-z0-9 /()%._#-]{1,50}?)\s+([A-Za-z%\/µμ^0-9-]{1,15})\s+([-+]?[\dOISBlZ|]+(?:[.,][\dOISBlZ|]+)?)\s+([<>]?\s*[\dOISBlZ|.,]+\s*(?:[-–]|to)\s*[<>]?\s*[\dOISBlZ|.,]+)$/i;

export function extractTestValues(text: string): ParsedTestValue[] {
  const linesWithSource = text
    .split(/\r?\n/)
    .slice(0, MAX_LINES_TO_SCAN)
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
      const tableValueIndex = tableCells.findIndex((cell) => /^[+-]?[\dOISBlZ|]+(?:[.,][\dOISBlZ|]+)?$/i.test(cell));
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
    // small window only when the direct row did not already yield a value
    // AND the very next line does not already parse as a complete, valid
    // test entry on its own — otherwise a preceding title/header line (e.g.
    // a "Laboratory Report" caption sitting above "Hemoglobin 13.5 g/dL")
    // gets wrongly fused into the test name of the line below it, producing
    // a bogus duplicate entry alongside the correct one.
    if (!direct && !/\d/.test(lines[index])) {
      const nextLineAlone = index + 1 < lines.length ? parseLine(lines[index + 1]) : null;
      if (!nextLineAlone) {
        let bestJoined: ParsedTestValue | null = null;
        for (let width = 2; width <= 3 && index + width <= lines.length; width += 1) {
          const joined = parseLine(lines.slice(index, index + width).join(" "), -0.08);
          if (joined && (!bestJoined || (joined.unit ? 1 : 0) > (bestJoined.unit ? 1 : 0))) bestJoined = joined;
        }
        if (bestJoined) results.push(bestJoined);
      }
    }
  }

  // Set-based dedupe. The previous filter/findIndex pair rebuilt the key for
  // every pair of results — quadratic in the number of extracted values, and
  // a noisy multi-page scan is exactly where that count explodes.
  const seenValues = new Set<string>();
  return results.filter((value) => {
    const key = `${value.testName.toLowerCase()}|${value.numericValue}|${value.unit?.toLowerCase() ?? ""}|${value.referenceRangeText ?? ""}`;
    if (seenValues.has(key)) return false;
    seenValues.add(key);
    return true;
  });
}
