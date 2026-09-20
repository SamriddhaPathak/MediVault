import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../config/prisma";

const app = createApp();

describe("Authentication", () => {
  const email = `user_${Date.now()}@example.com`;
  const password = "correct-horse-battery";

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("registers a new user", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password, confirmPassword: password });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(email);
  });

  it("rejects mismatched passwords", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: `mismatch_${Date.now()}@example.com`, password, confirmPassword: "different" });
    expect(res.status).toBe(422);
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it("rejects invalid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("refreshes an access token", async () => {
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it("logs out and invalidates the refresh token", async () => {
    const login = await request(app).post("/api/auth/login").send({ email, password });
    await request(app).post("/api/auth/logout").send({ refreshToken: login.body.refreshToken });
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(res.status).toBe(401);
  });
});
