import multer from "multer";
import { env } from "../../config/env";

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "image/bmp",
  "image/avif",
  "application/pdf",
]);
export const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".avif", ".pdf"]);

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadSizeBytes },
  // Type validation happens after Multer consumes the multipart stream. A
  // fileFilter rejection can close the client socket before callers receive
  // the intended validation response.
  fileFilter: (_req, _file, cb) => cb(null, true),
}).single("file");
