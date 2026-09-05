import { ZodError } from "zod";
import {
  PlanAction,
  PlanConfidence,
  PlanDecision,
  PlanValidationResult,
  TaskScope,
  TaskStatus,
  WorkflowPlan
} from "../types";
import { WorkflowPlanSchema } from "./PlanSchema";

const ABSOLUTE_PATH_PATTERN = /^(?:\/|[A-Za-z]:[\\/]|\\\\|[a-z][a-z0-9+.-]*:)/i;

export function parsePlanJson(raw: string): PlanValidationResult {
  try {
    return validatePlanShape(JSON.parse(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      valid: false,
      errors: [`Plan JSON is invalid: ${message}`],
      warnings: [],
      blockingReasons: ["Plan must be valid JSON."]
    };
  }
}

export function validatePlanShape(plan: unknown): PlanValidationResult {
  const parsed = WorkflowPlanSchema.safeParse(plan);

  if (!parsed.success) {
    const errors = formatZodErrors(parsed.error);

    return {
      valid: false,
      errors,
      warnings: [],
      blockingReasons: errors
    };
  }

  return validateParsedPlan(parsed.data);
}

function validateParsedPlan(plan: WorkflowPlan): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const blockingReasons: string[] = [];

  addDecisionRules(plan, errors, blockingReasons);
  addActionRules(plan, errors, blockingReasons);
  addPathRules(plan, errors, blockingReasons);

  if (plan.confidence !== PlanConfidence.High) {
    blockingReasons.push("Plan confidence must be high before execution.");
  }

  if (!plan.reason) {
    warnings.push("Plan reason is empty; user-facing review context may be unclear.");
  }

  return {
    valid: errors.length === 0 && blockingReasons.length === 0,
    errors,
    warnings,
    blockingReasons,
    plan
  };
}

function addDecisionRules(plan: WorkflowPlan, errors: string[], blockingReasons: string[]): void {
  if (plan.questions.length > 0) {
    blockingReasons.push("Plan has unanswered questions.");
  }

  if (plan.decision === PlanDecision.Ready && plan.questions.length > 0) {
    blockingReasons.push("Ready plans cannot contain questions.");
  }

  if (plan.decision === PlanDecision.NeedUserInput && plan.questions.length === 0) {
    errors.push("need_user_input plans must include at least one question.");
  }

  if (plan.decision === PlanDecision.Blocked && !plan.reason) {
    errors.push("blocked plans must include a reason.");
  }
}

function addActionRules(plan: WorkflowPlan, errors: string[], blockingReasons: string[]): void {
  if (plan.decision === PlanDecision.Ready && !plan.action) {
    errors.push("ready plans must include an action.");
  }

  if (plan.decision === PlanDecision.Ready && plan.action === PlanAction.AskUser) {
    blockingReasons.push("ask_user plans cannot be marked ready.");
  }

  if (plan.decision === PlanDecision.Ready && plan.action === PlanAction.Blocked) {
    blockingReasons.push("blocked action cannot be marked ready.");
  }

  if (
    plan.task_status === TaskStatus.Done &&
    [PlanAction.CreateTask, PlanAction.CreateGeneralTask, PlanAction.CreateWorkflow].includes(plan.action as PlanAction)
  ) {
    errors.push("New tasks cannot be created directly in completed status.");
  }

  if (plan.action === PlanAction.CreateTask || plan.action === PlanAction.ArchiveProjectInput) {
    if (!plan.project) {
      errors.push(`${plan.action} plans must include project.`);
    }
  }

  if (plan.action === PlanAction.CreateTask) {
    if (!plan.workflow_type) {
      errors.push("create_task plans must include workflow_type.");
    }

    for (const task of plan.tasks ?? []) {
      if (!task.link) {
        errors.push("create_task tasks must include link.");
      }
    }
  }

  if (plan.action === PlanAction.CreateGeneralTask) {
    if (plan.task_scope && plan.task_scope !== TaskScope.General) {
      errors.push("create_general_task plans must use task_scope general.");
    }

    for (const task of plan.tasks ?? []) {
      if (!task.link) {
        errors.push("create_general_task tasks must include a 10-tasks/items task file link.");
      }
    }

    if (plan.project || (plan.related_projects && plan.related_projects.length > 0)) {
      errors.push("create_general_task plans cannot include project or related_projects.");
    }

    if (plan.workflow_type || plan.workflow_slug) {
      errors.push("create_general_task plans cannot include workflow metadata.");
    }

    if (plan.moves && plan.moves.length > 0) {
      errors.push("create_general_task plans cannot move files.");
    }
  }

  if (plan.action === PlanAction.CreateWorkflow) {
    if (!plan.project) {
      errors.push("create_workflow plans must include project.");
    }

    if (!plan.workflow_type) {
      errors.push("create_workflow plans must include workflow_type.");
    }

    if (!plan.workflow_slug) {
      errors.push("create_workflow plans must include workflow_slug.");
      blockingReasons.push("Workflow creation requires workflow_slug.");
    }

    for (const task of plan.tasks ?? []) {
      if (!task.link) {
        errors.push("create_workflow tasks must include link.");
      }
    }
  }
}

function addPathRules(plan: WorkflowPlan, errors: string[], blockingReasons: string[]): void {
  plan.moves?.forEach((move, index) => {
    validateRelativePath(move.from, `moves[${index}].from`, errors, blockingReasons);
    validateRelativePath(move.to, `moves[${index}].to`, errors, blockingReasons);
  });

  plan.tasks?.forEach((task, index) => {
    if (task.link) {
      validateRelativePath(task.link, `tasks[${index}].link`, errors, blockingReasons);
    }
  });
}

function validateRelativePath(
  path: string,
  field: string,
  errors: string[],
  blockingReasons: string[]
): void {
  if (ABSOLUTE_PATH_PATTERN.test(path)) {
    const message = `${field} must be a relative vault path.`;
    errors.push(message);
    blockingReasons.push(message);
  }

  const segments = path.split(/[\\/]+/);
  if (segments.includes("..")) {
    const message = `${field} cannot include parent directory segments.`;
    errors.push(message);
    blockingReasons.push(message);
  }
}

function formatZodErrors(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "plan";
    return `${path}: ${issue.message}`;
  });
}
