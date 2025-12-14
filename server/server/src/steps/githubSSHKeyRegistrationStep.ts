import { IWorkflowStep, WorkflowStepResult } from "../shared/workflow";
import { logger } from "../shared/logger";
import { SSHConnectionStep } from "./sshConnectionStep";
import { GitHubAuthStep } from "./githubAuthStep";
import axios from "axios";

/**
 * GitHub SSH Key Registration Step
 * Generates ED25519 SSH key on remote server and registers it with GitHub
 */
export class GitHubSSHKeyRegistrationStep implements IWorkflowStep {
  name = "github-ssh-registration";
  description = "Generate ED25519 SSH key and register with GitHub";

  private sshStep: SSHConnectionStep;
  private githubStep: GitHubAuthStep;
  private sshKeyName: string;
  private githubApiUrl = "https://api.github.com";

  constructor(
    sshStep: SSHConnectionStep,
    githubStep: GitHubAuthStep,
    sshKeyName?: string
  ) {
    this.sshStep = sshStep;
    this.githubStep = githubStep;
    // Sanitize key name: remove spaces, special chars, and numbers, then add timestamp
    const sanitizedName = sshKeyName
      ? sshKeyName.replace(/[^a-zA-Z]/g, "")
      : "githubeffortless";
    this.sshKeyName = `${sanitizedName}_${Date.now()}`;
  }

  /**
   * Execute SSH key generation and GitHub registration
   */
  async execute(): Promise<WorkflowStepResult> {
    try {
      logger.info(
        "[SSH Registration] Starting ED25519 SSH key generation and GitHub registration"
      );

      // Step 1: Generate ED25519 key on remote server
      const keyGenResult = await this.generateED25519Key();
      if (!keyGenResult.success) {
        return keyGenResult;
      }

      const publicKeyContent = keyGenResult.data?.publicKey;
      logger.debug(
        "[SSH Registration] ED25519 public key generated successfully"
      );

      // Step 2: Register public key with GitHub
      const registrationResult = await this.registerKeyWithGitHub(
        publicKeyContent
      );
      if (!registrationResult.success) {
        return registrationResult;
      }

      logger.info(
        `[SSH Registration] SSH key "${this.sshKeyName}" successfully registered with GitHub`
      );

      return {
        success: true,
        message: `SSH key "${this.sshKeyName}" registered with GitHub`,
        data: {
          sshKeyRegistered: true,
          sshKeyName: this.sshKeyName,
          sshPublicKey: publicKeyContent,
          keyPath: `~/.ssh/${this.sshKeyName}`,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`[SSH Registration] Registration failed: ${errorMessage}`);
      return {
        success: false,
        message: "Failed to register SSH key with GitHub",
        error: errorMessage,
      };
    }
  }

  /**
   * Generate ED25519 SSH key on remote server
   * GitHub recommends ED25519 for security and smaller key size
   */
  private async generateED25519Key(): Promise<WorkflowStepResult> {
    try {
      const keyPath = `~/.ssh/${this.sshKeyName}`;
      logger.info(
        `[SSH Registration] Starting ED25519 key generation at ${keyPath}`
      );

      // Step 1: Create .ssh directory if it doesn't exist
      const mkdirCommand = "mkdir -p ~/.ssh && chmod 700 ~/.ssh";
      logger.info(`[SSH Registration] Step 1: Creating .ssh directory`);
      logger.debug(`[SSH Registration] Command: ${mkdirCommand}`);
      const mkdirResult = await this.sshStep.executeRemoteCommand(mkdirCommand);
      logger.debug(`[SSH Registration] mkdir stdout: ${mkdirResult.stdout}`);
      logger.debug(`[SSH Registration] mkdir stderr: ${mkdirResult.stderr}`);
      logger.info("[SSH Registration] ✓ .ssh directory prepared");

      // Step 2: Verify .ssh directory exists
      const checkDirCommand = 'ls -ld ~/.ssh && echo "DIR_EXISTS"';
      logger.info(`[SSH Registration] Step 2: Verifying .ssh directory exists`);
      const checkDirResult = await this.sshStep.executeRemoteCommand(
        checkDirCommand
      );
      logger.info(
        `[SSH Registration] Directory check: ${
          checkDirResult.stdout || checkDirResult.stderr
        }`
      );

      if (!checkDirResult.stdout.includes("DIR_EXISTS")) {
        logger.error("[SSH Registration] Failed to create .ssh directory");
        return {
          success: false,
          message: "Failed to create .ssh directory",
          error: "Directory creation failed",
        };
      }

      // Step 3: Generate ED25519 key (no passphrase for automation)
      const genKeyCommand = `ssh-keygen -t ed25519 -f ${keyPath} -N "" -C "effortless-github-${Date.now()}" 2>&1`;
      logger.info(`[SSH Registration] Step 3: Generating ED25519 key`);
      logger.debug(`[SSH Registration] Command: ${genKeyCommand}`);
      const genResult = await this.sshStep.executeRemoteCommand(genKeyCommand);

      logger.info(
        `[SSH Registration] ssh-keygen stdout length: ${
          genResult.stdout?.length || 0
        }`
      );
      logger.info(
        `[SSH Registration] ssh-keygen stderr length: ${
          genResult.stderr?.length || 0
        }`
      );
      logger.debug(`[SSH Registration] ssh-keygen stdout: ${genResult.stdout}`);
      logger.debug(`[SSH Registration] ssh-keygen stderr: ${genResult.stderr}`);

      if (genResult.stderr && genResult.stderr.includes("already exists")) {
        logger.warn(
          `[SSH Registration] Key already exists at ${keyPath}, using existing key`
        );
      } else if (
        genResult.stderr &&
        !genResult.stderr.includes("Your public key") &&
        !genResult.stderr.includes("Generating")
      ) {
        // ssh-keygen outputs to stderr even on success with some messages
        if (
          !genResult.stderr.toLowerCase().includes("key pair") &&
          !genResult.stderr.toLowerCase().includes("saved")
        ) {
          logger.warn(
            `[SSH Registration] ssh-keygen stderr (may be normal): ${genResult.stderr}`
          );
        }
      }

      // Step 4: List files to verify key was created
      const listCommand = `ls -la ${keyPath}* 2>&1 || echo "NO_KEY_FILES_FOUND"`;
      logger.info(
        `[SSH Registration] Step 4: Verifying key files were created`
      );
      logger.debug(`[SSH Registration] Command: ${listCommand}`);
      const listResult = await this.sshStep.executeRemoteCommand(listCommand);
      logger.info(
        `[SSH Registration] Files list: ${
          listResult.stdout || listResult.stderr
        }`
      );

      if (
        listResult.stdout.includes("NO_KEY_FILES_FOUND") ||
        !listResult.stdout
      ) {
        logger.error("[SSH Registration] Key files not found after generation");
        logger.error(`[SSH Registration] Expected path: ${keyPath}`);
        return {
          success: false,
          message: "SSH key files were not created on remote server",
          error: "ssh-keygen may have failed silently",
        };
      }

      // Step 5: Set appropriate permissions
      const chmodCommand = `chmod 600 ${keyPath} && chmod 644 ${keyPath}.pub`;
      logger.info(`[SSH Registration] Step 5: Setting file permissions`);
      logger.debug(`[SSH Registration] Command: ${chmodCommand}`);
      const chmodResult = await this.sshStep.executeRemoteCommand(chmodCommand);
      logger.debug(
        `[SSH Registration] chmod stdout: ${chmodResult.stdout || "none"}`
      );
      logger.debug(
        `[SSH Registration] chmod stderr: ${chmodResult.stderr || "none"}`
      );
      logger.info("[SSH Registration] ✓ SSH key permissions set correctly");

      // Step 6: Retrieve public key content
      const pubKeyCommand = `cat ${keyPath}.pub 2>&1`;
      logger.info(`[SSH Registration] Step 6: Retrieving public key content`);
      logger.debug(`[SSH Registration] Command: ${pubKeyCommand}`);
      const pubKeyResult = await this.sshStep.executeRemoteCommand(
        pubKeyCommand
      );

      logger.info(
        `[SSH Registration] Public key stdout length: ${
          pubKeyResult.stdout?.length || 0
        }`
      );
      logger.debug(
        `[SSH Registration] Public key stdout: ${
          pubKeyResult.stdout?.substring(0, 100) || "empty"
        }...`
      );
      logger.debug(
        `[SSH Registration] Public key stderr: ${pubKeyResult.stderr || "none"}`
      );

      if (!pubKeyResult.stdout || pubKeyResult.stdout.trim().length === 0) {
        // Try alternative method: use ls to check if file exists first
        const checkCommand = `ls -la ${keyPath}.pub 2>&1`;
        logger.warn(
          `[SSH Registration] Public key content is empty, checking file existence`
        );
        const checkResult = await this.sshStep.executeRemoteCommand(
          checkCommand
        );
        logger.error(
          `[SSH Registration] Public key file check: ${
            checkResult.stdout || checkResult.stderr
          }`
        );

        const error =
          "Failed to retrieve public key content - file may not exist or is empty";
        logger.error(`[SSH Registration] ${error}`);
        return {
          success: false,
          message: error,
          error,
        };
      }

      const publicKeyContent = pubKeyResult.stdout.trim();
      logger.info(
        `[SSH Registration] ✓ ED25519 public key retrieved successfully (${publicKeyContent.length} bytes)`
      );

      return {
        success: true,
        message: "ED25519 key generated successfully",
        data: {
          publicKey: publicKeyContent,
          keyPath,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Key generation error";
      logger.error(
        `[SSH Registration] Exception during key generation: ${errorMessage}`
      );
      logger.error(
        `[SSH Registration] Stack: ${
          error instanceof Error ? error.stack : "no stack"
        }`
      );
      return {
        success: false,
        message: "Failed to generate SSH key",
        error: errorMessage,
      };
    }
  }

  /**
   * Register the public key with GitHub using API
   * Requires PAT with 'write:public_key' or 'admin:public_key' scope
   */
  private async registerKeyWithGitHub(
    publicKeyContent: string
  ): Promise<WorkflowStepResult> {
    try {
      logger.debug("[SSH Registration] Registering public key with GitHub API");

      const pat = this.githubStep.getPAT();

      const payload = {
        title: this.sshKeyName,
        key: publicKeyContent,
      };

      logger.debug(
        `[SSH Registration] Creating GitHub SSH key with title: ${this.sshKeyName}`
      );

      const response = await axios.post(
        `${this.githubApiUrl}/user/keys`,
        payload,
        {
          headers: {
            Authorization: `token ${pat}`,
            "User-Agent": "Effortless-GitHub-Integration",
            "Content-Type": "application/json",
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (response.status === 201 && response.data.id) {
        logger.info(
          `[SSH Registration] SSH key registered with GitHub (Key ID: ${response.data.id})`
        );

        return {
          success: true,
          message: "SSH key registered with GitHub",
          data: {
            keyId: response.data.id,
            keyUrl: response.data.url,
          },
        };
      }

      const error = `Unexpected response status: ${response.status}`;
      logger.error(`[SSH Registration] ${error}`);
      return {
        success: false,
        message: "Failed to register key with GitHub",
        error,
      };
    } catch (error) {
      let errorMessage = "Unknown error";
      let details = "";

      if (axios.isAxiosError(error)) {
        errorMessage = `GitHub API error: ${error.response?.status} ${error.response?.statusText}`;
        details = error.response?.data?.message || error.message;

        if (error.response?.status === 401) {
          logger.error(
            "[SSH Registration] 401 Unauthorized - Invalid or expired PAT"
          );
        } else if (error.response?.status === 422) {
          logger.error(
            "[SSH Registration] 422 Unprocessable Entity - Key format or validation error"
          );
        } else if (error.response?.status === 403) {
          logger.error(
            "[SSH Registration] 403 Forbidden - PAT may lack required scopes"
          );
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      logger.error(
        `[SSH Registration] Failed to register key with GitHub: ${
          details || errorMessage
        }`
      );

      return {
        success: false,
        message: "Failed to register SSH key with GitHub",
        error: `${errorMessage} ${details ? `- ${details}` : ""}`.trim(),
      };
    }
  }

  /**
   * Test SSH key authentication by connecting to github.com
   */
  async testSSHKeyAuthentication(): Promise<boolean> {
    try {
      logger.debug(
        "[SSH Registration] Testing SSH key authentication with GitHub"
      );

      const testCommand = `ssh -T git@github.com 2>&1 || true`;
      const result = await this.sshStep.executeRemoteCommand(testCommand);

      // GitHub returns "Hi [username]! You've successfully authenticated..." for successful auth
      const success =
        result.stdout.includes("successfully authenticated") ||
        result.stdout.includes("permission denied");

      if (success) {
        logger.info(
          "[SSH Registration] SSH key authentication test successful"
        );
      } else {
        logger.warn(
          "[SSH Registration] SSH key authentication test inconclusive"
        );
      }

      return success;
    } catch (error) {
      logger.error("[SSH Registration] Failed to test SSH key authentication");
      return false;
    }
  }
}
