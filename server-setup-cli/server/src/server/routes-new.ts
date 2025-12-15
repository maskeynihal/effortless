import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { Client as SSH2Client } from "ssh2";
import { logger } from "../shared/logger";
import axios from "axios";
import {
  initializeDatabase,
  saveApplication,
  getApplicationByName,
  addApplicationStep,
  getApplicationSteps,
  updateApplicationStatus,
} from "../shared/database";
import { SSHConnectionStep } from "../steps/sshConnectionStep";
import { GitHubAuthStep } from "../steps/githubAuthStep";
import { RepoSelectionStep } from "../steps/repoSelectionStep";
import { DeployKeyGenerationStep } from "../steps/deployKeyGenerationStep";

const router = express.Router();

// Ensure database is initialized
let dbInitialized = false;
async function ensureDatabaseInitialized(): Promise<void> {
  if (dbInitialized) return;
  try {
    await initializeDatabase();
    dbInitialized = true;
    logger.info("[DB] Database initialized for API routes");
  } catch (e: any) {
    logger.error(`[DB] Failed to initialize database: ${e?.message || e}`);
    throw e;
  }
}

/**
 * POST /connection/verify
 * Verify SSH and GitHub connections
 */
router.post("/connection/verify", async (req: Request, res: Response) => {
  const stepId = uuidv4();
  const startTime = Date.now();

  try {
    const {
      host,
      username,
      port = 22,
      privateKeyContent,
      githubToken,
      applicationName,
    } = req.body;

    if (!host || !username || !privateKeyContent || !applicationName) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, privateKeyContent, applicationName",
      });
    }

    await ensureDatabaseInitialized();

    const sessionId = uuidv4();
    logger.info(`[Connection] Verifying connections for ${applicationName}`);

    // Test SSH connection
    let sshConnected = false;
    let sshError = null;

    try {
      const ssh = new SSH2Client();
      await new Promise<void>((resolve, reject) => {
        ssh.on("ready", () => {
          sshConnected = true;
          ssh.end();
          resolve();
        });
        ssh.on("error", reject);
        ssh.connect({
          host,
          port,
          username,
          privateKey: Buffer.from(privateKeyContent),
          readyTimeout: 30000,
        });
      });
      logger.info(`[Connection] SSH connection successful to ${host}`);
    } catch (error: any) {
      sshError = error.message;
      logger.error(`[Connection] SSH connection failed: ${sshError}`);
    }

    // Test GitHub connection
    let githubConnected = false;
    let githubError = null;
    let githubUsername = null;

    if (githubToken) {
      try {
        const response = await axios.get("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
          },
          timeout: 10000,
        });
        githubConnected = true;
        githubUsername = response.data.login;
        logger.info(
          `[Connection] GitHub connection successful as ${githubUsername}`
        );
      } catch (error: any) {
        githubError = error.message;
        logger.error(`[Connection] GitHub connection failed: ${githubError}`);
      }
    }

    // Save application with connection details, then reload to capture id
    await saveApplication({
      sessionId,
      host,
      username,
      port,
      sshPrivateKey: privateKeyContent,
      githubToken: githubToken || undefined,
      githubUsername: githubUsername || undefined,
      applicationName,
    });

    const application = await getApplicationByName(
      host,
      username,
      applicationName
    );
    const applicationId = application?.id;

    // Log the verification step
    if (applicationId) {
      await addApplicationStep(
        applicationId,
        "connection-verify",
        sshConnected && (!githubToken || githubConnected)
          ? "success"
          : "failed",
        JSON.stringify({
          ssh: { connected: sshConnected, error: sshError },
          github: {
            connected: githubConnected,
            error: githubError,
            username: githubUsername,
          },
          duration: Date.now() - startTime,
        })
      );
    }

    res.json({
      success: sshConnected && (!githubToken || githubConnected),
      message: "Connection verification completed",
      sessionId,
      applicationId,
      connections: {
        ssh: {
          connected: sshConnected,
          host,
          username,
          error: sshError,
        },
        github: githubToken
          ? {
              connected: githubConnected,
              username: githubUsername,
              error: githubError,
            }
          : null,
      },
    });
  } catch (error: any) {
    logger.error(`[Connection] Verification failed: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /step/deploy-key
 * Generate and register deploy key (can be re-executed)
 */
router.post("/step/deploy-key", async (req: Request, res: Response) => {
  const startTime = Date.now();
  let app;
  try {
    const { host, username, applicationName, selectedRepo } = req.body;

    if (!host || !username || !applicationName || !selectedRepo) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, selectedRepo",
      });
    }

    await ensureDatabaseInitialized();

    app = await getApplicationByName(host, username, applicationName);
    if (!app) {
      return res.status(404).json({
        success: false,
        error: "Application not found. Please verify connection first.",
      });
    }

    if (!app.sshPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "SSH key not found. Please verify connection first.",
      });
    }

    if (!app.githubToken) {
      return res.status(400).json({
        success: false,
        error: "GitHub token missing. Please authenticate GitHub first.",
      });
    }

    logger.info(
      `[DeployKey] Generating deploy key for ${selectedRepo} (token present: ${!!app.githubToken})`
    );

    // Build workflow-style steps to mirror routes.ts behavior
    const sshStep = new SSHConnectionStep(
      host,
      username,
      "",
      app.port || 22,
      app.sshPrivateKey
    );

    const githubStep = new GitHubAuthStep(app.githubToken);
    const repoStep = new RepoSelectionStep(githubStep);
    repoStep.setSelectedRepo(selectedRepo);
    const deployStep = new DeployKeyGenerationStep(
      sshStep,
      githubStep,
      repoStep,
      applicationName,
      host,
      username
    );

    // Ensure SSH connects first
    const sshResult = await sshStep.execute();
    if (!sshResult.success) {
      await addApplicationStep(
        app.id,
        "deploy-key-generation",
        "failed",
        JSON.stringify({
          error: sshResult.message,
          duration: Date.now() - startTime,
        })
      );

      return res.status(500).json({
        success: false,
        error: sshResult.message,
      });
    }

    // Validate PAT before proceeding
    const authResult = await githubStep.execute();
    if (!authResult.success) {
      sshStep.closeConnection();
      await addApplicationStep(
        app.id,
        "deploy-key-generation",
        "failed",
        JSON.stringify({
          error: authResult.message,
          duration: Date.now() - startTime,
        })
      );
      return res.status(400).json({
        success: false,
        error: authResult.message,
      });
    }

    // Execute deploy key step
    const result = await deployStep.execute();
    sshStep.closeConnection();

    if (result.success) {
      await addApplicationStep(
        app.id,
        "deploy-key-generation",
        "success",
        JSON.stringify({
          repository: selectedRepo,
          deployKeyName: result.data?.deployKeyName,
          duration: result.data?.duration || Date.now() - startTime,
        })
      );
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    }

    await addApplicationStep(
      app.id,
      "deploy-key-generation",
      "failed",
      JSON.stringify({
        error: result.message,
        duration: result.data?.duration || Date.now() - startTime,
      })
    );

    return res.status(500).json({ success: false, error: result.message });
  } catch (error: any) {
    logger.error(`[DeployKey] Step failed: ${error.message}`);

    if (app?.id) {
      await addApplicationStep(
        app.id,
        "deploy-key-generation",
        "failed",
        JSON.stringify({
          error: error.message,
          duration: Date.now() - startTime,
        })
      );
    }

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /step/database-create
 * Create database on remote server (can be re-executed)
 */
router.post("/step/database-create", async (req: Request, res: Response) => {
  const stepId = uuidv4();
  const startTime = Date.now();

  try {
    const {
      host,
      username,
      applicationName,
      dbType,
      dbName,
      dbUsername,
      dbPassword,
      dbPort,
    } = req.body;

    if (
      !host ||
      !username ||
      !applicationName ||
      !dbType ||
      !dbName ||
      !dbUsername ||
      !dbPassword
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, dbType, dbName, dbUsername, dbPassword",
      });
    }

    await ensureDatabaseInitialized();

    const app = await getApplicationByName(host, username, applicationName);
    if (!app) {
      return res.status(404).json({
        success: false,
        error: "Application not found. Please verify connection first.",
      });
    }

    logger.info(`[Database] Creating ${dbType} database: ${dbName}`);

    // Connect to server
    const ssh = new SSH2Client();
    await new Promise<void>((resolve, reject) => {
      ssh.on("ready", resolve);
      ssh.on("error", reject);
      ssh.connect({
        host,
        port: app.port || 22,
        username,
        privateKey: Buffer.from(app.sshPrivateKey),
        readyTimeout: 30000,
      });
    });

    let createDbCommand = "";
    if (dbType === "MySQL") {
      createDbCommand = `mysql -u root -e "CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\`; CREATE USER IF NOT EXISTS '${dbUsername}'@'localhost' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUsername}'@'localhost'; FLUSH PRIVILEGES;"`;
    } else if (dbType === "PostgreSQL") {
      createDbCommand = `sudo -u postgres createdb ${dbName} 2>/dev/null || true; sudo -u postgres psql -c "CREATE USER ${dbUsername} WITH PASSWORD '${dbPassword}';" 2>/dev/null || true; sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUsername};"`;
    }

    let stdout = "";
    let stderr = "";

    await new Promise<void>((resolve, reject) => {
      ssh.exec(createDbCommand, (err: any, stream: any) => {
        if (err) return reject(err);
        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        stream.on("close", () => resolve());
        stream.on("error", reject);
      });
    });

    ssh.end();

    logger.info(`[Database] Creation completed`);

    // Log success
    await addApplicationStep(
      app.id,
      "database-create",
      "success",
      JSON.stringify({
        dbType,
        dbName,
        dbUsername,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      })
    );

    res.json({
      success: true,
      message: `${dbType} database created successfully`,
      data: {
        dbType,
        dbName,
        dbUsername,
        host,
        port: dbPort,
      },
    });
  } catch (error: any) {
    logger.error(`[Database] Step failed: ${error.message}`);

    try {
      const app = await getApplicationByName(
        req.body.host,
        req.body.username,
        req.body.applicationName
      );
      if (app) {
        await addApplicationStep(
          app.id,
          "database-create",
          "failed",
          JSON.stringify({
            error: error.message,
            duration: Date.now() - startTime,
          })
        );
      }
    } catch (e) {}

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /step/folder-setup
 * Create application folder with proper ownership (can be re-executed)
 */
router.post("/step/folder-setup", async (req: Request, res: Response) => {
  const stepId = uuidv4();
  const startTime = Date.now();

  try {
    const { host, username, applicationName, pathname } = req.body;

    if (!host || !username || !applicationName || !pathname) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, pathname",
      });
    }

    await ensureDatabaseInitialized();

    const app = await getApplicationByName(host, username, applicationName);
    if (!app) {
      return res.status(404).json({
        success: false,
        error: "Application not found. Please verify connection first.",
      });
    }

    logger.info(`[Folder] Creating folder: ${pathname}`);

    // Connect to server
    const ssh = new SSH2Client();
    await new Promise<void>((resolve, reject) => {
      ssh.on("ready", resolve);
      ssh.on("error", reject);
      ssh.connect({
        host,
        port: app.port || 22,
        username,
        privateKey: Buffer.from(app.sshPrivateKey),
        readyTimeout: 30000,
      });
    });

    // Create folder
    await new Promise<void>((resolve, reject) => {
      ssh.exec(`sudo -n mkdir -p ${pathname}`, (err: any, stream: any) => {
        if (err) return reject(err);
        if (stream.stdin) stream.stdin.end();
        stream.on("close", () => resolve());
        stream.on("error", reject);
      });
    });

    // Set ownership
    await new Promise<void>((resolve, reject) => {
      ssh.exec(
        `sudo -n chown ${username}:${username} ${pathname}`,
        (err: any, stream: any) => {
          if (err) return reject(err);
          if (stream.stdin) stream.stdin.end();
          stream.on("close", () => resolve());
          stream.on("error", reject);
        }
      );
    });

    ssh.end();

    logger.info(`[Folder] Setup completed`);

    // Log success
    await addApplicationStep(
      app.id,
      "folder-setup",
      "success",
      JSON.stringify({
        pathname,
        owner: `${username}:${username}`,
        duration: Date.now() - startTime,
      })
    );

    res.json({
      success: true,
      message: "Application folder created successfully",
      data: {
        pathname,
        owner: `${username}:${username}`,
      },
    });
  } catch (error: any) {
    logger.error(`[Folder] Step failed: ${error.message}`);

    try {
      const app = await getApplicationByName(
        req.body.host,
        req.body.username,
        req.body.applicationName
      );
      if (app) {
        await addApplicationStep(
          app.id,
          "folder-setup",
          "failed",
          JSON.stringify({
            error: error.message,
            duration: Date.now() - startTime,
          })
        );
      }
    } catch (e) {}

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /steps/:host/:username/:applicationName
 * Get all step execution logs for an application
 */
router.get(
  "/steps/:host/:username/:applicationName",
  async (req: Request, res: Response) => {
    try {
      const { host, username, applicationName } = req.params;

      await ensureDatabaseInitialized();

      const app = await getApplicationByName(host, username, applicationName);
      if (!app) {
        return res.status(404).json({
          success: false,
          error: "Application not found",
        });
      }

      const steps = await getApplicationSteps(app.id);

      res.json({
        success: true,
        applicationName,
        host,
        username,
        steps: steps.map((step) => ({
          id: step.id,
          step: step.step,
          status: step.status,
          message: step.message,
          createdAt: step.createdAt,
        })),
      });
    } catch (error: any) {
      logger.error(`[Steps] Failed to fetch: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * GET /health
 * Health check
 */
router.get("/health", (req: Request, res: Response) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;
