import request from "supertest";
import path from "path";
import fs from "fs";
import { createApp } from "../app";
import { prisma } from "../config/prisma";

const app = createApp();

async function registerAndLogin(emailSuffix: string) {
  const email = `owner_${emailSuffix}_${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password, confirmPassword: password });
  return { email, accessToken: res.body.accessToken as string, userId: res.body.user.id as string };
}

const tinyPngPath = path.join(__dirname, "fixtures", "tiny.png");

beforeAll(() => {
  fs.mkdirSync(path.dirname(tinyPngPath), { recursive: true });
  // 1x1 transparent PNG
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  fs.writeFileSync(tinyPngPath, Buffer.from(base64, "base64"));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Cross-user authorization", () => {
  it("prevents a user from viewing another user's report", async () => {
    const userA = await registerAndLogin("a");
    const userB = await registerAndLogin("b");

    const upload = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .attach("file", tinyPngPath);
    expect(upload.status).toBe(201);
    const reportId = upload.body.report.id;

    const getAsOwner = await request(app)
      .get(`/api/reports/${reportId}`)
      .set("Authorization", `Bearer ${userA.accessToken}`);
    expect(getAsOwner.status).toBe(200);

    const getAsOther = await request(app)
      .get(`/api/reports/${reportId}`)
      .set("Authorization", `Bearer ${userB.accessToken}`);
    expect(getAsOther.status).toBe(404);
  });

  it("prevents a user from editing another user's report", async () => {
    const userA = await registerAndLogin("edit-a");
    const userB = await registerAndLogin("edit-b");

    const upload = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .attach("file", tinyPngPath);
    const reportId = upload.body.report.id;

    const res = await request(app)
      .patch(`/api/reports/${reportId}`)
      .set("Authorization", `Bearer ${userB.accessToken}`)
      .send({ name: "Hacked name" });
    expect(res.status).toBe(404);
  });

  it("prevents a user from deleting another user's report", async () => {
    const userA = await registerAndLogin("del-a");
    const userB = await registerAndLogin("del-b");

    const upload = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .attach("file", tinyPngPath);
    const reportId = upload.body.report.id;

    const res = await request(app)
      .delete(`/api/reports/${reportId}`)
      .set("Authorization", `Bearer ${userB.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("prevents a user from exporting another user's report", async () => {
    const userA = await registerAndLogin("exp-a");
    const userB = await registerAndLogin("exp-b");

    const upload = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .attach("file", tinyPngPath);
    const reportId = upload.body.report.id;

    const res = await request(app)
      .post("/api/exports")
      .set("Authorization", `Bearer ${userB.accessToken}`)
      .send({ reportIds: [reportId] });
    expect(res.status).toBe(403);
  });

  it("rejects unsupported file types on upload", async () => {
    const userA = await registerAndLogin("badtype-a");
    const badFile = path.join(__dirname, "fixtures", "bad.txt");
    fs.writeFileSync(badFile, "not a medical report");

    const res = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .attach("file", badFile);
    expect(res.status).toBe(422);
  });

  it("requires authentication for protected routes", async () => {
    const res = await request(app).get("/api/reports");
    expect(res.status).toBe(401);
  });
});
