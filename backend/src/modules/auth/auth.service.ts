import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError, UnauthorizedError } from "../../utils/errors";

function msFromDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 15 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

function issueAccessToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

async function issueRefreshToken(userId: string): Promise<string> {
  const token = uuid() + uuid();
  const expiresAt = new Date(Date.now() + msFromDuration(env.jwt.refreshExpiresIn));
  await prisma.refreshToken.create({ data: { userId, token, expiresAt } });
  return token;
}

export const authService = {
  async register(email: string, password: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError("An account with this email already exists.", 409);

    const passwordHash = await argon2.hash(password);
    const user = await prisma.user.create({ data: { email, passwordHash } });

    const accessToken = issueAccessToken(user.id, user.email);
    const refreshToken = await issueRefreshToken(user.id);
    return { user: { id: user.id, email: user.email }, accessToken, refreshToken };
  },

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedError("Invalid email or password.");

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedError("Invalid email or password.");

    const accessToken = issueAccessToken(user.id, user.email);
    const refreshToken = await issueRefreshToken(user.id);
    return { user: { id: user.id, email: user.email }, accessToken, refreshToken };
  },

  async refresh(oldToken: string) {
    const stored = await prisma.refreshToken.findUnique({ where: { token: oldToken } });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedError("Your session has expired. Please log in again.");
    }
    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) throw new UnauthorizedError("Your session has expired. Please log in again.");

    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    const accessToken = issueAccessToken(user.id, user.email);
    const refreshToken = await issueRefreshToken(user.id);
    return { accessToken, refreshToken };
  },

  async logout(token: string) {
    await prisma.refreshToken.updateMany({ where: { token }, data: { revoked: true } });
  },
};
