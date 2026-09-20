import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { UnauthorizedError } from "../utils/errors";

export interface AuthPayload {
  sub: string; // user id
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// Every protected route runs this. It attaches req.user, which every
// data-access query downstream MUST use to scope results to the owner.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Your session has expired. Please log in again."));
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.jwt.accessSecret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    next(new UnauthorizedError("Your session has expired. Please log in again."));
  }
}
