import { App } from "obsidian";
import {
  PlanAction,
  PlanConfidence,
  PlanDecision,
  PlanMove,
  PlanTask,
  TaskScope,
  ValidationIssue,
  ValidationSeverity,
  WorkflowPlan
} from "../types";
import { validatePlanShape } from "./PlanValidator";
import {
  formatBoardTaskId,
  formatTaskFileId,
  MarkdownTaskBoard,
  parsePlanTaskText,
  renderTaskLine
} from "../vault/MarkdownTaskBoard";
import { TaskFileMetadata, renderTaskFileFrontmatter, updateTaskFileContent } from "../vault/TaskFileMetadata";
import { TaskIdStore } from "../vault/TaskIdStore";
import { VaultScanner } from "../vault/VaultScanner";
import { VaultValidator } from "../vault/VaultValidator";
import { WorkflowCreator } from "../vault/WorkflowCreator";

const PROJECTS_ROOT_PATH = "30-projects";
const WORKFLOWS_ROOT_PATH = "20-workflows";
const TASK_BOARD_PATH = "10-tasks/board.md";
const PROJECT_TASK_ENTRY_PATH_PATTERN = /^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/(?:AGENTS|index)\.md$/;
const GENERAL_TASK_PATH_PATTERN = /^10-tasks\/items\/\d{4}\/\d{2}\/[^/]+\.md$/;
const ABSOLUTE_PATH_PATTERN = /^(?:\/|[A-Za-z]:[\\/]|\\\\|[a-z][a-z0-9+.-]*:)/i;

enum ProjectTaskTemplatePath {
  Root = "90-templates/project-task-template"
}

enum ProjectTaskTemplateFile {
  Agents = "AGENTS.md",
  Index = "index.md",
  Overview = "overview.md",
  Execution = "execution.md"
}

export enum PlanExecutionConfirmation {
  Confirmed = "confirmed"
}

export enum PlanExecutionOperationKind {
  CreateDirectory = "create_directory",
  CopyTemplate = "copy_template",
  CreateTaskFile = "create_task_file",
  MoveFile = "move_file",
  AppendTask = "append_task",
  ValidateVault = "validate_vault"
}

export enum PlanExecutionBlockerCode {
  InvalidPlanShape = "invalid_plan_shape",
  UnsafePath = "unsafe_path",
  MissingSource = "missing_source",
  ExistingTarget = "existing_target",
  DuplicateTask = "duplicate_task",
  MissingWorkflowSlug = "missing_workflow_slug",
  MissingProject = "missing_project",
  MissingTaskBoard = "missing_task_board",
  UnsupportedAction = "unsupported_action",
  MissingTaskEntry = "missing_task_entry",
  Unconfirmed = "unconfirmed"
}

export interface PlanExecutionOperation {
  kind: PlanExecutionOperationKind;
  path: string;
  detail: string;
}

export interface PlanExecutionBlocker {
  code: PlanExecutionBlockerCode;
  message: string;
  path?: string;
}

export interface PlanExecutionPreview {
  canExecute: boolean;
  operations: PlanExecutionOperation[];
  blockers: PlanExecutionBlocker[];
  warnings: string[];
}

export interface PlanExecutionResult {
  executed: boolean;
  preview: PlanExecutionPreview;
  validationIssues: ValidationIssue[];
  rolledBack?: boolean;
  error?: string;
}

export interface PlanExecutorOptions {
  vaultRoot?: string;
}

export class PlanExecutor {
  private readonly taskBoard: MarkdownTaskBoard;
  private readonly workflowCreator: WorkflowCreator;
  private readonly scanner: VaultScanner;
  private readonly validator: VaultValidator;

  constructor(
    private readonly app: App,
    private readonly options: PlanExecutorOptions = {}
  ) {
    this.taskBoard = new MarkdownTaskBoard(app);
    this.workflowCreator = new WorkflowCreator(app);
    this.scanner = new VaultScanner(app);
    this.validator = new VaultValidator();
  }

  async previewPlanExecution(plan: WorkflowPlan): Promise<PlanExecutionPreview> {
    const operations: PlanExecutionOperation[] = [];
    const blockers: PlanExecutionBlocker[] = [];
    const warnings: string[] = [];
    const shapeResult = validatePlanShape(plan);

    warnings.push(...shapeResult.warnings);

    if (!shapeResult.valid) {
      blockers.push(
        ...[...shapeResult.errors, ...shapeResult.blockingReasons].map((message) => ({
          code: PlanExecutionBlockerCode.InvalidPlanShape,
          message
        }))
      );
    }

    this.addReadinessBlockers(plan, blockers);

    if (
      plan.action !== PlanAction.CreateTask &&
      plan.action !== PlanAction.CreateGeneralTask &&
      plan.action !== PlanAction.CreateWorkflow
    ) {
      blockers.push({
        code: PlanExecutionBlockerCode.UnsupportedAction,
        message: `Executor only supports ${PlanAction.CreateTask}, ${PlanAction.CreateGeneralTask}, and ${PlanAction.CreateWorkflow}.`
      });
    }

    if (!plan.tasks || plan.tasks.length === 0) {
      blockers.push({
        code: PlanExecutionBlockerCode.MissingTaskEntry,
        message: "Plan must include at least one task board entry."
      });
    }

    await this.addProjectBlockers(plan, blockers);
    await this.addTaskBoardBlockers(blockers);
    await this.addPathBlockers(plan, blockers);
    await this.addDuplicateTaskBlockers(plan, blockers);
    this.addOperationPreview(plan, operations);

    return {
      canExecute: blockers.length === 0,
      operations,
      blockers,
      warnings
    };
  }

  async executePlan(
    plan: WorkflowPlan,
    confirmation: PlanExecutionConfirmation
  ): Promise<PlanExecutionResult> {
    const preview = await this.previewPlanExecution(plan);

    if (confirmation !== PlanExecutionConfirmation.Confirmed) {
      return {
        executed: false,
        preview: {
          ...preview,
          canExecute: false,
          blockers: [
            ...preview.blockers,
            {
              code: PlanExecutionBlockerCode.Unconfirmed,
              message: "Execution requires explicit confirmation after reviewing the dry-run preview."
            }
          ]
        },
        validationIssues: []
      };
    }

    if (!preview.canExecute) {
      return {
        executed: false,
        preview,
        validationIssues: []
      };
    }

    const originalTaskBoard = await this.taskBoard.readTaskBoard();
    const completedMoves: PlanMove[] = [];
    const createdTaskFiles: string[] = [];
    let createdWorkflowPath: string | null = null;
    const baselineValidationIssueKeys = await this.getBlockingValidationIssueKeys();
    const boardTasks = getBoardTasks(plan);
    const createdAt = formatDateTime(new Date());
    const taskScope = resolveTaskScope(plan);
    const firstTaskId = await new TaskIdStore(this.app).reserveTaskIds(originalTaskBoard, boardTasks.length);
    const taskFileIds = boardTasks.map((_, index) => formatTaskFileId(taskScope, firstTaskId + index));
    const boardTaskIds = boardTasks.map((_, index) => formatBoardTaskId(taskScope, firstTaskId + index));
    const planWithIds = applyTaskIdsToPlan(plan, boardTasks, taskFileIds);
    const tasksWithIdLinks = getBoardTasks(planWithIds);

    try {
      if (planWithIds.action === PlanAction.CreateWorkflow) {
        const workflow = await this.workflowCreator.createWorkflow(planWithIds.workflow_type!, planWithIds.workflow_slug!);
        createdWorkflowPath = workflow.workflowPath;
        await this.populateWorkflowFiles(planWithIds, workflow.workflowPath, {
          id: taskFileIds[0] ?? "",
          createdAt
        });
      }

      await this.applyMoves(planWithIds.moves ?? [], completedMoves);
      await this.createMissingTaskFiles(planWithIds, tasksWithIdLinks, taskFileIds, createdAt, createdTaskFiles);
      await this.taskBoard.appendTasks(tasksWithIdLinks, plan.task_status!, {
        taskScope,
        createdAt,
        taskIds: boardTaskIds
      });

      const validationIssues = await this.validateAfterExecution();
      const newBlockingValidationIssues = validationIssues.filter(
        (issue) => !baselineValidationIssueKeys.has(getValidationIssueKey(issue))
      );

      if (hasBlockingValidationIssues(newBlockingValidationIssues)) {
        await this.rollbackExecution(originalTaskBoard, completedMoves, createdWorkflowPath, createdTaskFiles);

        return {
          executed: false,
          preview,
          validationIssues: newBlockingValidationIssues,
          rolledBack: true,
          error: "Vault validation failed after execution; applied changes were rolled back."
        };
      }

      return {
        executed: true,
        preview: {
          ...preview,
          operations: [
            ...preview.operations,
            {
              kind: PlanExecutionOperationKind.ValidateVault,
              path: TASK_BOARD_PATH,
              detail: "Run deterministic vault validation after execution."
            }
          ]
        },
        validationIssues
      };
    } catch (error) {
      await this.rollbackExecution(originalTaskBoard, completedMoves, createdWorkflowPath, createdTaskFiles);

      return {
        executed: false,
        preview,
        validationIssues: [],
        rolledBack: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private addReadinessBlockers(plan: WorkflowPlan, blockers: PlanExecutionBlocker[]): void {
    if (plan.decision !== PlanDecision.Ready) {
      blockers.push({
        code: PlanExecutionBlockerCode.InvalidPlanShape,
        message: "Only ready plans can be executed."
      });
    }

    if (plan.questions.length > 0) {
      blockers.push({
        code: PlanExecutionBlockerCode.InvalidPlanShape,
        message: "Plan has unanswered questions."
      });
    }

    if (plan.confidence !== PlanConfidence.High) {
      blockers.push({
        code: PlanExecutionBlockerCode.InvalidPlanShape,
        message: "Plan confidence must be high before execution."
      });
    }

    if (!plan.task_status) {
      blockers.push({
        code: PlanExecutionBlockerCode.InvalidPlanShape,
        message: "Plan must include task_status."
      });
    }

    if (plan.action === PlanAction.CreateWorkflow && !plan.workflow_slug) {
      blockers.push({
        code: PlanExecutionBlockerCode.MissingWorkflowSlug,
        message: "Workflow creation requires workflow_slug."
      });
    }
  }

  private async addProjectBlockers(plan: WorkflowPlan, blockers: PlanExecutionBlocker[]): Promise<void> {
    for (const project of getRelatedProjects(plan)) {
      const projectPath = `${PROJECTS_ROOT_PATH}/${project}`;

      if (!(await this.app.vault.adapter.exists(projectPath))) {
        blockers.push({
          code: PlanExecutionBlockerCode.MissingProject,
          message: `Project does not exist: ${projectPath}`,
          path: projectPath
        });
      }
    }
  }

  private async addTaskBoardBlockers(blockers: PlanExecutionBlocker[]): Promise<void> {
    if (!(await this.app.vault.adapter.exists(TASK_BOARD_PATH))) {
      blockers.push({
        code: PlanExecutionBlockerCode.MissingTaskBoard,
        message: `Task board does not exist: ${TASK_BOARD_PATH}`,
        path: TASK_BOARD_PATH
      });
    }
  }

  private async addPathBlockers(plan: WorkflowPlan, blockers: PlanExecutionBlocker[]): Promise<void> {
    for (const move of plan.moves ?? []) {
      this.addUnsafePathBlockers([move.from, move.to], blockers);

      blockers.push({
        code: PlanExecutionBlockerCode.UnsupportedAction,
        message: "Plan file moves are no longer supported. Use task upload to copy files into inputs/.",
        path: move.to
      });
    }

    for (const task of getBoardTasks(plan)) {
      if (task.link) {
        this.addUnsafePathBlockers([task.link], blockers);
      }
    }

    if (plan.action === PlanAction.CreateTask) {
      await this.addCreateTaskLinkBlockers(plan.tasks ?? [], blockers);
    }

    if (plan.action === PlanAction.CreateGeneralTask) {
      await this.addCreateGeneralTaskBlockers(plan, blockers);
    }

    if (plan.action === PlanAction.CreateWorkflow) {
      await this.addCreateWorkflowTargetBlockers(plan, blockers);
    }
  }

  private addUnsafePathBlockers(paths: string[], blockers: PlanExecutionBlocker[]): void {
    for (const path of paths) {
      if (ABSOLUTE_PATH_PATTERN.test(path) || path.split(/[\\/]+/).includes("..")) {
        blockers.push({
          code: PlanExecutionBlockerCode.UnsafePath,
          message: `Path must stay inside the vault and cannot include parent segments: ${path}`,
          path
        });
      }
    }
  }

  private async addCreateTaskLinkBlockers(tasks: PlanTask[], blockers: PlanExecutionBlocker[]): Promise<void> {
    for (const task of tasks) {
      if (!task.link) {
        blockers.push({
          code: PlanExecutionBlockerCode.MissingTaskEntry,
          message: "create_task task entries must include a project input AGENTS.md link."
        });
        continue;
      }

      if (!PROJECT_TASK_ENTRY_PATH_PATTERN.test(task.link)) {
        blockers.push({
          code: PlanExecutionBlockerCode.UnsafePath,
          message: "create_task task links must point to inputs/YYYY/MM/<task-slug>/AGENTS.md.",
          path: task.link
        });
      }

      if (await this.app.vault.adapter.exists(task.link)) {
        blockers.push({
          code: PlanExecutionBlockerCode.ExistingTarget,
          message: `Task entry already exists: ${task.link}`,
          path: task.link
        });
      }
    }
  }

  private async addCreateGeneralTaskBlockers(
    plan: WorkflowPlan,
    blockers: PlanExecutionBlocker[]
  ): Promise<void> {
    if ((plan.moves ?? []).length > 0) {
      blockers.push({
        code: PlanExecutionBlockerCode.UnsupportedAction,
        message: "create_general_task only appends task board entries and cannot move files."
      });
    }

    for (const task of plan.tasks ?? []) {
      if (!task.link) {
        blockers.push({
          code: PlanExecutionBlockerCode.MissingTaskEntry,
          message: "create_general_task entries must include a task file link under 10-tasks/items/."
        });
        continue;
      }

      if (!GENERAL_TASK_PATH_PATTERN.test(task.link)) {
        blockers.push({
          code: PlanExecutionBlockerCode.UnsupportedAction,
          message: "create_general_task links must point to 10-tasks/items/YYYY/MM/<task>.md.",
          path: task.link
        });
      }

      if (await this.app.vault.adapter.exists(task.link)) {
        blockers.push({
          code: PlanExecutionBlockerCode.ExistingTarget,
          message: `General task file already exists: ${task.link}`,
          path: task.link
        });
      }
    }
  }

  private async addCreateWorkflowTargetBlockers(
    plan: WorkflowPlan,
    blockers: PlanExecutionBlocker[]
  ): Promise<void> {
    if (!plan.workflow_slug || !plan.workflow_type) {
      return;
    }

    if (!isSinglePathSegment(plan.workflow_slug)) {
      blockers.push({
        code: PlanExecutionBlockerCode.UnsafePath,
        message: "workflow_slug must be a single folder name.",
        path: plan.workflow_slug
      });
      return;
    }

    const workflowPath = this.workflowCreator.getWorkflowPath(plan.workflow_slug);

    if (await this.app.vault.adapter.exists(workflowPath)) {
      blockers.push({
        code: PlanExecutionBlockerCode.ExistingTarget,
        message: `Workflow target already exists: ${workflowPath}`,
        path: workflowPath
      });
    }

    for (const move of plan.moves ?? []) {
      if (!move.to.startsWith(`${workflowPath}/inputs/`)) {
        blockers.push({
          code: PlanExecutionBlockerCode.UnsafePath,
          message: "create_workflow move targets must live under the workflow inputs/ directory.",
          path: move.to
        });
      }
    }

    for (const task of plan.tasks ?? []) {
      if (!task.link) {
        blockers.push({
          code: PlanExecutionBlockerCode.MissingTaskEntry,
          message: "create_workflow task entries must include a workflow link."
        });
        continue;
      }

      if (task.link !== workflowPath && !task.link.startsWith(`${workflowPath}/`)) {
        blockers.push({
          code: PlanExecutionBlockerCode.UnsafePath,
          message: "create_workflow task links must point to the workflow directory or a file inside it.",
          path: task.link
        });
      }
    }

    const templatePath = this.workflowCreator.getTemplatePath(plan.workflow_type);

    if (!(await this.app.vault.adapter.exists(templatePath))) {
      blockers.push({
        code: PlanExecutionBlockerCode.MissingSource,
        message: `Workflow template is missing: ${templatePath}`,
        path: templatePath
      });
    }
  }

  private async addDuplicateTaskBlockers(plan: WorkflowPlan, blockers: PlanExecutionBlocker[]): Promise<void> {
    const tasks = getBoardTasks(plan);

    if (tasks.length === 0 || !(await this.app.vault.adapter.exists(TASK_BOARD_PATH))) {
      return;
    }

    const duplicates = await this.taskBoard.findDuplicateTasks(tasks, {
      taskScope: resolveTaskScope(plan)
    });

    for (const duplicate of duplicates) {
      blockers.push({
        code: PlanExecutionBlockerCode.DuplicateTask,
        message: `Duplicate task blocked: ${duplicate}`,
        path: TASK_BOARD_PATH
      });
    }
  }

  private addOperationPreview(plan: WorkflowPlan, operations: PlanExecutionOperation[]): void {
    if (plan.action === PlanAction.CreateWorkflow && plan.workflow_slug && plan.workflow_type) {
      operations.push({
        kind: PlanExecutionOperationKind.CreateDirectory,
        path: `${WORKFLOWS_ROOT_PATH}/${plan.workflow_slug}`,
        detail: `Create workflow directory for ${plan.workflow_type}.`
      });
      operations.push({
        kind: PlanExecutionOperationKind.CopyTemplate,
        path: this.workflowCreator.getTemplatePath(plan.workflow_type),
        detail: "Copy workflow template files."
      });
    }

    for (const move of plan.moves ?? []) {
      operations.push({
        kind: PlanExecutionOperationKind.MoveFile,
        path: move.to,
        detail: `Move ${move.from} -> ${move.to}`
      });
    }

    for (const task of getTaskFilesToCreate(plan)) {
      operations.push({
        kind: PlanExecutionOperationKind.CreateTaskFile,
        path: task.link!,
        detail: `Create task file for ${task.text}.`
      });
    }

    for (const task of getBoardTasks(plan)) {
      operations.push({
        kind: PlanExecutionOperationKind.AppendTask,
        path: TASK_BOARD_PATH,
        detail: renderTaskLine(task, { taskScope: resolveTaskScope(plan) })
      });
    }
  }

  private async applyMoves(moves: PlanMove[], completedMoves: PlanMove[]): Promise<void> {
    for (const move of moves) {
      await this.ensureFolder(parentPath(move.to));
      await this.app.vault.adapter.rename(move.from, move.to);
      completedMoves.push(move);
    }
  }

  private async createMissingTaskFiles(
    plan: WorkflowPlan,
    boardTasks: PlanTask[],
    taskIds: string[],
    createdAt: string,
    createdTaskFiles: string[]
  ): Promise<void> {
    for (const task of getTaskFilesToCreate(plan)) {
      const taskLink = task.link!;

      if (await this.app.vault.adapter.exists(taskLink)) {
        continue;
      }

      const taskIndex = boardTasks.findIndex((boardTask) => boardTask === task || boardTask.link === task.link);
      const taskFolder = parentPath(taskLink);
      await this.ensureFolder(taskFolder);
      if (plan.action === PlanAction.CreateTask) {
        createdTaskFiles.push(...await this.copyProjectTaskTemplateFiles(taskFolder));
      }
      const content =
        plan.action === PlanAction.CreateGeneralTask
          ? renderGeneralTaskFile(plan, task, this.options.vaultRoot, {
              id: taskIds[taskIndex] ?? "",
              createdAt
            })
          : renderProjectTaskFile(plan, task, this.options.vaultRoot, {
              id: taskIds[taskIndex] ?? "",
              createdAt
            });
      await this.app.vault.adapter.write(
        taskLink,
        content
      );
      createdTaskFiles.push(taskLink);

      if (plan.action === PlanAction.CreateTask) {
        const overviewPath = `${parentPath(taskLink)}/overview.md`;
        if (!(await this.app.vault.adapter.exists(overviewPath))) {
          await this.app.vault.adapter.write(overviewPath, renderProjectTaskOverview(plan, task));
          createdTaskFiles.push(overviewPath);
        }

        const executionPath = `${parentPath(taskLink)}/${ProjectTaskTemplateFile.Execution}`;
        if (!(await this.app.vault.adapter.exists(executionPath))) {
          await this.app.vault.adapter.write(executionPath, renderExecutionFile());
          createdTaskFiles.push(executionPath);
        }
      }
    }
  }

  private async copyProjectTaskTemplateFiles(taskFolder: string): Promise<string[]> {
    const copiedFiles: string[] = [];

    if (!(await this.app.vault.adapter.exists(ProjectTaskTemplatePath.Root))) {
      return copiedFiles;
    }

    await this.copyProjectTaskTemplateFolder(ProjectTaskTemplatePath.Root, taskFolder, copiedFiles);
    return copiedFiles;
  }

  private async copyProjectTaskTemplateFolder(
    currentTemplatePath: string,
    taskFolder: string,
    copiedFiles: string[]
  ): Promise<void> {
    const listed = await this.app.vault.adapter.list(currentTemplatePath);

    for (const folder of listed.folders) {
      const relativeFolder = stripPrefix(folder, ProjectTaskTemplatePath.Root);
      if (isLocalRulesPath(relativeFolder)) {
        continue;
      }
      await this.ensureFolder(`${taskFolder}/${relativeFolder}`);
      await this.copyProjectTaskTemplateFolder(folder, taskFolder, copiedFiles);
    }

    for (const file of listed.files) {
      const relativeFile = stripPrefix(file, ProjectTaskTemplatePath.Root);
      if (
        isLocalRulesPath(relativeFile) ||
        relativeFile === ProjectTaskTemplateFile.Agents ||
        relativeFile === ProjectTaskTemplateFile.Index ||
        relativeFile === ProjectTaskTemplateFile.Overview
      ) {
        continue;
      }

      const target = `${taskFolder}/${relativeFile}`;
      if (await this.app.vault.adapter.exists(target)) {
        continue;
      }

      await this.ensureFolder(parentPath(target));
      await this.app.vault.adapter.write(target, await this.app.vault.adapter.read(file));
      copiedFiles.push(target);
    }
  }

  private async populateWorkflowFiles(
    plan: WorkflowPlan,
    workflowPath: string,
    metadata: { id: string; createdAt: string }
  ): Promise<void> {
    const task = getBoardTasks(plan)[0] ?? plan.tasks?.[0];
    const { title, notes } = parsePlanTaskText(task?.text ?? plan.workflow_slug ?? "");
    const projectLinks = getRelatedProjects(plan).map(
      (project) => `- [${project}](../../${PROJECTS_ROOT_PATH}/${project}/index.md)`
    );
    const developmentBranchItems = getRelatedProjects(plan).map(
      (project) =>
        `- 项目：[${project}](../../${PROJECTS_ROOT_PATH}/${project}/index.md)\n  - 目标开发分支：待填写`
    );

    await this.writeWorkflowAgents(workflowPath, title, projectLinks, developmentBranchItems, plan, metadata);
    await this.writeWorkflowOverview(workflowPath, title, notes, projectLinks);
    await this.writeWorkflowTodo(workflowPath, title);
  }

  private async writeWorkflowAgents(
    workflowPath: string,
    title: string,
    projectLinks: string[],
    developmentBranchItems: string[],
    plan: WorkflowPlan,
    metadata: { id: string; createdAt: string }
  ): Promise<void> {
    const path = `${workflowPath}/AGENTS.md`;
    const content = await this.app.vault.adapter.read(path);
    const relatedProjects = getRelatedProjects(plan);
    const relatedKnowledgeProjectItems = relatedProjects.map(
      (project) => `  - [${project} AGENTS](../../${PROJECTS_ROOT_PATH}/${project}/AGENTS.md)`
    );
    const nextContent = removeMarkdownSections(
      content
      .replace('id: "{{TASK_ID}}"', `id: ${metadata.id}`)
      .replace("project: \"<project>\"", renderProjectFrontmatter(relatedProjects))
      .replace(/^title:\s*["']?\{\{WORKFLOW_TITLE\}\}["']?\s*$/m, () => `title: ${formatYamlScalar(title || plan.workflow_slug || "Workflow")}`)
      .replaceAll("{{WORKFLOW_TITLE}}", () => title || plan.workflow_slug || "Workflow")
      .replace('created: "{{YYYY-MM-DD}}"', `created: "${metadata.createdAt}"`)
      .replace("- 目标：待填写", () => `- 目标：${title || "待补充"}`)
      .replace("说明这次需求要解决什么问题，以及完成边界。", () => title || "待补充")
      .replace("- `[[30-projects/<project>/index]]`", projectLinks.join("\n") || "- 待补充")
      .replace(
        "- 关联项目：`[[30-projects/<project>/AGENTS]]`、`[[30-projects/<project>/links]]`",
        renderRelatedProjectRouteLine(relatedProjects)
      )
      .replace(
        "- 关联项目：[AGENTS](../../30-projects/%3Cproject%3E/AGENTS.md)、[links](../../30-projects/%3Cproject%3E/links.md)",
        renderRelatedProjectRouteLine(relatedProjects)
      )
      .replace(
        "- 关联项目：`[AGENTS](30-projects/%3Cproject%3E/AGENTS.md)`、`[links](30-projects/%3Cproject%3E/links.md)`",
        renderRelatedProjectRouteLine(relatedProjects)
      )
      .replace(
        "- 项目：`[[30-projects/<project>/index]]`\n  - 目标开发分支：待填写",
        developmentBranchItems.join("\n") || "- 项目：待补充\n  - 目标开发分支：待填写"
      )
      .replace(
        "- 项目：[index](../../30-projects/%3Cproject%3E/index.md)\n  - 目标开发分支：待填写",
        developmentBranchItems.join("\n") || "- 项目：待补充\n  - 目标开发分支：待填写"
      )
      .replace("- 项目：[index](../../30-projects/%3Cproject%3E/index.md)", projectLinks.join("\n") || "- 待补充")
      .replace(
        "- 项目入口：`[[30-projects/<project>/AGENTS]]`",
        relatedKnowledgeProjectItems.length > 0
          ? ["- 项目入口：", ...relatedKnowledgeProjectItems].join("\n")
          : "- 项目入口：待补充"
      )
      .replace(
        "- 项目入口：[AGENTS](../../30-projects/%3Cproject%3E/AGENTS.md)",
        relatedKnowledgeProjectItems.length > 0
          ? ["- 项目入口：", ...relatedKnowledgeProjectItems].join("\n")
          : "- 项目入口：待补充"
      ),
      ["当前结论", "已确认事实", "待确认问题", "执行结果", "AI 阅读顺序", "最小必读资料"]
    );

    await this.app.vault.adapter.write(path, updateTaskFileContent(nextContent, {
      id: metadata.id,
      type: TaskScope.Workflow,
      status: plan.task_status,
      title: title || plan.workflow_slug || "Workflow",
      created: metadata.createdAt,
      project: relatedProjects,
      entry_type: "workflow",
      task_type: plan.workflow_type ?? undefined
    }));
  }

  private async writeWorkflowOverview(
    workflowPath: string,
    title: string,
    notes: string[],
    projectLinks: string[]
  ): Promise<void> {
    const path = `${workflowPath}/overview.md`;
    const content = [
      `# ${title || "Feature Overview"}`,
      "",
      "## 背景",
      "",
      notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "- 待补充",
      "",
      "## 目标",
      "",
      `- ${title || "待补充"}`,
      "",
      "## 非目标",
      "",
      "- 待补充",
      "",
      "## 影响范围",
      "",
      projectLinks.length > 0 ? projectLinks.join("\n") : "- 待补充",
      "",
      "## 关联资料",
      "- 项目入口：",
      ...(projectLinks.length > 0 ? projectLinks : ["- 待补充"]),
      "- 需求资料：",
      "- 接口或原型：",
      "",
      ...renderExecutionPrecheckLines(),
      "",
      "## 当前结论",
      "- 待补充",
      "",
      "## 已确认事实",
      "- 待补充",
      "",
      "## 待确认问题",
      "- 待补充",
      ""
    ].join("\n");

    await this.app.vault.adapter.write(path, content);
  }

  private async writeWorkflowTodo(workflowPath: string, title: string): Promise<void> {
    const path = `${workflowPath}/todo.md`;
    const content = [
      "# Workflow Todo",
      "",
      "## Doing",
      "- [ ] ",
      "",
      "## Next",
      `- [ ] ${title || "梳理需求范围与后续处理"}`,
      "",
      "## Waiting",
      "- [ ] ",
      "",
      "## Done",
      "- [x] ",
      ""
    ].join("\n");

    await this.app.vault.adapter.write(path, content);
  }

  private async rollbackExecution(
    originalTaskBoard: string,
    completedMoves: PlanMove[],
    createdWorkflowPath: string | null,
    createdTaskFiles: string[]
  ): Promise<void> {
    await this.app.vault.adapter.write(TASK_BOARD_PATH, originalTaskBoard);

    for (const taskFile of [...createdTaskFiles].reverse()) {
      if (await this.app.vault.adapter.exists(taskFile)) {
        await this.app.vault.adapter.remove(taskFile);
      }
    }

    for (const move of [...completedMoves].reverse()) {
      const targetExists = await this.app.vault.adapter.exists(move.to);
      const sourceExists = await this.app.vault.adapter.exists(move.from);

      if (targetExists && !sourceExists) {
        await this.ensureFolder(parentPath(move.from));
        await this.app.vault.adapter.rename(move.to, move.from);
      }
    }

    if (createdWorkflowPath && (await this.app.vault.adapter.exists(createdWorkflowPath))) {
      await this.app.vault.adapter.rmdir(createdWorkflowPath, true);
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let current = "";

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;

      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async validateAfterExecution(): Promise<ValidationIssue[]> {
    const index = await this.scanner.scanVault();
    return this.validator
      .validateVault(index)
      .filter((issue) => issue.severity === ValidationSeverity.Error || issue.severity === ValidationSeverity.Blocker);
  }

  private async getBlockingValidationIssueKeys(): Promise<Set<string>> {
    const issues = await this.validateAfterExecution();
    return new Set(issues.map(getValidationIssueKey));
  }
}

function isWorkflowAgentsPath(path: string | null | undefined): boolean {
  return Boolean(path && /^20-workflows\/[^/]+\/AGENTS\.md$/.test(path));
}

function isSinglePathSegment(value: string): boolean {
  return value.trim().length > 0 && !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..";
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function hasBlockingValidationIssues(issues: ValidationIssue[]): boolean {
  return issues.some(
    (issue) => issue.severity === ValidationSeverity.Error || issue.severity === ValidationSeverity.Blocker
  );
}

function getValidationIssueKey(issue: ValidationIssue): string {
  return [issue.code, issue.severity, issue.path ?? "", issue.message].join("\u0000");
}

function rewriteMoveTargetsForTaskIds(moves: PlanMove[], originalTasks: PlanTask[], tasksWithIdLinks: PlanTask[]): PlanMove[] {
  if (moves.length === 0) {
    return moves;
  }

  return moves.map((move) => {
    for (let index = 0; index < originalTasks.length; index += 1) {
      const originalFolder = parentPath(originalTasks[index]?.link ?? "");
      const nextFolder = parentPath(tasksWithIdLinks[index]?.link ?? "");

      if (originalFolder && nextFolder && originalFolder !== nextFolder && move.to.startsWith(`${originalFolder}/`)) {
        return {
          ...move,
          to: `${nextFolder}/${move.to.slice(originalFolder.length + 1)}`
        };
      }
    }

    return move;
  });
}

function applyTaskIdsToPlan(plan: WorkflowPlan, boardTasks: PlanTask[], taskFileIds: string[]): WorkflowPlan {
  if (plan.action === PlanAction.CreateWorkflow && plan.workflow_slug) {
    const taskFileId = taskFileIds[0] ?? "";
    const nextWorkflowSlug = prependIdToWorkflowSlug(plan.workflow_slug, taskFileId);
    const originalWorkflowPath = `${WORKFLOWS_ROOT_PATH}/${plan.workflow_slug}`;
    const nextWorkflowPath = `${WORKFLOWS_ROOT_PATH}/${nextWorkflowSlug}`;

    return {
      ...plan,
      workflow_slug: nextWorkflowSlug,
      moves: rewriteWorkflowMoveTargets(plan.moves ?? [], originalWorkflowPath, nextWorkflowPath),
      tasks: (plan.tasks ?? []).map((task) => ({
        ...task,
        link: rewriteWorkflowTaskLink(task.link, originalWorkflowPath, nextWorkflowPath)
      }))
    };
  }

  const tasksWithIdLinks = boardTasks.map((task, index) => ({
    ...task,
    link: prependIdToPath(task.link, taskFileIds[index])
  }));
  const movesWithIdTargets = rewriteMoveTargetsForTaskIds(plan.moves ?? [], boardTasks, tasksWithIdLinks);

  return {
    ...plan,
    moves: movesWithIdTargets,
    tasks: (plan.tasks ?? []).map((task, index) => {
      const matching = boardTasks[index];
      if (matching && matching.link === task.link) {
        return { ...task, link: prependIdToPath(task.link, taskFileIds[index]) };
      }
      return task;
    })
  };
}

function prependIdToWorkflowSlug(workflowSlug: string, taskFileId: string): string {
  if (!taskFileId || /^w-\d+-/.test(workflowSlug)) {
    return workflowSlug;
  }

  return `${taskFileId}-${stripLeadingDateFromSlug(workflowSlug)}`;
}

function stripLeadingDateFromSlug(workflowSlug: string): string {
  return workflowSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "") || "workflow";
}

function rewriteWorkflowTaskLink(
  link: string | null | undefined,
  originalWorkflowPath: string,
  nextWorkflowPath: string
): string | undefined {
  if (!link) {
    return undefined;
  }

  if (link === originalWorkflowPath) {
    return `${nextWorkflowPath}/AGENTS.md`;
  }

  if (link === `${originalWorkflowPath}/AGENTS.md`) {
    return `${nextWorkflowPath}/AGENTS.md`;
  }

  if (link.startsWith(`${originalWorkflowPath}/`)) {
    return `${nextWorkflowPath}/${link.slice(originalWorkflowPath.length + 1)}`;
  }

  return link;
}

function rewriteWorkflowMoveTargets(
  moves: PlanMove[],
  originalWorkflowPath: string,
  nextWorkflowPath: string
): PlanMove[] {
  return moves.map((move) =>
    move.to.startsWith(`${originalWorkflowPath}/`)
      ? {
          ...move,
          to: `${nextWorkflowPath}/${move.to.slice(originalWorkflowPath.length + 1)}`
        }
      : move
  );
}

function replaceWorkflowReadingSections(
  content: string,
  readingOrderSection: string,
  requiredReadingSection: string
): string {
  return replaceMarkdownSection(
    replaceMarkdownSection(content, "AI 阅读顺序", readingOrderSection),
    "最小必读资料",
    requiredReadingSection
  );
}

function buildWorkflowReadingOrderSection(workflowPath: string, projects: string[]): string {
  const workflowLinks = [
    `- 先以本 workflow 入口确定上下文根、目标分支和禁止范围：[[${workflowPath}/AGENTS|workflow AGENTS]]。`,
    `- 需要确认需求时读取 [[${workflowPath}/overview|overview]]；需要看待办时读取 [[${workflowPath}/todo|todo]]；需要看风险时读取 [[${workflowPath}/risk|risk]]。`,
    "- `overview.md` 若存在 `状态：待确认` 的确认项，AI 必须先给出建议，再请用户确认或选择，写回结果后继续。",
    "- 已确认或无需确认的确认项不要重复询问。",
    "- 有原始需求、故障、工单、截图或口径材料时再读 `inputs/`。",
    "- 需要项目稳定知识或源码路径时按需读取关联项目入口："
  ];
  const projectLinks = projects.flatMap((project) => [
    `   - [[${PROJECTS_ROOT_PATH}/${project}/AGENTS|${project} AGENTS]]`,
    `   - [[${PROJECTS_ROOT_PATH}/${project}/links|${project} links]]`
  ]);

  return [
    "## AI 进入规则",
    ...workflowLinks,
    ...(projectLinks.length > 0 ? projectLinks : ["   - 待补充"]),
    "- 只读取与本任务直接相关的输入材料和源码文件。"
  ].join("\n");
}

function buildWorkflowRequiredReadingSection(
  workflowPath: string,
  projects: string[],
  vaultRoot: string | undefined
): string {
  const absoluteWorkflowEntry = renderAbsoluteVaultPath(vaultRoot, `${workflowPath}/AGENTS.md`);
  const lines = [
    "## 按需资料",
    `- 本 workflow 入口：\`${absoluteWorkflowEntry}\`。`,
    `- 需求和确认项：[[${workflowPath}/overview|overview]]。`,
    `- 待办：[[${workflowPath}/todo|todo]]。`,
    "- 需要项目稳定知识时读取：",
    ...(projects.length > 0
      ? projects.map((project) => `   - [[${PROJECTS_ROOT_PATH}/${project}/AGENTS|${project} AGENTS]]`)
      : ["   - 待补充"]),
    "- 需要源码路径或文档入口时读取：",
    ...(projects.length > 0
      ? projects.map((project) => `   - [[${PROJECTS_ROOT_PATH}/${project}/links|${project} links]]`)
      : ["   - 待补充"]),
    "- 只读取与本任务直接相关的输入材料和源码文件。"
  ];

  return lines.join("\n");
}

function renderRelatedProjectRouteLine(projects: string[]): string {
  if (projects.length === 0) {
    return "- 关联项目：待补充";
  }

  const links = projects.flatMap((project) => [
    `[${project} AGENTS](../../${PROJECTS_ROOT_PATH}/${project}/AGENTS.md)`,
    `[${project} links](../../${PROJECTS_ROOT_PATH}/${project}/links.md)`
  ]);
  return `- 关联项目：${links.join("、")}`;
}

function renderAbsoluteVaultPath(vaultRoot: string | undefined, path: string): string {
  const normalizedVaultRoot = normalizeVaultRoot(vaultRoot);
  return normalizedVaultRoot ? `${normalizedVaultRoot}/${path}` : path;
}

function replaceMarkdownSection(content: string, heading: string, nextSection: string): string {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);

  if (startIndex === -1) {
    return `${content.trimEnd()}\n\n${nextSection}\n`;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return [
    ...lines.slice(0, startIndex),
    nextSection,
    ...lines.slice(endIndex)
  ].join("\n");
}

function removeMarkdownSections(content: string, headings: string[]): string {
  return headings.reduce((nextContent, heading) => replaceMarkdownSection(nextContent, heading, ""), content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBoardTasks(plan: WorkflowPlan): PlanTask[] {
  if (plan.action !== PlanAction.CreateWorkflow || !plan.workflow_slug) {
    return plan.tasks ?? [];
  }

  const workflowPath = `${WORKFLOWS_ROOT_PATH}/${plan.workflow_slug}`;
  const workflowEntry = `${workflowPath}/AGENTS.md`;

  return (plan.tasks ?? []).map((task) => ({
    ...task,
    link: task.link === workflowPath ? workflowEntry : task.link
  }));
}

function getRelatedProjects(plan: WorkflowPlan): string[] {
  const projects = new Set<string>();

  for (const project of plan.related_projects ?? []) {
    if (project.trim()) {
      projects.add(project.trim());
    }
  }

  if (plan.project?.trim()) {
    projects.add(plan.project.trim());
  }

  return [...projects];
}

function renderProjectFrontmatter(projects: string[]): string {
  if (projects.length === 0) {
    return "project: []";
  }

  return ["project:", ...projects.map((project) => `  - ${formatYamlScalar(project)}`)].join("\n");
}

function formatYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function getTaskFilesToCreate(plan: WorkflowPlan): PlanTask[] {
  if (plan.action !== PlanAction.CreateTask && plan.action !== PlanAction.CreateGeneralTask) {
    return [];
  }

  const movedTargets = new Set((plan.moves ?? []).map((move) => move.to));

  return (plan.tasks ?? []).filter(
    (task) =>
      Boolean(task.link) &&
      task.link!.endsWith(".md") &&
      (PROJECT_TASK_ENTRY_PATH_PATTERN.test(task.link!) || GENERAL_TASK_PATH_PATTERN.test(task.link!)) &&
      !movedTargets.has(task.link!)
  );
}

function resolveTaskScope(plan: WorkflowPlan): TaskScope {
  if (plan.task_scope) {
    return plan.task_scope;
  }

  if (plan.action === PlanAction.CreateGeneralTask) {
    return TaskScope.General;
  }

  if (plan.action === PlanAction.CreateWorkflow) {
    return TaskScope.Workflow;
  }

  return TaskScope.Project;
}

function renderProjectTaskFile(
  plan: WorkflowPlan,
  task: PlanTask,
  vaultRoot: string | undefined,
  metadata: { id: string; createdAt: string }
): string {
  const { title } = parsePlanTaskText(task.text);
  const projectLink = plan.project ? `[${plan.project}](../../../../index.md)` : "";
  const taskLink = task.link ?? "";
  const taskFolder = parentPath(taskLink);
  const projectRootPath = plan.project ? `${PROJECTS_ROOT_PATH}/${plan.project}` : "";
  const projectAgentsLink = plan.project ? `[${plan.project} AGENTS](../../../../AGENTS.md)` : "";
  const projectLinksLink = plan.project ? `[${plan.project} links](../../../../links.md)` : "";
  const absoluteVaultRoot = normalizeVaultRoot(vaultRoot);
  const absoluteTaskPath = absoluteVaultRoot && taskLink ? `${absoluteVaultRoot}/${taskLink}` : "";
  const frontmatter: TaskFileMetadata = {
    id: metadata.id,
    type: TaskScope.Project,
    status: plan.task_status,
    project: plan.project ?? undefined,
    title,
    created: metadata.createdAt,
    priority: undefined,
    entry_type: "project_input",
    task_type: plan.workflow_type ?? undefined
  };
  const lines = [
    renderTaskFileFrontmatter(frontmatter).trimEnd(),
    "",
    `# ${title}`,
    "",
    "## 当前任务",
    "",
    "- 类型：project",
    projectLink ? `- 关联项目：${projectLink}` : "- 关联项目：待补充",
    "- 概览与确认：[overview](overview.md)",
    "- 执行记录：[execution](execution.md)",
    "- 发布准备：[release-prep](release-prep.md)",
    "- 规则：[task-routing](../../../../../../rules/task-routing.md)、[writeback](../../../../../../rules/writeback.md)、[workflow-policy](../../../../../../rules/workflow-policy.md)",
    "",
    "## 路由",
    "",
    "- 上下文根：本任务目录，非源码仓库。",
    "- 按需读取：`overview.md` 看需求和确认项；需要项目稳定知识时读关联项目入口；需要开发时再读相关源码。",
    "- 源码仓库：待从关联项目 `links.md` 读取",
    "- 目标模块：待填写",
    "- 预计修改范围：待填写",
    "- 目标分支：待填写",
  ];

  lines.push(
    projectRootPath
      ? `- 关联项目：${projectAgentsLink}、${projectLinksLink}`
      : "- 关联项目：待确认",
    ...(absoluteTaskPath ? [`- 绝对入口：\`${absoluteTaskPath}\``] : []),
    "",
    "## 门槛",
    "",
    "- 目标分支为空或 `待填写` 时，不要开始改源码。",
    "- `overview.md` 若有 `状态：待确认` 项，先请用户确认。",
    ""
  );

  return lines.join("\n");
}

function renderProjectTaskOverview(plan: WorkflowPlan, task: PlanTask): string {
  const { title, notes } = parsePlanTaskText(task.text);
  const projectLinks = plan.project ? [`- [${plan.project}](../../../../index.md)`] : ["- 待补充"];
  const taskFolder = parentPath(task.link ?? "");
  const inputLinks = (plan.moves ?? [])
    .filter((move) => Boolean(taskFolder) && move.to.startsWith(`${taskFolder}/inputs/`))
    .map((move) => {
      const relativePath = stripPrefix(move.to, `${taskFolder}/`);
      return `- [${relativePath}](${relativePath})`;
    });

  return [
    `# ${title}`,
    "",
    "## 背景",
    "",
    notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "- 待补充",
    "",
    "## 目标",
    "",
    `- ${title || "待补充"}`,
    "",
    "## 非目标",
    "",
    "- 待补充",
    "",
    "## 影响范围",
    "",
    ...projectLinks,
    "",
    "## 输入材料",
    "",
    ...(inputLinks.length > 0 ? inputLinks : ["- 待补充"]),
    "",
    ...renderExecutionPrecheckLines(),
    "",
    "## 当前结论",
    "",
    "- 待补充",
    "",
    "## 已确认事实",
    "",
    "- 待补充",
    "",
    "## 待确认问题",
    "",
    "- 待补充",
    ""
  ].join("\n");
}

function renderExecutionPrecheckLines(): string[] {
  return [
    "## 执行前确认",
    "",
    "### target_branch",
    "- 状态：待确认",
    "- 内容：确认目标开发分支",
    "- AI 建议：待生成",
    "- 用户选择：待填写",
    "- 结果：待填写",
    "",
    "### related_knowledge",
    "- 状态：待确认",
    "- 内容：确认是否关联跨项目知识",
    "- AI 建议：待生成",
    "- 用户选择：待填写",
    "- 结果：待填写",
    "",
    "## 确认记录",
    "",
    "- 待补充"
  ];
}

function renderExecutionFile(): string {
  return [
    "# 执行记录",
    "",
    "## 当前结果",
    "- 修改文件：",
    "- 验证方式：",
    "- 风险：",
    "- 后续待办：",
    ""
  ].join("\n");
}

function renderGeneralTaskFile(
  plan: WorkflowPlan,
  task: PlanTask,
  vaultRoot: string | undefined,
  metadata: { id: string; createdAt: string }
): string {
  const { title, notes } = parsePlanTaskText(task.text);
  const due = title.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const cleanTitle = title.replace(/\bdue:\d{4}-\d{2}-\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  const taskLink = task.link ?? "";
  const absoluteVaultRoot = normalizeVaultRoot(vaultRoot);
  const absoluteTaskPath = absoluteVaultRoot && taskLink ? `${absoluteVaultRoot}/${taskLink}` : "";
  const frontmatter: TaskFileMetadata = {
    id: metadata.id,
    type: TaskScope.General,
    status: plan.task_status,
    title: cleanTitle || title,
    created: metadata.createdAt,
    due,
    entry_type: "general_task"
  };
  const lines = [
    renderTaskFileFrontmatter(frontmatter).trimEnd(),
    "",
    `# ${cleanTitle || title}`,
    "",
    `- 创建时间：${metadata.createdAt}`,
    "",
    "## AI 上下文根",
    "",
    "本任务文件是通用待办上下文根；通用待办不默认进入源码开发。",
    "",
    "## 按需资料",
    "",
    `- 本任务入口：\`${absoluteTaskPath || taskLink || "本文件"}\`。`,
    "- 如需转为项目任务或 workflow，先让用户确认归属和目标开发分支。",
    "",
    "## 任务说明",
    "",
    notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : cleanTitle || title,
    "",
    "## 执行结果",
    "",
    "- 完成情况：",
    "- 后续待办：",
    ""
  ];

  return lines.join("\n");
}

function normalizeVaultRoot(vaultRoot: string | undefined): string {
  return (vaultRoot ?? "").trim().replace(/\/+$/, "");
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function stripPrefix(path: string, prefix: string): string {
  return path.slice(prefix.length).replace(/^\/+/, "");
}

function isLocalRulesPath(path: string): boolean {
  return path === "rules" || path.startsWith("rules/");
}

function prependIdToPath(path: string | null | undefined, id: string): string | undefined {
  if (!path || !id) {
    return path ?? undefined;
  }

  if (path.endsWith("/AGENTS.md") || path.endsWith("/index.md")) {
    const entryFileName = path.endsWith("/AGENTS.md") ? "AGENTS.md" : "index.md";
    const folder = path.slice(0, -`/${entryFileName}`.length);
    const lastSlash = folder.lastIndexOf("/");
    if (lastSlash === -1) {
      return path;
    }
    return `${folder.slice(0, lastSlash + 1)}${id}-${folder.slice(lastSlash + 1)}/${entryFileName}`;
  }

  if (path.endsWith(".md")) {
    const base = path.slice(0, -3);
    const lastSlash = base.lastIndexOf("/");
    if (lastSlash === -1) {
      return `${id}-${base}.md`;
    }
    return `${base.slice(0, lastSlash + 1)}${id}-${base.slice(lastSlash + 1)}.md`;
  }

  return path;
}
