# Effortless UI - User Guide

## Overview

Effortless provides a comprehensive web-based UI for managing server setup, deployment, and automation. All CLI functionality from the server has been ported to an interactive web interface.

## Features

### Application Management

- **Create & Save Applications**: Configure multiple server applications with SSH credentials
- **Connection Verification**: Test SSH and GitHub connections before proceeding
- **Configuration Persistence**: Applications are saved locally and can be reused

### Setup Steps (from CLI)

The UI provides all CLI steps in an organized, interactive interface:

#### 1. **Server Stack Setup**

- Install PHP (7.4 - 8.3)
- Install Nginx web server
- Install Database (MySQL or PostgreSQL)
- Install Composer and all Laravel extensions

#### 2. **Database Creation**

- Create MySQL or PostgreSQL database
- Create database user with credentials
- Grant necessary permissions

#### 3. **Folder Setup**

- Create application folder structure
- Set proper ownership and permissions
- Ensure directory is accessible

#### 4. **Environment Setup (.env)**

- Fetch `.env.example` from GitHub repository
- Create `.env` on remote server
- Automatically configures from template

#### 5. **Environment Update**

- Add database credentials to existing `.env`
- Update connection configuration
- Verify configuration values

#### 6. **Deploy Key Generation**

- Generate SSH deploy key for GitHub
- Register with GitHub repository
- Enable automated deployments

#### 7. **SSH Key Setup for GitHub Actions**

- Generate SSH key pair for CI/CD
- Add public key to authorized_keys
- Store private key as GitHub secret

#### 8. **Node.js Setup (NVM)**

- Install Node.js using NVM
- Select desired Node version
- Install npm and dependencies

#### 9. **HTTPS & SSL Setup**

- Configure Nginx for HTTPS
- Issue Let's Encrypt certificates
- Auto-renewal configuration

#### 10. **GitHub Actions Workflow**

- Create deployment workflow
- Update `deploy.yml` configuration
- Open pull request with changes

### Admin Dashboard

- **View Step Logs**: See execution history and status
- **Admin User Management**: Promote/demote admin users
- **Check Admin Status**: Verify user permissions

## How to Use

### Getting Started

1. **Navigate to Applications**
   - Click "Applications" in the header or start from homepage
   - You'll see saved applications (if any)

2. **Create New Application**
   - Click "Create New Application" or "Add Another Application"
   - Enter application details:
     - Application Name (required)
     - Server Host/IP (required)
     - SSH Username (required, defaults to "root")
     - SSH Port (default: 22)
     - Domain name (optional)
     - Application path (optional)
     - SSH Private Key (required, paste key content)
     - GitHub PAT (optional, for private repos)

3. **Verify Connections**
   - System verifies SSH connection
   - Verifies GitHub connection if PAT provided
   - Shows connection status before saving

4. **Configure Application**
   - Click "Configure" on saved application
   - You'll see all available setup steps
   - Each step shows description and can be executed individually

### Executing Steps

1. **Individual Execution**
   - Click "Execute" button on any step
   - Step runs asynchronously
   - Shows status: ○ pending, ⟳ running, ✓ success, ✗ failed

2. **Step Configuration**
   - Some steps may show input fields for parameters
   - Server Stack: Choose PHP version and database type
   - Database: Enter database name, user, password
   - Environment: Specify repository URL
   - HTTPS: Enter domain and admin email

3. **Error Handling**
   - Errors display inline with detailed messages
   - Can re-run steps at any time
   - All operations are repeatable

4. **View Logs**
   - Go to Admin Dashboard
   - Enter host, username, application name
   - See full execution history with timestamps

## API Integration

The UI communicates with the server API:

- **Connection Verification**: `POST /api/connection/verify`
- **Step Execution**: `POST /api/step/{step-name}`
- **Step Logs**: `GET /api/steps/{host}/{username}/{applicationName}`
- **Admin Functions**: `GET/POST /api/admin/*`

All API calls are made directly from the browser. SSH private keys are only stored locally and never transmitted except to authenticated server.

## Storage

- **Local Storage**: Applications saved in browser's localStorage
- **Security**: Private keys stored locally only
- **Persistence**: Configurations persist across browser sessions

## File Structure

```
client/src/
├── lib/
│   ├── api-service.ts      # API client implementation
│   ├── storage.ts          # Local storage utilities
│   └── api.ts              # Legacy axios client
├── routes/
│   ├── index.tsx           # Homepage
│   ├── __root.tsx          # Root layout with header
│   ├── admin/
│   │   └── index.tsx       # Admin dashboard
│   └── onboarding/
│       ├── index.tsx       # Application list
│       ├── new.tsx         # Create new application
│       ├── setup.tsx       # Step execution interface
│       ├── init.tsx        # Legacy redirect
│       ├── select.tsx      # Legacy redirect
│       └── steps.tsx       # Legacy redirect
└── components/             # UI components
```

## Keyboard Shortcuts

- **Enter** on form: Submit form
- **Escape**: Close dialogs

## Troubleshooting

### Connection Failed

- Verify SSH private key is correct and complete
- Check host IP/domain is reachable
- Ensure SSH port is correct (usually 22)
- Verify username has SSH access

### GitHub Token Invalid

- Generate new PAT at github.com/settings/tokens
- Ensure token has repo and workflow scopes
- Token must be from correct GitHub account

### Step Execution Failed

- Check connection is still valid
- Review error message for specific issue
- Check server logs: `tail -f /var/log/auth.log`
- Re-run step to retry

### SSH Key Not Found

- Check key file path exists and is readable
- Paste complete key including header/footer
- Ensure no leading/trailing whitespace

## Advanced Usage

### Multiple Applications

- Create separate applications for different servers
- Each application maintains its own configuration
- Switch between applications using the list view

### Reusing Applications

- Saved applications appear in dropdown
- Click to select and configure
- All previous settings are preserved

### Batch Operations

- Execute steps sequentially by clicking each one
- System maintains state across operations
- Can pause and resume at any time

## Support

For issues or questions:

1. Check Admin Dashboard for execution logs
2. Review server logs on remote machine
3. Verify all prerequisites are met
4. Re-run failed steps for detailed error messages
