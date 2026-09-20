import request from "supertest";
import path from "path";
import fs from "fs";
import { createApp } from "../app";
import { prisma } from "../config/prisma";

const app = createApp();
const tinyPngPath = path.join(__dirname, "fixtures", "prov-test.png");

beforeAll(() => {
  fs.mkdirSync(path.dirname(tinyPngPath), { recursive: true });
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  fs.writeFileSync(tinyPngPath, Buffer.from(base64, "base64"));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function registerAndLogin(suffix: string) {
  const email = `prov_${suffix}_${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const res = await request(app).post("/api/auth/register").send({ email, password, confirmPassword: password });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe("OCR vs. user provenance is preserved across saves", () => {
  it("keeps a test value's source as 'ocr' when re-saved unchanged", async () => {
    const { token, userId } = await registerAndLogin("unchanged");

    const upload = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", tinyPngPath);
    const reportId = upload.body.report.id;

    // Simulate a completed OCR pass directly (bypasses needing a real
    // Tesseract run in tests) by inserting a TestValue the way ocr.job.ts
    // would, with source="ocr" and a real confidence score.
    const testValue = await prisma.testValue.create({
      data: {
        reportId,
        testName: "Hemoglobin",
        numericValue: 13.5,
        unit: "g/dL",
        recordedDate: new Date("2026-08-15"),
        source: "ocr",
        confidence: 0.82,
      },
    });

    // Re-submit the exact same value, as the Review screen does on every
    // "Save Changes" click even when nothing was actually edited.
    const res = await request(app)
      .patch(`/api/reports/${reportId}/fields`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        testValues: [
          {
            id: testValue.id,
            testName: "Hemoglobin",
            numericValue: 13.5,
            unit: "g/dL",
            recordedDate: "2026-08-15",
          },
        ],
      });

    expect(res.status).toBe(200);
    const stored = await prisma.testValue.findUnique({ where: { id: testValue.id } });
    expect(stored?.source).toBe("ocr");
    expect(stored?.confidence).toBeCloseTo(0.82);
  });

  it("re-stamps source as 'user' and clears confidence when the value is actually edited", async () => {
    const { token } = await registerAndLogin("changed");

    const upload = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", tinyPngPath);
    const reportId = upload.body.report.id;

    const testValue = await prisma.testValue.create({
      data: {
        reportId,
        testName: "Glucose",
        numericValue: 95,
        unit: "mg/dL",
        recordedDate: new Date("2026-08-15"),
        source: "ocr",
        confidence: 0.7,
      },
    });

    const res = await request(app)
      .patch(`/api/reports/${reportId}/fields`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        testValues: [
          {
            id: testValue.id,
            testName: "Glucose",
            numericValue: 99, // user correction
            unit: "mg/dL",
            recordedDate: "2026-08-15",
          },
        ],
      });

    expect(res.status).toBe(200);
    const stored = await prisma.testValue.findUnique({ where: { id: testValue.id } });
    expect(stored?.source).toBe("user");
    expect(stored?.numericValue).toBe(99);
    expect(stored?.confidence).toBeNull();
  });
});
