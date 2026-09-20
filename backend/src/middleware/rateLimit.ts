import { NextFunction, Request, Response } from "express";

// Minimal in-memory sliding-window rate limiter (no Redis dependency).
// Fine for a single-process dev/small deployment; swap for a Redis-backed
// limiter (e.g. rate-limiter-flexible) behind this same interface at scale.
//
// Keys are swept periodically. Without this the map grew one entry per
// distinct client IP for the lifetime of the process and never shrank —
// an unbounded memory leak on any internet-facing instance, and one an
// attacker could grow deliberately by rotating source addresses.
const SWEEP_INTERVAL_MS = 60_000;

export function rateLimit(opts: { windowMs: number; max: number; keyPrefix: string }) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

  function sweep(now: number) {
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    const windowStart = now - opts.windowMs;
    for (const [key, timestamps] of hits) {
      // A key whose most recent hit has aged out of the window carries no
      // information — drop it rather than keeping it forever.
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= windowStart) {
        hits.delete(key);
      }
    }
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);

    const key = `${opts.keyPrefix}:${req.ip}`;
    const windowStart = now - opts.windowMs;
    const existing = (hits.get(key) ?? []).filter((t) => t > windowStart);
    existing.push(now);
    hits.set(key, existing);

    if (existing.length > opts.max) {
      res.setHeader("Retry-After", Math.ceil(opts.windowMs / 1000));
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    next();
  };
}
