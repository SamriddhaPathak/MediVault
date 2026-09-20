import { NextFunction, Request, Response } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// Wraps async route handlers so rejected promises reach centralized error middleware,
// instead of requiring try/catch in every controller.
export const asyncHandler = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
