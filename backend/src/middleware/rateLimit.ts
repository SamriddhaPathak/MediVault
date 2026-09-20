import { NextFunction, Request, Response } from "express";

// Minimal in-memory sliding-window rate limiter (no Redis dependency).
// Fine for a single-process dev/small deployment; swap for a Redis-backed
// limiter (e.g. rate-limiter-flexible) behind this same interface at scale.
export function rateLimit(opts: { windowMs: number; max: number; keyPrefix: string }) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${opts.keyPrefix}:${req.ip}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;
    const existing = (hits.get(key) ?? []).filter((t) => t > windowStart);
    existing.push(now);
    hits.set(key, existing);

    if (existing.length > opts.max) {
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    next();
  };
}
