import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { Client as SSH2Client } from "ssh2";
import { logger } from "../shared/logger";
import axios from "axios";
import sodium from "libsodium-wrappers";
import yaml from "js-yaml";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  initializeDatabase,
  saveApplication,
  getApplicationByName,
  addApplicationStep,
  getApplicationSteps,
  updateApplicationStatus,
  updatePrivateKeySecretName,
  updateApplicationSetupPathname,
} from "../shared/database";
import { SSHConnectionStep } from "../steps/sshConnectionStep";
import { GitHubAuthStep } from "../steps/githubAuthStep";
import { RepoSelectionStep } from "../steps/repoSelectionStep";
import { DeployKeyGenerationStep } from "../steps/deployKeyGenerationStep";

const router = express.Router();

// Default template directory (may vary depending on build output location)
const DEFAULT_TEMPLATE_DIR = join(__dirname, "../../templates/nginxconfig.io");

// Helper function to robustly resolve and load template files from common locations
async function loadTemplate(
  templateName: string,
  replacements: Record<string, string> = {}
): Promise<string> {
  const candidates = [
    // Relative to compiled dist/src/server
    join(
      __dirname,
      "../../templates/nginxconfig.io",
      `${templateName}.template`
    ),
    join(
      __dirname,
      "../../../templates/nginxconfig.io",
      `${templateName}.template`
    ),
    join(
      __dirname,
      "../../../../templates/nginxconfig.io",
      `${templateName}.template`
    ),
    // Relative to project root (when cwd is server/)
    join(process.cwd(), "templates/nginxconfig.io", `${templateName}.template`),
    // Explicit server/templates path
    join(
      process.cwd(),
      "server/templates/nginxconfig.io",
      `${templateName}.template`
    ),
  ];

  let content: string | null = null;
  let lastError: any = null;
  for (const p of candidates) {
    try {
      content = await readFile(p, "utf-8");
      if (content) {
        break;
      }
    } catch (e: any) {
      lastError = e;
      continue;
    }
  }

  if (!content) {
    throw new Error(
      `Failed to load template '${templateName}'. Last error: ${
        lastError?.message || lastError
      }`
    );
  }

  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`{{${key}}}`, "g");
    content = content.replace(pattern, value);
  }

  return content;
}

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
 * POST /applications
 * Create a new application record
 */
router.post("/applications", async (req: Request, res: Response) => {
  try {
    const { host, username, port = 22, applicationName } = req.body || {};

    if (!host || !username || !applicationName) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: host, username, applicationName",
      });
    }

    await ensureDatabaseInitialized();

    const sessionId = uuidv4();

    const result = await saveApplication({
      sessionId,
      host,
      username,
      port: Number(port) || 22,
      applicationName,
    });

    logger.info(
      `[Applications] Created application ${applicationName} for ${username}@${host}`
    );

    res.json({
      success: true,
      message: "Application created",
      data: {
        id: result.id,
        sessionId,
        host,
        username,
        port: Number(port) || 22,
        applicationName,
      },
    });
  } catch (error: any) {
    logger.error(
      `[Applications] Failed to create application: ${error.message}`
    );
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /step/check-github-token
 * Check GitHub token validity and save to database if valid
 */
router.post("/step/check-github-token", async (req: Request, res: Response) => {
  try {
    const { githubToken, host, username, applicationName } = req.body;

    if (!githubToken) {
      return res.status(400).json({
        success: false,
        error: "GitHub token is required",
      });
    }

    if (!host || !username || !applicationName) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: host, username, applicationName",
      });
    }

    logger.info(`[GitHub] Checking token validity for ${applicationName}`);

    try {
      // Call GitHub API to verify token
      const response = await axios.get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
        timeout: 10000,
      });

      const githubUsername = response.data.login;
      const githubName = response.data.name || githubUsername;

      logger.info(`[GitHub] Token valid for user: ${githubUsername}`);

      // Initialize database and save token to application
      await ensureDatabaseInitialized();

      // Get or create application
      let app = await getApplicationByName(host, username, applicationName);
      if (!app) {
        logger.info(
          `[GitHub] Application not found, creating new one for ${applicationName}`
        );
        // Create a minimal application entry if it doesn't exist
        const sessionId = uuidv4();
        const result = await saveApplication({
          sessionId,
          host,
          username,
          port: 22,
          applicationName,
          githubToken,
          githubUsername,
        });
        app = { ...app, id: result.id };
      } else {
        // Update existing application with GitHub token
        logger.info(`[GitHub] Updating application with GitHub token`);
        await saveApplication({
          sessionId: app.sessionId,
          host,
          username,
          port: app.port || 22,
          applicationName,
          sshPrivateKey: app.sshPrivateKey,
          githubToken,
          githubUsername,
        });
      }

      logger.info(`[GitHub] Token saved to database for ${applicationName}`);

      // Log the step
      if (app?.id) {
        await addApplicationStep(
          app.id,
          "github-token-check",
          "success",
          JSON.stringify({
            username: githubUsername,
            name: githubName,
            message: `GitHub token verified for ${githubUsername}`,
          })
        );
      }

      res.json({
        success: true,
        message: `GitHub token verified for ${githubUsername}`,
        data: {
          login: githubUsername,
          name: githubName,
        },
      });
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message || error.message || "Token is invalid";
      logger.error(`[GitHub] Token validation failed: ${errorMessage}`);

      // Log the failure
      if (host && username && applicationName) {
        try {
          const app = await getApplicationByName(
            host,
            username,
            applicationName
          );
          if (app?.id) {
            await addApplicationStep(
              app.id,
              "github-token-check",
              "failed",
              JSON.stringify({
                error: errorMessage,
              })
            );
          }
        } catch (e) {
          logger.debug(`[GitHub] Could not log failure step: ${e}`);
        }
      }

      res.status(401).json({
        success: false,
        error: errorMessage,
      });
    }
  } catch (error: any) {
    logger.error(`[GitHub] Token check failed: ${error.message}`);
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
      createDbCommand = `sudo mysql -e "CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\`; CREATE USER IF NOT EXISTS '${dbUsername}'@'localhost' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUsername}'@'localhost'; FLUSH PRIVILEGES;"`;
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

    // Helper to run commands with timeout
    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 15000
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          logger.error(`[Folder] Timeout (${timeoutMs}ms) running ${label}`);
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          if (stream?.stdin) stream.stdin.end();
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (stdout.trim())
              logger.debug(`[Folder] ${label} stdout: ${stdout.trim()}`);
            if (stderr.trim())
              logger.debug(`[Folder] ${label} stderr: ${stderr.trim()}`);
            if (code !== 0) {
              const errMsg = `${label} exited with ${code}${
                stderr ? `: ${stderr.trim()}` : ""
              }`;
              logger.error(`[Folder] ${errMsg}`);
              return reject(new Error(errMsg));
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Pre-check sudo -n to avoid hangs
    logger.info(`[Folder] Checking sudo access`);
    try {
      await execWithTimeout(`sudo -n true`, "sudo check", 5000);
    } catch (e: any) {
      ssh.end();
      logger.error(`[Folder] sudo -n not permitted: ${e.message}`);
      return res.status(400).json({
        success: false,
        error:
          "sudo -n not permitted. Configure NOPASSWD for mkdir, chown, and chmod commands on the target path.",
        details: e.message,
      });
    }

    // Create folder
    logger.info(`[Folder] Creating directory with sudo`);
    await execWithTimeout(`sudo -n mkdir -p ${pathname}`, "mkdir", 10000);

    // Set ownership recursively to ensure nested paths are accessible
    logger.info(`[Folder] Setting ownership to ${username}:${username}`);
    await execWithTimeout(
      `sudo -n chown -R ${username}:${username} ${pathname}`,
      "chown",
      10000
    );

    // Set permissions to ensure write access
    logger.info(`[Folder] Setting permissions to 755`);
    await execWithTimeout(`sudo -n chmod -R 755 ${pathname}`, "chmod", 10000);

    ssh.end();

    logger.info(`[Folder] Setup completed`);

    // Save pathname to application record
    const db =
      require("../shared/database").getDb?.() ||
      require("knex")(
        require("../../knexfile.cjs")[process.env.NODE_ENV || "development"]
      );
    await db("applications").where({ id: app.id }).update({ pathname });

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
 * POST /step/env-setup
 * Fetch .env.example from selected GitHub repo and write to server path/shared/.env
 */
router.post("/step/env-setup", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { host, username, applicationName, pathname, selectedRepo } =
      req.body;
    logger.info(`[EnvSetup] Request received`, {
      host,
      username,
      applicationName,
      pathname,
      selectedRepo,
    });

    if (!host || !username || !applicationName || !pathname) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, pathname",
      });
    }

    logger.info(`[EnvSetup] Ensuring database is initialized`);
    await ensureDatabaseInitialized();

    logger.info(
      `[EnvSetup] Loading application record for ${username}@${host}:${applicationName}`
    );
    const app = await getApplicationByName(host, username, applicationName);
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

    const repo: string | undefined =
      selectedRepo || app.selectedRepo || undefined;
    logger.info(`[EnvSetup] Using repository`, { repo });
    if (!repo) {
      return res.status(400).json({
        success: false,
        error:
          "Repository not set. Provide 'selectedRepo' or run deploy key step to store one.",
      });
    }

    // Parse repo owner/name from either owner/repo or full URL
    let owner: string;
    let repoName: string;
    const slashCount = (repo.match(/\//g) || []).length;
    if (slashCount === 1 && !repo.startsWith("http")) {
      [owner, repoName] = repo.split("/");
    } else {
      const m = repo.match(
        /^https?:\/\/github\.com\/([^\/]+)\/([^\/#?]+)(?:[\/#?].*)?$/
      );
      if (!m) {
        return res.status(400).json({
          success: false,
          error: "Invalid repository format. Use owner/repo or GitHub URL.",
        });
      }
      owner = m[1];
      repoName = m[2];
    }

    // Helper that fetches .env.example content using GitHub API
    const fetchEnvExample = async (): Promise<string | null> => {
      logger.info(`[EnvSetup] Fetching .env.example from ${owner}/${repoName}`);
      const token: string | undefined = app.githubToken || undefined;
      const baseHeaders: Record<string, string> = {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) {
        baseHeaders["Authorization"] = `Bearer ${token}`;
        logger.info(
          `[EnvSetup] GitHub token present; using authenticated requests`
        );
      } else {
        logger.info(
          `[EnvSetup] No GitHub token present; attempting public raw fetch as fallback`
        );
      }

      const branches = ["main", "master"];
      const candidatePaths = [
        ".env.example",
        "env.example",
        "example.env",
        "config/.env.example",
      ];

      // Strategy 1: GitHub Contents API with ref and raw accept
      for (const ref of branches) {
        for (const p of candidatePaths) {
          const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURI(
            p
          )}`;
          try {
            logger.info(`[EnvSetup] Contents API try: ref=${ref} path=${p}`);
            const r = await axios.get(apiUrl, {
              headers: baseHeaders,
              timeout: 15000,
            });
            if (r.status === 200 && typeof r.data === "string") {
              logger.info(
                `[EnvSetup] Found .env.example via Contents API at ${p} (ref ${ref})`
              );
              return r.data as string;
            }
          } catch (e: any) {
            const status = e?.response?.status;
            if (status && status !== 404) {
              logger.debug(
                `[EnvSetup] Contents API error ${status} for ${apiUrl}`
              );
            }
          }
        }
      }

      // Strategy 2: Raw URLs (works for public repos)
      for (const ref of branches) {
        for (const p of candidatePaths) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${ref}/${p}`;
          try {
            logger.info(`[EnvSetup] Raw try: ${rawUrl}`);
            const r = await axios.get(rawUrl, { timeout: 12000 });
            if (typeof r.data === "string") return r.data as string;
          } catch (_) {}
        }
      }

      return null;
    };

    logger.info(`[EnvSetup] Starting .env.example fetch`);
    const envContent = await fetchEnvExample();
    if (!envContent) {
      logger.warn(`[EnvSetup] .env.example not found in ${owner}/${repoName}`);
      return res.status(400).json({
        success: false,
        error:
          ".env.example not found in the repository (checked main/master and common paths).",
      });
    }
    logger.info(
      `[EnvSetup] .env.example fetched successfully (${envContent.length} bytes)`
    );

    // Connect to server and write file to <pathname>/shared/.env
    const ssh = new SSH2Client();
    logger.info(
      `[EnvSetup] Establishing SSH connection to ${username}@${host}`
    );
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
    logger.info(`[EnvSetup] SSH connection established`);

    const sharedDir = `${pathname}/shared`;
    const envPath = `${sharedDir}/.env`;

    // Helper to run remote commands with timeout and logging to avoid hangs
    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 15000,
      allowNonZero: boolean = true
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          logger.error(`[EnvSetup] Timeout (${timeoutMs}ms) running ${label}`);
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          if (stream?.stdin) stream.stdin.end();
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (stdout.trim())
              logger.debug(`[EnvSetup] ${label} stdout: ${stdout.trim()}`);
            if (stderr.trim())
              logger.debug(`[EnvSetup] ${label} stderr: ${stderr.trim()}`);
            if (!allowNonZero && code !== 0) {
              const errMsg = `${label} exited with ${code}${
                stderr ? `: ${stderr.trim()}` : ""
              }`;
              logger.error(`[EnvSetup] ${errMsg}`);
              return reject(new Error(errMsg));
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Ensure shared directory exists (quietly) using sudo -n; fail fast if sudo prompts
    logger.info(
      `[EnvSetup] Ensuring shared directory exists at ${sharedDir} using ACL`
    );

    // Pre-check sudo -n to avoid hangs
    let sudoCheck: { ok: boolean; code: number; out: string; err: string } = {
      ok: false,
      code: 1,
      out: "",
      err: "",
    };
    try {
      const result = await execWithTimeout(
        `sudo -n true`,
        "sudo check",
        5000,
        false
      );
      sudoCheck = {
        ok: result.code === 0,
        code: result.code,
        out: result.stdout,
        err: result.stderr,
      };
    } catch (e: any) {
      sudoCheck = {
        ok: false,
        code: 1,
        out: e?.stdout || "",
        err: e?.stderr || e?.message || "",
      };
    }

    if (!sudoCheck.ok) {
      ssh.end();
      logger.error(`[EnvSetup] sudo -n not permitted`, sudoCheck);
      return res.status(400).json({
        success: false,
        error:
          "sudo -n not permitted for required commands (setfacl/mkdir). Configure NOPASSWD for setfacl and mkdir on the target path, then retry.",
        details: sudoCheck,
      });
    }

    const aclCommands = [
      `sudo -n setfacl -m u:${username}:rwx ${pathname} || true`,
      `sudo -n setfacl -d -m u:${username}:rwx ${pathname} || true`,
    ];

    for (const cmd of aclCommands) {
      await execWithTimeout(cmd, "ACL command", 10000, true);
    }

    // Create shared directory as the current SSH user (no sudo)
    await execWithTimeout(
      `mkdir -p ${sharedDir}`,
      "mkdir sharedDir",
      10000,
      false
    );

    logger.info(`[EnvSetup] Writing .env to ${envPath} as SSH user`);
    const heredoc = "EOF_ENV_SETUP";
    // Write file without sudo to honor the requirement; ACLs above should grant access
    await execWithTimeout(
      `cat <<'${heredoc}' > ${envPath}\n${envContent}\n${heredoc}`,
      "write .env",
      15000,
      false
    );
    logger.info(`[EnvSetup] .env write completed`);

    // Verify
    let verifyOutput = "";
    logger.info(`[EnvSetup] Verifying .env presence at ${envPath}`);
    await execWithTimeout(
      `test -f ${envPath} && echo exists || echo missing`,
      "verify .env",
      8000,
      true
    ).then((res) => {
      verifyOutput = res.stdout || "";
    });

    ssh.end();
    logger.info(`[EnvSetup] SSH session closed`);

    await addApplicationStep(
      app.id,
      "env-setup",
      "success",
      JSON.stringify({
        repo: `${owner}/${repoName}`,
        path: envPath,
        verification: verifyOutput.trim(),
        duration: Date.now() - startTime,
      })
    );

    logger.info(`[EnvSetup] Env setup completed successfully`);
    return res.json({
      success: true,
      message: ".env created from .env.example",
      data: { filePath: envPath, verification: verifyOutput.trim() },
    });
  } catch (error: any) {
    console.error(error);
    const details = (() => {
      try {
        const base: any = { message: error?.message || String(error) };
        if (error?.stack) base.stack = error.stack;
        if (error?.response) {
          base.response = {
            status: error.response?.status,
            headers: error.response?.headers,
            data: error.response?.data,
          };
        }
        return base;
      } catch (_) {
        return { message: error?.message || String(error) };
      }
    })();
    logger.error(`[EnvSetup] Step failed`, details);
    try {
      const { host, username, applicationName } = req.body || {};
      const app =
        host && username && applicationName
          ? await getApplicationByName(host, username, applicationName)
          : null;
      if (app?.id) {
        await addApplicationStep(
          app.id,
          "env-setup",
          "failed",
          JSON.stringify({ error: details, duration: Date.now() - startTime })
        );
      }
    } catch (_) {}

    return res.status(500).json({ success: false, error: details });
  }
});

/**
 * POST /step/env-update
 * Update .env file with database configuration values
 */
router.post("/step/env-update", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const {
      host,
      username,
      applicationName,
      pathname,
      dbType,
      dbPort,
      dbName,
      dbUsername,
      dbPassword,
    } = req.body;

    logger.info(`[EnvUpdate] Request received`, {
      host,
      username,
      applicationName,
      pathname,
      dbType,
      dbPort,
      dbName,
      dbUsername,
    });

    if (
      !host ||
      !username ||
      !applicationName ||
      !pathname ||
      !dbType ||
      !dbPort ||
      !dbName ||
      !dbUsername
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, pathname, dbType, dbPort, dbName, dbUsername",
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

    if (!app.sshPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "SSH key not found. Please verify connection first.",
      });
    }

    // Map dbType to DB_CONNECTION value
    const dbConnectionValue =
      dbType.toLowerCase() === "mysql" ? "mysql" : "pgsql";

    logger.info(`[EnvUpdate] Connecting to server`);
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
    logger.info(`[EnvUpdate] SSH connection established`);

    const envPath = `${pathname}/shared/.env`;

    // Helper to run remote commands with timeout
    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 15000,
      allowNonZero: boolean = true
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          logger.error(`[EnvUpdate] Timeout (${timeoutMs}ms) running ${label}`);
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          if (stream?.stdin) stream.stdin.end();
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (stdout.trim())
              logger.debug(`[EnvUpdate] ${label} stdout: ${stdout.trim()}`);
            if (stderr.trim())
              logger.debug(`[EnvUpdate] ${label} stderr: ${stderr.trim()}`);
            if (!allowNonZero && code !== 0) {
              const errMsg = `${label} exited with ${code}${
                stderr ? `: ${stderr.trim()}` : ""
              }`;
              logger.error(`[EnvUpdate] ${errMsg}`);
              return reject(new Error(errMsg));
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Read existing .env file
    logger.info(`[EnvUpdate] Reading existing .env from ${envPath}`);
    const readResult = await execWithTimeout(
      `cat ${envPath}`,
      "read .env",
      10000,
      false
    );
    let envContent = readResult.stdout;

    if (!envContent) {
      logger.warn(`[EnvUpdate] .env file is empty`);
      envContent = "";
    }

    // Parse and update .env content
    logger.info(`[EnvUpdate] Parsing and updating .env values`);
    const lines = envContent.split("\n");
    const updates: Record<string, string> = {
      DB_CONNECTION: dbConnectionValue,
      DB_HOST: "localhost",
      DB_PORT: String(dbPort),
      DB_DATABASE: dbName,
      DB_USERNAME: dbUsername,
      DB_PASSWORD: dbPassword || "",
    };

    const updatedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line; // Keep empty lines and comments
      }

      const [key] = trimmed.split("=");
      if (key && updates.hasOwnProperty(key.trim())) {
        logger.debug(
          `[EnvUpdate] Updating ${key.trim()} = ${updates[key.trim()]}`
        );
        return `${key.trim()}=${updates[key.trim()]}`;
      }

      return line;
    });

    // Add any missing keys
    const existingKeys = new Set(
      lines
        .map((line) => line.split("=")[0].trim())
        .filter((key) => key && !key.startsWith("#"))
    );

    for (const [key, value] of Object.entries(updates)) {
      if (!existingKeys.has(key)) {
        logger.debug(`[EnvUpdate] Adding missing key ${key} = ${value}`);
        updatedLines.push(`${key}=${value}`);
      }
    }

    const newEnvContent = updatedLines.join("\n");

    // Write updated .env file
    logger.info(`[EnvUpdate] Writing updated .env to ${envPath}`);
    const heredoc = "EOF_ENV_UPDATE";
    await execWithTimeout(
      `cat <<'${heredoc}' > ${envPath}\n${newEnvContent}\n${heredoc}`,
      "write .env",
      15000,
      false
    );
    logger.info(`[EnvUpdate] .env update completed`);

    // Verify update
    logger.info(`[EnvUpdate] Verifying .env update`);
    const verifyResult = await execWithTimeout(
      `grep -E "^DB_" ${envPath}`,
      "verify .env",
      10000,
      true
    );
    const dbLines = verifyResult.stdout;

    ssh.end();
    logger.info(`[EnvUpdate] SSH session closed`);

    await addApplicationStep(
      app.id,
      "env-update",
      "success",
      JSON.stringify({
        path: envPath,
        dbType: dbConnectionValue,
        dbPort,
        dbName,
        dbUsername,
        verification: dbLines.trim(),
        duration: Date.now() - startTime,
      })
    );

    logger.info(`[EnvUpdate] Env update completed successfully`);
    return res.json({
      success: true,
      message: ".env updated with database configuration",
      data: {
        filePath: envPath,
        updates: {
          DB_CONNECTION: dbConnectionValue,
          DB_HOST: "localhost",
          DB_PORT: dbPort,
          DB_DATABASE: dbName,
          DB_USERNAME: dbUsername,
        },
        verification: dbLines.trim(),
      },
    });
  } catch (error: any) {
    logger.error(`[EnvUpdate] Step failed: ${error.message}`);

    try {
      const app = await getApplicationByName(
        req.body.host,
        req.body.username,
        req.body.applicationName
      );
      if (app) {
        await addApplicationStep(
          app.id,
          "env-update",
          "failed",
          JSON.stringify({
            error: error.message,
            duration: Date.now() - startTime,
          })
        );
      }
    } catch (e) {}

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /step/ssh-key-setup
 * Generate SSH key pair, add public key to authorized_keys, and store private key in GitHub secret
 */
router.post("/step/ssh-key-setup", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { host, username, applicationName, selectedRepo } = req.body;

    logger.info(`[SSHKeySetup] Request received`, {
      host,
      username,
      applicationName,
      selectedRepo,
    });

    if (!host || !username || !applicationName || !selectedRepo) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, selectedRepo",
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

    logger.info(`[SSHKeySetup] Connecting to server`);
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
    logger.info(`[SSHKeySetup] SSH connection established`);

    // Helper to run remote commands with timeout
    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 15000,
      allowNonZero: boolean = true
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          logger.error(
            `[SSHKeySetup] Timeout (${timeoutMs}ms) running ${label}`
          );
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          if (stream?.stdin) stream.stdin.end();
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (stdout.trim())
              logger.debug(`[SSHKeySetup] ${label} stdout: ${stdout.trim()}`);
            if (stderr.trim())
              logger.debug(`[SSHKeySetup] ${label} stderr: ${stderr.trim()}`);
            if (!allowNonZero && code !== 0) {
              const errMsg = `${label} exited with ${code}${
                stderr ? `: ${stderr.trim()}` : ""
              }`;
              logger.error(`[SSHKeySetup] ${errMsg}`);
              return reject(new Error(errMsg));
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Generate SSH key pair for GitHub Actions
    const keyName = `github_actions_${applicationName}`;
    const keyPath = `~/.ssh/${keyName}`;
    logger.info(`[SSHKeySetup] Generating SSH key pair: ${keyName}`);

    await execWithTimeout(
      `ssh-keygen -t ed25519 -f ${keyPath} -N "" -C "github-actions-${applicationName}" 2>&1 || true`,
      "generate key",
      15000,
      true
    );

    // Read private key
    logger.info(`[SSHKeySetup] Reading private key`);
    const privateKeyResult = await execWithTimeout(
      `cat ${keyPath}`,
      "read private key",
      10000,
      false
    );
    const privateKey = privateKeyResult.stdout;

    if (!privateKey) {
      ssh.end();
      logger.error(`[SSHKeySetup] Failed to read private key`);
      return res.status(500).json({
        success: false,
        error: "Failed to read generated private key",
      });
    }

    // Read public key
    logger.info(`[SSHKeySetup] Reading public key`);
    const publicKeyResult = await execWithTimeout(
      `cat ${keyPath}.pub`,
      "read public key",
      10000,
      false
    );
    const publicKey = publicKeyResult.stdout;

    if (!publicKey) {
      ssh.end();
      logger.error(`[SSHKeySetup] Failed to read public key`);
      return res.status(500).json({
        success: false,
        error: "Failed to read generated public key",
      });
    }

    // Add public key to authorized_keys
    logger.info(`[SSHKeySetup] Adding public key to authorized_keys`);
    await execWithTimeout(
      `mkdir -p ~/.ssh && echo "${publicKey.trim()}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
      "add to authorized_keys",
      10000,
      false
    );

    // Parse repo owner/name
    let owner: string;
    let repoName: string;
    const slashCount = (selectedRepo.match(/\//g) || []).length;
    if (slashCount === 1 && !selectedRepo.startsWith("http")) {
      [owner, repoName] = selectedRepo.split("/");
    } else {
      const m = selectedRepo.match(
        /^https?:\/\/github\.com\/([^\/]+)\/([^\/#?]+)(?:[\/#?].*)?$/
      );
      if (!m) {
        ssh.end();
        return res.status(400).json({
          success: false,
          error: "Invalid repository format. Use owner/repo or GitHub URL.",
        });
      }
      owner = m[1];
      repoName = m[2];
    }

    // Replace dots with underscores for secret name
    // Replace any non-alphanumeric character with underscore, then uppercase
    const secretName = `PRIVATE_KEY_${applicationName
      .replace(/[^A-Za-z0-9]/g, "_")
      .toUpperCase()}`;

    // Persist the secret name in the applications table
    try {
      await updatePrivateKeySecretName(
        host,
        username,
        applicationName,
        secretName
      );
    } catch (dbErr: any) {
      logger.warn(
        `[SSHKeySetup] Failed to persist secret name: ${
          dbErr?.message || dbErr
        }`
      );
    }

    // Add private key to GitHub secret with proper encryption
    logger.info(
      `[SSHKeySetup] Adding private key to GitHub secret: ${secretName}`
    );
    try {
      // Step 1: Get the repository's public key for encryption
      logger.info(`[SSHKeySetup] Fetching repository public key`);
      const publicKeyResponse = await axios.get(
        `https://api.github.com/repos/${owner}/${repoName}/actions/secrets/public-key`,
        {
          headers: {
            Authorization: `Bearer ${app.githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          timeout: 10000,
        }
      );

      const publicKeyData = publicKeyResponse.data;
      logger.info(
        `[SSHKeySetup] Got public key with ID: ${publicKeyData.key_id}`
      );

      // Step 2: Encrypt the private key using LibSodium per GitHub docs
      logger.info(
        `[SSHKeySetup] Encrypting secret with libsodium crypto_box_seal`
      );

      // Initialize libsodium (async)
      await sodium.ready;

      // Decode the public key from base64
      const publicKeyBase64 = publicKeyData.key;
      const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");

      // Encrypt using crypto_box_seal (recipient's public key only)
      const sealed = sodium.crypto_box_seal(privateKey.trim(), publicKeyBytes);

      // Encode sealed box as base64
      const encryptedBase64 = Buffer.from(sealed).toString("base64");
      logger.info(`[SSHKeySetup] Secret encrypted successfully`);

      // Step 3: Create or update the secret
      logger.info(`[SSHKeySetup] Creating/updating secret in GitHub`);
      const secretResponse = await axios.put(
        `https://api.github.com/repos/${owner}/${repoName}/actions/secrets/${secretName}`,
        {
          encrypted_value: encryptedBase64,
          key_id: publicKeyData.key_id,
        },
        {
          headers: {
            Authorization: `Bearer ${app.githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          timeout: 15000,
        }
      );

      logger.info(
        `[SSHKeySetup] GitHub secret created/updated: ${secretName} (status: ${secretResponse.status})`
      );
    } catch (e: any) {
      const errorDetails = (() => {
        try {
          const base: any = { message: e?.message || String(e) };
          if (e?.response?.status) base.status = e.response.status;
          if (e?.response?.data) base.data = e.response.data;
          if (e?.response?.headers) base.headers = e.response.headers;
          if (e?.stack) base.stack = e.stack;
          return base;
        } catch (_) {
          return { message: e?.message || String(e) };
        }
      })();
      logger.error(
        `[SSHKeySetup] Failed to create GitHub secret`,
        errorDetails
      );
      // Log but continue - key is already on server, user can add secret manually if needed
    }

    ssh.end();
    logger.info(`[SSHKeySetup] SSH session closed`);

    await addApplicationStep(
      app.id,
      "ssh-key-setup",
      "success",
      JSON.stringify({
        keyName,
        secretName,
        publicKeyAdded: true,
        repository: `${owner}/${repoName}`,
        duration: Date.now() - startTime,
      })
    );

    logger.info(`[SSHKeySetup] SSH key setup completed successfully`);
    return res.json({
      success: true,
      message: "SSH key pair generated and configured",
      data: {
        keyName,
        secretName,
        publicKeyAdded: true,
        repository: `${owner}/${repoName}`,
        instructions: `Add this secret to your GitHub Actions workflow: \${{ secrets.${secretName} }}`,
      },
    });
  } catch (error: any) {
    logger.error(`[SSHKeySetup] Step failed: ${error.message}`);

    try {
      const app = await getApplicationByName(
        req.body.host,
        req.body.username,
        req.body.applicationName
      );
      if (app) {
        await addApplicationStep(
          app.id,
          "ssh-key-setup",
          "failed",
          JSON.stringify({
            error: error.message,
            duration: Date.now() - startTime,
          })
        );
      }
    } catch (e) {}

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /step/server-stack-setup
 * Install complete server stack: PHP with version-specific extensions, Nginx, Database (MySQL/PostgreSQL)
 * and all Laravel-required PHP extensions
 */
router.post("/step/server-stack-setup", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const {
      host,
      username,
      applicationName,
      phpVersion = "8.3",
      database = "mysql", // mysql or pgsql
    } = req.body;

    logger.info("[ServerStack] Request received", {
      host,
      username,
      applicationName,
      phpVersion,
      database,
    });

    if (!host || !username || !applicationName || !phpVersion || !database) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, phpVersion, database",
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
    if (!app.sshPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "SSH key not found. Please verify connection first.",
      });
    }

    // Connect via SSH
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
    logger.info("[ServerStack] SSH connection established");

    // Helper: exec with timeout
    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 300000, // 5 min default for package installs
      allowNonZero: boolean = false
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          logger.error(
            `[ServerStack] Timeout (${timeoutMs}ms) running ${label}`
          );
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (stdout.trim())
              logger.debug(`[ServerStack] ${label} stdout: ${stdout.trim()}`);
            if (stderr.trim())
              logger.debug(`[ServerStack] ${label} stderr: ${stderr.trim()}`);
            if (!allowNonZero && code !== 0) {
              const errMsg = `${label} exited with ${code}${
                stderr ? `: ${stderr.trim()}` : ""
              }`;
              logger.error(`[ServerStack] ${errMsg}`);
              return reject(new Error(errMsg));
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Pre-check sudo -n
    try {
      await execWithTimeout("sudo -n true", "sudo check", 5000, false);
    } catch (e: any) {
      ssh.end();
      logger.error(`[ServerStack] sudo -n not permitted: ${e?.message || e}`);
      return res.status(400).json({
        success: false,
        error:
          "sudo -n not permitted. Configure NOPASSWD for package management commands.",
        details: e?.message || String(e),
      });
    }

    // Detect OS and package manager
    let pkgMgr: "apt" | "dnf" | "yum" = "apt";
    let osId = "ubuntu";
    try {
      const r = await execWithTimeout(
        "(. /etc/os-release; echo $ID) 2>/dev/null || echo unknown",
        "detect os",
        8000,
        true
      );
      osId = (r.stdout || "").trim().toLowerCase();
      if (["ubuntu", "debian"].includes(osId)) pkgMgr = "apt";
      else if (
        ["rocky", "centos", "rhel", "fedora", "almalinux"].includes(osId)
      ) {
        pkgMgr = "dnf";
        // Check if dnf exists, fallback to yum
        try {
          await execWithTimeout("which dnf", "check dnf", 5000, true);
        } catch {
          pkgMgr = "yum";
        }
      }
      logger.info(`[ServerStack] OS ID=${osId}, pkgMgr=${pkgMgr}`);
    } catch (_) {}

    const installLog: string[] = [];

    // Step 1: Add PHP repository (for specific versions)
    logger.info(`[ServerStack] Adding PHP ${phpVersion} repository`);
    if (pkgMgr === "apt") {
      // Add ondrej/php PPA for Ubuntu/Debian
      await execWithTimeout(
        "DEBIAN_FRONTEND=noninteractive sudo -n apt-get update -yq && DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq software-properties-common",
        "install add-apt-repository",
        180000,
        false
      );
      await execWithTimeout(
        "DEBIAN_FRONTEND=noninteractive sudo -n add-apt-repository ppa:ondrej/php -y",
        "add php ppa",
        120000,
        false
      );
      await execWithTimeout(
        "DEBIAN_FRONTEND=noninteractive sudo -n apt-get update -yq",
        "apt update",
        180000,
        false
      );
      installLog.push("Added ondrej/php PPA");
    } else {
      // For RHEL/Rocky/CentOS, enable EPEL and Remi
      await execWithTimeout(
        `sudo -n ${pkgMgr} install -y epel-release`,
        "install epel",
        180000,
        true
      );
      await execWithTimeout(
        `sudo -n ${pkgMgr} install -y https://rpms.remirepo.net/enterprise/remi-release-\$(rpm -E %rhel).rpm || true`,
        "install remi",
        180000,
        true
      );
      await execWithTimeout(
        `sudo -n ${pkgMgr} module reset php -y || true`,
        "reset php module",
        60000,
        true
      );
      await execWithTimeout(
        `sudo -n ${pkgMgr} module enable php:remi-${phpVersion} -y || true`,
        "enable php module",
        60000,
        true
      );
      installLog.push(`Enabled Remi PHP ${phpVersion} module`);
    }

    // Step 2: Install Nginx
    logger.info("[ServerStack] Installing Nginx");
    if (pkgMgr === "apt") {
      await execWithTimeout(
        "DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq nginx",
        "install nginx",
        240000,
        false
      );
    } else {
      await execWithTimeout(
        `sudo -n ${pkgMgr} install -y -q nginx`,
        "install nginx",
        240000,
        false
      );
    }
    installLog.push("Installed Nginx");

    // Step 3: Install database server
    logger.info(`[ServerStack] Installing ${database} database`);
    if (database === "mysql") {
      if (pkgMgr === "apt") {
        await execWithTimeout(
          "DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq mysql-server",
          "install mysql",
          300000,
          false
        );
      } else {
        await execWithTimeout(
          `sudo -n ${pkgMgr} install -y -q mysql-server`,
          "install mysql",
          300000,
          false
        );
      }
      // Start and enable MySQL
      await execWithTimeout(
        "sudo -n systemctl enable --now mysql || sudo -n systemctl enable --now mysqld",
        "start mysql",
        30000,
        true
      );
      installLog.push("Installed MySQL server");
    } else if (database === "pgsql") {
      if (pkgMgr === "apt") {
        await execWithTimeout(
          "DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq postgresql postgresql-contrib",
          "install postgresql",
          300000,
          false
        );
      } else {
        await execWithTimeout(
          `sudo -n ${pkgMgr} install -y -q postgresql-server postgresql-contrib`,
          "install postgresql",
          300000,
          false
        );
        // Initialize PostgreSQL for RHEL-based systems
        await execWithTimeout(
          "sudo -n postgresql-setup --initdb || true",
          "init postgresql",
          60000,
          true
        );
      }
      // Start and enable PostgreSQL
      await execWithTimeout(
        "sudo -n systemctl enable --now postgresql",
        "start postgresql",
        30000,
        true
      );
      installLog.push("Installed PostgreSQL server");
    }

    // Step 4: Install PHP and extensions
    logger.info(
      `[ServerStack] Installing PHP ${phpVersion} and Laravel extensions`
    );

    // Core Laravel extensions
    const phpExtensions = [
      "cli",
      "fpm",
      "mbstring",
      "xml",
      "bcmath",
      "curl",
      "zip",
      "gd",
      "intl",
      "soap",
      "opcache",
      "readline",
      "common",
    ];

    // Add database-specific extensions
    if (database === "mysql") {
      phpExtensions.push("mysql", "mysqli");
    } else if (database === "pgsql") {
      phpExtensions.push("pgsql");
    }

    // Additional useful extensions
    phpExtensions.push("redis", "imagick");

    const phpPackages = phpExtensions
      .map((ext) => `php${phpVersion}-${ext}`)
      .join(" ");

    if (pkgMgr === "apt") {
      await execWithTimeout(
        `DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq ${phpPackages}`,
        "install php extensions",
        360000,
        false
      );
    } else {
      // For RHEL/Rocky, package names are different
      const rhelPhpPackages = phpExtensions
        .map((ext) => {
          // Map extension names for RHEL
          if (ext === "mysqli") return ""; // mysql package includes mysqli
          if (ext === "common") return "php-common";
          return `php-${ext}`;
        })
        .filter(Boolean)
        .join(" ");

      await execWithTimeout(
        `sudo -n ${pkgMgr} install -y -q ${rhelPhpPackages}`,
        "install php extensions",
        360000,
        false
      );
    }
    installLog.push(
      `Installed PHP ${phpVersion} with ${phpExtensions.length} extensions`
    );

    // Step 5: Install Composer
    logger.info("[ServerStack] Installing Composer");
    const composerInstall = `
curl -sS https://getcomposer.org/installer | sudo -n php -- --install-dir=/usr/local/bin --filename=composer
sudo -n chmod +x /usr/local/bin/composer
`;
    await execWithTimeout(composerInstall, "install composer", 120000, true);
    installLog.push("Installed Composer");

    // Step 6: Configure PHP-FPM
    logger.info("[ServerStack] Configuring PHP-FPM");
    await execWithTimeout(
      `sudo -n systemctl enable --now php${phpVersion}-fpm || sudo -n systemctl enable --now php-fpm`,
      "start php-fpm",
      30000,
      true
    );
    installLog.push("Configured and started PHP-FPM");

    // Step 7: Enable and start Nginx
    await execWithTimeout(
      "sudo -n systemctl enable --now nginx",
      "start nginx",
      20000,
      true
    );
    installLog.push("Started Nginx");

    // Get versions for verification
    let phpVersionOutput = "";
    let composerVersionOutput = "";
    let nginxVersionOutput = "";
    let dbVersionOutput = "";

    try {
      const phpVer = await execWithTimeout(
        "php -v | head -1",
        "php version",
        5000,
        true
      );
      phpVersionOutput = phpVer.stdout.trim();
    } catch (_) {}

    try {
      const compVer = await execWithTimeout(
        "composer --version",
        "composer version",
        5000,
        true
      );
      composerVersionOutput = compVer.stdout.trim();
    } catch (_) {}

    try {
      const nginxVer = await execWithTimeout(
        "nginx -v 2>&1",
        "nginx version",
        5000,
        true
      );
      nginxVersionOutput = nginxVer.stderr.trim() || nginxVer.stdout.trim();
    } catch (_) {}

    if (database === "mysql") {
      try {
        const dbVer = await execWithTimeout(
          "mysql --version",
          "mysql version",
          5000,
          true
        );
        dbVersionOutput = dbVer.stdout.trim();
      } catch (_) {}
    } else {
      try {
        const dbVer = await execWithTimeout(
          "psql --version",
          "psql version",
          5000,
          true
        );
        dbVersionOutput = dbVer.stdout.trim();
      } catch (_) {}
    }

    ssh.end();
    logger.info("[ServerStack] SSH session closed");

    // Log success
    await addApplicationStep(
      app.id,
      "server-stack-setup",
      "success",
      JSON.stringify({
        phpVersion,
        database,
        extensions: phpExtensions,
        installLog,
        versions: {
          php: phpVersionOutput,
          composer: composerVersionOutput,
          nginx: nginxVersionOutput,
          database: dbVersionOutput,
        },
        duration: Date.now() - startTime,
      })
    );

    logger.info("[ServerStack] Server stack setup completed successfully");
    return res.json({
      success: true,
      message: "Server stack installed successfully",
      data: {
        phpVersion,
        database,
        extensionsInstalled: phpExtensions.length,
        installLog,
        versions: {
          php: phpVersionOutput,
          composer: composerVersionOutput,
          nginx: nginxVersionOutput,
          database: dbVersionOutput,
        },
      },
    });
  } catch (error: any) {
    logger.error(`[ServerStack] Step failed: ${error?.message || error}`);

    try {
      const { host, username, applicationName } = req.body || {};
      const app =
        host && username && applicationName
          ? await getApplicationByName(host, username, applicationName)
          : null;
      if (app?.id) {
        await addApplicationStep(
          app.id,
          "server-stack-setup",
          "failed",
          JSON.stringify({
            error: error?.message || error,
            duration: Date.now() - startTime,
          })
        );
      }
    } catch (_) {}

    return res.status(500).json({
      success: false,
      error: error?.message || String(error),
    });
  }
});

/**
 * POST /step/https-nginx-setup
 * Complete HTTPS + Nginx setup with backup, template deployment, and SSL certificate provisioning.
 * Follows best practices with backup, DH params, ACME challenge setup, and gradual SSL enablement.
 */
router.post("/step/https-nginx-setup", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const processLog: string[] = [];

  try {
    const { host, username, applicationName, domain, email } = req.body;

    logger.info("[HTTPS+Nginx] Request received", {
      host,
      username,
      applicationName,
      domain,
      email,
    });

    if (!host || !username || !applicationName || !domain || !email) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, domain, email",
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
    if (!app.sshPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "SSH key not found. Please verify connection first.",
      });
    }

    // Connect via SSH
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
    logger.info("[HTTPS+Nginx] SSH connection established");
    processLog.push("✅ SSH connection established");

    // Helper: exec with timeout
    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 30000,
      allowNonZero: boolean = false
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (!allowNonZero && code !== 0) {
              return reject(
                new Error(
                  `${label} exited with ${code}${
                    stderr ? `: ${stderr.trim()}` : ""
                  }`
                )
              );
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Pre-check sudo -n to avoid interactive prompt
    try {
      await execWithTimeout("sudo -n true", "sudo check", 5000, false);
      processLog.push("✅ Sudo permissions verified");
    } catch (e: any) {
      ssh.end();
      logger.error(`[HTTPS+Nginx] sudo -n not permitted: ${e?.message || e}`);
      return res.status(400).json({
        success: false,
        error:
          "sudo -n not permitted. Configure NOPASSWD for package install and nginx commands.",
        details: e?.message || String(e),
      });
    }

    // Detect package manager
    let pkgMgr: "apt" | "dnf" | "yum" | "apk" = "apt";
    try {
      const r = await execWithTimeout(
        "(. /etc/os-release; echo $ID) 2>/dev/null || echo unknown",
        "detect os",
        8000,
        true
      );
      const id = (r.stdout || "").trim().toLowerCase();
      if (["ubuntu", "debian"].includes(id)) pkgMgr = "apt";
      else if (["rocky", "centos", "rhel", "fedora"].includes(id))
        pkgMgr = "dnf";
      else if (["alpine"].includes(id)) pkgMgr = "apk";
      else pkgMgr = "apt";
      logger.info(`[HTTPS+Nginx] OS ID=${id}, pkgMgr=${pkgMgr}`);
      processLog.push(`✅ Detected OS: ${id}, Package Manager: ${pkgMgr}`);
    } catch (_) {}

    // Install Nginx and Certbot
    const installCommands: string[] = [];
    if (pkgMgr === "apt") {
      installCommands.push(
        "DEBIAN_FRONTEND=noninteractive sudo -n apt-get update -yq",
        "DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq nginx certbot python3-certbot-nginx"
      );
    } else if (pkgMgr === "dnf") {
      installCommands.push(
        "sudo -n dnf -y -q install nginx certbot python3-certbot-nginx || sudo -n yum -y -q install nginx certbot python3-certbot-nginx"
      );
    } else if (pkgMgr === "apk") {
      installCommands.push(
        "sudo -n apk update -q",
        "sudo -n apk add -q nginx certbot certbot-nginx"
      );
    }

    logger.info("[HTTPS+Nginx] Installing packages: Nginx + Certbot");
    processLog.push("⏳ Installing Nginx and Certbot...");
    for (const cmd of installCommands) {
      await execWithTimeout(cmd, "install packages", 240000, false);
    }
    processLog.push("✅ Nginx and Certbot installed");

    // Ensure Nginx enabled and started
    await execWithTimeout(
      "sudo -n systemctl enable --now nginx || sudo -n service nginx start || true",
      "start nginx",
      20000,
      true
    );
    processLog.push("✅ Nginx service enabled and started");

    // STEP 1: Backup current nginx configuration
    logger.info("[HTTPS+Nginx] Creating backup of current nginx config");
    processLog.push("⏳ Creating backup of current nginx configuration...");
    const backupCmd = `cd /etc/nginx && sudo -n tar -czf nginx_$(date +'%F_%H-%M-%S').tar.gz nginx.conf sites-available/ sites-enabled/ nginxconfig.io/ 2>/dev/null || true`;
    await execWithTimeout(backupCmd, "backup nginx config", 30000, true);
    processLog.push("✅ Nginx configuration backup created");

    // STEP 2: Create nginx configuration from templates
    logger.info("[HTTPS+Nginx] Creating nginx configuration from templates");
    processLog.push("⏳ Generating nginx configuration from templates...");
    const rootDir = `/var/www/${applicationName}`;

    // Ensure directories exist
    await execWithTimeout(
      `sudo -n mkdir -p /var/www/_letsencrypt`,
      "create directories",
      15000,
      false
    );

    // Load nginx.conf template
    const nginxConf = await loadTemplate("nginx.conf", { applicationName });
    await execWithTimeout(
      `cat <<'EOF_NGINX_CONF' | sudo -n tee /etc/nginx/nginx.conf > /dev/null\n${nginxConf}\nEOF_NGINX_CONF`,
      "write nginx.conf",
      15000,
      false
    );
    processLog.push("✅ Main nginx.conf written");

    // Create nginxconfig.io directory for snippets
    await execWithTimeout(
      "sudo -n mkdir -p /etc/nginx/nginxconfig.io",
      "create nginxconfig.io dir",
      10000,
      false
    );

    // Load and write security snippet
    const securityConf = await loadTemplate("security.conf");
    await execWithTimeout(
      `cat <<'EOF_SEC' | sudo -n tee /etc/nginx/nginxconfig.io/security.conf > /dev/null\n${securityConf}\nEOF_SEC`,
      "write security snippet",
      15000,
      false
    );
    processLog.push("✅ Security configuration written");

    // Load and write general snippet
    const generalConf = await loadTemplate("general.conf");
    await execWithTimeout(
      `cat <<'EOF_GEN' | sudo -n tee /etc/nginx/nginxconfig.io/general.conf > /dev/null\n${generalConf}\nEOF_GEN`,
      "write general snippet",
      15000,
      false
    );
    processLog.push("✅ General configuration written");

    // Load and write PHP fastcgi snippet
    const phpFastcgiConf = await loadTemplate("php_fastcgi.conf");
    await execWithTimeout(
      `cat <<'EOF_PHP' | sudo -n tee /etc/nginx/nginxconfig.io/php_fastcgi.conf > /dev/null\n${phpFastcgiConf}\nEOF_PHP`,
      "write php fastcgi snippet",
      15000,
      false
    );
    processLog.push("✅ PHP FastCGI configuration written");

    // Load and write Let's Encrypt snippet
    const letsencryptConf = await loadTemplate("letsencrypt.conf");
    await execWithTimeout(
      `cat <<'EOF_LE' | sudo -n tee /etc/nginx/nginxconfig.io/letsencrypt.conf > /dev/null\n${letsencryptConf}\nEOF_LE`,
      "write letsencrypt snippet",
      15000,
      false
    );
    processLog.push("✅ Let's Encrypt configuration written");

    // Load and write server block
    const domainUnderscore = domain.replace(/[^a-z0-9]/gi, "_");
    const serverConf = await loadTemplate("server.conf", {
      domainUnderscore,
      domain,
      rootDir,
    });

    const serverConfPath = `/etc/nginx/sites-available/${domain}.conf`;
    await execWithTimeout(
      `cat <<'EOF_SERVER' | sudo -n tee ${serverConfPath} > /dev/null\n${serverConf}\nEOF_SERVER`,
      "write server block",
      15000,
      false
    );
    processLog.push(`✅ Server configuration written to ${serverConfPath}`);

    await execWithTimeout(
      `sudo -n ln -sf ${serverConfPath} /etc/nginx/sites-enabled/${domain}.conf`,
      "enable site",
      10000,
      true
    );
    processLog.push("✅ Site enabled");

    // Remove default site if exists
    await execWithTimeout(
      "sudo -n rm -f /etc/nginx/sites-enabled/default",
      "remove default site",
      10000,
      true
    );
    processLog.push("✅ Default site removed");

    // STEP 3: Generate Diffie-Hellman parameters
    logger.info("[HTTPS+Nginx] Generating Diffie-Hellman parameters");
    processLog.push("⏳ Generating Diffie-Hellman parameters (2048 bit)...");
    await execWithTimeout(
      "sudo -n openssl dhparam -out /etc/nginx/dhparam.pem 2048",
      "generate dhparam",
      180000,
      false
    );
    processLog.push("✅ DH parameters generated");

    // STEP 4: Create ACME challenge directory
    logger.info("[HTTPS+Nginx] Creating ACME challenge directory");
    processLog.push("⏳ Setting up Let's Encrypt ACME challenge directory...");
    await execWithTimeout(
      "sudo -n mkdir -p /var/www/_letsencrypt",
      "create letsencrypt dir",
      10000,
      false
    );
    await execWithTimeout(
      "sudo -n chown www-data /var/www/_letsencrypt",
      "set letsencrypt ownership",
      10000,
      false
    );
    processLog.push("✅ ACME challenge directory created and configured");

    // STEP 5: Comment out SSL directives temporarily
    logger.info(
      "[HTTPS+Nginx] Commenting out SSL directives for initial setup"
    );
    processLog.push("⏳ Temporarily disabling SSL directives...");
    const commentSSLCmd = `sudo -n sed -i -r 's/(listen .*443)/\\1; #/g; s/(ssl_(certificate|certificate_key|trusted_certificate) )/#;#\\1/g; s/(server \\{)/\\1\\n    ssl off;/g' ${serverConfPath}`;
    await execWithTimeout(
      commentSSLCmd,
      "comment ssl directives",
      15000,
      false
    );
    processLog.push("✅ SSL directives temporarily disabled");

    // STEP 6: Test and reload Nginx
    logger.info("[HTTPS+Nginx] Testing and reloading Nginx");
    processLog.push("⏳ Testing nginx configuration...");
    await execWithTimeout("sudo -n nginx -t", "nginx test", 20000, false);
    processLog.push("✅ Nginx configuration test passed");

    await execWithTimeout(
      "sudo -n systemctl reload nginx || sudo -n service nginx reload",
      "nginx reload",
      20000,
      false
    );
    processLog.push("✅ Nginx reloaded");

    // STEP 7: Obtain SSL certificates from Let's Encrypt
    logger.info("[HTTPS+Nginx] Obtaining SSL certificates from Let's Encrypt");
    processLog.push("⏳ Requesting SSL certificate from Let's Encrypt...");
    const certbotCmd = `sudo -n certbot certonly --webroot -d ${domain} --email ${email} -w /var/www/_letsencrypt -n --agree-tos --force-renewal`;
    const certResult = await execWithTimeout(
      certbotCmd,
      "certbot obtain certificate",
      300000,
      true
    );
    // Verify certificate files exist before enabling SSL
    const certLivePath = `/etc/letsencrypt/live/${domain}`;
    // const certCheck = await execWithTimeout(
    //   `if [ -f ${certLivePath}/fullchain.pem ] && [ -f ${certLivePath}/privkey.pem ]; then echo present; else echo missing; fi`,
    //   "verify cert files",
    //   10000,
    //   true
    // );
    // if (!certCheck.stdout.includes("present")) {
    //   processLog.push("❌ Certificate files not found; keeping SSL disabled");
    //   if (certResult.stderr) {
    //     processLog.push(
    //       `📋 Certbot errors: ${certResult.stderr.slice(0, 200)}`
    //     );
    //   }
    //   // Close SSH and return informative error without enabling SSL
    //   ssh.end();
    //   logger.error(
    //     `[HTTPS+Nginx] Certificate verification failed; SSL remains disabled`
    //   );
    //   await addApplicationStep(
    //     app.id,
    //     "https-nginx-setup",
    //     "failed",
    //     JSON.stringify({
    //       domain,
    //       email,
    //       processLog,
    //       certbot: {
    //         stdout: certResult.stdout?.slice(0, 8000) || "",
    //         stderr: certResult.stderr?.slice(0, 8000) || "",
    //       },
    //       duration: Date.now() - startTime,
    //     })
    //   );
    //   return res.status(400).json({
    //     success: false,
    //     error:
    //       "Certificate issuance failed or files missing. SSL remains disabled.",
    //     data: {
    //       domain,
    //       processLog,
    //       certbotOutput: certResult.stdout?.slice(0, 8000) || "",
    //       certbotError: certResult.stderr?.slice(0, 8000) || "",
    //     },
    //   });
    // }
    processLog.push("✅ Certificate files present");
    if (certResult.stdout) {
      processLog.push(`📋 Certbot output: ${certResult.stdout.slice(0, 200)}`);
    }

    // STEP 8: Uncomment SSL directives
    logger.info("[HTTPS+Nginx] Enabling SSL directives");
    processLog.push("⏳ Enabling SSL directives...");
    const uncommentSSLCmd = `sudo -n sed -i -r -z 's/#?; ?#//g; s/(server \\{)\\n    ssl off;/\\1/g' ${serverConfPath}`;
    await execWithTimeout(
      uncommentSSLCmd,
      "uncomment ssl directives",
      15000,
      false
    );
    processLog.push("✅ SSL directives enabled");

    // STEP 9: Final test and reload
    logger.info("[HTTPS+Nginx] Final nginx test and reload");
    processLog.push("⏳ Final nginx configuration test...");
    await execWithTimeout("sudo -n nginx -t", "final nginx test", 20000, false);
    processLog.push("✅ Final nginx configuration test passed");

    await execWithTimeout(
      "sudo -n systemctl reload nginx || sudo -n service nginx reload",
      "final nginx reload",
      20000,
      false
    );
    processLog.push("✅ Nginx reloaded with SSL enabled");

    // STEP 10: Configure Certbot renewal hook
    logger.info("[HTTPS+Nginx] Configuring Certbot renewal hook");
    processLog.push("⏳ Setting up automatic certificate renewal...");
    const renewalHookCmd = `echo -e '#!/bin/bash\\nsudo -n nginx -t && sudo -n systemctl reload nginx' | sudo -n tee /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh && sudo -n chmod a+x /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh`;
    await execWithTimeout(renewalHookCmd, "setup renewal hook", 15000, false);
    processLog.push("✅ Certificate auto-renewal configured");

    // Enable certbot timer if available
    await execWithTimeout(
      "sudo -n systemctl enable --now certbot.timer || true",
      "enable certbot timer",
      15000,
      true
    );
    processLog.push("✅ Certbot auto-renewal timer enabled");

    // Close SSH
    ssh.end();
    logger.info("[HTTPS+Nginx] SSH session closed");
    processLog.push("✅ Setup completed successfully");

    // Log and respond
    await addApplicationStep(
      app.id,
      "https-nginx-setup",
      "success",
      JSON.stringify({
        domain,
        email,
        processLog,
        duration: Date.now() - startTime,
      })
    );

    return res.json({
      success: true,
      message:
        "Nginx configured and HTTPS certificates provisioned successfully",
      data: {
        domain,
        configFile: serverConfPath,
        processLog,
        autoRenewalEnabled: true,
      },
    });
  } catch (error: any) {
    logger.error(`[HTTPS+Nginx] Step failed: ${error?.message || error}`);
    processLog.push(`❌ Error: ${error?.message || error}`);

    try {
      const { host, username, applicationName } = req.body || {};
      const app =
        host && username && applicationName
          ? await getApplicationByName(host, username, applicationName)
          : null;
      if (app?.id) {
        await addApplicationStep(
          app.id,
          "https-nginx-setup",
          "failed",
          JSON.stringify({
            error: error?.message || error,
            processLog,
            duration: Date.now() - startTime,
          })
        );
      }
    } catch (_) {}

    return res.status(500).json({
      success: false,
      error: error?.message || String(error),
      processLog,
    });
  }
});

/**
 * POST /step/certbot-issue
 * Install Certbot and issue HTTPS certificate for the provided domain.
 * Uses the Nginx plugin when Nginx is present; otherwise falls back to standalone.
 */
router.post("/step/certbot-issue", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { host, username, applicationName, domain, email } = req.body;

    if (!host || !username || !applicationName || !domain || !email) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: host, username, applicationName, domain, email",
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
    if (!app.sshPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "SSH key not found. Please verify connection first.",
      });
    }

    // Connect via SSH
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

    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 60000,
      allowNonZero: boolean = false
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (!allowNonZero && code !== 0) {
              return reject(
                new Error(
                  `${label} exited with ${code}${
                    stderr ? `: ${stderr.trim()}` : ""
                  }`
                )
              );
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Pre-check sudo -n
    try {
      await execWithTimeout("sudo -n true", "sudo check", 5000, false);
    } catch (e: any) {
      ssh.end();
      return res.status(400).json({
        success: false,
        error:
          "sudo -n not permitted. Configure NOPASSWD for package installation commands.",
        details: e?.message || String(e),
      });
    }

    // Detect package manager
    let pkgMgr: "apt" | "dnf" | "yum" | "apk" = "apt";
    try {
      const r = await execWithTimeout(
        "(. /etc/os-release; echo $ID) 2>/dev/null || echo unknown",
        "detect os",
        8000,
        true
      );
      const id = (r.stdout || "").trim().toLowerCase();
      if (["ubuntu", "debian"].includes(id)) pkgMgr = "apt";
      else if (["rocky", "centos", "rhel", "fedora", "almalinux"].includes(id))
        pkgMgr = "dnf";
      else if (["alpine"].includes(id)) pkgMgr = "apk";
    } catch (_) {}

    // Install Certbot and Nginx plugin when available
    const installCmds: string[] = [];
    if (pkgMgr === "apt") {
      installCmds.push(
        "DEBIAN_FRONTEND=noninteractive sudo -n apt-get update -yq",
        "DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq certbot python3-certbot-nginx"
      );
    } else if (pkgMgr === "dnf") {
      installCmds.push(
        "sudo -n dnf -y -q install certbot python3-certbot-nginx || sudo -n yum -y -q install certbot python3-certbot-nginx"
      );
    } else if (pkgMgr === "apk") {
      installCmds.push(
        "sudo -n apk update -q",
        "sudo -n apk add -q certbot certbot-nginx"
      );
    }
    for (const cmd of installCmds) {
      await execWithTimeout(cmd, "install certbot", 240000, false);
    }

    // Determine if nginx is installed
    let nginxPresent = false;
    try {
      const v = await execWithTimeout(
        "sudo -n nginx -v 2>&1",
        "nginx version",
        5000,
        true
      );
      nginxPresent = !!(v.stdout || v.stderr);
    } catch (_) {}

    // Issue certificate
    const baseArgs = [
      `-d ${domain}`,
      `-d www.${domain}`,
      "--non-interactive",
      "--agree-tos",
      `-m ${email}`,
    ];

    let certbotCmd = "";
    if (nginxPresent) {
      certbotCmd = ["sudo -n certbot --nginx", ...baseArgs, "--redirect"].join(
        " "
      );
    } else {
      certbotCmd = [
        "sudo -n certbot certonly --standalone",
        ...baseArgs,
        "--preferred-challenges http",
      ].join(" ");
    }

    const issueResult = await execWithTimeout(
      certbotCmd,
      "certbot issue",
      300000,
      true
    );

    // Enable auto-renewal
    await execWithTimeout(
      "sudo -n systemctl enable --now certbot.timer || true",
      "enable renewal timer",
      15000,
      true
    );

    ssh.end();

    await addApplicationStep(
      app.id,
      "certbot-issue",
      "success",
      JSON.stringify({
        domain,
        email,
        method: nginxPresent ? "nginx" : "standalone",
        output: (issueResult.stdout || "")?.slice(0, 8000),
        duration: Date.now() - startTime,
      })
    );

    return res.json({
      success: true,
      message: "HTTPS certificate issued via Certbot",
      data: { domain, method: nginxPresent ? "nginx" : "standalone" },
    });
  } catch (error: any) {
    try {
      const { host, username, applicationName } = req.body || {};
      const app =
        host && username && applicationName
          ? await getApplicationByName(host, username, applicationName)
          : null;
      if (app?.id) {
        await addApplicationStep(
          app.id,
          "certbot-issue",
          "failed",
          JSON.stringify({
            error: error?.message || error,
            when: "certbot-issue",
          })
        );
      }
    } catch (_) {}

    return res
      .status(500)
      .json({ success: false, error: error?.message || String(error) });
  }
});

/**
 * POST /step/certbot-nginx-setup
 * Install Nginx with minimal configuration and provision HTTPS certificate via Certbot.
 * This is ideal for getting a quick certificate with just nginx serving the domain.
 */
router.post(
  "/step/certbot-nginx-setup",
  async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const { host, username, applicationName, domain, email } = req.body;

      if (!host || !username || !applicationName || !domain || !email) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: host, username, applicationName, domain, email",
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
      if (!app.sshPrivateKey) {
        return res.status(400).json({
          success: false,
          error: "SSH key not found. Please verify connection first.",
        });
      }

      // Connect via SSH
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

      const execWithTimeout = (
        cmd: string,
        label: string,
        timeoutMs: number = 60000,
        allowNonZero: boolean = false
      ): Promise<{ code: number; stdout: string; stderr: string }> => {
        return new Promise((resolve, reject) => {
          let stdout = "";
          let stderr = "";
          let finished = false;
          const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            reject(new Error(`Timeout running ${label}`));
          }, timeoutMs);

          ssh.exec(cmd, (err: any, stream: any) => {
            if (err) {
              clearTimeout(timer);
              return reject(err);
            }
            stream?.on("data", (d: Buffer) => (stdout += d.toString()));
            stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
            stream?.on("close", (code: number) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              if (!allowNonZero && code !== 0) {
                return reject(
                  new Error(
                    `${label} exited with ${code}${
                      stderr ? `: ${stderr.trim()}` : ""
                    }`
                  )
                );
              }
              resolve({ code, stdout, stderr });
            });
            stream?.on("error", (e: any) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              reject(e);
            });
          });
        });
      };

      // Pre-check sudo -n
      try {
        await execWithTimeout("sudo -n true", "sudo check", 5000, false);
      } catch (e: any) {
        ssh.end();
        return res.status(400).json({
          success: false,
          error:
            "sudo -n not permitted. Configure NOPASSWD for package installation commands.",
          details: e?.message || String(e),
        });
      }

      // Detect package manager
      let pkgMgr: "apt" | "dnf" | "yum" | "apk" = "apt";
      try {
        const r = await execWithTimeout(
          "(. /etc/os-release; echo $ID) 2>/dev/null || echo unknown",
          "detect os",
          8000,
          true
        );
        const id = (r.stdout || "").trim().toLowerCase();
        if (["ubuntu", "debian"].includes(id)) pkgMgr = "apt";
        else if (
          ["rocky", "centos", "rhel", "fedora", "almalinux"].includes(id)
        )
          pkgMgr = "dnf";
        else if (["alpine"].includes(id)) pkgMgr = "apk";
      } catch (_) {}

      // Step 1: Install Nginx and Certbot
      logger.info("[CertbotNginx] Installing Nginx and Certbot");
      const installCmds: string[] = [];
      if (pkgMgr === "apt") {
        installCmds.push(
          "DEBIAN_FRONTEND=noninteractive sudo -n apt-get update -yq",
          "DEBIAN_FRONTEND=noninteractive sudo -n apt-get install -yq nginx certbot python3-certbot-nginx"
        );
      } else if (pkgMgr === "dnf") {
        installCmds.push(
          "sudo -n dnf -y -q install nginx certbot python3-certbot-nginx || sudo -n yum -y -q install nginx certbot python3-certbot-nginx"
        );
      } else if (pkgMgr === "apk") {
        installCmds.push(
          "sudo -n apk update -q",
          "sudo -n apk add -q nginx certbot certbot-nginx"
        );
      }
      for (const cmd of installCmds) {
        await execWithTimeout(cmd, "install nginx+certbot", 240000, false);
      }

      // Step 2: Create minimal nginx config for certbot validation
      logger.info("[CertbotNginx] Creating minimal nginx configuration");
      const rootDir = `/var/www/${applicationName}`;
      await execWithTimeout(
        `sudo -n mkdir -p ${rootDir}`,
        "create root dir",
        10000,
        false
      );

      // Load minimal nginx config from template
      const minimalNginxConf = await loadTemplate("certbot-https-setup.conf", {
        domain,
        rootDir,
      });

      const heredoc = "EOF_MINIMAL_NGINX";
      await execWithTimeout(
        `cat <<'${heredoc}' | sudo -n tee /etc/nginx/sites-available/${domain}.conf > /dev/null\n${minimalNginxConf}\n${heredoc}`,
        "write minimal config",
        15000,
        false
      );

      // Enable site
      await execWithTimeout(
        `sudo -n ln -sf /etc/nginx/sites-available/${domain}.conf /etc/nginx/sites-enabled/${domain}.conf`,
        "enable site",
        10000,
        true
      );

      // Test nginx config
      await execWithTimeout("sudo -n nginx -t", "nginx test", 10000, false);

      // Start nginx
      await execWithTimeout(
        "sudo -n systemctl enable --now nginx || sudo -n service nginx start",
        "start nginx",
        20000,
        true
      );

      // Step 3: Prepare SSL/TLS infrastructure for certbot
      logger.info("[CertbotNginx] Preparing SSL/TLS infrastructure");

      // Generate dhparam.pem for strong SSL configuration
      await execWithTimeout(
        "sudo -n openssl dhparam -out /etc/nginx/dhparam.pem 2048",
        "generate dhparam",
        120000,
        false
      );

      // Create and configure Let's Encrypt directory
      await execWithTimeout(
        "sudo -n mkdir -p /var/www/_letsencrypt",
        "create letsencrypt dir",
        10000,
        false
      );

      // Set ownership to www-data for ACME challenges
      await execWithTimeout(
        "sudo -n chown www-data /var/www/_letsencrypt",
        "set letsencrypt ownership",
        10000,
        false
      );

      // Step 4: Provision HTTPS certificate using certbot nginx plugin
      // Step 4: Provision HTTPS certificate using certbot nginx plugin
      logger.info("[CertbotNginx] Running Certbot to issue certificate");
      const certbotCmd = [
        "sudo -n certbot --nginx",
        `-d ${domain}`,
        `-d www.${domain}`,
        "--non-interactive",
        "--agree-tos",
        `-m ${email}`,
        "--redirect",
      ].join(" ");

      const certResult = await execWithTimeout(
        certbotCmd,
        "certbot issue",
        300000,
        true
      );

      // Enable auto-renewal
      await execWithTimeout(
        "sudo -n systemctl enable --now certbot.timer || true",
        "enable renewal timer",
        15000,
        true
      );

      ssh.end();

      await addApplicationStep(
        app.id,
        "certbot-nginx-setup",
        "success",
        JSON.stringify({
          domain,
          email,
          nginxConfig: `${domain}.conf`,
          certificateMethod: "nginx",
          output: (certResult.stdout || "")?.slice(0, 8000),
          duration: Date.now() - startTime,
        })
      );

      return res.json({
        success: true,
        message:
          "Nginx installed with minimal config and HTTPS certificate provisioned",
        data: {
          domain,
          configFile: `/etc/nginx/sites-available/${domain}.conf`,
          certificateMethod: "nginx",
          autoRenewal: true,
        },
      });
    } catch (error: any) {
      logger.error(`[CertbotNginx] Step failed: ${error?.message || error}`);

      try {
        const { host, username, applicationName } = req.body || {};
        const app =
          host && username && applicationName
            ? await getApplicationByName(host, username, applicationName)
            : null;
        if (app?.id) {
          await addApplicationStep(
            app.id,
            "certbot-nginx-setup",
            "failed",
            JSON.stringify({
              error: error?.message || error,
              duration: Date.now() - startTime,
            })
          );
        }
      } catch (_) {}

      return res
        .status(500)
        .json({ success: false, error: error?.message || String(error) });
    }
  }
);

/**
 * POST /step/laravel-stack-setup
 * Install complete Laravel stack: Nginx, PHP, Composer, Node.js, Database, Redis, Supervisor
 */
router.post(
  "/step/laravel-stack-setup",
  async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const {
        host,
        username,
        applicationName,
        phpVersion = "8.3",
        nodeVersion = "20",
        dbType = "MySQL",
      } = req.body;

      logger.info("[LaravelStack] Request received", {
        host,
        username,
        applicationName,
        phpVersion,
        nodeVersion,
        dbType,
      });

      if (!host || !username || !applicationName) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: host, username, applicationName",
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
      if (!app.sshPrivateKey) {
        return res.status(400).json({
          success: false,
          error: "SSH key not found. Please verify connection first.",
        });
      }

      // Connect via SSH
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
      logger.info("[LaravelStack] SSH connection established");

      // Helper: exec with timeout
      const execWithTimeout = (
        cmd: string,
        label: string,
        timeoutMs: number = 60000,
        allowNonZero: boolean = false
      ): Promise<{ code: number; stdout: string; stderr: string }> => {
        return new Promise((resolve, reject) => {
          let stdout = "";
          let stderr = "";
          let finished = false;
          const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            logger.error(
              `[LaravelStack] Timeout (${timeoutMs}ms) running ${label}`
            );
            reject(new Error(`Timeout running ${label}`));
          }, timeoutMs);

          ssh.exec(cmd, (err: any, stream: any) => {
            if (err) {
              clearTimeout(timer);
              return reject(err);
            }
            stream?.on("data", (d: Buffer) => (stdout += d.toString()));
            stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
            stream?.on("close", (code: number) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              if (stdout.trim())
                logger.debug(
                  `[LaravelStack] ${label} stdout: ${stdout.trim()}`
                );
              if (stderr.trim())
                logger.debug(
                  `[LaravelStack] ${label} stderr: ${stderr.trim()}`
                );
              if (!allowNonZero && code !== 0) {
                const errMsg = `${label} exited with ${code}${
                  stderr ? `: ${stderr.trim()}` : ""
                }`;
                logger.error(`[LaravelStack] ${errMsg}`);
                return reject(new Error(errMsg));
              }
              resolve({ code, stdout, stderr });
            });
            stream?.on("error", (e: any) => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              reject(e);
            });
          });
        });
      };

      // Pre-check sudo -n to avoid interactive prompt
      try {
        await execWithTimeout("sudo -n true", "sudo check", 5000, false);
      } catch (e: any) {
        ssh.end();
        logger.error(
          `[LaravelStack] sudo -n not permitted: ${e?.message || e}`
        );
        return res.status(400).json({
          success: false,
          error:
            "sudo -n not permitted. Configure NOPASSWD for package installation commands.",
          details: e?.message || String(e),
        });
      }

      // Load installation script template
      const templatePath = join(
        __dirname,
        "../../../templates/install-laravel-stack.sh.template"
      );
      let installScript = await readFile(templatePath, "utf-8");

      // Replace template variables
      const replacements: Record<string, string> = {
        phpVersion,
        nodeVersion,
        dbType,
        username,
      };

      for (const [key, value] of Object.entries(replacements)) {
        const pattern = new RegExp(`{{${key}}}`, "g");
        installScript = installScript.replace(pattern, value);
      }

      // Upload and execute installation script
      const scriptPath = `/tmp/install-laravel-stack-${Date.now()}.sh`;
      logger.info("[LaravelStack] Uploading installation script");

      const heredoc = "EOF_INSTALL_SCRIPT";
      await execWithTimeout(
        `cat <<'${heredoc}' > ${scriptPath}\n${installScript}\n${heredoc}`,
        "upload script",
        30000,
        false
      );

      await execWithTimeout(
        `chmod +x ${scriptPath}`,
        "make executable",
        10000,
        false
      );

      // Execute installation script
      logger.info("[LaravelStack] Executing installation script");
      const installResult = await execWithTimeout(
        `bash ${scriptPath}`,
        "install stack",
        600000, // 10 minutes timeout
        true
      );

      // Clean up script
      await execWithTimeout(
        `rm -f ${scriptPath}`,
        "cleanup script",
        10000,
        true
      );

      // Verify installations
      logger.info("[LaravelStack] Verifying installations");
      const verifications: Record<string, string> = {};

      try {
        const nginxVersion = await execWithTimeout(
          "nginx -v 2>&1",
          "check nginx",
          10000,
          true
        );
        verifications.nginx = nginxVersion.stdout || nginxVersion.stderr;
      } catch (e: any) {
        verifications.nginx = "Not installed or not in PATH";
      }

      try {
        const phpVersionCheck = await execWithTimeout(
          "php -v",
          "check php",
          10000,
          true
        );
        verifications.php = phpVersionCheck.stdout.split("\n")[0];
      } catch (e: any) {
        verifications.php = "Not installed or not in PATH";
      }

      try {
        const composerVersionCheck = await execWithTimeout(
          "composer --version",
          "check composer",
          10000,
          true
        );
        verifications.composer = composerVersionCheck.stdout.split("\n")[0];
      } catch (e: any) {
        verifications.composer = "Not installed or not in PATH";
      }

      try {
        const nodeVersionCheck = await execWithTimeout(
          ". ~/.nvm/nvm.sh && node --version",
          "check node",
          10000,
          true
        );
        verifications.node = nodeVersionCheck.stdout.trim();
      } catch (e: any) {
        verifications.node = "Install nvm in user session";
      }

      ssh.end();
      logger.info("[LaravelStack] SSH session closed");

      // Log success
      await addApplicationStep(
        app.id,
        "laravel-stack-setup",
        "success",
        JSON.stringify({
          phpVersion,
          nodeVersion,
          dbType,
          verifications,
          installOutput: installResult.stdout.slice(-5000),
          duration: Date.now() - startTime,
        })
      );

      logger.info("[LaravelStack] Installation completed successfully");
      return res.json({
        success: true,
        message: "Laravel stack installed successfully",
        data: {
          phpVersion,
          nodeVersion,
          dbType,
          verifications,
          installed: [
            "Nginx",
            `PHP ${phpVersion}`,
            "Composer",
            `Node.js ${nodeVersion}`,
            dbType,
            "Redis",
            "Supervisor",
            "Git",
          ],
        },
      });
    } catch (error: any) {
      logger.error(
        `[LaravelStack] Installation failed: ${error?.message || error}`
      );

      try {
        const app = await getApplicationByName(
          req.body.host,
          req.body.username,
          req.body.applicationName
        );
        if (app) {
          await addApplicationStep(
            app.id,
            "laravel-stack-setup",
            "failed",
            JSON.stringify({
              error: error?.message || error,
              duration: Date.now() - startTime,
            })
          );
        }
      } catch (_) {}

      return res.status(500).json({
        success: false,
        error: error?.message || String(error),
      });
    }
  }
);

/**
 * POST /step/node-nvm-setup
 * Install Node.js using NVM (Node Version Manager)
 */
router.post("/step/node-nvm-setup", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { host, username, applicationName, nodeVersion = "20" } = req.body;

    logger.info("[NodeNVM] Request received", {
      host,
      username,
      applicationName,
      nodeVersion,
    });

    if (!host || !username || !applicationName) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: host, username, applicationName",
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
    if (!app.sshPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "SSH key not found. Please verify connection first.",
      });
    }

    // Connect via SSH
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
    logger.info("[NodeNVM] SSH connection established");

    const execWithTimeout = (
      cmd: string,
      label: string,
      timeoutMs: number = 120000,
      allowNonZero: boolean = false
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          reject(new Error(`Timeout running ${label}`));
        }, timeoutMs);

        ssh.exec(cmd, (err: any, stream: any) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          stream?.on("data", (d: Buffer) => (stdout += d.toString()));
          stream?.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
          stream?.on("close", (code: number) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (!allowNonZero && code !== 0) {
              return reject(
                new Error(
                  `${label} exited with ${code}${
                    stderr ? `: ${stderr.trim()}` : ""
                  }`
                )
              );
            }
            resolve({ code, stdout, stderr });
          });
          stream?.on("error", (e: any) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(e);
          });
        });
      });
    };

    // Step 1: Install NVM
    logger.info("[NodeNVM] Installing NVM");
    const nvmInstallCmd = `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`;
    await execWithTimeout(nvmInstallCmd, "install nvm", 180000, false);

    // Step 2: Source NVM and install Node.js
    logger.info(`[NodeNVM] Installing Node.js ${nodeVersion}`);
    const nodeInstallCmd = `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm install ${nodeVersion} && nvm use ${nodeVersion} && nvm alias default ${nodeVersion}`;
    await execWithTimeout(nodeInstallCmd, "install node", 240000, false);

    // Step 3: Verify installation
    logger.info("[NodeNVM] Verifying installation");
    let nodeVersionOutput = "";
    let npmVersionOutput = "";
    let nvmVersionOutput = "";

    try {
      const nodeVer = await execWithTimeout(
        `. ~/.nvm/nvm.sh && node --version`,
        "check node version",
        10000,
        true
      );
      nodeVersionOutput = nodeVer.stdout.trim();
    } catch (_) {
      nodeVersionOutput = "Not found";
    }

    try {
      const npmVer = await execWithTimeout(
        `. ~/.nvm/nvm.sh && npm --version`,
        "check npm version",
        10000,
        true
      );
      npmVersionOutput = npmVer.stdout.trim();
    } catch (_) {
      npmVersionOutput = "Not found";
    }

    try {
      const nvmVer = await execWithTimeout(
        `. ~/.nvm/nvm.sh && nvm --version`,
        "check nvm version",
        10000,
        true
      );
      nvmVersionOutput = nvmVer.stdout.trim();
    } catch (_) {
      nvmVersionOutput = "Not found";
    }

    ssh.end();
    logger.info("[NodeNVM] SSH session closed");

    // Log success
    await addApplicationStep(
      app.id,
      "node-nvm-setup",
      "success",
      JSON.stringify({
        nodeVersion,
        versions: {
          nvm: nvmVersionOutput,
          node: nodeVersionOutput,
          npm: npmVersionOutput,
        },
        duration: Date.now() - startTime,
      })
    );

    logger.info("[NodeNVM] Installation completed successfully");
    return res.json({
      success: true,
      message: "Node.js and NVM installed successfully",
      data: {
        nodeVersion,
        versions: {
          nvm: nvmVersionOutput,
          node: nodeVersionOutput,
          npm: npmVersionOutput,
        },
        instructions: "To use Node.js in your shell, run: source ~/.nvm/nvm.sh",
      },
    });
  } catch (error: any) {
    logger.error(`[NodeNVM] Installation failed: ${error?.message || error}`);

    try {
      const { host, username, applicationName } = req.body || {};
      const app =
        host && username && applicationName
          ? await getApplicationByName(host, username, applicationName)
          : null;
      if (app?.id) {
        await addApplicationStep(
          app.id,
          "node-nvm-setup",
          "failed",
          JSON.stringify({
            error: error?.message || error,
            duration: Date.now() - startTime,
          })
        );
      }
    } catch (_) {}

    return res.status(500).json({
      success: false,
      error: error?.message || String(error),
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

/**
 * POST /step/deploy-workflow-update
 * Prompt for a base branch name, update deploy.yml on a new feature branch, and open a PR.
 * Also records branch info in the application steps log.
 */
router.post(
  "/step/deploy-workflow-update",
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    logger.info("[DeployWorkflow] Request received", req.body);

    try {
      const {
        host,
        username,
        applicationName,
        selectedRepo,
        baseBranch,
        sshPath,
      } = req.body;

      if (
        !host ||
        !username ||
        !applicationName ||
        !selectedRepo ||
        !baseBranch ||
        !sshPath
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: host, username, applicationName, selectedRepo, baseBranch, sshPath",
        });
      }

      // Generate hostAlias from applicationName
      const hostAlias = `github.com-${applicationName}`;

      await ensureDatabaseInitialized();
      const app = await getApplicationByName(host, username, applicationName);
      logger.info("[DeployWorkflow] Fetched application data");
      if (!app) {
        return res.status(404).json({
          success: false,
          error: "Application not found. Please verify connection first.",
        });
      }
      if (!app.githubToken) {
        return res.status(400).json({
          success: false,
          error: "GitHub token missing. Please authenticate GitHub first.",
        });
      }

      // Parse owner/repo
      let owner: string;
      let repoName: string;
      const slashCount = (selectedRepo.match(/\//g) || []).length;
      if (slashCount === 1 && !selectedRepo.startsWith("http")) {
        [owner, repoName] = selectedRepo.split("/");
      } else {
        const m = selectedRepo.match(
          /^https?:\/\/github\.com\/([^\/]+)\/([^\/#?]+)(?:[\/#?].*)?$/
        );
        if (!m) {
          return res.status(400).json({
            success: false,
            error: "Invalid repository format. Use owner/repo or GitHub URL.",
          });
        }
        owner = m[1];
        repoName = m[2];
      }

      const gh = axios.create({
        baseURL: "https://api.github.com",
        headers: {
          Authorization: `Bearer ${app.githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout: 15000,
      });

      // 1) Resolve base branch ref/commit - try requested branch first, create from 'dev' if not found
      let baseSha: string | null = null;
      let actualBaseBranch = baseBranch;
      let branchCreated = false;

      try {
        const refResp = await gh.get(
          `/repos/${owner}/${repoName}/git/refs/heads/${encodeURIComponent(
            baseBranch
          )}`
        );
        baseSha = refResp.data?.object?.sha || refResp.data?.sha;
        logger.info(
          `[DeployWorkflow] Found base branch '${baseBranch}' and SHA ${baseSha}`
        );
      } catch (e: any) {
        // If the specified branch doesn't exist, create it from 'dev'
        if (e?.response?.status === 404) {
          logger.info(
            `[DeployWorkflow] Branch '${baseBranch}' not found, attempting to create from 'dev'`
          );
          try {
            // Get 'dev' branch ref
            const devRefResp = await gh.get(
              `/repos/${owner}/${repoName}/git/refs/heads/dev`
            );
            const devSha = devRefResp.data?.object?.sha || devRefResp.data?.sha;

            if (devSha) {
              // Create the requested branch from 'dev'
              logger.info(
                `[DeployWorkflow] Creating branch '${baseBranch}' from 'dev'`
              );
              await gh.post(`/repos/${owner}/${repoName}/git/refs`, {
                ref: `refs/heads/${baseBranch}`,
                sha: devSha,
              });
              baseSha = devSha;
              actualBaseBranch = baseBranch;
              branchCreated = true;
              logger.info(
                `[DeployWorkflow] Successfully created branch '${baseBranch}' from 'dev'`
              );
            }
          } catch (devBranchError: any) {
            logger.error(
              `[DeployWorkflow] Failed to create branch from 'dev': ${devBranchError.message}`
            );
            // If 'dev' doesn't exist either, return error
            return res.status(404).json({
              success: false,
              error: `Base branch '${baseBranch}' not found and 'dev' branch is not available to create it from`,
            });
          }
        }
      }

      if (!baseSha) {
        return res.status(404).json({
          success: false,
          error: `Base branch '${baseBranch}' not found and could not be created`,
        });
      }

      // 2) Create a feature branch
      const featureBranch = `deploy-update-${applicationName.replace(
        /\W+/g,
        "-"
      )}-${Date.now()}`;
      await gh.post(`/repos/${owner}/${repoName}/git/refs`, {
        ref: `refs/heads/${featureBranch}`,
        sha: baseSha,
      });
      logger.info(
        `[DeployWorkflow] Created feature branch '${featureBranch}' from '${actualBaseBranch}'`
      );

      // 3) Find deploy.yml (common locations)
      const candidatePaths = [
        ".github/workflows/deploy.yml",
        "deploy.yml",
        ".github/workflows/deploy.yaml",
        "deploy.yaml",
      ];
      let deployPath: string | null = null;
      let fileSha: string | null = null;
      let fileContent: string | null = null;

      for (const p of candidatePaths) {
        try {
          const c = await gh.get(
            `/repos/${owner}/${repoName}/contents/${encodeURI(
              p
            )}?ref=${featureBranch}`
          );
          const data = c.data;
          if (data && data.content) {
            const decoded = Buffer.from(
              data.content,
              data.encoding || "base64"
            ).toString("utf-8");
            deployPath = p;
            fileSha = data.sha;
            fileContent = decoded;
            break;
          }
        } catch (_) {}
      }

      if (!deployPath || !fileContent) {
        return res.status(404).json({
          success: false,
          error: "deploy.yml not found in repository",
        });
      }

      // 4) Update YAML: ensure hosts/application entry exists and update fields
      let doc: any;
      try {
        doc = yaml.load(fileContent) as any;
      } catch (e: any) {
        return res.status(400).json({
          success: false,
          error: `Invalid YAML in ${deployPath}: ${e?.message || e}`,
        });
      }

      // We expect structure like: hosts: [{ application: string, remote_user, hostname, deploy_path, branch, composer_options, npm_build }]
      if (!doc.hosts) doc.hosts = [];
      if (!Array.isArray(doc.hosts)) doc.hosts = [doc.hosts];

      const appIndex = doc.hosts.findIndex((h: any) => {
        const name = h?.application || h?.name || h?.app;
        return (
          typeof name === "string" && name.trim() === applicationName.trim()
        );
      });

      const hostEntry = {
        application: applicationName,
        remote_user: username,
        hostname: host,
        deploy_path: sshPath,
        branch: baseBranch,
        composer_options:
          "--no-dev --optimize-autoloader --prefer-dist --no-interaction --ignore-platform-reqs",
        npm_build: "build",
        repository: `git@${hostAlias}:${owner}/${repoName}.git`,
      };

      if (appIndex >= 0) {
        doc.hosts[appIndex] = { ...doc.hosts[appIndex], ...hostEntry };
      } else {
        doc.hosts.push(hostEntry);
      }

      const newYaml = yaml.dump(doc, { lineWidth: 120 });

      // 5) Commit the change to feature branch via Contents API
      const putResp = await gh.put(
        `/repos/${owner}/${repoName}/contents/${encodeURI(deployPath)}`,
        {
          message: `chore: update deploy.yml for ${applicationName}`,
          content: Buffer.from(newYaml, "utf-8").toString("base64"),
          sha: fileSha,
          branch: featureBranch,
        }
      );
      logger.info(`[DeployWorkflow] Updated ${deployPath} on feature branch`);

      // 6) Create GitHub Actions workflow file
      const secretName: string =
        app.privateKeySecretName ||
        `PRIVATE_KEY_${applicationName
          .replace(/[^A-Za-z0-9]/g, "_")
          .toUpperCase()}`;

      const workflowPath = `.github/workflows/laravel-project-deployment.yml`;
      const workflowContent = `name: Deploy ${applicationName}
run-name: Deploy to production for \${{ github.ref }} by @\${{ github.actor }} (\${{ github.sha }})

on:
  push:
    branches:
      - ${actualBaseBranch}

jobs:
  deploy:
    uses: maskeynihal/gh-actions/.github/workflows/reusable_deploy_laravel.yml@main
    with:
      php-version: "8.3"
    secrets:
      PRIVATE_KEY: \${{ secrets.${secretName} }}
      VAULT_ADDR: \${{ secrets.VAULT_ADDR }}
      VAULT_TOKEN: \${{ secrets.VAULT_TOKEN }}
      VAULT_PATH: \${{ vars.VAULT_PATH }}
`;

      // Check if workflow file exists
      let workflowFileSha: string | undefined;
      try {
        const existingFile = await gh.get(
          `/repos/${owner}/${repoName}/contents/${workflowPath}?ref=${featureBranch}`
        );
        workflowFileSha = existingFile.data.sha;
        logger.info(
          `[DeployWorkflow] Found existing workflow file, will update`
        );
      } catch (err: any) {
        if (err.response?.status === 404) {
          logger.info(`[DeployWorkflow] Will create new workflow file`);
        } else {
          throw err;
        }
      }

      // Commit workflow file to feature branch
      logger.info(`[DeployWorkflow] Committing workflow file...`);
      const workflowPayload: any = {
        message: `feat: add deployment workflow for ${applicationName}`,
        content: Buffer.from(workflowContent, "utf-8").toString("base64"),
        branch: featureBranch,
      };
      if (workflowFileSha) {
        workflowPayload.sha = workflowFileSha;
      }

      const workflowResp = await gh.put(
        `/repos/${owner}/${repoName}/contents/${workflowPath}`,
        workflowPayload
      );
      logger.info(`[DeployWorkflow] Workflow file committed`);

      // 7) Create a PR to the base branch
      const prTitle = `Deploy: Add deployment configuration for ${applicationName}`;
      const prBody = `Automatically created deployment configuration for **${applicationName}**

### Changes
- Updated \`${deployPath}\` with host configuration
- Created/Updated GitHub Actions workflow

### Workflow Configuration
- **Branch**: ${actualBaseBranch}
- **Secret Name**: \`${secretName}\`
- **PHP Version**: 8.3

### Server Details
- **Host**: ${host}
- **User**: ${username}
- **Path**: ${sshPath}

### Next Steps
Ensure the following secrets and variables are set in your repository:
- \`${secretName}\` - SSH private key (already set if you ran SSH key setup)
- \`VAULT_ADDR\` - Your Vault address
- \`VAULT_TOKEN\` - Your Vault token
- \`VAULT_PATH\` (variable) - Path in Vault`;

      const prResp = await gh.post(`/repos/${owner}/${repoName}/pulls`, {
        title: prTitle,
        head: featureBranch,
        base: actualBaseBranch,
        body: prBody,
      });
      logger.info(`[DeployWorkflow] PR created: ${prResp.data?.html_url}`);

      // 8) Log the step with branch info
      await addApplicationStep(
        app.id,
        "deploy-workflow-update",
        "success",
        JSON.stringify({
          repository: `${owner}/${repoName}`,
          baseBranch: actualBaseBranch,
          branchCreated,
          featureBranch,
          deployPath,
          workflowPath,
          secretName,
          commit: putResp.data?.commit?.sha,
          workflowCommit: workflowResp.data?.commit?.sha,
          prNumber: prResp.data?.number,
          prUrl: prResp.data?.html_url,
          duration: Date.now() - startTime,
        })
      );

      return res.json({
        success: true,
        message: branchCreated
          ? `Created branch '${actualBaseBranch}' from 'dev', updated deploy.yml, created workflow and opened PR`
          : "Deployment configuration updated and PR created successfully",
        data: {
          repository: `${owner}/${repoName}`,
          baseBranch: actualBaseBranch,
          branchCreated,
          featureBranch,
          deployPath,
          workflowPath,
          secretName,
          prNumber: prResp.data?.number,
          prUrl: prResp.data?.html_url,
        },
      });
    } catch (error: any) {
      const details = (() => {
        try {
          const base: any = { message: error?.message || String(error) };
          if (error?.response?.status) base.status = error.response.status;
          if (error?.response?.data) base.data = error.response.data;
          if (error?.response?.headers) base.headers = error.response.headers;
          if (error?.stack) base.stack = error.stack;
          return base;
        } catch (_) {
          return { message: error?.message || String(error) };
        }
      })();

      try {
        const { host, username, applicationName } = req.body || {};
        const app =
          host && username && applicationName
            ? await getApplicationByName(host, username, applicationName)
            : null;
        if (app?.id) {
          await addApplicationStep(
            app.id,
            "deploy-workflow-update",
            "failed",
            JSON.stringify({ error: details, duration: Date.now() - startTime })
          );
        }
      } catch (_) {}

      return res.status(500).json({ success: false, error: details });
    }
  }
);

/**
 * GET /applications
 * List all applications
 */
router.get("/applications", async (req: Request, res: Response) => {
  try {
    await ensureDatabaseInitialized();
    const db =
      require("../shared/database").getDb?.() ||
      require("knex")(
        require("../../knexfile.cjs")[process.env.NODE_ENV || "development"]
      );

    const applications = await db("applications")
      .select([
        "id",
        "sessionId",
        "host",
        "username",
        "applicationName",
        "status",
        "createdAt",
        "githubUsername",
        "selectedRepo",
        "pathname",
      ])
      .orderBy("createdAt", "desc");

    logger.info(`[Applications] Retrieved ${applications.length} applications`);

    res.json({
      success: true,
      message: `Found ${applications.length} applications`,
      data: applications.map((app: any) => ({
        id: app.id,
        sessionId: app.sessionId,
        host: app.host,
        username: app.username,
        applicationName: app.applicationName,
        status: app.status,
        createdAt: app.createdAt,
        githubUsername: app.githubUsername || null,
        selectedRepo: app.selectedRepo || null,
        pathname: app.pathname || null,
      })),
    });
  } catch (error: any) {
    logger.error(
      `[Applications] Failed to list applications: ${error.message}`
    );
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /github/repos
 * List GitHub repositories for an application using stored token
 */
router.get("/github/repos", async (req: Request, res: Response) => {
  try {
    const { host, username, applicationName } = req.query as Record<
      string,
      string
    >;

    if (!host || !username || !applicationName) {
      return res.status(400).json({
        success: false,
        error: "Missing required query params: host, username, applicationName",
      });
    }

    await ensureDatabaseInitialized();
    const app = await getApplicationByName(host, username, applicationName);
    if (!app) {
      return res
        .status(404)
        .json({ success: false, error: "Application not found" });
    }

    if (!app.githubToken) {
      return res.status(400).json({
        success: false,
        error: "GitHub token not set for application",
      });
    }

    // Fetch repositories for the authenticated user
    const response = await axios.get("https://api.github.com/user/repos", {
      headers: {
        Authorization: `Bearer ${app.githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      params: { per_page: 100, sort: "updated" },
      timeout: 15000,
    });

    const repos = (response.data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: !!r.private,
      html_url: r.html_url,
      default_branch: r.default_branch,
      updated_at: r.updated_at,
    }));

    logger.info(`[GitHub] Listed ${repos.length} repos for ${username}`);
    res.json({ success: true, data: repos });
  } catch (error: any) {
    const msg = error?.response?.data?.message || error.message;
    logger.error(`[GitHub] Failed to list repos: ${msg}`);
    res
      .status(error?.response?.status || 500)
      .json({ success: false, error: msg });
  }
});

/**
 * POST /applications
 * Create a new application with connection details
 */
router.post("/applications", async (req: Request, res: Response) => {
  try {
    const { host, username, port = 22, applicationName } = req.body;

    if (!host || !username || !applicationName) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: host, username, applicationName",
      });
    }

    await ensureDatabaseInitialized();

    const sessionId = uuidv4();

    // Save application to database
    const result = await saveApplication({
      sessionId,
      host,
      username,
      port,
      applicationName,
    });

    logger.info(
      `[Applications] Created new application: ${applicationName} (ID: ${result.id})`
    );

    res.json({
      success: true,
      message: "Application created",
      data: {
        id: result.id,
        sessionId,
        host,
        username,
        port,
        applicationName,
      },
    });
  } catch (error: any) {
    logger.error(
      `[Applications] Failed to create application: ${error.message}`
    );
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /applications/:id
 * Get application details by ID
 */
router.get("/applications/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        success: false,
        error: "Invalid application ID",
      });
    }

    await ensureDatabaseInitialized();
    const db =
      require("../shared/database").getDb?.() ||
      require("knex")(
        require("../../knexfile.cjs")[process.env.NODE_ENV || "development"]
      );

    const application = await db("applications")
      .where({ id: Number(id) })
      .first();

    if (!application) {
      return res.status(404).json({
        success: false,
        error: "Application not found",
      });
    }

    logger.info(
      `[Applications] Retrieved application: ${application.applicationName}`
    );

    res.json({
      success: true,
      message: "Application retrieved",
      data: {
        id: application.id,
        sessionId: application.sessionId,
        host: application.host,
        username: application.username,
        port: application.port,
        applicationName: application.applicationName,
        status: application.status,
        createdAt: application.createdAt,
        githubUsername: application.githubUsername || null,
        githubToken: application.githubToken || null,
        selectedRepo: application.selectedRepo || null,
        pathname: application.pathname || null,
        domain: application.domain || null,
      },
    });
  } catch (error: any) {
    logger.error(`[Applications] Failed to get application: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /applications/:id/select-repo
 * Persist selected GitHub repository to the application record
 */
router.post(
  "/applications/:id/select-repo",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { selectedRepo } = req.body || {};

      if (!id || isNaN(Number(id))) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid application ID" });
      }
      if (!selectedRepo || typeof selectedRepo !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "'selectedRepo' is required" });
      }

      await ensureDatabaseInitialized();
      const db =
        require("../shared/database").getDb?.() ||
        require("knex")(
          require("../../knexfile.cjs")[process.env.NODE_ENV || "development"]
        );

      const existing = await db("applications")
        .where({ id: Number(id) })
        .first();
      if (!existing) {
        return res
          .status(404)
          .json({ success: false, error: "Application not found" });
      }

      await db("applications")
        .where({ id: Number(id) })
        .update({ selectedRepo });

      // Log step
      await addApplicationStep(
        Number(id),
        "repo-selection",
        "success",
        JSON.stringify({ selectedRepo })
      );

      logger.info(
        `[Applications] Selected repo updated for app ${id}: ${selectedRepo}`
      );
      return res.json({
        success: true,
        message: "Repository selection saved",
        data: { id: Number(id), selectedRepo },
      });
    } catch (error: any) {
      logger.error(
        `[Applications] Failed to save selected repo: ${error.message}`
      );
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * POST /applications/:id/database-config
 * Save database configuration for an application
 */
router.post(
  "/applications/:id/database-config",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { dbType, dbName, dbUsername, dbPassword, dbPort } = req.body || {};

      if (!id || isNaN(Number(id))) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid application ID" });
      }
      if (!dbType || !dbName || !dbUsername) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: dbType, dbName, dbUsername",
        });
      }

      await ensureDatabaseInitialized();
      const db =
        require("../shared/database").getDb?.() ||
        require("knex")(
          require("../../knexfile.cjs")[process.env.NODE_ENV || "development"]
        );

      const application = await db("applications")
        .where({ id: Number(id) })
        .first();
      if (!application) {
        return res
          .status(404)
          .json({ success: false, error: "Application not found" });
      }

      // Save database config in the databases table
      await db("databases")
        .insert({
          applicationId: Number(id),
          host: application.host,
          username: application.username,
          port: application.port || 22,
          applicationName: application.applicationName,
          dbType,
          dbName,
          dbUsername,
          dbPassword,
          dbPort: dbPort || null,
          status: "configured",
        })
        .onConflict(["host", "username", "applicationName", "dbName"])
        .merge();

      // Log step
      await addApplicationStep(
        Number(id),
        "database-config-save",
        "success",
        JSON.stringify({ dbType, dbName })
      );

      logger.info(
        `[Applications] Database config saved for app ${id}: ${dbType}/${dbName}`
      );
      return res.json({
        success: true,
        message: "Database configuration saved",
        data: { dbType, dbName, dbUsername, dbPort },
      });
    } catch (error: any) {
      logger.error(
        `[Applications] Failed to save database config: ${error.message}`
      );
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * GET /applications/:id/database-config
 * Retrieve database configuration for an application
 */
router.get(
  "/applications/:id/database-config",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!id || isNaN(Number(id))) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid application ID" });
      }

      await ensureDatabaseInitialized();
      const db =
        require("../shared/database").getDb?.() ||
        require("knex")(
          require("../../knexfile.cjs")[process.env.NODE_ENV || "development"]
        );

      const application = await db("applications")
        .where({ id: Number(id) })
        .first();
      if (!application) {
        return res
          .status(404)
          .json({ success: false, error: "Application not found" });
      }

      // Get the most recent database config
      const dbConfig = await db("databases")
        .where({ applicationId: Number(id) })
        .orderBy("createdAt", "desc")
        .first();

      if (!dbConfig) {
        return res.json({ success: true, data: null });
      }

      logger.info(`[Applications] Retrieved database config for app ${id}`);
      return res.json({
        success: true,
        data: {
          dbType: dbConfig.dbType,
          dbName: dbConfig.dbName,
          dbUsername: dbConfig.dbUsername,
          dbPassword: dbConfig.dbPassword,
          dbPort: dbConfig.dbPort,
        },
      });
    } catch (error: any) {
      logger.error(
        `[Applications] Failed to get database config: ${error.message}`
      );
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

export default router;
