import inquirer from "inquirer";
import axios from "axios";
import * as fs from "fs";

const API_URL = process.env.API_URL || "http://localhost:3000/api";

interface CLIConfig {
  host: string;
  username: string;
  port: number;
  privateKeyPath: string;
  privateKeyContent: string;
  applicationName: string;
  githubToken?: string;
  selectedRepo?: string;
}

class EffortlessCLI {
  private config: CLIConfig | null = null;
  private sessionId: string | null = null;

  async start(): Promise<void> {
    try {
      console.log("\n🚀 Effortless CLI (step-based)\n");
      await this.gatherConfig();
      await this.verifyConnections();
      await this.runMenu();
      console.log(
        "\n✅ Done. You can rerun this CLI anytime to execute steps again.\n"
      );
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message || error}\n`);
      process.exit(1);
    }
  }

  private async gatherConfig(): Promise<void> {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "host",
        message: "Server host (IP or domain):",
        validate: (v) => (!!v ? true : "Host is required"),
      },
      {
        type: "input",
        name: "username",
        message: "SSH username:",
        default: "root",
      },
      {
        type: "input",
        name: "port",
        message: "SSH port:",
        default: "22",
        validate: (v) =>
          !v || isNaN(Number(v)) ? "Port must be a number" : true,
      },
      {
        type: "input",
        name: "privateKeyPath",
        message: "Path to SSH private key:",
        default: "~/.ssh/id_ed25519",
      },
      {
        type: "input",
        name: "applicationName",
        message: "Application name:",
        validate: (v) => (!!v ? true : "Application name is required"),
      },
      {
        type: "password",
        name: "githubToken",
        message: "GitHub PAT (optional, for private repos):",
        mask: "*",
      },
    ]);

    const expandedKeyPath = answers.privateKeyPath.replace(
      "~",
      process.env.HOME || ""
    );
    if (!fs.existsSync(expandedKeyPath)) {
      throw new Error(`Private key not found at ${expandedKeyPath}`);
    }
    const privateKeyContent = fs.readFileSync(expandedKeyPath, "utf8");

    this.config = {
      host: answers.host,
      username: answers.username,
      port: parseInt(answers.port, 10) || 22,
      privateKeyPath: expandedKeyPath,
      privateKeyContent,
      applicationName: answers.applicationName,
      githubToken: answers.githubToken || undefined,
    };
  }

  private async verifyConnections(): Promise<void> {
    if (!this.config) throw new Error("Config not set");

    console.log("\n🔄 Verifying SSH and GitHub (if provided)...\n");
    try {
      const response = await axios.post(`${API_URL}/connection/verify`, {
        host: this.config.host,
        username: this.config.username,
        privateKeyContent: this.config.privateKeyContent,
        port: this.config.port,
        githubToken: this.config.githubToken,
        applicationName: this.config.applicationName,
      });

      if (!response.data.success) {
        throw new Error(
          response.data.error || "Connection verification failed"
        );
      }

      this.sessionId = response.data.sessionId;
      console.log(
        `✓ SSH verified to ${this.config.username}@${this.config.host}`
      );
      if (response.data.connections?.github) {
        const gh = response.data.connections.github;
        console.log(
          gh.connected
            ? `✓ GitHub verified as ${gh.username}`
            : `⚠️ GitHub verification failed: ${gh.error || "unknown"}`
        );
      }
      console.log("");
    } catch (error: any) {
      const details = this.describeAxiosError(error);
      throw new Error(`Verification failed: ${details}`);
    }
  }

  private async runMenu(): Promise<void> {
    if (!this.config) throw new Error("Config not set");

    let exit = false;
    while (!exit) {
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "Select a step to run (all steps are repeatable):",
          choices: [
            { name: "Generate & register deploy key", value: "deploy" },
            { name: "Create database", value: "db" },
            { name: "Setup application folder", value: "folder" },
            { name: "View step logs", value: "logs" },
            { name: "Exit", value: "exit" },
          ],
        },
      ]);

      switch (action) {
        case "deploy":
          await this.runDeployKey();
          break;
        case "db":
          await this.runDatabaseCreate();
          break;
        case "folder":
          await this.runFolderSetup();
          break;
        case "logs":
          await this.showLogs();
          break;
        case "exit":
          exit = true;
          break;
      }
    }
  }

  private async runDeployKey(): Promise<void> {
    if (!this.config) return;

    let repo: string | null = null;

    // Offer GitHub repo selection when a token is available; otherwise fallback to manual entry.
    if (this.config.githubToken) {
      const repos = await this.fetchGitHubRepos();
      if (repos.length > 0) {
        const { repoChoice } = await inquirer.prompt([
          {
            type: "list",
            name: "repoChoice",
            message: "Choose a repository or enter one manually:",
            choices: [
              ...repos.map((name) => ({ name, value: name })),
              { name: "Enter owner/repo manually", value: "__manual__" },
            ],
            pageSize: 15,
            default: this.config.selectedRepo || undefined,
          },
        ]);

        if (repoChoice !== "__manual__") {
          repo = repoChoice as string;
        }
      }
    }

    if (!repo) {
      const manual = await inquirer.prompt([
        {
          type: "input",
          name: "repo",
          message: "Repository (owner/repo or https URL):",
          default: this.config.selectedRepo || "",
          validate: (v) =>
            v && v.includes("/") ? true : "Please provide owner/repo",
        },
      ]);
      repo = manual.repo;
    }

    if (!repo) {
      console.error("No repository provided; skipping deploy key step.");
      return;
    }
    const selectedRepo = repo.trim();

    console.log("\n⏳ Registering deploy key...\n");
    try {
      const response = await axios.post(`${API_URL}/step/deploy-key`, {
        host: this.config.host,
        username: this.config.username,
        applicationName: this.config.applicationName,
        selectedRepo,
      });

      if (response.data.success) {
        this.config.selectedRepo = selectedRepo;
        console.log("✅ Deploy key registered");
        console.table(response.data.data || {});
      } else {
        console.error(`❌ Deploy key failed: ${response.data.error}`);
      }
    } catch (error: any) {
      console.error(`❌ Deploy key failed: ${this.describeAxiosError(error)}`);
    }
    console.log("");
  }

  private async runDatabaseCreate(): Promise<void> {
    if (!this.config) return;

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "dbType",
        message: "Database type:",
        choices: ["MySQL", "PostgreSQL"],
        default: "MySQL",
      },
      {
        type: "input",
        name: "dbName",
        message: "Database name:",
        default: this.config.applicationName,
      },
      {
        type: "input",
        name: "dbUsername",
        message: "DB username:",
        default: `${this.config.applicationName}_user`,
      },
      {
        type: "password",
        name: "dbPassword",
        message: "DB password:",
        mask: "*",
      },
      {
        type: "input",
        name: "dbPort",
        message: "DB port (optional):",
        default: "",
      },
    ]);

    console.log("\n⏳ Creating database...\n");
    try {
      const response = await axios.post(`${API_URL}/step/database-create`, {
        host: this.config.host,
        username: this.config.username,
        applicationName: this.config.applicationName,
        dbType: answers.dbType,
        dbName: answers.dbName,
        dbUsername: answers.dbUsername,
        dbPassword: answers.dbPassword,
        dbPort: answers.dbPort ? parseInt(answers.dbPort, 10) : undefined,
      });

      if (response.data.success) {
        console.log("✅ Database created");
        console.table(response.data.data || {});
      } else {
        console.error(`❌ Database creation failed: ${response.data.error}`);
      }
    } catch (error: any) {
      console.error(
        `❌ Database creation failed: ${this.describeAxiosError(error)}`
      );
    }
    console.log("");
  }

  private async runFolderSetup(): Promise<void> {
    if (!this.config) return;

    const { pathname } = await inquirer.prompt([
      {
        type: "input",
        name: "pathname",
        message: "Folder path on server:",
        default: `/var/www/${this.config.applicationName}`,
      },
    ]);

    console.log("\n⏳ Creating folder...\n");
    try {
      const response = await axios.post(`${API_URL}/step/folder-setup`, {
        host: this.config.host,
        username: this.config.username,
        applicationName: this.config.applicationName,
        pathname,
      });

      if (response.data.success) {
        console.log("✅ Folder created");
        console.table(response.data.data || {});
      } else {
        console.error(`❌ Folder setup failed: ${response.data.error}`);
      }
    } catch (error: any) {
      console.error(
        `❌ Folder setup failed: ${this.describeAxiosError(error)}`
      );
    }
    console.log("");
  }

  private async showLogs(): Promise<void> {
    if (!this.config) return;

    try {
      const response = await axios.get(
        `${API_URL}/steps/${this.config.host}/${this.config.username}/${this.config.applicationName}`
      );

      if (!response.data.success) {
        console.error(
          `Failed to fetch logs: ${response.data.error || "unknown"}`
        );
        return;
      }

      console.log("\n📋 Step executions:");
      console.table(response.data.steps || []);
    } catch (error: any) {
      console.error(`Failed to fetch logs: ${this.describeAxiosError(error)}`);
    }
    console.log("");
  }

  private async fetchGitHubRepos(): Promise<string[]> {
    if (!this.config?.githubToken) return [];
    try {
      const response = await axios.get("https://api.github.com/user/repos", {
        headers: {
          Authorization: `Bearer ${this.config.githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
        params: { per_page: 100, sort: "updated" },
      });

      return (response.data as Array<{ full_name?: string }>)
        .map((repo) => repo.full_name)
        .filter((name): name is string => Boolean(name));
    } catch (error) {
      console.error(
        `⚠️  Could not list GitHub repos: ${this.describeAxiosError(error)}`
      );
      return [];
    }
  }

  private describeAxiosError(error: any): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const msg = error.response?.data?.error || error.message;
      return status ? `${msg} (HTTP ${status})` : msg;
    }
    return error?.message || String(error);
  }
}

(async () => {
  const cli = new EffortlessCLI();
  await cli.start();
})();
