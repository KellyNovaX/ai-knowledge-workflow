import {
  LayoutDirection,
  ModelProviderType,
  PlanAction,
  PlanDecision,
  PlanConfidence,
  TaskScope,
  TaskPriority,
  TaskStatus,
  TerminalApp,
  ValidationSeverity,
  WorkflowType
} from "./types";

export const PLUGIN_ID = "ai-knowledge-workflow";
export const PLUGIN_NAME = "AI Knowledge Workflow";

export const MODEL_PROVIDER_LABELS: Record<ModelProviderType, string> = {
  [ModelProviderType.Manual]: "Manual",
  [ModelProviderType.Codex]: "Codex CLI",
  [ModelProviderType.CustomCli]: "Custom CLI"
};

export const TERMINAL_APP_LABELS: Record<TerminalApp, string> = {
  [TerminalApp.Iterm]: "iTerm",
  [TerminalApp.Warp]: "Warp",
  [TerminalApp.Obsidian]: "Obsidian Terminal"
};

export const LAYOUT_DIRECTION_LABELS: Record<LayoutDirection, string> = {
  [LayoutDirection.Vertical]: "上下分栏",
  [LayoutDirection.Horizontal]: "左右分栏"
};

export const PLAN_DECISION_LABELS: Record<PlanDecision, string> = {
  [PlanDecision.Ready]: "Ready",
  [PlanDecision.NeedUserInput]: "Need user input",
  [PlanDecision.Blocked]: "Blocked"
};

export const PLAN_ACTION_LABELS: Record<PlanAction, string> = {
  [PlanAction.CreateTask]: "Create task",
  [PlanAction.CreateGeneralTask]: "Create general task",
  [PlanAction.CreateWorkflow]: "Create workflow",
  [PlanAction.ArchiveProjectInput]: "Archive project input",
  [PlanAction.AskUser]: "Ask user",
  [PlanAction.Blocked]: "Blocked"
};

export const TASK_SCOPE_LABELS: Record<TaskScope, string> = {
  [TaskScope.Project]: "Project",
  [TaskScope.Workflow]: "Workflow",
  [TaskScope.General]: "General"
};

export const PLAN_CONFIDENCE_LABELS: Record<PlanConfidence, string> = {
  [PlanConfidence.Low]: "Low",
  [PlanConfidence.Medium]: "Medium",
  [PlanConfidence.High]: "High"
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.Doing]: "Doing",
  [TaskStatus.Todo]: "Todo",
  [TaskStatus.PendingRelease]: "Pending Release",
  [TaskStatus.Waiting]: "Waiting",
  [TaskStatus.Backlog]: "Backlog",
  [TaskStatus.Done]: "Done"
};

export const TASK_STATUS_TITLES: Record<TaskStatus, string> = {
  [TaskStatus.Doing]: "进行中",
  [TaskStatus.Todo]: "待处理",
  [TaskStatus.PendingRelease]: "待上线",
  [TaskStatus.Waiting]: "等待中",
  [TaskStatus.Backlog]: "待排期",
  [TaskStatus.Done]: "已完成"
};

export const LEGACY_TASK_STATUS_ALIASES: Record<string, TaskStatus> = {
  "In Progress": TaskStatus.Doing,
  Next: TaskStatus.Todo,
  "下一步": TaskStatus.Todo,
  "待处理": TaskStatus.Todo,
  "待上线": TaskStatus.PendingRelease
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.P0]: "P0",
  [TaskPriority.P1]: "P1",
  [TaskPriority.P2]: "P2",
  [TaskPriority.P3]: "P3",
  [TaskPriority.P4]: "P4"
};

export const TASK_STATUS_ORDER: TaskStatus[] = [
  TaskStatus.Doing,
  TaskStatus.Todo,
  TaskStatus.PendingRelease,
  TaskStatus.Waiting,
  TaskStatus.Backlog,
  TaskStatus.Done
];

export const ACTIVE_TASK_STATUS_ORDER: TaskStatus[] = TASK_STATUS_ORDER.filter(
  (status) => status !== TaskStatus.Done
);

export function normalizeTaskStatusValue(
  value: unknown,
  fallback: TaskStatus | null | undefined = TaskStatus.Todo
): TaskStatus | null | undefined {
  if (typeof value !== "string") {
    return fallback;
  }

  if (Object.values(TaskStatus).includes(value as TaskStatus)) {
    return value as TaskStatus;
  }

  const trimmed = value.trim();
  const directAlias = LEGACY_TASK_STATUS_ALIASES[trimmed];

  if (directAlias) {
    return directAlias;
  }

  const normalized = trimmed.toLowerCase();
  const matchedStatus = TASK_STATUS_ORDER.find((status) => status.toString() === normalized);
  const matchedLabel = TASK_STATUS_ORDER.find(
    (status) => TASK_STATUS_LABELS[status].toLowerCase() === normalized
  );

  return matchedStatus ?? matchedLabel ?? fallback;
}

export function getTaskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export const TASK_PRIORITY_ORDER: TaskPriority[] = [
  TaskPriority.P0,
  TaskPriority.P1,
  TaskPriority.P2,
  TaskPriority.P3,
  TaskPriority.P4
];

export const WORKFLOW_TYPE_LABELS: Record<WorkflowType, string> = {
  [WorkflowType.Feature]: "Feature",
  [WorkflowType.Incident]: "Incident",
  [WorkflowType.Datafix]: "Data fix",
  [WorkflowType.DataExport]: "Data export"
};

export const VALIDATION_SEVERITY_LABELS: Record<ValidationSeverity, string> = {
  [ValidationSeverity.Info]: "Info",
  [ValidationSeverity.Warning]: "Warning",
  [ValidationSeverity.Error]: "Error",
  [ValidationSeverity.Blocker]: "Blocker"
};

export const DEFAULT_VAULT_ROOT = "";
export const DEFAULT_CODEX_CLI_PATH = "codex";
export const DEFAULT_CUSTOM_CLI_COMMAND = "";
