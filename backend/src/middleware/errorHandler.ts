import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { env } from "../config/env";

// Centralized error handler. Never leaks stack traces or internal details
// to clients IN PRODUCTION.
//
// Outside production, an unexpected (non-AppError) failure also includes
// its real message under `detail`. The generic "Something went wrong"
// message is what a user should ever see, but a developer running this
// locally has no other easy way to find out *why* — the true cause (a
// database schema mismatch, a bad Prisma query, a bug) was previously only
// visible in server-side logs, which someone debugging purely from the
// browser has no reason to think to check. `detail` is additive: existing
// frontend code reads only `error` and ignores fields it doesn't know
// about, so this cannot change any user-facing message.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (!err.isOperational || err.statusCode >= 500) {
      logger.error(err.message, { path: req.path });
    }
    return res.status(err.statusCode).json({ error: err.message });
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error("Unhandled error", { path: req.path, error: message });

  const body: { error: string; detail?: string } = { error: "Something went wrong. Please try again." };
  if (env.nodeEnv !== "production") body.detail = message;

  return res.status(500).json(body);
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "Resource not found" });
}
