import request from "supertest";
import path from "path";
import fs from "fs";
import { createApp } from "../app";
import { prisma } from "../config/prisma";

const app = createApp();

const tinyPngPath = path.join(__dirname, "fixtures", "tiny.png");

beforeAll(() => {
  fs.mkdirSync(path.dirname(tinyPngPath), { recursive: true });
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  fs.writeFileSync(tinyPngPath, Buffer.from(base64, "base64"));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function registerUser(suffix: string) {
  const email = `regression_${suffix}_${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const res = await request(app).post("/api/auth/register").send({ email, password, confirmPassword: password });
  return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
}

async function uploadReport(accessToken: string) {
  const res = await request(app)
    .post("/api/reports/upload")
    .set("Authorization", `Bearer ${accessToken}`)
    .attach("file", tinyPngPath);
  expect(res.status).toBe(201);
  return res.body.report.id as string;
}

describe("Signed file links serve a usable Content-Type", () => {
  // Served as the Express default application/octet-stream, these bytes were
  // refused by the browser under helmet's nosniff header — which silently
  // broke every image and PDF preview in the app.
  it("returns the real media type for a signed image link", async () => {
    const user = await registerUser("signed-url");
    const reportId = await uploadReport(user.accessToken);

    const urlRes = await request(app)
      .get(`/api/reports/${reportId}/file-url`)
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(urlRes.status).toBe(200);
    expect(urlRes.body.url).toMatch(/^\/api\/files\//);

    const fileRes = await request(app).get(urlRes.body.url);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers["content-type"]).toMatch(/^image\/png/);
  });

  it("rejects a tampered token", async () => {
    const res = await request(app).get("/api/files/not-a-real-token");
    expect(res.status).toBe(404);
  });
});

describe("Manual entry rescues a report whose OCR failed", () => {
  it("promotes OCR_FAILED to PENDING_REVIEW once the user adds a value, and allows verification", async () => {
    const user = await registerUser("ocr-failed");
    const reportId = await uploadReport(user.accessToken);

    await prisma.report.update({
      where: { id: reportId },
      data: { status: "OCR_FAILED", failureReason: "No readable text detected in document." },
    });

    // Verifying with nothing entered is still refused, but with a message
    // that tells the user what to do rather than a flat dead end.
    const premature = await request(app)
      .post(`/api/reports/${reportId}/verify`)
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(premature.status).toBe(422);
    expect(premature.body.error).toMatch(/add at least one detail/i);

    const edit = await request(app)
      .patch(`/api/reports/${reportId}/fields`)
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        testValues: [
          { testName: "Hemoglobin", numericValue: 13.5, unit: "g/dL", recordedDate: "2026-01-15" },
        ],
      });
    expect(edit.status).toBe(200);

    const promoted = await prisma.report.findUnique({ where: { id: reportId } });
    expect(promoted?.status).toBe("PENDING_REVIEW");
    expect(promoted?.failureReason).toBeNull();

    const verified = await request(app)
      .post(`/api/reports/${reportId}/verify`)
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(verified.status).toBe(200);
    expect(verified.body.report.status).toBe("VERIFIED");
  });
});

describe("Report-level provenance", () => {
  it("does not mark a report edited when a save changes nothing", async () => {
    const user = await registerUser("provenance");
    const reportId = await uploadReport(user.accessToken);

    await prisma.report.update({ where: { id: reportId }, data: { category: "LABORATORY" } });

    const res = await request(app)
      .patch(`/api/reports/${reportId}`)
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ category: "LABORATORY" });
    expect(res.status).toBe(200);
    expect(res.body.report.editedByUser).toBe(false);
  });

  it("marks a report edited when a save actually changes something", async () => {
    const user = await registerUser("provenance-changed");
    const reportId = await uploadReport(user.accessToken);

    const res = await request(app)
      .patch(`/api/reports/${reportId}`)
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ category: "RADIOLOGY" });
    expect(res.status).toBe(200);
    expect(res.body.report.editedByUser).toBe(true);
  });
});

describe("Optional test-value fields can be cleared", () => {
  it("erases a unit and reference range when null is submitted", async () => {
    const user = await registerUser("clearable");
    const reportId = await uploadReport(user.accessToken);

    const created = await prisma.testValue.create({
      data: {
        reportId,
        testName: "Glucose",
        numericValue: 95,
        unit: "mg/dL",
        recordedDate: new Date("2026-01-15"),
        referenceRangeText: "70-110",
        source: "ocr",
        confidence: 0.7,
      },
    });

    const res = await request(app)
      .patch(`/api/reports/${reportId}/fields`)
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        testValues: [
          {
            id: created.id,
            testName: "Glucose",
            numericValue: 95,
            unit: null,
            recordedDate: "2026-01-15",
            referenceRangeText: null,
          },
        ],
      });
    expect(res.status).toBe(200);

    const updated = await prisma.testValue.findUnique({ where: { id: created.id } });
    expect(updated?.unit).toBeNull();
    expect(updated?.referenceRangeText).toBeNull();
    expect(updated?.source).toBe("user");
  });
});

describe("Reprocessing a report", () => {
  // Before this endpoint existed, a report that failed OCR for a transient
  // reason was stuck in OCR_FAILED permanently — the only remedy was
  // deleting it and uploading the same file again.
  it("resets a failed report so OCR can run again", async () => {
    const user = await registerUser("reprocess");
    const reportId = await uploadReport(user.accessToken);

    await prisma.report.update({
      where: { id: reportId },
      data: { status: "OCR_FAILED", failureReason: "No readable text detected.", ocrAttempts: 2 },
    });

    const res = await request(app)
      .post(`/api/reports/${reportId}/reprocess`)
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe("UPLOADED");
    expect(res.body.report.failureReason).toBeNull();
    expect(res.body.report.ocrAttempts).toBe(0);
  });

  it("refuses to reprocess a report that is already processing", async () => {
    const user = await registerUser("reprocess-busy");
    const reportId = await uploadReport(user.accessToken);
    await prisma.report.update({ where: { id: reportId }, data: { status: "PROCESSING" } });

    const res = await request(app)
      .post(`/api/reports/${reportId}/reprocess`)
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(res.status).toBe(422);
  });

  it("does not let one user reprocess another user's report", async () => {
    const owner = await registerUser("reprocess-owner");
    const other = await registerUser("reprocess-other");
    const reportId = await uploadReport(owner.accessToken);

    const res = await request(app)
      .post(`/api/reports/${reportId}/reprocess`)
      .set("Authorization", `Bearer ${other.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe("Uploads are validated by content, not by filename", () => {
  it("rejects a file whose bytes are not a supported format", async () => {
    const user = await registerUser("sniff-reject");
    const fakePath = path.join(__dirname, "fixtures", "fake.png");
    fs.writeFileSync(fakePath, Buffer.from("PK\u0003\u0004 this is actually a zip, not a png at all"));

    const res = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .attach("file", fakePath);

    expect(res.status).toBe(422);
  });

  it("stores the detected type when the declared type is wrong", async () => {
    const user = await registerUser("sniff-correct");
    // A real PDF carrying a .png filename: the browser declares image/png.
    const misnamedPath = path.join(__dirname, "fixtures", "actually-a-pdf.png");
    fs.writeFileSync(misnamedPath, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(256, 0x20)]));

    const res = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .attach("file", misnamedPath);

    expect(res.status).toBe(201);
    expect(res.body.report.mimeType).toBe("application/pdf");
  });

  it("rejects an empty file", async () => {
    const user = await registerUser("empty-upload");
    const emptyPath = path.join(__dirname, "fixtures", "empty.png");
    fs.writeFileSync(emptyPath, Buffer.alloc(0));

    const res = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .attach("file", emptyPath);

    expect(res.status).toBe(422);
  });
});

describe("List page size matches what the browse views request", () => {
  // Exports and the Image Vault fetch one large page (pageSize=500) instead
  // of paginating, since both are meant to be browsable grids/pickers. The
  // schema previously capped pageSize at 100, so every request from either
  // page failed with "Invalid query parameters."
  it("accepts pageSize=500", async () => {
    const user = await registerUser("pagesize-500");
    const res = await request(app)
      .get("/api/reports")
      .query({ page: 1, pageSize: 500, sort: "newest" })
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(500);
  });

  it("still rejects an unreasonably large pageSize", async () => {
    const user = await registerUser("pagesize-too-big");
    const res = await request(app)
      .get("/api/reports")
      .query({ page: 1, pageSize: 5000 })
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(res.status).toBe(422);
  });
});
