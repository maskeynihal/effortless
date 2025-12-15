# Application Setup Feature Documentation

## Overview

The Application Setup feature enables users to configure their application deployment on remote servers by specifying a domain and filesystem path, then automatically creating that path with proper ownership via SSH with sudo privileges.

## User Flow

1. User completes the 5-step workflow (SSH → Auth → Repo → Deploy Key test → Verification)
2. User selects "Setup Application" from the post-workflow menu
3. If this is their first setup for that app:
   - User enters **domain** (e.g., `myapp.com`) - where the application will be hosted
   - User enters **pathname** (e.g., `/var/www/myapp`) - where files will be stored on the server
4. Application setup is created on the remote server:
   - Directory created with `sudo mkdir -p <pathname>`
   - Ownership changed to SSH user with `sudo chown <username>:<username> <pathname>`
   - Folder permissions verified
5. Configuration is saved to SQLite database
6. User can view and optionally modify existing setups

## Implementation Details

### 1. Database Layer (`src/shared/database.ts`)

#### Schema Addition

```sql
CREATE TABLE IF NOT EXISTS application_setup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT NOT NULL,
  host TEXT NOT NULL,
  username TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  applicationName TEXT NOT NULL,
  domain TEXT,
  pathname TEXT,
  folderCreated INTEGER DEFAULT 0,
  ownershipSet INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(host, username, applicationName)
)
```

#### Exported Functions

**`saveApplicationSetup()`**

- Stores or updates application domain and pathname configuration
- Parameters: sessionId, host, username, port, applicationName, domain, pathname
- Returns: Promise<void>
- Called after successful remote folder creation

**`getApplicationSetup()`**

- Retrieves existing application setup for a host/user/app combination
- Parameters: host, username, applicationName
- Returns: Promise<ApplicationSetupInfo | null>
- Checks if reusing or modifying existing configuration

**`updateApplicationSetupStatus()`**

- Marks folder creation and ownership changes as complete
- Parameters: host, username, applicationName, folderCreated, ownershipSet
- Returns: Promise<void>
- Called after verification step

### 2. CLI Layer (`src/cli/index.ts`)

#### Menu Integration

```typescript
private async showPostWorkflowOptions(): Promise<void>
  // Choices include:
  // - Create Database
  // - Setup Application  ← NEW
  // - View Workflow Configuration
  // - Exit
```

#### New Methods

**`setupApplication()`**

- Main method for gathering domain and pathname from user
- Checks for existing configuration, asks if user wants to reuse or modify
- Prompts for:
  - Domain (with autocomplete suggestions from previous setups)
  - Pathname (with autocomplete suggestions from previous setups)
- Calls `createApplicationFoldersOnRemote()` to execute setup on server
- Saves configuration to database via `saveApplicationSetup()`
- Updates status via `updateApplicationSetupStatus()`
- Adds suggestions for future autocomplete

**`createApplicationFoldersOnRemote(pathname: string): Promise<boolean>`**

- Helper method that calls the API endpoint
- Makes POST request to `/application/setup`
- Returns success flag for UI feedback
- Handles errors and logs failures

### 3. API Layer (`src/server/routes.ts`)

#### POST /application/setup

**Request Body**

```json
{
  "host": "server.example.com",
  "port": 22,
  "username": "deploy",
  "privateKeyContent": "-----BEGIN OPENSSH PRIVATE KEY-----...",
  "pathname": "/var/www/myapp",
  "applicationName": "my-application"
}
```

**Response**

```json
{
  "success": true,
  "message": "Application folder setup completed",
  "folderPath": "/var/www/myapp",
  "owner": "deploy:deploy",
  "verificationInfo": "drwxr-xr-x  3 deploy deploy 96 Dec 14 05:45 /var/www/myapp"
}
```

**Implementation Steps**

1. Establish SSH connection to remote server
2. Execute `sudo mkdir -p <pathname>` to create folder recursively
3. Execute `sudo chown <username>:<username> <pathname>` to set ownership
4. Execute `ls -la <pathname>` to verify folder and permissions
5. Close SSH connection
6. Return success with folder info

**Error Handling**

- Returns 400 if required fields missing
- Returns 500 with error message if SSH operations fail
- Logs all operations for debugging

## Database Schema

### application_setup Table Structure

| Column          | Type     | Default           | Purpose                           |
| --------------- | -------- | ----------------- | --------------------------------- |
| id              | INTEGER  | auto-increment    | Primary key                       |
| sessionId       | TEXT     | -                 | Reference to session              |
| host            | TEXT     | -                 | Server hostname/IP                |
| username        | TEXT     | -                 | SSH username                      |
| port            | INTEGER  | 22                | SSH port                          |
| applicationName | TEXT     | -                 | Application identifier            |
| domain          | TEXT     | -                 | Application domain (URL)          |
| pathname        | TEXT     | -                 | Application path on server        |
| folderCreated   | INTEGER  | 0                 | Flag: folder creation successful  |
| ownershipSet    | INTEGER  | 0                 | Flag: ownership change successful |
| status          | TEXT     | 'pending'         | Setup status                      |
| createdAt       | DATETIME | CURRENT_TIMESTAMP | Creation timestamp                |
| updatedAt       | DATETIME | CURRENT_TIMESTAMP | Last update timestamp             |

**Unique Constraint**: (host, username, applicationName) - prevents duplicate setups

## Key Features

✅ **Persistent Storage**

- All configurations saved to SQLite database
- Configurations persist across sessions
- Quick reuse of previous setups

✅ **SSH with Sudo**

- Creates folders with sudo privileges
- Proper ownership assignment to SSH user
- No hardcoded passwords needed

✅ **Autocomplete Suggestions**

- Domain and pathname suggestions stored for future use
- Speeds up subsequent setups

✅ **Validation & Verification**

- Path must start with `/` (absolute path)
- Domain and path cannot be empty
- Folder creation verified with `ls -la`

✅ **Error Recovery**

- Graceful error messages
- Detailed logging for debugging
- User can retry with different values

## Usage Examples

### First-time setup

```
User completes workflow
User selects "Setup Application" → "create new"
User enters domain: "myapp.example.com"
User enters path: "/var/www/myapp"
✅ Folder created at /var/www/myapp
✅ Ownership set to deploy:deploy
✅ Configuration saved
```

### Reusing configuration

```
User selects "Setup Application"
System finds existing setup for myapp
User chooses to reuse (no modification needed)
User returns to menu
```

### Modifying configuration

```
User selects "Setup Application"
System finds existing setup for myapp
User chooses to modify
User enters new path: "/opt/applications/myapp"
✅ New path created and configured
```

## Testing

The feature is fully integrated with:

- TypeScript compilation (no type errors)
- Express REST API (endpoint responds correctly)
- SQLite database (schema and functions available)
- CLI menu system (integrated with post-workflow options)

All components communicate via well-defined interfaces and error handling.

## Files Modified

1. **src/shared/database.ts**

   - Added application_setup table schema
   - Added saveApplicationSetup() function
   - Added getApplicationSetup() function
   - Added updateApplicationSetupStatus() function

2. **src/cli/index.ts**

   - Updated showPostWorkflowOptions() menu choices
   - Updated switch statement to handle "setup-app" case
   - Added setupApplication() method
   - Added createApplicationFoldersOnRemote() helper method
   - Added imports for database functions

3. **src/server/routes.ts**
   - Added SSH2Client import
   - Added POST /application/setup endpoint
   - Implemented folder creation and ownership logic
   - Added verification and error handling

## Next Steps (Optional Future Enhancements)

- [ ] Support for multiple applications per server
- [ ] Application environment setup (env files, config files)
- [ ] Service/daemon configuration (systemd, supervisor)
- [ ] Health checks for deployed applications
- [ ] Application update/rollback functionality
- [ ] Automated backup configuration
