import { IWorkflowStep, WorkflowStepResult } from "../shared/workflow";
import { logger } from "../shared/logger";
import { SSHConnectionStep } from "./sshConnectionStep";
import { GitHubAuthStep } from "./githubAuthStep";
import { RepoSelectionStep } from "./repoSelectionStep";
import axios from "axios";

/**
 * Deploy Key Generation Step
 * Generates ED25519 SSH key for specific repository and registers as deploy key on GitHub
 */
export class DeployKeyGenerationStep implements IWorkflowStep {
  name = "deploy-key-generation";
  description = "Generate deploy key for selected repository";

  private sshStep: SSHConnectionStep;
  private githubStep: GitHubAuthStep;
  private repoStep: RepoSelectionStep;
  private applicationName: string;
  private host: string;
  private username: string;
  private deployKeyName: string;
  private deployKeyTitle: string;
  private githubApiUrl = "https://api.github.com";

  constructor(
    sshStep: SSHConnectionStep,
    githubStep: GitHubAuthStep,
    repoStep: RepoSelectionStep,
    applicationName: string,
    host: string,
    username: string
  ) {
    this.sshStep = sshStep;
    this.githubStep = githubStep;
    this.repoStep = repoStep;
    this.applicationName = applicationName;
    this.host = host;
    this.username = username;
    this.deployKeyName = `${applicationName}_deploy_key`;
    this.deployKeyTitle = `${applicationName} [${username}@${host}]`;
  }

  /**
   * Execute deploy key generation and registration
   */
  async execute(): Promise<WorkflowStepResult> {
    try {
      logger.info("[Deploy Key] Starting deploy key generation for repository");

      const selectedRepo = this.repoStep.getSelectedRepo();
      if (!selectedRepo) {
        return {
          success: false,
          message: "No repository selected",
        };
      }

      // Step 1: Generate ED25519 key on remote server
      logger.info(`[Deploy Key] Step 1/4: Generating ED25519 key`);
      const keyGenResult = await this.generateDeployKey();
      if (!keyGenResult.success) {
        return keyGenResult;
      }

      const publicKeyContent = keyGenResult.data?.publicKey;
      if (!publicKeyContent) {
        return {
          success: false,
          message: "Public key content not available",
        };
      }

      // Step 2: Register deploy key with GitHub
      logger.info(
        `[Deploy Key] Step 2/4: Registering deploy key with GitHub for ${selectedRepo}`
      );
      const registerResult = await this.registerDeployKeyWithGitHub(
        selectedRepo,
        publicKeyContent
      );
      if (!registerResult.success) {
        return registerResult;
      }

      // Step 3: Update ~/.ssh/config on remote server
      logger.info(
        `[Deploy Key] Step 3/5: Updating ~/.ssh/config on remote server`
      );
      const configResult = await this.updateSSHConfigOnRemote(selectedRepo);
      if (!configResult.success) {
        return configResult;
      }

      // Step 4: Test SSH connection to GitHub
      logger.info(`[Deploy Key] Step 4/5: Testing SSH connection to GitHub`);
      const testResult = await this.testGitHubConnection(
        configResult.data?.hostAlias || `github.com-${this.applicationName}`
      );
      if (!testResult.success) {
        logger.warn(
          `[Deploy Key] SSH connection test warning: ${testResult.message}`
        );
      }

      logger.info("[Deploy Key] Step 5/5: Deploy key setup complete");

      return {
        success: true,
        message: `Deploy key generated and registered for ${selectedRepo}`,
        data: {
          deployKeyName: this.deployKeyName,
          deployKeyTitle: this.deployKeyTitle,
          repository: selectedRepo,
          sshConfigUpdated: true,
          hostAlias: configResult.data?.hostAlias,
          connectionTested: testResult.success,
          testMessage: testResult.message,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`[Deploy Key] Error: ${message}`);
      return {
        success: false,
        message: `Deploy key generation failed: ${message}`,
      };
    }
  }

  /**
   * Generate ED25519 key on remote server
   */
  private async generateDeployKey(): Promise<WorkflowStepResult> {
    try {
      const keyPath = `~/.ssh/${this.deployKeyName}`;

      // Step 1: Create .ssh directory if it doesn't exist
      logger.info(`[Deploy Key] Creating ~/.ssh directory`);
      const mkdirResult = await this.sshStep.executeRemoteCommand(
        "mkdir -p ~/.ssh"
      );
      logger.debug(
        "[Deploy Key] mkdir output:",
        mkdirResult.stdout || "(no output)"
      );

      // Step 2: Verify directory exists
      logger.info(`[Deploy Key] Verifying ~/.ssh directory`);
      const lsResult = await this.sshStep.executeRemoteCommand("ls -la ~/");
      logger.debug(
        "[Deploy Key] Directory listing:",
        lsResult.stdout.substring(0, 200)
      );

      // Step 3: Generate ED25519 key
      logger.info(`[Deploy Key] Generating ED25519 key: ${this.deployKeyName}`);
      const sshKeygenCmd = `ssh-keygen -t ed25519 -f ${keyPath} -N "" -C "deploy-key-${this.applicationName}" < /dev/null`;
      const genResult = await this.sshStep.executeRemoteCommand(
        sshKeygenCmd,
        60000
      ); // 60 second timeout for keygen
      logger.info("[Deploy Key] ssh-keygen output:", genResult.stdout);

      if (genResult.stderr && !genResult.stderr.includes("Your public key")) {
        logger.warn("[Deploy Key] ssh-keygen stderr:", genResult.stderr);
      }

      // Step 4: Verify key files were created
      logger.info(`[Deploy Key] Verifying key files`);
      const verifyResult = await this.sshStep.executeRemoteCommand(
        `ls -la ${keyPath}*`,
        10000
      );
      logger.info("[Deploy Key] Key files:", verifyResult.stdout);

      if (!verifyResult.stdout.includes(this.deployKeyName)) {
        throw new Error(
          `Deploy key file was not created: ${this.deployKeyName}`
        );
      }

      // Step 5: Set correct permissions
      logger.info(`[Deploy Key] Setting key permissions to 600`);
      await this.sshStep.executeRemoteCommand(`chmod 600 ${keyPath}`, 10000);
      logger.info("[Deploy Key] Permissions set successfully");

      // Step 6: Retrieve public key content
      logger.info(`[Deploy Key] Retrieving public key content`);
      const pubKeyResult = await this.sshStep.executeRemoteCommand(
        `cat ${keyPath}.pub`,
        10000
      );
      const publicKey = pubKeyResult.stdout.trim();

      if (!publicKey) {
        throw new Error(`Failed to retrieve public key from ${keyPath}.pub`);
      }

      logger.info(
        "[Deploy Key] Public key retrieved successfully",
        publicKey.substring(0, 50) + "..."
      );

      return {
        success: true,
        message: "Deploy key generated successfully",
        data: {
          publicKey,
          keyPath,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`[Deploy Key] Key generation failed: ${message}`);
      return {
        success: false,
        message: `Failed to generate deploy key: ${message}`,
      };
    }
  }

  /**
   * Register deploy key with GitHub repository
   */
  private async registerDeployKeyWithGitHub(
    repoFullName: string,
    publicKeyContent: string
  ): Promise<WorkflowStepResult> {
    try {
      const pat = this.githubStep.getPAT();
      if (!pat) {
        throw new Error("GitHub PAT not available");
      }

      logger.info(`[Deploy Key] Registering deploy key for ${repoFullName}`);

      const response = await axios.post(
        `${this.githubApiUrl}/repos/${repoFullName}/keys`,
        {
          title: this.deployKeyTitle,
          key: publicKeyContent,
          read_only: false, // Allow write access for CI/CD
        },
        {
          headers: {
            Authorization: `token ${pat}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      logger.info(
        `[Deploy Key] Deploy key registered successfully with ID: ${response.data.id}`
      );

      return {
        success: true,
        message: "Deploy key registered with GitHub",
        data: {
          deployKeyId: response.data.id,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`[Deploy Key] Failed to register deploy key: ${message}`);
      return {
        success: false,
        message: `Failed to register deploy key: ${message}`,
      };
    }
  }

  /**
   * Update ~/.ssh/config on remote server with unique GitHub entry
   */
  private async updateSSHConfigOnRemote(
    repoFullName: string
  ): Promise<WorkflowStepResult> {
    try {
      const keyPath = `~/.ssh/${this.deployKeyName}`;
      const hostAlias = `github.com-${this.applicationName}`;

      // Create SSH config entry
      const configEntry = `\n# Deploy key for ${repoFullName} (${this.applicationName})\nHost ${hostAlias}\n  HostName github.com\n  User git\n  IdentityFile ${keyPath}\n  IdentitiesOnly yes\n`;

      logger.info("[Deploy Key] Creating SSH config entry on remote server");

      // Check if config file exists
      const checkConfigResult = await this.sshStep.executeRemoteCommand(
        "test -f ~/.ssh/config && echo 'exists' || echo 'not exists'"
      );
      const configExists = checkConfigResult.stdout.trim() === "exists";

      if (configExists) {
        // Remove old entry if exists (to avoid duplicates)
        logger.info("[Deploy Key] Removing old config entry if exists");
        const removeOldEntry = `sed -i.bak '/# Deploy key for ${repoFullName.replace(
          "/",
          "\\/"
        )}/,/IdentitiesOnly yes/d' ~/.ssh/config`;
        await this.sshStep.executeRemoteCommand(removeOldEntry);
      }

      // Append new entry to config
      logger.info("[Deploy Key] Appending new config entry");
      const appendCommand = `echo '${configEntry}' >> ~/.ssh/config`;
      await this.sshStep.executeRemoteCommand(appendCommand);

      // Set correct permissions
      logger.info("[Deploy Key] Setting config file permissions");
      await this.sshStep.executeRemoteCommand("chmod 600 ~/.ssh/config");

      // Verify the entry was added
      const verifyResult = await this.sshStep.executeRemoteCommand(
        `grep -A 4 "${hostAlias}" ~/.ssh/config`
      );
      logger.info("[Deploy Key] SSH config entry:", verifyResult.stdout);

      return {
        success: true,
        message: `SSH config updated on remote server with host alias: ${hostAlias}`,
        data: {
          hostAlias,
          configPath: "~/.ssh/config",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(
        `[Deploy Key] Failed to update SSH config on remote: ${message}`
      );
      return {
        success: false,
        message: `Failed to update SSH config on remote server: ${message}`,
      };
    }
  }

  /**
   * Test SSH connection to GitHub using the deploy key
   */
  private async testGitHubConnection(
    hostAlias: string
  ): Promise<WorkflowStepResult> {
    try {
      logger.info(`[Deploy Key] Testing SSH connection to ${hostAlias}`);

      // Test SSH connection to GitHub
      // Note: This will return exit code 1 but with success message in stderr
      const testCommand = `ssh -T -o StrictHostKeyChecking=no git@${hostAlias} 2>&1 || true`;
      const testResult = await this.sshStep.executeRemoteCommand(testCommand);

      const output = testResult.stdout + testResult.stderr;
      logger.info("[Deploy Key] GitHub SSH test output:", output);

      // Check if authentication was successful
      // GitHub returns "Hi username! You've successfully authenticated" message
      if (
        output.includes("successfully authenticated") ||
        output.includes("Hi ")
      ) {
        logger.info("[Deploy Key] GitHub SSH authentication successful");
        return {
          success: true,
          message: "Successfully authenticated with GitHub",
          data: {
            output: output.trim(),
          },
        };
      } else if (output.includes("Permission denied")) {
        logger.error(
          "[Deploy Key] GitHub SSH authentication failed - permission denied"
        );
        return {
          success: false,
          message:
            "Permission denied - deploy key may not be properly configured",
          data: {
            output: output.trim(),
          },
        };
      } else {
        logger.warn("[Deploy Key] Unexpected SSH test output");
        return {
          success: false,
          message: "Unexpected response from GitHub SSH test",
          data: {
            output: output.trim(),
          },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`[Deploy Key] GitHub connection test failed: ${message}`);
      return {
        success: false,
        message: `Failed to test GitHub connection: ${message}`,
      };
    }
  }
}
