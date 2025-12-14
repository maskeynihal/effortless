import express, { Request, Response } from "express";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { Client as SSH2Client } from "ssh2";
import { logger } from "../shared/logger";
import {
  WorkflowEngine,
  getOrCreateSession,
  removeSession,
  workflowSessions,
} from "../shared/workflow";
import { SSHConnectionStep } from "../steps/sshConnectionStep";
import { GitHubAuthStep } from "../steps/githubAuthStep";
import { GitHubSSHKeyRegistrationStep } from "../steps/githubSSHKeyRegistrationStep";
import { RepoSelectionStep } from "../steps/repoSelectionStep";
import { DeployKeyGenerationStep } from "../steps/deployKeyGenerationStep";
import {
  initializeDatabase,
  getSessionByApplication,
  saveSession,
  makeUserAdmin,
  isUserAdmin,
  getAdminUsers,
  removeAdminStatus,
} from "../shared/database";

// Ensure database is initialized before any DB access
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

const router = express.Router();

/**
 * Workflow session store with step instances
 */
interface SessionContext {
  engine: WorkflowEngine;
  sshStep?: SSHConnectionStep;
  githubStep?: GitHubAuthStep;
  registrationStep?: GitHubSSHKeyRegistrationStep;
  repoSelectionStep?: RepoSelectionStep;
  deployKeyStep?: DeployKeyGenerationStep;
}

const sessionContexts = new Map<string, SessionContext>();

/**
 * POST /workflow/init
 * Initialize a new workflow session with SSH connection parameters
 */
router.post("/workflow/init", async (req: Request, res: Response) => {
  try {
    const {
      host,
      username,
      privateKeyPath,
      privateKeyContent,
      port = 22,
      sshKeyName,
      applicationName,
    } = req.body;

    logger.debug(`[API] /workflow/init request body:`, {
      host,
      username,
      hasPrivateKeyPath: !!privateKeyPath,
      hasPrivateKeyContent: !!privateKeyContent,
      keyContentLength: privateKeyContent?.length,
      port,
      sshKeyName,
      applicationName,
    });

    // Validate required parameters
    if (!host || !username || (!privateKeyPath && !privateKeyContent)) {
      logger.warn("[API] Invalid init request - missing required parameters");
      return res.status(400).json({
        success: false,
        error:
          "Missing required parameters: host, username, and either privateKeyPath or privateKeyContent",
      });
    }

    // Generate unique session ID
    const sessionId = uuidv4();
    logger.info(`[API] Initializing workflow session: ${sessionId}`);

    // Create workflow engine
    const engine = getOrCreateSession(sessionId);

    // Create and register SSH connection step
    const sshStep = new SSHConnectionStep(
      host,
      username,
      privateKeyPath || "",
      port,
      privateKeyContent
    );
    engine.registerStep(sshStep);
    logger.debug(
      `[API] Registered SSH connection step for ${username}@${host}`
    );

    // Create and register GitHub auth step (placeholder PAT for now)
    const githubStep = new GitHubAuthStep("");
    engine.registerStep(githubStep);
    logger.debug("[API] Registered GitHub auth step");

    // Create and register repo selection step
    const repoSelectionStep = new RepoSelectionStep(githubStep);
    engine.registerStep(repoSelectionStep);
    logger.debug("[API] Registered repo selection step");

    // Create and register deploy key generation step
    const deployKeyStep = new DeployKeyGenerationStep(
      sshStep,
      githubStep,
      repoSelectionStep,
      applicationName || "effortless",
      sshStep.getHost(),
      sshStep.getUsername()
    );
    engine.registerStep(deployKeyStep);
    logger.debug("[API] Registered deploy key generation step");

    // Store context
    sessionContexts.set(sessionId, {
      engine,
      sshStep,
      githubStep,
      repoSelectionStep,
      deployKeyStep,
    });

    // Persist initial session so later steps (DB/env setup) can retrieve SSH key
    try {
      await ensureDatabaseInitialized();
      await saveSession({
        sessionId,
        host,
        username,
        port,
        sshKeyName,
        applicationName,
        sshPrivateKey: privateKeyContent,
      });
      logger.info(
        `[API] Session persisted for ${applicationName || "(no-app)"}`
      );
    } catch (e: any) {
      logger.warn(`[API] Failed to persist session: ${e?.message || e}`);
    }

    logger.info(
      `[API] Workflow session initialized: ${sessionId} with 4 steps`
    );

    res.json({
      success: true,
      message: "Workflow session initialized",
      sessionId,
      workflow: {
        steps: engine.getState().steps,
        currentStep: engine.getState().currentStep,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(`[API] Failed to initialize workflow: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /workflow/:sessionId/next
 * Execute the next step in the workflow
 */
router.post(
  "/workflow/:sessionId/next",
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { pat, sshKeyName, applicationName, selectedRepo } = req.body;

      const context = sessionContexts.get(sessionId);
      if (!context) {
        logger.warn(`[API] Session not found: ${sessionId}`);
        return res.status(404).json({
          success: false,
          error: "Session not found",
        });
      }

      const { engine, sshStep, githubStep, repoSelectionStep, deployKeyStep } =
        context;
      const state = engine.getState();
      const currentStepName = state.steps[state.currentStep];

      logger.info(
        `[API] Executing step ${state.currentStep + 1}/${
          state.steps.length
        }: ${currentStepName}`
      );

      // Provide PAT for GitHub auth step
      if (currentStepName === "github-auth" && pat) {
        // Create new GitHub auth step with provided PAT
        const newGithubStep = new GitHubAuthStep(pat);
        context.githubStep = newGithubStep;

        // Re-register with updated step
        engine.registerStep(newGithubStep);
        logger.debug("[API] Updated GitHub auth step with provided PAT");

        // Persist PAT to session DB
        if (sshStep && applicationName) {
          try {
            await saveSession({
              sessionId,
              host: sshStep.getHost(),
              username: sshStep.getUsername(),
              port: 22,
              githubToken: pat,
              applicationName,
            });
            logger.info("[API] Saved GitHub token to session DB");
          } catch (e: any) {
            logger.warn(`[API] Failed to save PAT to DB: ${e.message}`);
          }
        }

        // Update dependent steps with new GitHub step
        if (repoSelectionStep) {
          context.repoSelectionStep = new RepoSelectionStep(newGithubStep);
        }
        if (deployKeyStep) {
          context.deployKeyStep = new DeployKeyGenerationStep(
            sshStep!,
            newGithubStep,
            context.repoSelectionStep || new RepoSelectionStep(newGithubStep),
            applicationName || "effortless",
            sshStep!.getHost(),
            sshStep!.getUsername()
          );
        }
      }

      // Handle repo selection
      if (currentStepName === "github-repo-selection" && selectedRepo) {
        if (repoSelectionStep) {
          repoSelectionStep.setSelectedRepo(selectedRepo);
          logger.info(`[API] Repository selected: ${selectedRepo}`);

          // Re-register the updated step with the engine
          engine.registerStep(repoSelectionStep);
          logger.debug(
            "[API] Updated repo selection step with selected repository"
          );

          // Persist selectedRepo to session DB
          if (sshStep && applicationName) {
            try {
              await saveSession({
                sessionId,
                host: sshStep.getHost(),
                username: sshStep.getUsername(),
                port: 22,
                applicationName,
                selectedRepo,
              });
              logger.info("[API] Saved selected repo to session DB");
            } catch (e: any) {
              logger.warn(`[API] Failed to save repo to DB: ${e.message}`);
            }
          }

          // Also update and re-register the deploy key step with the updated repo selection step
          if (deployKeyStep && githubStep && sshStep) {
            const updatedDeployKeyStep = new DeployKeyGenerationStep(
              sshStep,
              githubStep,
              repoSelectionStep,
              applicationName || "effortless",
              sshStep.getHost(),
              sshStep.getUsername()
            );
            context.deployKeyStep = updatedDeployKeyStep;
            engine.registerStep(updatedDeployKeyStep);
            logger.debug(
              "[API] Updated deploy key step with selected repository"
            );
          }
        }
      }

      // Execute current step
      const result = await engine.executeCurrentStep();

      logger.info(
        `[API] Step result - Success: ${result.success}, Message: ${result.message}`
      );

      res.json({
        success: result.success,
        message: result.message,
        error: result.error,
        workflow: {
          currentStep: engine.getState().currentStep,
          totalSteps: engine.getState().steps.length,
          completed: engine.getState().completed,
          nextStepName:
            engine.getState().currentStep < engine.getState().steps.length
              ? engine.getState().steps[engine.getState().currentStep]
              : null,
        },
        data: result.data,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`[API] Failed to execute workflow step: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * POST /workflow/:sessionId/skip
 * Skip the current step without executing it
 */
router.post(
  "/workflow/:sessionId/skip",
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const context = sessionContexts.get(sessionId);
      if (!context) {
        logger.warn(`[API] Session not found: ${sessionId}`);
        return res.status(404).json({
          success: false,
          error: "Session not found",
        });
      }

      const { engine } = context;
      const state = engine.getState();
      const currentStepName = state.steps[state.currentStep];

      logger.info(
        `[API] Skipping step ${state.currentStep + 1}/${
          state.steps.length
        }: ${currentStepName}`
      );

      const skipped = engine.skipCurrentStep();

      if (!skipped) {
        return res.status(400).json({
          success: false,
          error:
            "Cannot skip step - workflow already completed or invalid state",
        });
      }

      res.json({
        success: true,
        message: `Skipped step: ${currentStepName}`,
        workflow: {
          currentStep: engine.getState().currentStep,
          totalSteps: engine.getState().steps.length,
          completed: engine.getState().completed,
          nextStepName:
            engine.getState().currentStep < engine.getState().steps.length
              ? engine.getState().steps[engine.getState().currentStep]
              : null,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`[API] Failed to skip step: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * POST /workflow/:sessionId/repos
 * Get available repositories for the authenticated GitHub user
 */
router.post(
  "/workflow/:sessionId/repos",
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { pat } = req.body;

      if (!pat) {
        return res.status(400).json({
          success: false,
          error: "GitHub PAT is required",
        });
      }

      logger.info(`[API] Fetching repositories for session: ${sessionId}`);

      // Always create fresh temporary steps with the provided PAT
      // This ensures we use the latest token from the request, not stale context
      logger.debug(
        "[API] Creating temporary GitHub auth and repo selection steps with provided PAT"
      );
      const tempGithubStep = new GitHubAuthStep(pat);
      const repoStep = new RepoSelectionStep(tempGithubStep);

      // Get available repositories
      const repos = await repoStep.getAvailableRepos();

      res.json({
        success: true,
        message: `Found ${repos.length} repositories`,
        data: {
          repos,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`[API] Failed to fetch repositories: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * GET /workflow/:sessionId/status
 * Get current workflow session status
 */
router.get("/workflow/:sessionId/status", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const engine = workflowSessions.get(sessionId);
    if (!engine) {
      logger.warn(`[API] Session not found: ${sessionId}`);
      return res.status(404).json({
        success: false,
        error: "Session not found",
      });
    }

    const state = engine.getState();

    res.json({
      success: true,
      sessionId,
      workflow: {
        currentStep: state.currentStep,
        totalSteps: state.steps.length,
        steps: state.steps,
        completed: state.completed,
        nextStepName:
          state.currentStep < state.steps.length
            ? state.steps[state.currentStep]
            : null,
      },
      data: state.data,
      history: state.history.map((event) => ({
        timestamp: event.timestamp,
        step: event.stepName,
        event: event.event,
        message: event.message,
      })),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(`[API] Failed to get workflow status: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /workflow/:sessionId/reset
 * Reset workflow to the beginning
 */
router.post("/workflow/:sessionId/reset", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const engine = workflowSessions.get(sessionId);
    if (!engine) {
      logger.warn(`[API] Session not found: ${sessionId}`);
      return res.status(404).json({
        success: false,
        error: "Session not found",
      });
    }

    engine.reset();
    logger.info(`[API] Workflow session reset: ${sessionId}`);

    res.json({
      success: true,
      message: "Workflow reset to beginning",
      workflow: {
        currentStep: engine.getState().currentStep,
        totalSteps: engine.getState().steps.length,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(`[API] Failed to reset workflow: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * DELETE /workflow/:sessionId
 * Cleanup and remove a workflow session
 */
router.delete("/workflow/:sessionId", (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const context = sessionContexts.get(sessionId);
    if (context?.sshStep) {
      context.sshStep.closeConnection();
    }

    sessionContexts.delete(sessionId);
    removeSession(sessionId);

    logger.info(`[API] Workflow session removed: ${sessionId}`);

    res.json({
      success: true,
      message: "Workflow session deleted",
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(`[API] Failed to delete workflow session: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /database/create
 * Create a database on remote server
 */
router.post("/database/create", async (req: Request, res: Response) => {
  try {
    const {
      host,
      username,
      port = 22,
      applicationName,
      dbType,
      dbName,
      dbUsername,
      dbPassword,
      dbPort,
    } = req.body;

    if (!applicationName) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: applicationName",
      });
    }

    logger.info(
      `[Database] Creating ${dbType} database: ${dbName} on ${username}@${host} for ${applicationName}`
    );

    // Initialize DB and fetch session credentials
    await ensureDatabaseInitialized();

    // Fetch session to get privateKey
    const session = await getSessionByApplication(
      host,
      username,
      applicationName
    );
    if (!session || !session.sshPrivateKey) {
      logger.error(
        `[Database] No session or SSH key found for ${applicationName}`
      );
      return res.status(400).json({
        success: false,
        error:
          "Session not found or SSH private key not available. Please initialize workflow first.",
      });
    }

    logger.info(
      `[Database] Found session for ${applicationName}, creating SSH connection`
    );

    // Create SSH step to execute database creation commands
    const sshStep = new SSHConnectionStep(
      host,
      username,
      "",
      port,
      session.sshPrivateKey
    );

    // Execute SSH connection
    const connResult = await sshStep.execute();
    if (!connResult.success) {
      return res.status(400).json({
        success: false,
        error: "Failed to connect to remote server",
      });
    }

    let createDbCommand = "";

    if (dbType === "MySQL") {
      // MySQL database creation commands
      createDbCommand = `mysql -u root -e "CREATE DATABASE IF NOT EXISTS \\\`${dbName}\\\`; CREATE USER '${dbUsername}'@'localhost' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON \\\`${dbName}\\\`.* TO '${dbUsername}'@'localhost'; FLUSH PRIVILEGES;"`;
    } else if (dbType === "PostgreSQL") {
      // PostgreSQL database creation commands - create DB first (outside transaction)
      createDbCommand = `sudo -u postgres createdb ${dbName} 2>/dev/null || true`;
    }

    if (!createDbCommand) {
      return res.status(400).json({
        success: false,
        error: "Unsupported database type",
      });
    }

    logger.info(`[Database] Executing: ${dbType} database creation`);
    const execResult = await sshStep.executeRemoteCommand(
      createDbCommand,
      30000
    );

    logger.info(`[Database] Database creation output:`, execResult.stdout);

    if (
      execResult.stderr &&
      !execResult.stderr.includes("already exists") &&
      !execResult.stderr.includes("ERROR")
    ) {
      logger.warn(`[Database] stderr: ${execResult.stderr}`);
    }

    // For PostgreSQL, also create the user and grant privileges
    if (dbType === "PostgreSQL") {
      // Create user
      const createUserCmd = `sudo -u postgres psql -c "CREATE USER ${dbUsername} WITH PASSWORD '${dbPassword}';" 2>/dev/null || true`;
      await sshStep.executeRemoteCommand(createUserCmd, 15000);

      // Grant privileges
      const grantCmd = `sudo -u postgres psql -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${dbUsername}; GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUsername};"`;
      await sshStep.executeRemoteCommand(grantCmd, 15000);
    }

    // Verify database was created
    let verifyCommand = "";
    if (dbType === "MySQL") {
      verifyCommand = `mysql -u ${dbUsername} -p${dbPassword} -e "SELECT DATABASE();" 2>/dev/null`;
    } else if (dbType === "PostgreSQL") {
      verifyCommand = `sudo -u postgres psql -lqt | cut -d \\| -f 1 | grep -w ${dbName}`;
    }

    const verifyResult = await sshStep.executeRemoteCommand(
      verifyCommand,
      15000
    );

    const dbCreated = verifyResult.stdout.trim().length > 0;

    res.json({
      success: dbCreated,
      message: dbCreated
        ? `${dbType} database '${dbName}' created successfully`
        : `Failed to verify ${dbType} database creation`,
      data: {
        dbType,
        dbName,
        dbUsername,
        host,
        port: dbPort,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error(`[Database] Creation failed: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /application/setup
 * Create application folder on remote server with proper ownership
 */
router.post("/application/setup", async (req: Request, res: Response) => {
  const { host, port, username, pathname, applicationName } = req.body;

  if (!host || !username || !pathname || !applicationName) {
    return res.status(400).json({
      success: false,
      error:
        "Missing required fields: host, username, pathname, applicationName",
    });
  }

  try {
    // Initialize DB and fetch session credentials
    await ensureDatabaseInitialized();
    logger.info(
      `Setting up application folder: ${pathname} on ${host} for ${applicationName}`
    );

    // Fetch session to get privateKey
    const session = await getSessionByApplication(
      host,
      username,
      applicationName
    );
    if (!session || !session.sshPrivateKey) {
      logger.error(
        `[setup] No session or SSH key found for ${applicationName}`
      );
      return res.status(400).json({
        success: false,
        error:
          "Session not found or SSH private key not available. Please initialize workflow first.",
      });
    }

    logger.info(
      `[setup] Found session for ${applicationName}, connecting via SSH`
    );

    // Create SSH connection
    const ssh = new SSH2Client();

    await new Promise<void>((resolve, reject) => {
      ssh.on("ready", resolve);
      ssh.on("error", reject);

      ssh.connect({
        host,
        port: port || 22,
        username,
        privateKey: Buffer.from(session.sshPrivateKey),
        readyTimeout: 30000,
      });
    });

    logger.info("SSH connection established for application setup");

    // First verify sudo access without password
    let sudoVerified = false;
    await new Promise<void>((resolve, reject) => {
      ssh.exec(`sudo -n true`, (err: Error | undefined, stream: any) => {
        if (err) {
          logger.warn(
            `Sudo without password not configured. User may need to configure NOPASSWD in sudoers.`
          );
          resolve(); // Continue anyway, but sudo might fail
          return;
        }

        if (stream.stdin) {
          stream.stdin.end();
        }

        stream.on("close", (code: number) => {
          if (code === 0) {
            sudoVerified = true;
            logger.info("Sudo access verified (NOPASSWD configured)");
          } else {
            logger.warn(
              "Sudo access check failed. NOPASSWD may not be configured."
            );
          }
          resolve();
        });

        stream.on("error", () => {
          resolve(); // Continue anyway
        });
      });
    });

    let commandOutput = "";

    // Create folder with sudo (non-interactive with -n flag)
    await new Promise<void>((resolve, reject) => {
      let mkdirTimeout: NodeJS.Timeout;

      mkdirTimeout = setTimeout(() => {
        logger.warn("Mkdir command timeout - continuing anyway");
        resolve();
      }, 10000); // 10 second timeout for mkdir

      ssh.exec(
        `sudo -n mkdir -p ${pathname}`,
        (err: Error | undefined, stream: any) => {
          clearTimeout(mkdirTimeout);
          if (err) {
            logger.warn(`Mkdir error: ${err.message}`);
            reject(err);
            return;
          }

          // Close stdin to prevent waiting for input
          if (stream.stdin) {
            stream.stdin.end();
          }

          stream.on("close", (code: number) => {
            clearTimeout(mkdirTimeout);
            if (code !== 0) {
              logger.warn(`Mkdir exited with code ${code}`);
              return reject(
                new Error(`Failed to create folder: exit code ${code}`)
              );
            }
            logger.info("Mkdir command completed successfully");
            resolve();
          });

          stream.on("data", (data: Buffer) => {
            commandOutput += data.toString();
          });

          stream.on("error", (err: Error) => {
            clearTimeout(mkdirTimeout);
            logger.warn(`Mkdir stream error: ${err.message}`);
            reject(err);
          });
        }
      );
    });

    logger.info(`Folder created: ${pathname}`);

    // Change ownership to the SSH user (non-interactive with -n flag)
    const chownCommand = `sudo -n chown ${username}:${username} ${pathname}`;

    logger.info(`Executing chown command: ${chownCommand}`);

    // Attempt chown but don't fail if it times out
    await new Promise<void>((resolve) => {
      let commandTimeout: NodeJS.Timeout;

      commandTimeout = setTimeout(() => {
        logger.warn("Chown command timeout - continuing without waiting");
        resolve();
      }, 5000); // 5 second timeout

      ssh.exec(chownCommand, (err: Error | undefined, stream: any) => {
        clearTimeout(commandTimeout);
        if (err) {
          logger.warn(`Chown command error: ${err.message}`);
          resolve();
          return;
        }

        // Close stdin to prevent waiting for input
        if (stream.stdin) {
          stream.stdin.end();
        }

        stream.on("close", (code: number) => {
          clearTimeout(commandTimeout);
          if (code === 0) {
            logger.info("Chown command completed successfully");
          } else {
            logger.warn(`Chown command exited with code ${code}`);
          }
          resolve();
        });

        stream.on("error", (err: Error) => {
          clearTimeout(commandTimeout);
          logger.warn(`Chown stream error: ${err.message}`);
          resolve();
        });
      });
    });

    logger.info(`Ownership changed to ${username}:${username}`);

    // Verify folder and permissions
    let verifyOutput = "";

    logger.info(`Verifying folder: ${pathname}`);

    await new Promise<void>((resolve, reject) => {
      let verifyTimeout: NodeJS.Timeout;

      verifyTimeout = setTimeout(() => {
        logger.warn("Verify command timeout");
        resolve(); // Don't fail on verify timeout, return what we have
      }, 5000); // 5 second timeout for verify

      ssh.exec(
        `ls -la ${pathname} | head -1`,
        (err: Error | undefined, stream: any) => {
          clearTimeout(verifyTimeout);
          if (err) {
            logger.warn(`Verify command error: ${err.message}`);
            resolve(); // Don't fail on verify error
            return;
          }

          // Close stdin to prevent waiting for input
          if (stream.stdin) {
            stream.stdin.end();
          }

          stream.on("data", (data: Buffer) => {
            verifyOutput += data.toString();
          });

          stream.on("close", (code: number) => {
            clearTimeout(verifyTimeout);
            logger.info(`Verification completed with code ${code}`);
            resolve();
          });

          stream.on("error", () => {
            clearTimeout(verifyTimeout);
            resolve(); // Don't fail on verify error
          });
        }
      );
    });

    ssh.end();

    res.json({
      success: true,
      message: "Application folder setup completed",
      folderPath: pathname,
      owner: `${username}:${username}`,
      verificationInfo: verifyOutput.trim(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const full = (() => {
      try {
        // Include stack and any nested response data
        const base: any = {
          message,
        };
        if ((error as any)?.stack) base.stack = (error as any).stack;
        if ((error as any)?.response) {
          base.response = {
            status: (error as any).response?.status,
            headers: (error as any).response?.headers,
            data: (error as any).response?.data,
          };
        }
        return base;
      } catch (_) {
        return { message };
      }
    })();
    logger.error(`Application setup error: ${message}`);
    res.status(500).json({
      success: false,
      error: full,
    });
  }
});

/**
 * POST /application/setup-env
 * Setup .env file for application with database credentials
 */
router.post("/application/setup-env", async (req: Request, res: Response) => {
  const {
    host,
    port,
    username,
    pathname,
    applicationName,
    repoUrl,
    dbDatabase,
    dbUsername,
    dbPassword,
  } = req.body;

  if (!host || !username || !pathname || !applicationName) {
    return res.status(400).json({
      success: false,
      error:
        "Missing required fields: host, username, pathname, applicationName",
    });
  }

  try {
    // Initialize DB for session lookups
    await ensureDatabaseInitialized();
    logger.info(
      `Setting up .env file for ${applicationName} at ${pathname}/.env`
    );

    // Load session to get credentials and repo info
    let sessionForEnv: any = null;
    try {
      sessionForEnv = await getSessionByApplication(
        host,
        username,
        applicationName
      );
    } catch (e: any) {
      const msg = e?.message || String(e);
      logger.warn(`[env] getSessionByApplication failed: ${msg}`);
      if (msg.includes("Database not initialized")) {
        logger.info("[env] Retrying after database initialization");
        await ensureDatabaseInitialized();
        sessionForEnv = await getSessionByApplication(
          host,
          username,
          applicationName
        );
      } else {
        // proceed without session
      }
    }

    if (!sessionForEnv || !sessionForEnv.sshPrivateKey) {
      logger.error(`[env] No session or SSH key found for ${applicationName}`);
      return res.status(400).json({
        success: false,
        error:
          "Session not found or SSH private key not available. Please initialize workflow first.",
      });
    }

    logger.info(`[env] Found session for ${applicationName}`);
    logger.info(`[env] GitHub token available: ${!!sessionForEnv.githubToken}`);
    logger.info(`[env] Selected repo: ${sessionForEnv.selectedRepo || "none"}`);

    // Create SSH connection
    const ssh = new SSH2Client();

    await new Promise<void>((resolve, reject) => {
      ssh.on("ready", resolve);
      ssh.on("error", reject);

      ssh.connect({
        host,
        port: port || 22,
        username,
        privateKey: Buffer.from(sessionForEnv.sshPrivateKey),
        readyTimeout: 30000,
      });
    });

    logger.info("SSH connection established for .env setup");

    const derivedRepoUrl = repoUrl || sessionForEnv?.selectedRepo || null;
    if (!repoUrl && derivedRepoUrl) {
      logger.info(`[env] Using repoUrl from session: ${derivedRepoUrl}`);
    }

    // Check for GitHub token and repoUrl
    const sessionToken: string | undefined = sessionForEnv?.githubToken;
    if (!sessionToken) {
      logger.warn(
        "[env] No GitHub token found in session - private repos may be inaccessible"
      );
    }
    if (!derivedRepoUrl) {
      logger.warn(
        "[env] Strict mode: missing repoUrl (no request value and none in session)"
      );
      ssh.end();
      return res.status(400).json({
        success: false,
        error:
          "Repository URL is required. Please select and store a repository before setting up .env.",
      });
    }

    // Helper: robust .env.example fetch from GitHub
    const fetchEnvExampleFromRepo = async (): Promise<string | null> => {
      const effectiveRepoUrl = derivedRepoUrl;
      if (!effectiveRepoUrl) {
        logger.info("[env] No repoUrl provided; skipping GitHub fetch");
        return null;
      }

      let owner: string;
      let repo: string;

      // Check if it's short format "owner/repo" (only one slash)
      const slashCount = (effectiveRepoUrl.match(/\//g) || []).length;
      if (slashCount === 1 && !effectiveRepoUrl.startsWith("http")) {
        // Short format: "owner/repo"
        const parts = effectiveRepoUrl.split("/");
        owner = parts[0];
        repo = parts[1];
        logger.info(
          `[env] Repo parsed from short format: owner=${owner}, repo=${repo}`
        );
      } else {
        // Full URL format
        const m = effectiveRepoUrl.match(
          /^https?:\/\/github\.com\/([^\/]+)\/([^\/?#]+)(?:[\/?#].*)?$/
        );
        if (!m) {
          logger.warn(`[env] Unable to parse repoUrl: ${effectiveRepoUrl}`);
          return null;
        }
        owner = m[1];
        repo = m[2];
        logger.info(`[env] Repo parsed from URL: owner=${owner}, repo=${repo}`);
      }

      const session = await getSessionByApplication(
        host,
        username,
        applicationName
      );
      const token: string | undefined = session?.githubToken;
      const headers = token
        ? {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.raw+json",
            "X-GitHub-Api-Version": "2022-11-28",
          }
        : {
            Accept: "application/vnd.github.raw+json",
            "X-GitHub-Api-Version": "2022-11-28",
          };
      if (token)
        logger.info("[env] GitHub token found; private repo access enabled");
      else logger.info("[env] No GitHub token; only public content accessible");

      const branches = ["main", "master"];
      const candidatePaths = [
        ".env.example",
        "env.example",
        "example.env",
        "config/.env.example",
      ];

      // Strategy 1: Contents API with ref using raw media type
      for (const ref of branches) {
        for (const p of candidatePaths) {
          const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(
            p
          )}}`;
          try {
            logger.info(`[env] Contents API fetch (raw): ${apiUrl}`);
            const r = await axios.get(apiUrl, { headers, timeout: 12000 });
            logger.info(headers.Authorization);
            if (r.status === 200 && typeof r.data === "string") {
              logger.info(
                `[env] Found ${p} on branch ${ref} via Contents API (raw)`
              );
              return r.data as string;
            }
          } catch (e: any) {
            const status = e?.response?.status;
            if (status === 404) logger.debug(`[env] ${p} not found on ${ref}`);
            else if (status === 403)
              logger.warn(`[env] Access denied or rate limited for ${apiUrl}`);
            else
              logger.debug(
                `[env] Contents API error for ${apiUrl}: ${e?.message || e}`
              );
          }
        }
      }

      // Strategy 2: Raw content (public repos)
      for (const ref of branches) {
        for (const p of candidatePaths) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${p}`;
          try {
            logger.info(`[env] Raw fetch: ${rawUrl}`);
            const r = await axios.get(rawUrl, { timeout: 10000 });
            if (typeof r.data === "string") {
              logger.info(`[env] Found ${p} on branch ${ref} via raw`);
              return r.data as string;
            }
          } catch (e: any) {
            logger.debug(
              `[env] Raw fetch failed for ${rawUrl}: ${e?.message || e}`
            );
          }
        }
      }

      logger.warn("[env] .env.example not found in repo using all strategies");
      return null;
    };

    let envContent = await fetchEnvExampleFromRepo();
    if (!envContent) {
      logger.warn(
        "[env] Strict mode: .env.example not found in the repository"
      );
      ssh.end();
      return res.status(400).json({
        success: false,
        error:
          ".env.example not found in the selected repository (checked main/master and common paths). Please add .env.example to the repo.",
      });
    } else {
      // Replace or append DB credentials into the fetched content
      const upsert = (text: string, key: string, value: string) => {
        const re = new RegExp(`^${key}=.*$`, "m");
        if (re.test(text)) {
          return text.replace(re, `${key}=${value}`);
        }
        // Append if missing
        return `${text}\n${key}=${value}\n`;
      };
      logger.info(`[env] Injecting DB credentials into fetched .env.example`);
      envContent = upsert(envContent, "DB_DATABASE", String(dbDatabase || ""));
      envContent = upsert(envContent, "DB_USERNAME", String(dbUsername || ""));
      envContent = upsert(envContent, "DB_PASSWORD", String(dbPassword || ""));
      if (!/DB_HOST=/.test(envContent)) {
        envContent = `${envContent}\nDB_HOST=localhost\n`;
      }
    }

    // Write .env file to remote server
    const envSharedDir = `${pathname}/shared`;
    const envPath = `${envSharedDir}/.env`;
    // Ensure shared directory exists
    await new Promise<void>((resolve) => {
      ssh.exec(
        `sudo -n mkdir -p ${envSharedDir}`,
        (err: Error | undefined, stream: any) => {
          if (stream?.stdin) stream.stdin.end();
          stream?.on("close", () => resolve());
          stream?.on("error", () => resolve());
          if (err) resolve();
        }
      );
    });
    let writeOutput = "";

    await new Promise<void>((resolve, reject) => {
      // Safer write via echo + tee (handles permissions via sudo)
      const escaped = envContent.replace(/`/g, "\\`").replace(/\$/g, "\\$");
      const cmd = `echo "${escaped}" | sudo -n tee ${envPath} > /dev/null`;
      logger.info(`[env] Writing .env to ${envPath} via sudo tee`);
      ssh.exec(cmd, (err: Error | undefined, stream: any) => {
        if (err) return reject(err);

        if (stream.stdin) {
          stream.stdin.end();
        }

        stream.on("data", (data: Buffer) => {
          writeOutput += data.toString();
        });

        stream.on("close", (code: number) => {
          if (code !== 0) {
            return reject(
              new Error(`Failed to write .env file: exit code ${code}`)
            );
          }
          logger.info(`[env] .env write completed`);
          resolve();
        });
      });
    });

    logger.info(`.env file created at ${envPath}`);

    // Verify file was created
    let verifyOutput = "";
    await new Promise<void>((resolve, reject) => {
      ssh.exec(
        `test -f ${envPath} && echo "File exists" || echo "File not found"`,
        (err: Error | undefined, stream: any) => {
          if (err) return reject(err);

          if (stream.stdin) {
            stream.stdin.end();
          }

          stream.on("data", (data: Buffer) => {
            verifyOutput += data.toString();
          });

          stream.on("close", (code: number) => {
            resolve();
          });
        }
      );
    });

    ssh.end();

    res.json({
      success: true,
      message: ".env file created successfully",
      filePath: envPath,
      verificationInfo: verifyOutput.trim(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const full = (() => {
      try {
        const base: any = { message };
        if ((error as any)?.stack) base.stack = (error as any).stack;
        if ((error as any)?.response) {
          base.response = {
            status: (error as any).response?.status,
            headers: (error as any).response?.headers,
            data: (error as any).response?.data,
          };
        }
        return base;
      } catch (_) {
        return { message };
      }
    })();
    logger.error(`.env setup error: ${message}`);
    res.status(500).json({
      success: false,
      error: full,
    });
  }
});

/**
 * POST /admin/promote
 * Make a user admin on a specific host
 */
router.post("/admin/promote", async (req: Request, res: Response) => {
  try {
    const { host, username, promotedBy } = req.body;

    if (!host || !username) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: host, username",
      });
    }

    await ensureDatabaseInitialized();
    const success = await makeUserAdmin(host, username, promotedBy);

    if (success) {
      logger.info(`[admin] User ${username}@${host} promoted to admin`);
      res.json({
        success: true,
        message: `User ${username} is now admin on ${host}`,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Failed to promote user to admin",
      });
    }
  } catch (error: any) {
    logger.error(`[admin] Error promoting user: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /admin/check
 * Check if a user is admin
 */
router.get("/admin/check", async (req: Request, res: Response) => {
  try {
    const { host, username } = req.query;

    if (!host || !username) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: host, username",
      });
    }

    await ensureDatabaseInitialized();
    const isAdmin = await isUserAdmin(String(host), String(username));

    res.json({
      success: true,
      host: String(host),
      username: String(username),
      isAdmin,
    });
  } catch (error: any) {
    logger.error(`[admin] Error checking admin status: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /admin/users
 * Get all admin users
 */
router.get("/admin/users", async (req: Request, res: Response) => {
  try {
    await ensureDatabaseInitialized();
    const adminUsers = await getAdminUsers();

    res.json({
      success: true,
      count: adminUsers.length,
      adminUsers,
    });
  } catch (error: any) {
    logger.error(`[admin] Error fetching admin users: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /admin/demote
 * Remove admin status from a user
 */
router.post("/admin/demote", async (req: Request, res: Response) => {
  try {
    const { host, username } = req.body;

    if (!host || !username) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: host, username",
      });
    }

    await ensureDatabaseInitialized();
    const success = await removeAdminStatus(host, username);

    if (success) {
      logger.info(`[admin] User ${username}@${host} demoted from admin`);
      res.json({
        success: true,
        message: `User ${username} is no longer admin on ${host}`,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Failed to remove admin status",
      });
    }
  } catch (error: any) {
    logger.error(`[admin] Error demoting user: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get("/health", (req: Request, res: Response) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;
