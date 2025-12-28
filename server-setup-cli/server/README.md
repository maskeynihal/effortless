# Effortless GitHub Integration Server

A comprehensive Node.js server with CLI tool that automates the process of connecting a remote server to GitHub via SSH. The tool executes a 3-step workflow with extensive logging.

## Features

✨ **3-Step Workflow**

1. **SSH Connection** - Securely connect to a remote server using SSH key authentication
2. **GitHub Authentication** - Validate connection with GitHub using Personal Access Token (PAT)
3. **SSH Key Registration** - Generate ED25519 SSH keys on remote server and register with GitHub

🔐 **Security**

- ED25519 SSH key generation (GitHub recommended)
- In-memory credential storage (no persistence by default)
- SSH2 protocol implementation
- Masked credential logging

📊 **Comprehensive Logging**

- Winston logger with console and file output
- All workflow events tracked and auditable
- Error logging with stack traces
- Debug mode for troubleshooting

🎯 **Extensible Architecture**

- State machine-based workflow engine
- Easy to add new workflow steps
- Support for step skipping and reset
- RESTful API for external integration

🖥️ **Dual Interface**

- **Server API** - Express.js REST endpoints for programmatic access
- **CLI Tool** - Interactive command-line interface with prompts
- **React-Ready** - Clean API structure for React integration

## Project Structure

```
src/
├── server/
│   ├── index.ts           # Express server entry point
│   └── routes.ts          # API route definitions
├── cli/
│   └── index.ts           # Interactive CLI tool
├── steps/
│   ├── sshConnectionStep.ts           # SSH connection logic
│   ├── githubAuthStep.ts              # GitHub PAT validation
│   └── githubSSHKeyRegistrationStep.ts # Key generation and registration
└── shared/
    ├── workflow.ts        # Workflow engine and state machine
    └── logger.ts          # Winston logger setup
```

## Installation

### Prerequisites

- Node.js 16+
- npm or yarn
- SSH key pair for remote server access
- GitHub Personal Access Token (with `write:public_key` scope)

### Setup

```bash
cd /Users/leapfrog/Projects/maskeynihal/effortless/server

# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Usage

### Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3000`

### Run the CLI Tool

In another terminal:

```bash
npm run cli
```

The CLI will guide you through:

1. SSH server configuration
2. GitHub PAT input
3. Interactive workflow execution with real-time feedback

## API Endpoints

### Server Stack Setup

Install complete server stack with PHP, Nginx, database, and all Laravel-required extensions.

```bash
POST /api/step/server-stack-setup
Content-Type: application/json

{
  "host": "example.com",
  "username": "deploy",
  "applicationName": "my-app",
  "phpVersion": "8.3",      # Options: "8.3", "8.2", "8.1", "8.0", "7.4"
  "database": "mysql"       # Options: "mysql", "pgsql"
}

Response:
{
  "success": true,
  "message": "Server stack installed successfully",
  "data": {
    "phpVersion": "8.3",
    "database": "mysql",
    "extensionsInstalled": 18,
    "installLog": [
      "Added ondrej/php PPA",
      "Installed Nginx",
      "Installed MySQL server",
      "Installed PHP 8.3 with 18 extensions",
      "Installed Composer",
      "Configured and started PHP-FPM",
      "Started Nginx"
    ],
    "versions": {
      "php": "PHP 8.3.0 (cli)",
      "composer": "Composer version 2.6.5",
      "nginx": "nginx/1.24.0",
      "database": "mysql  Ver 8.0.35"
    }
  }
}
```

**Installed PHP Extensions:**

- Core: cli, fpm, mbstring, xml, bcmath, curl, zip, gd, intl, soap, opcache, readline, common
- Database: mysql, mysqli (for MySQL) OR pgsql (for PostgreSQL)
- Additional: redis, imagick

**What gets installed:**

- PHP with specified version via ondrej/php (Ubuntu/Debian) or Remi (RHEL/CentOS)
- Nginx web server
- MySQL or PostgreSQL database server
- Composer (latest version)
- PHP-FPM configured and running
- All necessary PHP extensions for Laravel

### Initialize Workflow

```bash
POST /api/workflow/init
Content-Type: application/json

{
  "host": "example.com",
  "username": "deploy",
  "privateKeyPath": "/path/to/ssh/key",
  "port": 22,
  "sshKeyName": "github-automation" # optional
}

Response:
{
  "success": true,
  "sessionId": "uuid-here",
  "workflow": {
    "steps": ["ssh-connection", "github-auth", "github-ssh-registration"],
    "currentStep": 0
  }
}
```

### Execute Next Workflow Step

```bash
POST /api/workflow/:sessionId/next
Content-Type: application/json

{
  "pat": "ghp_xxxxxxxxxxxx",  # For github-auth step
  "sshKeyName": "custom-key"  # Optional for github-ssh-registration
}

Response:
{
  "success": true,
  "message": "Step completed",
  "workflow": {
    "currentStep": 1,
    "totalSteps": 3,
    "completed": false,
    "nextStepName": "github-auth"
  },
  "data": {
    "sshConnected": true,
    "sshHost": "example.com",
    "sshUsername": "deploy"
  }
}
```

### Get Workflow Status

```bash
GET /api/workflow/:sessionId/status

Response:
{
  "success": true,
  "sessionId": "uuid-here",
  "workflow": {
    "currentStep": 1,
    "totalSteps": 3,
    "steps": ["ssh-connection", "github-auth", "github-ssh-registration"],
    "completed": false,
    "nextStepName": "github-auth"
  },
  "data": { /* workflow data */ },
  "history": [
    {
      "timestamp": "2025-12-13T10:30:00Z",
      "step": "ssh-connection",
      "event": "started",
      "message": "Starting step: Connect to remote server via SSH"
    },
    {
      "timestamp": "2025-12-13T10:30:05Z",
      "step": "ssh-connection",
      "event": "completed",
      "message": "Connected to example.com as deploy"
    }
  ]
}
```

### Reset Workflow

```bash
POST /api/workflow/:sessionId/reset

Response:
{
  "success": true,
  "message": "Workflow reset to beginning",
  "workflow": {
    "currentStep": 0,
    "totalSteps": 3
  }
}
```

### Delete Session

```bash
DELETE /api/workflow/:sessionId

Response:
{
  "success": true,
  "message": "Workflow session deleted"
}
```

### Health Check

```bash
GET /api/health

Response:
{
  "success": true,
  "status": "ok",
  "timestamp": "2025-12-13T10:30:00Z"
}
```

## Logging

Logs are stored in the `logs/` directory:

- **`logs/combined.log`** - All logs (info, warn, error, debug)
- **`logs/error.log`** - Errors only

Set log level via environment variable:

```bash
LOG_LEVEL=debug npm run dev
```

Available levels: `error`, `warn`, `info`, `debug`

## Environment Variables

```bash
# Server configuration
PORT=3000
LOG_LEVEL=info

# API configuration
API_URL=http://localhost:3000/api  # Used by CLI
```

## Workflow State

The workflow maintains state across all steps:

```typescript
{
  sessionId: "uuid",
  currentStep: 1,
  steps: ["ssh-connection", "github-auth", "github-ssh-registration"],
  completed: false,
  data: {
    sshConnected: true,
    sshHost: "example.com",
    sshUsername: "deploy",
    githubAuthenticated: false,
    // ... more fields added as workflow progresses
  },
  history: [/* event logs */],
  createdAt: "2025-12-13T10:30:00Z"
}
```

## Extending the Workflow

To add new steps (deployment, monitoring setup, etc.):

1. Create a new step class implementing `IWorkflowStep`
2. Register it in the workflow engine
3. Handle step-specific parameters in API routes

See [WORKFLOW_EXTENSIBILITY.md](./WORKFLOW_EXTENSIBILITY.md) for detailed guide.

## CLI Examples

### Basic Usage

```bash
$ npm run cli

🚀 Effortless GitHub Integration CLI

Connect your remote server to GitHub via SSH in 3 easy steps!

📋 Step 1: SSH Server Configuration

? Remote server hostname or IP address: example.com
? SSH username: deploy
? Path to SSH private key file: /Users/user/.ssh/id_rsa
? SSH port: (22)
? GitHub Personal Access Token (PAT): ••••••••••••••••••
? SSH key name for GitHub: github-automation

🔄 Initializing workflow session...

Session ID: 550e8400-e29b-41d4-a716-446655440000
Workflow Steps: ssh-connection → github-auth → github-ssh-registration

📍 Step 1/3: Connect to remote server via SSH

? Ready to execute: ssh-connection? (Y/n)
✅ ssh-connection: Connected to example.com as deploy

📊 Details:
  Host: example.com:22
  Username: deploy

📍 Step 2/3: Authenticate with GitHub using PAT

? Ready to execute: github-auth? (Y/n)
✅ github-auth: Authenticated as octocat

📊 Details:
  GitHub User: octocat
  Name: The Octocat
  Email: octocat@github.com

📍 Step 3/3: Generate and register SSH key with GitHub

? Ready to execute: github-ssh-registration? (Y/n)
✅ github-ssh-registration: SSH key "github-automation" registered with GitHub

📊 Details:
  Key Name: github-automation
  Key Path: ~/.ssh/github-automation
  Key ID: 12345678

✅ Workflow completed successfully!
```

## React Integration Example

```typescript
// useGitHubWorkflow.ts
import { useState } from "react";
import axios from "axios";

export function useGitHubWorkflow() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const initWorkflow = async (config: any) => {
    setLoading(true);
    try {
      const response = await axios.post("/api/workflow/init", config);
      setSessionId(response.data.sessionId);
      setStatus(response.data.workflow);
    } finally {
      setLoading(false);
    }
  };

  const executeStep = async (params?: any) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const response = await axios.post(
        `/api/workflow/${sessionId}/next`,
        params
      );
      setStatus(response.data.workflow);
      return response.data;
    } finally {
      setLoading(false);
    }
  };

  return { sessionId, status, loading, initWorkflow, executeStep };
}
```

## Error Handling

### Common Errors

**SSH Connection Failed**

- Verify host is reachable: `ping example.com`
- Check SSH key has correct permissions: `chmod 600 ~/.ssh/id_rsa`
- Verify username and port: `ssh -i ~/.ssh/id_rsa user@example.com -p 22`

**GitHub PAT Invalid**

- Ensure PAT has `write:public_key` scope
- Check token hasn't expired in GitHub settings
- Verify token format: should start with `ghp_` or `github_pat_`

**SSH Key Registration Failed**

- Ensure PAT has correct scopes
- Check GitHub API rate limits
- Verify remote server has SSH command available

## Performance Considerations

- **Connection Timeout** - 30 seconds for SSH connections
- **Memory Usage** - Sessions stored in-memory (plan for Redis in production)
- **Concurrent Workflows** - Each session is independent and thread-safe
- **Log Rotation** - Implement log rotation in production

## Security Considerations

⚠️ **Current Implementation**

- In-memory storage only
- No encryption of credentials in memory
- No user authentication
- No rate limiting

🔒 **For Production**

- Add Redis/database for session persistence
- Encrypt sensitive data
- Implement user authentication and authorization
- Add rate limiting and DDoS protection
- Use HTTPS/TLS for server communication
- Rotate and revoke credentials regularly
- Audit logging for compliance

## Troubleshooting

### Enable Debug Logging

```bash
LOG_LEVEL=debug npm run dev
```

### Check Logs

```bash
# View latest logs
tail -f logs/combined.log

# View only errors
tail -f logs/error.log
```

### Test SSH Connection

```bash
# From the CLI
npm run cli

# From the server logs, look for detailed connection information
# in logs/combined.log
```

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Run Tests (when added)

```bash
npm test
```

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Start server in development mode
- `npm run cli` - Run interactive CLI
- `npm start` - Start server in production mode

## Architecture

### Workflow Engine Pattern

The system uses a **state machine pattern** with the following flow:

```
[Initialize] → [Register Steps] → [Execute Step N] → [Update State] → [Execute Step N+1] → [Complete]
```

Each step:

1. Receives current workflow state
2. Executes its task
3. Updates state with results
4. Returns success/failure with data

### Session Management

All workflow sessions are stored in-memory in a Map. Each session contains:

- Unique UUID
- Workflow engine instance
- Step instances with their context
- Full execution history

## License

MIT

## Support

For issues, questions, or contributions:

1. Check logs for detailed error information
2. Review [WORKFLOW_EXTENSIBILITY.md](./WORKFLOW_EXTENSIBILITY.md)
3. Ensure all prerequisites are installed
4. Verify network connectivity to remote server and GitHub API

## Future Enhancements

- [ ] Persistent session storage (Redis/database)
- [ ] User authentication and authorization
- [ ] Additional workflow steps (deployment, monitoring, SSL)
- [ ] Web UI dashboard
- [ ] Webhook support for CI/CD integration
- [ ] Session timeout and cleanup
- [ ] Rate limiting and throttling
- [ ] Database audit logging
- [ ] Docker support
- [ ] Kubernetes operator
