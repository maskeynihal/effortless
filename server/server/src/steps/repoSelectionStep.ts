import { IWorkflowStep, WorkflowStepResult } from "../shared/workflow";
import { logger } from "../shared/logger";
import { GitHubAuthStep } from "./githubAuthStep";
import axios from "axios";

interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
  };
}

/**
 * GitHub Repo Selection Step
 * Fetches user's repositories and stores selected repo for deploy key generation
 */
export class RepoSelectionStep implements IWorkflowStep {
  name = "github-repo-selection";
  description = "Select repository for SSH deploy key";

  private githubStep: GitHubAuthStep;
  private githubApiUrl = "https://api.github.com";
  private selectedRepo?: string; // Format: owner/repo

  constructor(githubStep: GitHubAuthStep) {
    this.githubStep = githubStep;
  }

  /**
   * Fetch available repositories
   */
  async getAvailableRepos(): Promise<GitHubRepo[]> {
    try {
      const pat = this.githubStep.getPAT();
      if (!pat) {
        throw new Error("GitHub PAT not available");
      }

      logger.info("[Repo Selection] Fetching available repositories");

      const response = await axios.get(`${this.githubApiUrl}/user/repos`, {
        headers: {
          Authorization: `token ${pat}`,
          Accept: "application/vnd.github.v3+json",
        },
        params: {
          per_page: 100,
          sort: "updated",
        },
      });

      const repos = response.data as GitHubRepo[];
      logger.info(
        `[Repo Selection] Found ${repos.length} repositories`,
        repos.map((r) => r.full_name)
      );

      return repos;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`[Repo Selection] Failed to fetch repositories: ${message}`);
      throw error;
    }
  }

  /**
   * Set the selected repository
   */
  setSelectedRepo(repoFullName: string): void {
    this.selectedRepo = repoFullName;
    logger.info(`[Repo Selection] Repository selected: ${this.selectedRepo}`);
  }

  /**
   * Get the selected repository
   */
  getSelectedRepo(): string | undefined {
    return this.selectedRepo;
  }

  /**
   * Execute - returns available repos for CLI selection
   * The actual selection happens in the CLI, not here
   */
  async execute(): Promise<WorkflowStepResult> {
    try {
      logger.info("[Repo Selection] Step executed");

      if (!this.selectedRepo) {
        return {
          success: false,
          message: "No repository selected",
        };
      }

      return {
        success: true,
        message: `Repository selected: ${this.selectedRepo}`,
        data: {
          selectedRepo: this.selectedRepo,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(`[Repo Selection] Error: ${message}`);
      return {
        success: false,
        message: `Failed to select repository: ${message}`,
      };
    }
  }
}
