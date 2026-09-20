import request from "supertest";
import path from "path";
import fs from "fs";
import { createApp } from "../app";
import { prisma } from "../config/prisma";

const app = createApp();

const tinyPngPath = path.join(__dirname, "fixtures", "dup-test.png");

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
  const email = `dup_${suffix}_${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const res = await request(app).post("/api/auth/register").send({ email, password, confirmPassword: password });
  return res.body.accessToken as string;
}

describe("Duplicate upload detection", () => {
  it("flags re-uploading the exact same file, but does not block it", async () => {
    const token = await registerAndLogin("a");

    const first = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", tinyPngPath);
    expect(first.status).toBe(201);
    expect(first.body.duplicateOf).toBeNull();

    const second = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", tinyPngPath);
    expect(second.status).toBe(201); // never blocked, only flagged
    expect(second.body.duplicateOf).not.toBeNull();
    expect(second.body.duplicateOf.id).toBe(first.body.report.id);
  });

  it("does not flag the same file uploaded by a different user", async () => {
    const tokenA = await registerAndLogin("cross-a");
    const tokenB = await registerAndLogin("cross-b");

    await request(app).post("/api/reports/upload").set("Authorization", `Bearer ${tokenA}`).attach("file", tinyPngPath);
    const res = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${tokenB}`)
      .attach("file", tinyPngPath);

    expect(res.body.duplicateOf).toBeNull();
  });
});
