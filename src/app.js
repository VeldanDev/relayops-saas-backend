import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { prisma } from "./db.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import tenantRoutes from "./routes/tenant.js";
import { openApiSpec } from "./docs/openapi.js";
import { AppError, errorHandler } from "./utils/errors.js";

export function createApp() {
  const app = express();

  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        return cb(null, true);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  app.get("/", (_req, res) => {
    res.json({
      service: "RelayOps Multi-Tenant SaaS API",
      docs: "/api-docs",
      openapi: "/openapi.json",
      health: "/health",
    });
  });

  app.get("/health", async (_req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", service: "softlligence-saas-backend", timestamp: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  app.get("/openapi.json", (_req, res) => res.json(openApiSpec));
  const swaggerOpts = process.env.VERCEL
    ? {
        customCssUrl: "https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css",
        customJs: [
          "https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js",
          "https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js",
        ],
      }
    : undefined;
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, swaggerOpts));

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/tenant", tenantRoutes);

  app.use((_req, _res, next) => {
    next(new AppError(404, "NOT_FOUND", "The requested endpoint does not exist."));
  });

  app.use(errorHandler);
  return app;
}
