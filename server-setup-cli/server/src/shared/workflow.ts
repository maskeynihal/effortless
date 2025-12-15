/**
 * Workflow step interface for extensibility
 * Each step should implement this interface to be part of the workflow pipeline
 */
export interface WorkflowStepResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
  error?: string;
}

export interface IWorkflowStep {
  name: string;
  description: string;
  execute(): Promise<WorkflowStepResult>;
}

/**
 * Workflow state that persists across steps
 */
export interface WorkflowState {
  sessionId: string;
  currentStep: number;
  steps: string[];
  completed: boolean;
  data: {
    sshConnected?: boolean;
    sshUsername?: string;
    sshHost?: string;
    githubAuthenticated?: boolean;
    githubUsername?: string;
    githubPAT?: string;
    sshKeyRegistered?: boolean;
    sshKeyName?: string;
    sshPublicKey?: string;
    [key: string]: any;
  };
  history: WorkflowEventLog[];
  createdAt: Date;
}

export interface WorkflowEventLog {
  timestamp: Date;
  stepName: string;
  event: "started" | "completed" | "failed" | "updated";
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Workflow engine that manages the state machine and step execution
 */
export class WorkflowEngine {
  private state: WorkflowState;
  private steps: Map<string, IWorkflowStep> = new Map();

  constructor(sessionId: string) {
    this.state = {
      sessionId,
      currentStep: 0,
      steps: [],
      completed: false,
      data: {},
      history: [],
      createdAt: new Date(),
    };
  }

  /**
   * Register a step in the workflow
   */
  registerStep(step: IWorkflowStep): void {
    this.steps.set(step.name, step);
    // Only add to steps array if it doesn't already exist
    if (!this.state.steps.includes(step.name)) {
      this.state.steps.push(step.name);
    }
  }

  /**
   * Get current workflow state
   */
  getState(): WorkflowState {
    return this.state;
  }

  /**
   * Execute the current step
   */
  async executeCurrentStep(): Promise<WorkflowStepResult> {
    if (this.state.currentStep >= this.state.steps.length) {
      return {
        success: false,
        message: "No more steps to execute",
        error: "Workflow already completed",
      };
    }

    const stepName = this.state.steps[this.state.currentStep];
    const step = this.steps.get(stepName);

    if (!step) {
      return {
        success: false,
        message: `Step "${stepName}" not found`,
        error: "Step not registered",
      };
    }

    this.logEvent(stepName, "started", `Starting step: ${step.description}`);

    try {
      const result = await step.execute();

      if (result.success) {
        this.logEvent(stepName, "completed", result.message, result.data);
        if (result.data) {
          this.state.data = { ...this.state.data, ...result.data };
        }
        this.state.currentStep++;

        // Check if workflow is complete
        if (this.state.currentStep >= this.state.steps.length) {
          this.state.completed = true;
        }
      } else {
        this.logEvent(stepName, "failed", result.message, {
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logEvent(
        stepName,
        "failed",
        `Error executing step: ${errorMessage}`,
        {
          error: errorMessage,
        }
      );
      return {
        success: false,
        message: `Failed to execute step: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Get a specific step in the workflow
   */
  getStep(stepName: string): IWorkflowStep | undefined {
    return this.steps.get(stepName);
  }

  /**
   * Update workflow data
   */
  updateData(data: Record<string, any>): void {
    this.state.data = { ...this.state.data, ...data };
    this.logEvent(
      this.state.steps[this.state.currentStep] || "workflow",
      "updated",
      "Workflow data updated",
      data
    );
  }

  /**
   * Log a workflow event
   */
  private logEvent(
    stepName: string,
    event: "started" | "completed" | "failed" | "updated",
    message: string,
    metadata?: Record<string, any>
  ): void {
    this.state.history.push({
      timestamp: new Date(),
      stepName,
      event,
      message,
      metadata,
    });
  }

  /**
   * Skip to a specific step (for workflow updates/modifications)
   */
  skipToStep(stepIndex: number): boolean {
    if (stepIndex < 0 || stepIndex >= this.state.steps.length) {
      return false;
    }
    this.state.currentStep = stepIndex;
    this.logEvent(
      "workflow",
      "updated",
      `Skipped to step ${stepIndex}: ${this.state.steps[stepIndex]}`
    );
    return true;
  }

  /**
   * Skip current step and move to next without executing
   */
  skipCurrentStep(): boolean {
    if (this.state.currentStep >= this.state.steps.length) {
      return false;
    }

    const stepName = this.state.steps[this.state.currentStep];
    this.state.currentStep++;

    // Check if workflow is complete
    if (this.state.currentStep >= this.state.steps.length) {
      this.state.completed = true;
    }

    this.logEvent(stepName, "updated", `Skipped step: ${stepName}`);
    return true;
  }

  /**
   * Reset the workflow to the beginning
   */
  reset(): void {
    this.state.currentStep = 0;
    this.state.completed = false;
    this.state.history = [];
    this.logEvent("workflow", "updated", "Workflow reset to beginning");
  }
}

/**
 * Global in-memory session store
 */
export const workflowSessions = new Map<string, WorkflowEngine>();

/**
 * Create or get a workflow session
 */
export function getOrCreateSession(sessionId: string): WorkflowEngine {
  if (!workflowSessions.has(sessionId)) {
    workflowSessions.set(sessionId, new WorkflowEngine(sessionId));
  }
  return workflowSessions.get(sessionId)!;
}

/**
 * Remove a session
 */
export function removeSession(sessionId: string): void {
  workflowSessions.delete(sessionId);
}
