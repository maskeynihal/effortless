import { IWorkflowStep, WorkflowStepResult } from "../shared/workflow";
import { logger } from "../shared/logger";
import axios from "axios";

/**
 * GitHub Authentication Step - Validates PAT token and retrieves user information
 */
export class GitHubAuthStep implements IWorkflowStep {
  name = "github-auth";
  description = "Authenticate with GitHub using Personal Access Token (PAT)";

  private pat: string;
  private githubApiUrl = "https://api.github.com";

  constructor(pat: string) {
    this.pat = pat;
  }

  /**
   * Execute GitHub authentication
   */
  async execute(): Promise<WorkflowStepResult> {
    try {
      logger.info("[GitHub] Authenticating with GitHub API using PAT");

      // Validate PAT is provided
      if (!this.pat || this.pat.trim() === "") {
        const error = "GitHub PAT is required";
        logger.error(`[GitHub] ${error}`);
        return {
          success: false,
          message: "GitHub PAT is required",
          error,
        };
      }

      logger.debug("[GitHub] PAT provided, validating with GitHub API");

      // Verify PAT by fetching user information
      const userInfo = await this.fetchUserInfo();

      if (!userInfo) {
        const error = "Invalid GitHub PAT or API error";
        logger.error(`[GitHub] ${error}`);
        return {
          success: false,
          message: "Failed to authenticate with GitHub",
          error,
        };
      }

      logger.info(
        `[GitHub] Successfully authenticated as GitHub user: ${userInfo.login}`
      );
      logger.debug(
        `[GitHub] User details - ID: ${userInfo.id}, Name: ${userInfo.name}`
      );

      return {
        success: true,
        message: `Authenticated as ${userInfo.login}`,
        data: {
          githubAuthenticated: true,
          githubUsername: userInfo.login,
          githubUserId: userInfo.id,
          githubName: userInfo.name,
          githubEmail: userInfo.email,
          githubPAT: "***" + this.pat.slice(-4), // Log masked PAT
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown GitHub error";
      logger.error(`[GitHub] Authentication failed: ${errorMessage}`);
      return {
        success: false,
        message: "Failed to authenticate with GitHub",
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch user information from GitHub API
   */
  private async fetchUserInfo(): Promise<any> {
    try {
      const response = await axios.get(`${this.githubApiUrl}/user`, {
        headers: {
          Authorization: `token ${this.pat}`,
          "User-Agent": "Effortless-GitHub-Integration",
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.status === 200 && response.data) {
        return response.data;
      }

      logger.error(`[GitHub] Unexpected response status: ${response.status}`);
      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          logger.warn("[GitHub] 401 Unauthorized - Invalid or expired PAT");
        } else if (error.response?.status === 403) {
          logger.warn(
            "[GitHub] 403 Forbidden - Check PAT scopes and rate limits"
          );
        }
        logger.error(
          `[GitHub] API error: ${error.response?.status} - ${error.response?.statusText}`
        );
      }
      return null;
    }
  }

  /**
   * Check if PAT has required scopes for SSH key registration
   */
  async validatePATScopes(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.githubApiUrl}/user`, {
        headers: {
          Authorization: `token ${this.pat}`,
          "User-Agent": "Effortless-GitHub-Integration",
        },
      });

      // Check for scopes in response headers
      const scopes = response.headers["x-oauth-scopes"]
        ?.split(",")
        .map((s: string) => s.trim());
      logger.debug(`[GitHub] Available scopes: ${scopes?.join(", ")}`);

      // Required scope for SSH key management is 'write:public_key'
      const hasRequiredScope =
        scopes?.includes("write:public_key") ||
        scopes?.includes("admin:public_key");

      if (!hasRequiredScope) {
        logger.warn(
          "[GitHub] PAT may not have sufficient scopes for SSH key registration"
        );
      }

      return true;
    } catch (error) {
      logger.error("[GitHub] Failed to validate PAT scopes");
      return false;
    }
  }

  /**
   * Get the stored PAT
   */
  getPAT(): string {
    return this.pat;
  }
}
