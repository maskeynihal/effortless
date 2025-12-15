import express from "express";
import { logger } from "../shared/logger";
import routes from "./routes-new";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.body,
  });
  next();
});

// Routes
app.use("/api", routes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Effortless GitHub Integration Server",
    version: "2.0.0",
    description: "SSH and GitHub integration with independent steps",
    endpoints: {
      health: "GET /api/health",
      verifyConnection: "POST /api/connection/verify",
      deployKey: "POST /api/step/deploy-key",
      createDatabase: "POST /api/step/database-create",
      setupFolder: "POST /api/step/folder-setup",
      setupEnv: "POST /api/step/env-setup",
      getSteps: "GET /api/steps/:host/:username/:applicationName",
    },
  });
});

// Error handling middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    logger.error("Unhandled error", {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });

    res.status(err.status || 500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
);

// Start server
app.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
  logger.info("Available endpoints:");
  logger.info("  POST   /api/connection/verify");
  logger.info("  POST   /api/step/deploy-key");
  logger.info("  POST   /api/step/database-create");
  logger.info("  POST   /api/step/folder-setup");
  logger.info("  POST   /api/step/env-setup");
  logger.info("  GET    /api/steps/:host/:username/:applicationName");
});

export default app;
