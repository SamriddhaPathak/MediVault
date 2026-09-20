import dotenv from "dotenv";
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "5000", 10),
  databaseUrl: required("DATABASE_URL", "file:./dev.db"),
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET", "dev_access_secret_change_me"),
    refreshSecret: required("JWT_REFRESH_SECRET", "dev_refresh_secret_change_me"),
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
