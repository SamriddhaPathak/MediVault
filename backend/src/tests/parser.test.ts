import { categorize, extractDates, extractMedicalFields, extractTestValues } from "../modules/ocr/parser";

describe("OCR parser — digit-confusion correction", () => {
  it("corrects a leading capital-I misread as a digit (I2.5 -> 12.5)", () => {
    const values = extractTestValues("Hemoglobin I2.5 g/dL");
    expect(values).toHaveLength(1);
    expect(values[0].numericValue).toBe(12.5);
    expect(values[0].unit).toBe("g/dL");
  });

  it("corrects a letter-O misread as zero (9O -> 90)", () => {
    const values = extractTestValues("Glucose 9O mg/dL");
    expect(values[0].numericValue).toBe(90);
  });

  it("does not mangle a pure-letter unit with no digit anchor", () => {
    const values = extractTestValues("Insulin 14 IU/L");
    expect(values[0].unit).toBe("IU/L");
  });

  it("lowers confidence when a digit correction was applied", () => {
    const clean = extractTestValues("Glucose 95 mg/dL")[0];
    const corrected = extractTestValues("Glucose 9S mg/dL")[0];
    expect(corrected.confidence).toBeLessThan(clean.confidence);
  });

  it("does not misparse a plain value like 12.5 into 125", () => {
    const values = extractTestValues("Potassium 12.5 mmol/L");
    expect(values[0].numericValue).toBe(12.5);
  });

  it("handles OCR table separators", () => {
    const values = extractTestValues("Hemoglobin | 13.5 | g/dL");
    expect(values[0].numericValue).toBe(13.5);
    expect(values[0].unit).toBe("g/dL");
  });

  it("handles decimal commas", () => {
    const values = extractTestValues("Creatinine 1,2 mg/dL");
    expect(values[0].numericValue).toBe(1.2);
  });

  it("preserves thousands-separated values", () => {
    const values = extractTestValues("Platelets 1,234 /uL");
    expect(values[0].numericValue).toBe(1234);
  });

  it("supports reference ranges without parentheses", () => {
    const values = extractTestValues("Glucose: 95 mg/dL 70 to 110");
    expect(values[0].referenceRangeText).toBe("70-110");
  });

  it("does not store patient or vital labels as laboratory tests", () => {
    const values = extractTestValues("Patient Age 47\nBlood Pressure 128/82\nTemperature 37.2 C");
    expect(values).toHaveLength(0);
  });

  it("deduplicates repeated OCR rows", () => {
    const values = extractTestValues("Glucose 95 mg/dL\nGlucose 95 mg/dL");
    expect(values).toHaveLength(1);
  });

  it("joins a test name, value, and unit split across OCR lines", () => {
    const values = extractTestValues("Hemoglobin\n13.5\ng/dL");
    expect(values[0]).toEqual(expect.objectContaining({ testName: "Hemoglobin", numericValue: 13.5, unit: "g/dL" }));
  });

  it("extracts a value from a table row with a trailing reference column", () => {
    const values = extractTestValues("WBC | 5.2 | 4.0-11.0 | x10^3/uL");
    expect(values[0]).toEqual(expect.objectContaining({ testName: "WBC", numericValue: 5.2, unit: "x10^3/uL" }));
    expect(values[0].referenceRangeText).toBe("4.0-11.0");
  });

  it("supports value, reference range, then unit column order", () => {
    const values = extractTestValues("WBC 5.2 4.0-11.0 x10^3/uL");
    expect(values[0]).toEqual(expect.objectContaining({ testName: "WBC", numericValue: 5.2, unit: "x10^3/uL", referenceRangeText: "4.0-11.0" }));
  });

  it("supports unit, value, then reference range column order", () => {
    const values = extractTestValues("Hemoglobin g/dL 13.5 12-16");
    expect(values[0]).toEqual(expect.objectContaining({ testName: "Hemoglobin", numericValue: 13.5, unit: "g/dL", referenceRangeText: "12-16" }));
  });

  it("ignores trailing high or low flags", () => {
    const values = extractTestValues("Glucose 145 mg/dL HIGH");
    expect(values[0]).toEqual(expect.objectContaining({ testName: "Glucose", numericValue: 145, unit: "mg/dL" }));
  });
});

describe("OCR parser — reference range extraction", () => {
  it("extracts a reference range appended after the unit", () => {
    const values = extractTestValues("Glucose 95 mg/dL (70-110)");
    expect(values[0].referenceRangeText).toBe("70-110");
  });
});

describe("OCR parser — structured clinical fields", () => {
  it("extracts identity, symptoms, diagnosis, and treatment separately from test values", () => {
    const fields = extractMedicalFields(
      [
        "Patient ID: MRN-2048",
        "Patient Age: 47",
        "Symptoms: fatigue and shortness of breath",
        "Diagnosis: iron deficiency anemia",
        "Treatment Plan: oral iron and follow-up in 4 weeks",
        "Hemoglobin 9.8 g/dL",
      ].join("\n")
    );

    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: "patientId", value: "MRN-2048" }),
      expect.objectContaining({ fieldName: "patientAge", value: "47" }),
      expect.objectContaining({ fieldName: "symptoms", value: "fatigue and shortness of breath" }),
      expect.objectContaining({ fieldName: "diagnosis", value: "iron deficiency anemia" }),
      expect.objectContaining({ fieldName: "treatment", value: "oral iron and follow-up in 4 weeks" }),
    ]));
  });

  it("extracts vital signs as named fields", () => {
    const fields = extractMedicalFields("Blood Pressure: 128/82 mmHg\nPulse: 76 bpm\nTemperature: 37.2 C\nSpO2: 98%");
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldName: "vital.bloodPressure", value: "128/82 mmHg" }),
      expect.objectContaining({ fieldName: "vital.heartRate", value: "76 bpm" }),
      expect.objectContaining({ fieldName: "vital.temperature", value: "37.2 C" }),
      expect.objectContaining({ fieldName: "vital.oxygenSaturation", value: "98%" }),
    ]));
  });

  it("captures bounded multi-line clinical sections", () => {
    const fields = extractMedicalFields("Symptoms:\nPersistent cough\nChest discomfort\nDiagnosis:\nAcute bronchitis");
    expect(fields.find((field) => field.fieldName === "symptoms")?.value).toBe("Persistent cough Chest discomfort");
    expect(fields.find((field) => field.fieldName === "diagnosis")?.value).toBe("Acute bronchitis");
  });
});

describe("OCR parser — dates", () => {
  it("parses ISO dates", () => {
    expect(extractDates("Collected 2026-08-15")[0].value).toBe("2026-08-15");
  });

  it("parses month-name dates", () => {
    expect(extractDates("Report Date: Aug 15, 2026")[0].value).toBe("2026-08-15");
  });

  it("rejects impossible calendar dates", () => {
    expect(extractDates("Report Date: 2026-02-31")).toHaveLength(0);
  });

  it("extracts multiple dates with their clinical context", () => {
    const dates = extractDates("Date of Birth: 02/03/1980\nCollection Date: 08/15/2026\nReport Date: 08/16/2026");
    expect(dates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "1980-02-03", kind: "birth" }),
      expect.objectContaining({ value: "2026-08-15", kind: "collection" }),
      expect.objectContaining({ value: "2026-08-16", kind: "report" }),
    ]));
  });

  it("keeps a date printed on a test row for that test", () => {
    const values = extractTestValues("Glucose 95 mg/dL 2026-08-15");
    expect(values[0].recordedDate).toBe("2026-08-15");
  });
});

describe("OCR parser — categorization", () => {
  it("categorizes a lab report", () => {
    const { category } = categorize("Laboratory Report\nHemoglobin 13.5 g/dL\nGlucose 95 mg/dL");
    expect(category).toBe("LABORATORY");
  });

  it("categorizes a prescription", () => {
    const { category } = categorize("Prescription\nTablet Amoxicillin 500mg\nSig: 1 tablet twice daily");
    expect(category).toBe("PRESCRIPTION");
  });

  it("falls back to OTHER with low confidence for unrecognized text", () => {
    const { category, confidence } = categorize("random unrelated text with no keywords");
    expect(category).toBe("OTHER");
    expect(confidence).toBeLessThan(0.5);
  });
});
