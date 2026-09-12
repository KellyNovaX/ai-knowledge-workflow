export enum ModelProviderType {
  Manual = "manual",
  Codex = "codex",
  CustomCli = "custom-cli"
}

export enum TerminalApp {
  Iterm = "iterm",
  Warp = "warp",
  Obsidian = "obsidian"
}

export enum TaskSourceApp {
  Wps = "wps",
  Feishu = "feishu"
}

export enum LayoutDirection {
  Vertical = "vertical",
  Horizontal = "horizontal"
}

export enum PlanDecision {
  Ready = "ready",
  NeedUserInput = "need_user_input",
  Blocked = "blocked"
}

export enum PlanAction {
  CreateTask = "create_task",
  CreateGeneralTask = "create_general_task",
  CreateWorkflow = "create_workflow",
  ArchiveProjectInput = "archive_project_input",
  AskUser = "ask_user",
  Blocked = "blocked"
}

export enum TaskScope {
  Project = "project",
  Workflow = "workflow",
  General = "general"
}

export enum PlanConfidence {
  Low = "low",
  Medium = "medium",
  High = "high"
}

export enum TaskStatus {
  Doing = "doing",
  Todo = "todo",
  PendingRelease = "pending_release",
  Waiting = "waiting",
  Backlog = "backlog",
  Done = "done"
}

export enum TaskPriority {
  P0 = "P0",
  P1 = "P1",
  P2 = "P2",
  P3 = "P3",
  P4 = "P4"
}

export enum ProtectedTaskField {
  Id = "id",
  Created = "created",
  Type = "type",
  Link = "link",
  SourcePath = "source_path"
}

export enum WorkflowType {
  Feature = "feature",
  Incident = "incident",
  Datafix = "datafix",
  DataExport = "data-export"
}

export enum ValidationSeverity {
  Info = "info",
  Warning = "warning",
  Error = "error",
  Blocker = "blocker"
}

export enum VaultIssueCode {
  MissingRootAgents = "missing_root_agents",
  MissingTaskBoard = "missing_task_board",
  MissingProjectEntry = "missing_project_entry",
  MissingProjectKnowledgeSection = "missing_project_knowledge_section",
  MissingProjectSourceSection = "missing_project_source_section",
  MissingWorkflowEntry = "missing_workflow_entry",
  MissingWorkflowInputs = "missing_workflow_inputs",
  MissingWorkflowExports = "missing_workflow_exports",
  MissingWorkflowProjectsSection = "missing_workflow_projects_section",
  MissingWorkflowDevelopmentBranch = "missing_workflow_development_branch",
  MissingProjectTaskDevelopmentBranch = "missing_project_task_development_branch",
  MissingWorkflowKnowledgeSection = "missing_workflow_knowledge_section",
  MissingWorkflowKnowledgeLink = "missing_workflow_knowledge_link",
  MissingProjectTaskStructure = "missing_project_task_structure",
  LegacyProjectTaskEntry = "legacy_project_task_entry",
  ProjectTaskProjectMismatch = "project_task_project_mismatch",
  MissingWorkflowStructure = "missing_workflow_structure",
  BrokenWorkflowLink = "broken_workflow_link",
  BrokenMarkdownLink = "broken_markdown_link",
  MissingTaskEntry = "missing_task_entry",
  TaskMetadataMismatch = "task_metadata_mismatch",
  DuplicateTask = "duplicate_task",
  InvalidProjectInputPath = "invalid_project_input_path",
  OversizedAgentsEntry = "oversized_agents_entry",
  AgentsExecutionSection = "agents_execution_section",
  LocalWorkflowRules = "local_workflow_rules",
  OversizedProjectLinks = "oversized_project_links",
  ProjectLinksColdContent = "project_links_cold_content",
  UntrackedInboxItem = "untracked_inbox_item"
}

export enum VaultEntryKind {
  File = "file",
  Folder = "folder"
}

export interface AiKnowledgeWorkflowSettings {
  vaultRoot: string;
  provider: ModelProviderType;
  terminalApp: TerminalApp;
  taskSourceApp: TaskSourceApp;
  codexCliPath: string;
  customCliPath: string;
  defaultTaskStatus: TaskStatus;
  autoValidate: boolean;
  layoutDirection: LayoutDirection;
}

export interface PlanQuestion {
  field: string;
  question: string;
  options?: string[];
}

export interface PlanMove {
  from: string;
  to: string;
}

export interface PlanTask {
  text: string;
  link?: string;
}

export interface WorkflowPlan {
  decision: PlanDecision;
  action?: PlanAction;
  task_scope?: TaskScope;
  project?: string | null;
  related_projects?: string[];
  workflow_type?: WorkflowType | null;
  workflow_slug?: string | null;
  task_status?: TaskStatus;
  confidence: PlanConfidence;
  reason?: string;
  questions: PlanQuestion[];
  moves?: PlanMove[];
  tasks?: PlanTask[];
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  blockingReasons: string[];
  plan?: WorkflowPlan;
}

export interface ValidationIssue {
  code: VaultIssueCode;
  severity: ValidationSeverity;
  message: string;
  path?: string;
}

export interface VaultEntry {
  path: string;
  kind: VaultEntryKind;
}

export interface TaskBoardEntry {
  line: number;
  text: string;
  normalizedText: string;
  workflowLinks: string[];
}

export interface ProjectIndexEntry {
  path: string;
  hasAgents: boolean;
  hasIndex: boolean;
  hasLinks: boolean;
  linksContent: string;
  inputFiles: string[];
  inputIndexFiles: ProjectInputIndexEntry[];
}

export interface ProjectInputIndexEntry {
  path: string;
  content: string;
}

export interface WorkflowIndexEntry {
  path: string;
  hasAgents: boolean;
  hasTodo: boolean;
  hasInputs: boolean;
  hasExports: boolean;
  hasLocalRules: boolean;
  agentsContent: string;
  files: string[];
}

export interface VaultIndex {
  rootAgentsExists: boolean;
  taskBoardExists: boolean;
  taskBoardEntries: TaskBoardEntry[];
  projects: ProjectIndexEntry[];
  workflows: WorkflowIndexEntry[];
  inboxItems: VaultEntry[];
  routingFiles?: ProjectInputIndexEntry[];
  linkChecks?: { path: string; line: number; target: string; exists: boolean }[];
  taskReferences?: {
    path: string;
    line: number;
    id: string | null;
    status: TaskStatus;
    checked: boolean;
    entryPath: string | null;
    entryContent: string | null;
  }[];
}
