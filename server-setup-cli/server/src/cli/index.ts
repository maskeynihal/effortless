import inquirer from "inquirer";
import axios from "axios";
import * as fs from "fs";
import {
  initializeDatabase,
  closeDatabase,
  getApplicationsByHostUser,
  getSessionByApplication,
  getDistinctConfigurations,
  saveApplication,
} from "../shared/database";
import { v4 as uuidv4 } from "uuid";

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
  domain?: string;
  pathname?: string;
}

class EffortlessCLI {
  private config: CLIConfig | null = null;
  private sessionId: string | null = null;
  private preHost?: string;
  private preUsername?: string;
  private preApplicationName?: string;
  private prePort?: number;

  async start(): Promise<void> {
    try {
      console.log("\n🚀 Effortless CLI (step-based)\n");
      await initializeDatabase();
      await this.preselectApplication();
      await this.collectAndStoreConfiguration();
      await this.verifyConnections();
      await this.runMenu();
      console.log(
        "\n✅ Done. You can rerun this CLI anytime to execute steps again.\n"
      );
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message || error}\n`);
      process.exit(1);
    } finally {
      await closeDatabase();
    }
  }

  // List all previously stored applications across hosts/users, allow selection or create new
  private async preselectApplication(): Promise<void> {
    try {
      const configs = await getDistinctConfigurations();
      const appChoices: Array<{ name: string; value: string }> = [];

      for (const cfg of configs) {
        const apps = await getApplicationsByHostUser(cfg.host, cfg.username);
        for (const app of apps) {
          appChoices.push({
            name: `${app.applicationName} — ${cfg.username}@${cfg.host}:${
              cfg.port
            }${app.selectedRepo ? ` (${app.selectedRepo})` : ""}`,
            value: JSON.stringify({
              host: cfg.host,
              username: cfg.username,
              port: cfg.port,
              applicationName: app.applicationName,
            }),
          });
        }
      }

      const choices = [
        ...appChoices,
        { name: "➕ Create new application", value: "__NEW__" },
      ];

      const { selection } = await inquirer.prompt([
        {
          type: "list",
          name: "selection",
          message:
            appChoices.length > 0
              ? "Select an application to continue or create new:"
              : "No applications found. Create new:",
          choices,
          pageSize: 15,
        },
      ]);

      if (selection !== "__NEW__") {
        const parsed = JSON.parse(selection);
        this.preHost = parsed.host;
        this.preUsername = parsed.username;
        this.prePort = parsed.port;
        this.preApplicationName = parsed.applicationName;
      }
    } catch (_) {
      // If listing fails, proceed to normal prompts
    }
  }
  // Step 1 & 2: prompt info and store in DB first
  private async collectAndStoreConfiguration(): Promise<void> {
    // If an application was preselected, use that server directly
    const useExisting = !!(this.preHost && this.preUsername);

    const questions: any[] = [];
    if (!useExisting) {
      questions.push(
        {
          type: "input",
          name: "host",
          message: "Server host (IP or domain):",
          validate: (v: string) => (!!v ? true : "Host is required"),
          default: this.preHost || undefined,
        },
        {
          type: "input",
          name: "username",
          message: "SSH username:",
          default: this.preUsername || "root",
        },
        {
          type: "input",
          name: "port",
          message: "SSH port:",
          default: String(this.prePort ?? 22),
          validate: (v: string) =>
            !v || isNaN(Number(v)) ? "Port must be a number" : true,
        }
      );
    } else if (this.prePort == null) {
      // If using existing but port wasn't known, ask for it
      questions.push({
        type: "input",
        name: "port",
        message: "SSH port:",
        default: "22",
        validate: (v: string) =>
          !v || isNaN(Number(v)) ? "Port must be a number" : true,
      });
    }

    // GitHub PAT is resolved later from env/stored, prompt only if missing

    const answers = await inquirer.prompt(questions);
    // Determine host/username after potential preselection
    const host = useExisting ? (this.preHost as string) : answers.host;
    const username = useExisting
      ? (this.preUsername as string)
      : answers.username;
    const port = useExisting
      ? this.prePort ?? (parseInt(answers.port, 10) || 22)
      : parseInt(answers.port, 10) || 22;

    // Determine applicationName: use preselected if available; else prompt to create new
    let applicationName: string = this.preApplicationName || "";
    let selectedRepo: string | undefined = undefined;
    let storedGithubToken: string | undefined = undefined;
    let sessionForApp: any | undefined = undefined;
    let selectedApp: any | undefined = undefined;

    if (!applicationName) {
      const { appName } = await inquirer.prompt([
        {
          type: "input",
          name: "appName",
          message: "New application name:",
          validate: (v) => (!!v ? true : "Application name is required"),
        },
      ]);
      applicationName = appName;
    }

    // If preselected application (or existing record), load stored details for defaults
    const existingApps = await getApplicationsByHostUser(host, username);
    selectedApp = existingApps.find(
      (app) => app.applicationName === applicationName
    );
    const session = await getSessionByApplication(
      host,
      username,
      applicationName
    );
    if (session) {
      selectedRepo = session.selectedRepo || undefined;
      storedGithubToken = session.githubToken || undefined;
      sessionForApp = session;
    }

    let domain: string | undefined = selectedApp?.domain || undefined;
    let pathname: string | undefined = selectedApp?.pathname || undefined;
    if (!domain || !pathname) {
      const promptAns = await inquirer.prompt([
        {
          type: "input",
          name: "domain",
          message: "Application domain (e.g. example.com):",
          default: domain || `${applicationName}.local`,
        },
        {
          type: "input",
          name: "pathname",
          message: "Application path on server:",
          default: pathname || `/var/www/${applicationName}`,
        },
      ]);
      domain = promptAns.domain;
      pathname = promptAns.pathname;
    }

    // Resolve private key: use stored if available, else prompt for path now
    let privateKeyContent: string = "";
    if (sessionForApp?.sshPrivateKey) {
      privateKeyContent = sessionForApp.sshPrivateKey;
    } else {
      const keyAns = await inquirer.prompt([
        {
          type: "input",
          name: "privateKeyPath",
          message: "Path to SSH private key:",
          default: "~/.ssh/id_ed25519",
        },
      ]);
      const expandedKeyPath = keyAns.privateKeyPath.replace(
        "~",
        process.env.HOME || ""
      );
      if (!fs.existsSync(expandedKeyPath)) {
        throw new Error(`Private key not found at ${expandedKeyPath}`);
      }
      privateKeyContent = fs.readFileSync(expandedKeyPath, "utf8");
    }

    // Resolve GitHub PAT: prefer stored, then env, then prompt
    let githubToken: string | undefined = storedGithubToken;
    if (!githubToken) {
      githubToken =
        process.env.GH_TOKEN ||
        process.env.GH_TOKEN_TECHNORIO_GITHUB ||
        undefined;
    }
    if (!githubToken) {
      const ghAns = await inquirer.prompt([
        {
          type: "password",
          name: "githubToken",
          message: "GitHub PAT (optional, for private repos):",
          mask: "*",
        },
      ]);
      githubToken = ghAns.githubToken || undefined;
    }

    this.config = {
      host,
      username,
      port,
      privateKeyPath: "",
      privateKeyContent,
      applicationName,
      githubToken,
      selectedRepo,
      domain,
      pathname,
    };

    // Persist application configuration before verification
    if (!this.sessionId) {
      this.sessionId = uuidv4();
    }
    await saveApplication({
      sessionId: this.sessionId,
      host,
      username,
      port,
      sshKeyName: undefined,
      githubUsername: undefined,
      sshPrivateKey: privateKeyContent,
      githubToken,
      applicationName,
      selectedRepo,
      domain,
      pathname,
    });
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
        domain: this.config.domain,
        pathname: this.config.pathname,
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
            { name: "Setup environment (.env)", value: "env" },
            { name: "Update .env with database config", value: "env-update" },
            { name: "Setup SSH key for GitHub Actions", value: "ssh-key" },
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
        case "env":
          await this.runEnvSetup();
          break;
        case "env-update":
          await this.runEnvUpdate();
          break;
        case "ssh-key":
          await this.runSSHKeySetup();
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
        default:
          this.config.pathname || `/var/www/${this.config.applicationName}`,
      },
    ]);

    // Keep config in sync for subsequent steps
    this.config.pathname = pathname;

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

  private async runEnvSetup(): Promise<void> {
    if (!this.config) return;

    // Ensure we know the path where to place .env
    const { pathname } = await inquirer.prompt([
      {
        type: "input",
        name: "pathname",
        message: "Application path on server (will use <path>/shared/.env):",
        default:
          this.config.pathname || `/var/www/${this.config.applicationName}`,
      },
    ]);
    this.config.pathname = pathname;

    // Resolve repository: prefer existing selection, else offer picklist/prompt
    let repo: string | undefined = this.config.selectedRepo;
    if (!repo) {
      let choice: string | undefined;
      const repos = await this.fetchGitHubRepos();
      if (repos.length > 0) {
        const ans = await inquirer.prompt([
          {
            type: "list",
            name: "repoChoice",
            message: "Select the repository to fetch .env.example from:",
            choices: [
              ...repos.map((r) => ({ name: r, value: r })),
              { name: "Enter owner/repo manually", value: "__manual__" },
            ],
            pageSize: 15,
          },
        ]);
        choice = ans.repoChoice;
      }
      if (!choice || choice === "__manual__") {
        const manual = await inquirer.prompt([
          {
            type: "input",
            name: "repo",
            message: "Repository (owner/repo or GitHub URL):",
            validate: (v) =>
              v && v.includes("/") ? true : "Provide owner/repo",
          },
        ]);
        repo = manual.repo;
      } else {
        repo = choice;
      }
    }

    console.log("\n⏳ Setting up .env from repository...\n");
    try {
      const response = await axios.post(`${API_URL}/step/env-setup`, {
        host: this.config.host,
        username: this.config.username,
        applicationName: this.config.applicationName,
        pathname,
        selectedRepo: repo,
      });

      if (response.data.success) {
        console.log("✅ .env created");
        console.table(response.data.data || {});
      } else {
        console.error(`❌ Env setup failed: ${response.data.error}`);
      }
    } catch (error: any) {
      console.error(`❌ Env setup failed: ${this.describeAxiosError(error)}`);
    }
    console.log("");
  }

  private async runEnvUpdate(): Promise<void> {
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
        name: "dbPort",
        message: "Database port:",
        default: (ans: any) => (ans.dbType === "MySQL" ? "3306" : "5432"),
        validate: (v: string) =>
          !isNaN(Number(v)) ? true : "Port must be a number",
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
        message: "Database username:",
        default: `${this.config.applicationName}_user`,
      },
      {
        type: "password",
        name: "dbPassword",
        message: "Database password:",
        mask: "*",
      },
    ]);

    console.log("\n⏳ Updating .env with database configuration...\n");
    try {
      const response = await axios.post(`${API_URL}/step/env-update`, {
        host: this.config.host,
        username: this.config.username,
        applicationName: this.config.applicationName,
        pathname: this.config.pathname,
        dbType: answers.dbType,
        dbPort: parseInt(answers.dbPort, 10),
        dbName: answers.dbName,
        dbUsername: answers.dbUsername,
        dbPassword: answers.dbPassword,
      });

      if (response.data.success) {
        console.log("✅ .env updated with database configuration");
        console.table(response.data.data?.updates || {});
        console.log("\nVerification (DB_* keys):");
        console.log(response.data.data?.verification || "");
      } else {
        console.error(`❌ Env update failed: ${response.data.error}`);
      }
    } catch (error: any) {
      console.error(`❌ Env update failed: ${this.describeAxiosError(error)}`);
    }
    console.log("");
  }

  private async runSSHKeySetup(): Promise<void> {
    if (!this.config) return;

    // Get the selected repo or prompt for it
    let repo: string | null = null;

    if (this.config.selectedRepo) {
      repo = this.config.selectedRepo;
    } else if (this.config.githubToken) {
      const repos = await this.fetchGitHubRepos();
      if (repos.length > 0) {
        const { repoChoice } = await inquirer.prompt([
          {
            type: "list",
            name: "repoChoice",
            message: "Choose a repository:",
            choices: [
              ...repos.map((name) => ({ name, value: name })),
              { name: "Enter owner/repo manually", value: "__manual__" },
            ],
            pageSize: 15,
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
          validate: (v) =>
            v && v.includes("/") ? true : "Please provide owner/repo",
        },
      ]);
      repo = manual.repo;
    }

    if (!repo) {
      console.error("No repository provided; skipping SSH key setup.");
      return;
    }

    console.log("\n⏳ Setting up SSH key for GitHub Actions...\n");
    try {
      const response = await axios.post(`${API_URL}/step/ssh-key-setup`, {
        host: this.config.host,
        username: this.config.username,
        applicationName: this.config.applicationName,
        selectedRepo: repo.trim(),
      });

      if (response.data.success) {
        console.log("✅ SSH key setup completed");
        console.log(`\nSecret Name: ${response.data.data?.secretName}`);
        console.log(`\nAdd this to your GitHub Actions workflow:`);
        console.log(
          `  ssh-key: \${{ secrets.${response.data.data?.secretName} }}`
        );
        console.log(
          `\nPublic key has been added to authorized_keys on the server.`
        );
      } else {
        console.error(`❌ SSH key setup failed: ${response.data.error}`);
      }
    } catch (error: any) {
      console.error(
        `❌ SSH key setup failed: ${this.describeAxiosError(error)}`
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
