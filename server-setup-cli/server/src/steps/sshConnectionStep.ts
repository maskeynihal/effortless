import { IWorkflowStep, WorkflowStepResult } from "../shared/workflow";
import { logger } from "../shared/logger";
import { Client, ClientChannel } from "ssh2";
import * as fs from "fs";
import * as path from "path";

/**
 * SSH Connection Step - Establishes connection to remote server via SSH
 * Validates username and SSH key file
 */
export class SSHConnectionStep implements IWorkflowStep {
  name = "ssh-connection";
  description = "Connect to remote server via SSH";

  private host: string;
  private username: string;
  private privateKeyPath: string;
  private privateKeyContent: string | null = null;
  private port: number;
  private sshClient: Client | null = null;

  constructor(
    host: string,
    username: string,
    privateKeyPath: string,
    port: number = 22,
    privateKeyContent?: string
  ) {
    this.host = host;
    this.username = username;
    this.privateKeyPath = privateKeyPath;
    this.port = port;
    this.privateKeyContent = privateKeyContent || null;
  }

  /**
   * Execute SSH connection
   */
  async execute(): Promise<WorkflowStepResult> {
    try {
      logger.info(
        `[SSH] Attempting to connect to ${this.username}@${this.host}:${this.port}`
      );

      let privateKey: Buffer;

      // Use stored key content if available, otherwise read from file
      if (this.privateKeyContent) {
        logger.debug("[SSH] Using stored SSH key content");
        privateKey = Buffer.from(this.privateKeyContent);
      } else {
        // Validate SSH key file exists
        if (!fs.existsSync(this.privateKeyPath)) {
          const error = `SSH private key file not found: ${this.privateKeyPath}`;
          logger.error(`[SSH] ${error}`);
          return {
            success: false,
            message: "SSH private key file not found",
            error,
          };
        }

        logger.debug(`[SSH] SSH key file found at: ${this.privateKeyPath}`);

        // Read private key
        privateKey = fs.readFileSync(this.privateKeyPath);
      }

      // Establish SSH connection
      const connectionResult = await this.establishConnection(privateKey);

      if (!connectionResult.success) {
        return connectionResult;
      }

      logger.info(
        `[SSH] Successfully connected to ${this.username}@${this.host}:${this.port}`
      );

      return {
        success: true,
        message: `Connected to ${this.host} as ${this.username}`,
        data: {
          sshConnected: true,
          sshHost: this.host,
          sshUsername: this.username,
          sshPort: this.port,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown SSH error";
      logger.error(`[SSH] Connection failed: ${errorMessage}`);
      return {
        success: false,
        message: "Failed to establish SSH connection",
        error: errorMessage,
      };
    }
  }

  /**
   * Establish SSH connection with promise-based wrapper
   */
  private establishConnection(privateKey: Buffer): Promise<WorkflowStepResult> {
    return new Promise((resolve) => {
      const conn = new Client();

      conn.on("ready", () => {
        this.sshClient = conn;
        logger.debug("[SSH] SSH connection ready");
        resolve({
          success: true,
          message: "SSH connection established",
        });
      });

      conn.on("error", (error: Error) => {
        logger.error(`[SSH] Connection error: ${error.message}`);
        resolve({
          success: false,
          message: "SSH connection error",
          error: error.message,
        });
      });

      conn.on("close", () => {
        logger.debug("[SSH] SSH connection closed");
        this.sshClient = null;
      });

      try {
        conn.connect({
          host: this.host,
          port: this.port,
          username: this.username,
          privateKey,
          readyTimeout: 30000,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Connection error";
        logger.error(`[SSH] Failed to initiate connection: ${errorMessage}`);
        resolve({
          success: false,
          message: "Failed to initiate SSH connection",
          error: errorMessage,
        });
      }
    });
  }

  /**
   * Execute a command on the remote server
   */
  async executeRemoteCommand(
    command: string,
    timeoutMs: number = 30000
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (!this.sshClient) {
        reject(new Error("SSH client not connected"));
        return;
      }

      let stdout = "";
      let stderr = "";
      let timeoutHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Command execution timeout after ${timeoutMs}ms: ${command}`
          )
        );
      }, timeoutMs);

      this.sshClient.exec(
        command,
        (error: Error | undefined, stream: ClientChannel) => {
          if (error) {
            cleanup();
            logger.error(`[SSH] Command execution error: ${error.message}`);
            reject(error);
            return;
          }

          stream.on("close", () => {
            cleanup();
            logger.debug(`[SSH] Command executed: ${command}`);
            resolve({ stdout, stderr });
          });

          stream.on("data", (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on("error", (error: Error) => {
            cleanup();
            logger.error(`[SSH] Stream error: ${error.message}`);
            reject(error);
          });
        }
      );
    });
  }

  /**
   * Close the SSH connection
   */
  closeConnection(): void {
    if (this.sshClient) {
      this.sshClient.end();
      logger.info("[SSH] Connection closed");
    }
  }

  /**
   * Get the SSH client instance for use in other steps
   */
  getClient(): Client | null {
    return this.sshClient;
  }

  /**
   * Get the SSH host
   */
  getHost(): string {
    return this.host;
  }

  /**
   * Get the SSH username
   */
  getUsername(): string {
    return this.username;
  }
}
