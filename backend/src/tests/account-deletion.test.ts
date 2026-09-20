import request from "supertest";
import path from "path";
import fs from "fs";
import { createApp } from "../app";
import { prisma } from "../config/prisma";

const app = createApp();

async function registerAndLogin(emailSuffix: string) {
  const email = `del_${emailSuffix}_${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password, confirmPassword: password });
  return {
    email,
    password,
    accessToken: res.body.accessToken as string,
    refreshToken: res.body.refreshToken as string,
    userId: res.body.user.id as string,
  };
}

const tinyPngPath = path.join(__dirname, "fixtures", "tiny.png");

beforeAll(() => {
  fs.mkdirSync(path.dirname(tinyPngPath), { recursive: true });
  // 1x1 transparent PNG
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  if (!fs.existsSync(tinyPngPath)) fs.writeFileSync(tinyPngPath, Buffer.from(base64, "base64"));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Account deletion", () => {
  it("requires a password", async () => {
    const user = await registerAndLogin("nopass");
    const res = await request(app)
      .delete("/api/profile")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({});
    expect(res.status).toBe(422);

    // Nothing should have been deleted.
    expect(await prisma.user.findUnique({ where: { id: user.userId } })).not.toBeNull();
  });

  it("rejects an incorrect password and leaves the account intact", async () => {
    const user = await registerAndLogin("wrongpass");
    const res = await request(app)
      .delete("/api/profile")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ password: "not-the-right-password" });
    expect(res.status).toBe(401);

    expect(await prisma.user.findUnique({ where: { id: user.userId } })).not.toBeNull();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).delete("/api/profile").send({ password: "whatever" });
    expect(res.status).toBe(401);
  });

  it("deletes the account and every record that belongs to it", async () => {
    const user = await registerAndLogin("full");

    await request(app)
      .patch("/api/profile")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ displayName: "Delete Me" });

    const upload = await request(app)
      .post("/api/reports/upload")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .attach("file", tinyPngPath);
    expect(upload.status).toBe(201);
    const reportId = upload.body.report.id;

    const del = await request(app)
      .delete("/api/profile")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ password: user.password });
    expect(del.status).toBe(204);

    expect(await prisma.user.findUnique({ where: { id: user.userId } })).toBeNull();
    expect(await prisma.healthProfile.findUnique({ where: { userId: user.userId } })).toBeNull();
    expect(await prisma.report.findUnique({ where: { id: reportId } })).toBeNull();
    expect(await prisma.refreshToken.findMany({ where: { userId: user.userId } })).toHaveLength(0);

    // The refresh token issued before deletion must no longer work.
    const refresh = await request(app).post("/api/auth/refresh").send({ refreshToken: user.refreshToken });
    expect(refresh.status).toBe(401);

    // Nor can the deleted account's credentials be used to log back in.
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: user.password });
    expect(login.status).toBe(401);
  });
});
