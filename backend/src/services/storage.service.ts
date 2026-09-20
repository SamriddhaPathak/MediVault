import crypto from "crypto";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { env } from "../config/env";

function sign(payload: string): string {
  return crypto.createHmac("sha256", env.jwt.accessSecret).update(payload).digest("base64url");
}

export function verifySignedFileToken(token: string): { fileKey: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [fileKey, expiresAtStr, sig] = decoded.split("::");
    if (!fileKey || !expiresAtStr || !sig) return null;
    const expected = sign(`${fileKey}::${expiresAtStr}`);
    if (sig !== expected) return null;
    if (Date.now() > parseInt(expiresAtStr, 10)) return null;
    return { fileKey };
  } catch {
    return null;
  }
}

/**
 * Storage abstraction. Dev implementation writes to a private local
 * directory (never served statically as public files). Swap this class
 * for an S3StorageService implementing the same interface in production —
 * nothing else in the app needs to change.
 */
export interface StorageService {
  save(buffer: Buffer, originalName: string, ownerId: string): Promise<string>; // returns fileKey
  read(fileKey: string): Promise<Buffer>;
  getSignedUrl(fileKey: string, ttlMinutes: number): Promise<string>;
  delete(fileKey: string): Promise<void>;
}

class LocalStorageService implements StorageService {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private resolveKey(fileKey: string): string {
    const resolved = path.resolve(this.baseDir, fileKey);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error("Invalid file key");
    }
    return resolved;
  }

  async save(buffer: Buffer, originalName: string, ownerId: string): Promise<string> {
    const ext = path.extname(originalName).toLowerCase();
    const ownerDir = path.join(this.baseDir, ownerId);
    fs.mkdirSync(ownerDir, { recursive: true });
    const fileKey = path.join(ownerId, `${uuid()}${ext}`);
    fs.writeFileSync(this.resolveKey(fileKey), buffer);
    return fileKey;
  }

  async read(fileKey: string): Promise<Buffer> {
    return fs.promises.readFile(this.resolveKey(fileKey));
  }

  async getSignedUrl(fileKey: string, ttlMinutes: number): Promise<string> {
    // Local dev stand-in for a signed S3 URL: an HMAC-signed, time-limited
    // token the file-serving route verifies. This is never a permanent
    // public URL — it expires and carries no implicit access beyond the
    // one file it was minted for. In production, swap for a real S3
    // presigned URL from the S3-backed StorageService implementation.
    const expiresAt = Date.now() + ttlMinutes * 60_000;
    const payload = `${fileKey}::${expiresAt}`;
    const sig = sign(payload);
    const token = Buffer.from(`${payload}::${sig}`).toString("base64url");
    return `/api/reports/file/${token}`;
  }

  async delete(fileKey: string): Promise<void> {
    const p = this.resolveKey(fileKey);
    if (fs.existsSync(p)) await fs.promises.unlink(p);
  }
}

export const storageService: StorageService = new LocalStorageService(env.storage.localDir);
