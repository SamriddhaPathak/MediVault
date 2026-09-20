import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

// Centralized error handler. Never leaks stack traces or internal details to clients.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (!err.isOperational || err.statusCode >= 500) {
      logger.error(err.message, { path: req.path });
    }
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error("Unhandled error", { path: req.path, error: err instanceof Error ? err.message : String(err) });
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "Resource not found" });
}
