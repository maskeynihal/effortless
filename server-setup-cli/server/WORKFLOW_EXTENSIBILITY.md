# Workflow Extensibility Pattern

This document describes how to extend the Effortless GitHub Integration tool with additional workflow steps beyond the initial 3 steps (SSH connection, GitHub auth, and SSH key registration).

## Architecture Overview

The workflow system is built on a **state machine pattern** that allows for dynamic step registration and execution. All state is maintained in-memory for fast access.

### Core Components

1. **WorkflowEngine** - Manages the workflow state machine and step execution
2. **IWorkflowStep** - Interface that all steps must implement
3. **WorkflowState** - Immutable state tracking across all steps
4. **WorkflowEventLog** - Audit trail of all workflow events

## Adding a New Workflow Step

### Step 1: Create a Step Class

Create a new TypeScript file implementing the `IWorkflowStep` interface:

```typescript
// src/steps/myCustomStep.ts
import { IWorkflowStep, WorkflowStepResult } from '../shared/workflow';
import { logger } from '../shared/logger';

export class MyCustomStep implements IWorkflowStep {
  name = 'my-custom-step'; // Unique step identifier
  description = 'Description of what this step does';

  constructor(/* parameters */) {}

  async execute(): Promise<WorkflowStepResult> {
    try {
      logger.info(`[My Custom Step] Starting execution`);

      // Your step logic here
      const success = true;
      const message = 'Step completed successfully';

      if (success) {
        logger.info(`[My Custom Step] ${message}`);
        return {
          success: true,
          message,
          data: {
            customField1: 'value1',
            customField2: 'value2',
          },
        };
      }

      return {
        success: false,
        message: 'Step failed',
        error: 'Detailed error message',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[My Custom Step] Failed: ${errorMessage}`);
      return {
        success: false,
        message: 'Step failed with exception',
        error: errorMessage,
      };
    }
  }
}
```

### Step 2: Register the Step in the API

Modify `src/server/routes.ts` to register your new step:

```typescript
// In the POST /workflow/init endpoint

// After registering existing steps...
const myStep = new MyCustomStep(/* parameters */);
engine.registerStep(myStep);
logger.debug('[API] Registered custom step');
```

### Step 3: Handle Step-Specific Parameters

If your step requires parameters from the client, handle them in the `POST /workflow/:sessionId/next` endpoint:

```typescript
if (currentStepName === 'my-custom-step' && req.body.myParam) {
  // Process your step-specific parameters
  const newStep = new MyCustomStep(req.body.myParam);
  context.myStep = newStep;
  // Re-register if needed
}
```

## Example: Adding a Deployment Step

Here's a complete example of adding a deployment step:

```typescript
// src/steps/deploymentStep.ts
import { IWorkflowStep, WorkflowStepResult } from '../shared/workflow';
import { logger } from '../shared/logger';
import axios from 'axios';

export class DeploymentStep implements IWorkflowStep {
  name = 'deployment';
  description = 'Deploy application to server via git pull';

  private sshStep: SSHConnectionStep;
  private repositoryUrl: string;
  private deployPath: string;

  constructor(sshStep: SSHConnectionStep, repositoryUrl: string, deployPath: string) {
    this.sshStep = sshStep;
    this.repositoryUrl = repositoryUrl;
    this.deployPath = deployPath;
  }

  async execute(): Promise<WorkflowStepResult> {
    try {
      logger.info('[Deployment] Starting deployment process');

      // Clone or update repository
      const cloneCommand = `cd ${this.deployPath} && git clone ${this.repositoryUrl} . 2>&1 || git pull origin main`;
      const result = await this.sshStep.executeRemoteCommand(cloneCommand);

      if (result.stderr && !result.stderr.includes('already exists')) {
        return {
          success: false,
          message: 'Failed to deploy repository',
          error: result.stderr,
        };
      }

      logger.info('[Deployment] Repository deployment successful');

      return {
        success: true,
        message: 'Application deployed successfully',
        data: {
          deploymentPath: this.deployPath,
          repositoryUrl: this.repositoryUrl,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Deployment] Failed: ${errorMessage}`);
      return {
        success: false,
        message: 'Deployment failed',
        error: errorMessage,
      };
    }
  }
}
```

Then register it:

```typescript
// In POST /workflow/init
const deploymentStep = new DeploymentStep(
  sshStep,
  'https://github.com/user/repo.git',
  '/home/user/app'
);
engine.registerStep(deploymentStep);
```

## Workflow State Management

### Accessing Workflow Data

Any step can access or update the workflow state:

```typescript
// In a step's execute method
const sshConnected = this.state.data.sshConnected;
const githubUsername = this.state.data.githubUsername;

// Update state with new data
engine.updateData({
  deploymentStatus: 'success',
  deploymentTime: new Date().toISOString(),
});
```

### Conditional Step Execution

Skip to a specific step based on conditions:

```typescript
// In the API route
if (someCondition) {
  engine.skipToStep(2); // Jump to step index 2
}
```

## Logging and Monitoring

All steps should use the Winston logger:

```typescript
import { logger } from '../shared/logger';

logger.info('[Step Name] Success message');
logger.warn('[Step Name] Warning message');
logger.error('[Step Name] Error message');
logger.debug('[Step Name] Debug details');
```

Logs are written to:
- Console (formatted)
- `logs/combined.log` (all levels)
- `logs/error.log` (errors only)

## Future Step Ideas

1. **Deployment Step** - Deploy code to the connected server
2. **Docker Step** - Build and push Docker images
3. **Database Setup** - Configure databases on remote server
4. **Monitoring Setup** - Install monitoring agents
5. **SSL Certificate** - Generate and install SSL certificates
6. **Environment Config** - Setup environment variables and secrets
7. **Webhook Setup** - Configure GitHub webhooks
8. **Backup Config** - Setup automated backups

## Best Practices

1. **Logging** - Use logger extensively for debugging and monitoring
2. **Error Handling** - Always catch errors and return meaningful error messages
3. **Validation** - Validate parameters before execution
4. **Timeouts** - Set reasonable timeouts for long-running operations
5. **State Updates** - Return updated workflow data in the `data` field
6. **Idempotency** - Steps should be safe to retry if possible
7. **Cleanup** - Close connections and release resources in finally blocks

## Testing Steps Locally

To test a new step without the full workflow:

```typescript
const step = new MyCustomStep(/* params */);
const result = await step.execute();
console.log(result);
```

## API for React Integration

All server endpoints are RESTful and can be consumed by a React application:

```typescript
// React Hook Example
const useWorkflow = (sessionId: string) => {
  const [status, setStatus] = useState(null);

  const executeStep = async (params?: any) => {
    const response = await fetch(`/api/workflow/${sessionId}/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await response.json();
    setStatus(data);
    return data;
  };

  return { status, executeStep };
};
```

## Deployment Considerations

While this current implementation is in-memory only, when deploying to production:

1. **Session Persistence** - Consider storing sessions in Redis or database
2. **Horizontal Scaling** - Use shared session store for multiple server instances
3. **Security** - Encrypt sensitive data (PAT, SSH keys)
4. **Session Timeout** - Implement TTL for long-lived sessions
5. **Audit Logging** - Persist all workflow events to database
6. **Rate Limiting** - Add rate limiting to prevent abuse
7. **Authentication** - Add user authentication to the server
8. **Database** - Store workflow history for auditing

These features are marked as `deployment` step in the workflow architecture.
