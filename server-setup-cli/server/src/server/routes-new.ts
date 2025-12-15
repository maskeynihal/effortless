import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { Client as SSH2Client } from "ssh2";
import { logger } from "../shared/logger";
import axios from "axios";
import sodium from "libsodium-wrappers";
import yaml from "js-yaml";
import {
  initializeDatabase,
  saveApplication,
  getApplicationByName,
  addApplicationStep,
  getApplicationSteps,
  updateApplicationStatus,
  updatePrivateKeySecretName,
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

/**
 * POST /step/deploy-workflow-update
 * Prompt for a base branch name, update deploy.yml on a new feature branch, and open a PR.
 * Also records branch info in the application steps log.
 */
router.post(
  "/step/deploy-workflow-update",
  async (req: Request, res: Response) => {
    const startTime = Date.now();

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

      // 1) Resolve base branch ref/commit
      const refResp = await gh.get(
        `/repos/${owner}/${repoName}/git/refs/heads/${encodeURIComponent(
          baseBranch
        )}`
      );
      const baseSha = refResp.data?.object?.sha || refResp.data?.sha;
      if (!baseSha) {
        return res.status(404).json({
          success: false,
          error: `Base branch not found: ${baseBranch}`,
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

      // 6) Create a PR to the base branch
      const prTitle = `Update deploy.yml for ${applicationName}`;
      const prResp = await gh.post(`/repos/${owner}/${repoName}/pulls`, {
        title: prTitle,
        head: featureBranch,
        base: baseBranch,
        body: `This PR updates deploy.yml to configure deployment for ${applicationName}.`,
      });

      // 7) Log the step with branch info
      await addApplicationStep(
        app.id,
        "deploy-workflow-update",
        "success",
        JSON.stringify({
          repository: `${owner}/${repoName}`,
          baseBranch,
          featureBranch,
          deployPath,
          commit: putResp.data?.commit?.sha,
          prNumber: prResp.data?.number,
          duration: Date.now() - startTime,
        })
      );

      return res.json({
        success: true,
        message: "deploy.yml updated and PR created",
        data: {
          repository: `${owner}/${repoName}`,
          baseBranch,
          featureBranch,
          deployPath,
          prNumber: prResp.data?.number,
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
