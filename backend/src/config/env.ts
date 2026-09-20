import dotenv from "dotenv";
dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

// Every `required()` call below passes a development fallback, which meant
// nothing was ever actually required — a production deploy missing
// JWT_ACCESS_SECRET would boot happily on the placeholder. That is not a
// theoretical problem: the access secret also signs the HMAC file-access
// tokens (storage.service.ts), so anyone who knows the published default
// could mint a valid link to any stored file. Secrets must be supplied
// explicitly, and must not be the placeholders, whenever NODE_ENV=production.
const PLACEHOLDER_SECRETS = new Set([
  "dev_access_secret_change_me",
  "dev_refresh_secret_change_me",
  "change_me_access_secret",
  "change_me_refresh_secret",
]);

function requiredSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (isProduction) {
    if (!value) throw new Error(`Missing required environment variable in production: ${name}`);
    if (PLACEHOLDER_SECRETS.has(value)) {
      throw new Error(`${name} is still set to a placeholder value. Set a real secret before deploying.`);
    }
    if (value.length < 32) {
      throw new Error(`${name} must be at least 32 characters in production.`);
    }
    return value;
  }
  return value ?? devFallback;
}

export const env = {
  nodeEnv,
  port: parseInt(process.env.PORT ?? "5000", 10),
  databaseUrl: required("DATABASE_URL", "file:./dev.db"),
  jwt: {
    accessSecret: requiredSecret("JWT_ACCESS_SECRET", "dev_access_secret_change_me"),
    refreshSecret: requiredSecret("JWT_REFRESH_SECRET", "dev_refresh_secret_change_me"),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER ?? "local",
    localDir: process.env.STORAGE_LOCAL_DIR ?? "./uploads",
  },
  maxUploadSizeBytes: parseInt(process.env.MAX_UPLOAD_SIZE_BYTES ?? String(15 * 1024 * 1024), 10),
  ocrLanguage: process.env.OCR_LANGUAGE ?? "eng",
  export: {
    localDir: process.env.EXPORT_LOCAL_DIR ?? "./generated",
    urlTtlMinutes: parseInt(process.env.EXPORT_URL_TTL_MINUTES ?? "15", 10),
  },
};
