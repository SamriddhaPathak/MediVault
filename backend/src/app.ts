import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRoutes from "./modules/auth/auth.routes";
import profileRoutes from "./modules/users/profile.routes";
import reportsRoutes from "./modules/reports/reports.routes";
import analyticsRoutes from "./modules/analytics/analytics.routes";
import exportsRoutes from "./modules/exports/exports.routes";
import { registerJobs } from "./jobs";

import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

// Custom morgan token that strips query strings before logging. Several
// endpoints carry potentially sensitive content in query params (report
// search terms, test names in analytics routes) — logging the full URL
// would put medical search terms in application logs, which the product's
// privacy requirements explicitly rule out.
morgan.token("safe-url", (req) => {
  const url = (req as any).originalUrl ?? (req as any).url ?? "";
  const [path] = url.split("?");
  return path;
});

export function createApp() {
  registerJobs();
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(
    morgan(
      process.env.NODE_ENV === "development"
        ? ":method :safe-url :status :response-time ms"
        : ":remote-addr :method :safe-url :status :response-time ms"
    )
  );

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/profile", profileRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/exports", exportsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
