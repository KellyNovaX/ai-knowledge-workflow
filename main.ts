import { FuzzySuggestModal, Menu, Notice, Platform, Plugin, requireApiVersion, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { z } from "zod";
import { PLUGIN_ID, PLUGIN_NAME } from "./src/constants";
import {
  AiKnowledgeWorkflowSettingTab,
  DEFAULT_SETTINGS,
  normalizeLayoutDirection,
  normalizeTaskStatus,
  normalizeTerminalApp
} from "./src/settings";
import {
  AiKnowledgeWorkflowSettings,
  TaskScope,
  ModelProviderType,
  ValidationIssue,
  ValidationSeverity
} from "./src/types";
import {
  PlanExecutionConfirmation,
  PlanExecutor
} from "./src/plans/PlanExecutor";
import { PlanPreviewDecision, showPlanPreview } from "./src/ui/PlanPreviewModal";
import {
  buildDirectTaskPlan,
  buildDirectGeneralTaskPlan,
  buildDirectWorkflowPlan,
  collectDirectTaskInput,
  collectDirectGeneralTaskInput,
  collectDirectWorkflowInput,
  DirectTaskInput,
  DirectGeneralTaskInput,
  DirectWorkflowInput
} from "./src/ui/DirectPlanModal";
import { VaultScanner } from "./src/vault/VaultScanner";
import { VaultValidator } from "./src/vault/VaultValidator";
import { VaultInitializer } from "./src/vault/VaultInitializer";
import { TaskCompleter } from "./src/vault/TaskCompleter";
import {
  CompleteTaskDecision,
  confirmTaskCompletion,
  selectCompletableTask
} from "./src/ui/CompleteTaskModal";
import { BoardTask, BoardTaskWpsTarget, TASK_BOARD_PATH, TASK_DONE_PATH } from "./src/vault/TaskBoard";
import {
  ValidateResultView,
  VALIDATE_RESULT_VIEW_TYPE
} from "./src/ui/ValidateResultView";
import {
  TodoBoardView,
  TODO_BOARD_VIEW_TYPE
} from "./src/ui/TodoBoardView";
import {
  FaqView,
  FAQ_VIEW_TYPE
} from "./src/ui/FaqView";
import {
  ProjectView,
  PROJECT_VIEW_TYPE
} from "./src/ui/ProjectView";
import { ProjectCardEntry } from "./src/vault/ProjectRepository";
import { SkillActionId, SkillActions } from "./src/skills/SkillActions";
import { AiWorkspaceLauncher } from "./src/workspace/AiWorkspaceLauncher";
import { openCodexAppForProject, openCodexAppForTask, openCodexAppWithPrompt } from "./src/workspace/CodexAppLauncher";
import { DefaultAppOpener } from "./src/workspace/DefaultAppOpener";
import { openWpsChatTarget } from "./src/workspace/WpsChatOpener";
import { askTextNoteName, TextNoteModalResultKind } from "./src/ui/TextNoteModal";
import { TextNoteCreator } from "./src/vault/TextNoteCreator";
import { getConfiguredAiAgent } from "./src/agents";
import {
  buildAgentPromptForBoardTask,
  buildAgentPromptForFile,
  buildInboxOrganizePrompt
} from "./src/agents/AgentTaskPrompt";
import { INBOX_ROOT_PATH } from "./src/vault/InboxRules";
import { ConfirmDecision, confirmAction } from "./src/ui/ConfirmModal";

const manifestSchema = z.object({
  id: z.literal(PLUGIN_ID),
  name: z.literal(PLUGIN_NAME)
});

const settingsSchema = z.object({
  vaultRoot: z.string().catch(DEFAULT_SETTINGS.vaultRoot)
    .transform((value) => value.trim() || DEFAULT_SETTINGS.vaultRoot),
  provider: z.nativeEnum(ModelProviderType).catch(DEFAULT_SETTINGS.provider),
  terminalApp: z.unknown().transform(normalizeTerminalApp),
  codexCliPath: z.string().catch(DEFAULT_SETTINGS.codexCliPath),
  customCliPath: z.string().catch(DEFAULT_SETTINGS.customCliPath),
  defaultTaskStatus: z.unknown().transform(normalizeTaskStatus),
  autoValidate: z.boolean().catch(DEFAULT_SETTINGS.autoValidate),
  layoutDirection: z.unknown().transform(normalizeLayoutDirection)
}).catch(() => ({ ...DEFAULT_SETTINGS }));

enum WorkspaceViewType {
  Terminal = "terminal:terminal"
}

enum CommandId {
  OpenTodoBoard = "open-ai-knowledge-todo-board",
  OpenDoneArchive = "open-ai-knowledge-done-archive",
  OpenProjects = "open-ai-knowledge-projects",
  OpenFaq = "open-ai-knowledge-faq",
  ValidateVault = "validate-vault",
  InitializeVault = "initialize-vault",
  CreateWorkflow = "create-workflow",
  AddTask = "add-task",
  AddGeneralTask = "add-general-task",
  CompleteTask = "complete-task",
  CopyActiveFileToAgent = "copy-active-file-to-agent",
  ValidateActiveTaskForDevelopment = "validate-active-task-for-development",
  RepairTaskContextStructure = "repair-task-context-structure",
  MoveTask = "move-task",
  OrganizeInboxFolderWithAgent = "organize-inbox-folder-with-agent",
  OrganizeInboxFolderWithCodexApp = "organize-inbox-folder-with-codex-app",
  CopyInboxFolderOrganizePrompt = "copy-inbox-folder-organize-prompt",
  OpenSettings = "open-settings"
}

export default class AiKnowledgeWorkflowPlugin extends Plugin {
  settings: AiKnowledgeWorkflowSettings;
  private aiWorkspaceLaunchInProgress = false;

  async onload(): Promise<void> {
    manifestSchema.parse(this.manifest);
    await this.loadSettings();
    this.addSettingTab(new AiKnowledgeWorkflowSettingTab(this.app, this));
    this.registerExtensions(["txt"], "markdown");

    this.registerView(
      VALIDATE_RESULT_VIEW_TYPE,
      (leaf) => new ValidateResultView(leaf)
    );
    this.registerView(
      TODO_BOARD_VIEW_TYPE,
      (leaf) => new TodoBoardView(leaf, this.buildTodoBoardActions())
    );
    this.registerView(
      FAQ_VIEW_TYPE,
      (leaf) => new FaqView(leaf, this.buildFaqViewActions())
    );
    this.registerView(
      PROJECT_VIEW_TYPE,
      (leaf) => new ProjectView(leaf, this.buildProjectViewActions())
    );

    this.addRibbonIcon("list-checks", "AI Knowledge todo board", () => {
      void this.activateTodoBoard();
    });
    this.addRibbonIcon("folder-tree", "AI Knowledge projects", () => {
      void this.activateProjects();
    });
    this.addRibbonIcon("badge-help", "AI Knowledge FAQ", () => {
      void this.activateFaq();
    });
    this.addCommand({
      id: CommandId.OpenTodoBoard,
      name: "AI Knowledge: Open todo board",
      callback: () => {
        void this.activateTodoBoard();
      }
    });

    this.addCommand({
      id: CommandId.OpenDoneArchive,
      name: "AI Knowledge: Open completed tasks",
      callback: () => {
        void this.openDoneArchive();
      }
    });

    this.addCommand({
      id: CommandId.OpenFaq,
      name: "AI Knowledge: Open FAQ",
      callback: () => {
        void this.activateFaq();
      }
    });

    this.addCommand({
      id: CommandId.OpenProjects,
      name: "AI Knowledge: Open projects",
      callback: () => {
        void this.activateProjects();
      }
    });

    this.addCommand({
      id: CommandId.ValidateVault,
      name: "AI Knowledge: Validate vault",
      callback: async () => {
        await this.validateVault();
      }
    });

    this.addCommand({
      id: CommandId.InitializeVault,
      name: "AI Knowledge: Initialize vault structure",
      callback: async () => {
        await this.initializeVaultStructure();
      }
    });

    this.addCommand({
      id: CommandId.CreateWorkflow,
      name: "AI Knowledge: Create workflow",
      callback: async () => {
        await this.addDirectWorkflow();
      }
    });

    this.addCommand({
      id: CommandId.AddTask,
      name: "AI Knowledge: Create project task",
      callback: async () => {
        await this.addDirectTask();
      }
    });

    this.addCommand({
      id: CommandId.AddGeneralTask,
      name: "AI Knowledge: Add general task",
      callback: async () => {
        await this.addDirectGeneralTask();
      }
    });

    this.addCommand({
      id: CommandId.CompleteTask,
      name: "AI Knowledge: Complete task",
      callback: async () => {
        await this.completeTask();
      }
    });

    this.addCommand({
      id: CommandId.CopyActiveFileToAgent,
      name: "AI Knowledge: Copy active file to agent",
      callback: async () => {
        await this.copyActiveFileToAgent();
      }
    });

    this.addCommand({
      id: CommandId.ValidateActiveTaskForDevelopment,
      name: "AI Knowledge: Validate active task for development",
      callback: async () => {
        await this.validateActiveTaskForDevelopment();
      }
    });

    this.addCommand({
      id: CommandId.RepairTaskContextStructure,
      name: "AI Knowledge: Repair task context structure",
      callback: async () => {
        await this.repairTaskContextStructure();
      }
    });

    this.addCommand({
      id: CommandId.MoveTask,
      name: "AI Knowledge: Move task",
      callback: async () => {
        await this.activateTodoBoard();
      }
    });

    this.addCommand({
      id: CommandId.OrganizeInboxFolderWithAgent,
      name: "AI Knowledge: Organize inbox folder with agent",
      callback: async () => {
        await this.organizeInboxFolderWithAgent();
      }
    });

    this.addCommand({
      id: CommandId.OrganizeInboxFolderWithCodexApp,
      name: "AI Knowledge: Organize inbox folder with Codex app",
      callback: async () => {
        await this.organizeInboxFolderWithCodexApp();
      }
    });

    this.addCommand({
      id: CommandId.CopyInboxFolderOrganizePrompt,
      name: "AI Knowledge: Copy inbox folder organize prompt",
      callback: async () => {
        await this.copyInboxFolderOrganizePrompt();
      }
    });

    this.addCommand({
      id: CommandId.OpenSettings,
      name: "AI Knowledge: Open settings",
      callback: () => {
        this.openSettings();
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        this.addFileMenuItems(menu, file);
      })
    );
  }

  async loadSettings(): Promise<void> {
    const savedSettings: unknown = await this.loadData();
    this.settings = settingsSchema.parse(savedSettings);
  }

  async saveSettings(): Promise<void> {
    const savedData: unknown = await this.loadData();
    const pluginData = z.record(z.unknown()).catch({}).parse(savedData);
    await this.saveData({ ...pluginData, ...this.settings });
  }

  private async initializeVaultStructure(): Promise<void> {
    const initializer = new VaultInitializer(this.app);
    const preview = await initializer.preview();
    const missingEntries = [...preview.missingFolders, ...preview.missingFiles];

    if (missingEntries.length === 0) {
      new Notice("AI Knowledge vault structure is already initialized.");
      return;
    }

    const visibleEntries = missingEntries.slice(0, 12);
    const remainingCount = missingEntries.length - visibleEntries.length;
    const message = [
      `Create ${preview.missingFolders.length} missing folders and ${preview.missingFiles.length} missing files.`,
      "Existing files will not be overwritten.",
      ...visibleEntries.map((path) => `- ${path}`),
      ...(remainingCount > 0 ? [`- ...and ${remainingCount} more`] : [])
    ].join("\n");
    const decision = await confirmAction(
      this.app,
      "Initialize AI Knowledge Vault",
      message,
      "Create missing structure"
    );

    if (decision !== ConfirmDecision.Confirm) {
      new Notice("Vault initialization cancelled.");
      return;
    }

    const result = await initializer.initialize();
    new Notice(
      `Vault initialized: ${result.createdFolders.length} folders and ${result.createdFiles.length} files created.`
    );
    await this.validateVault();
  }

  private async validateVault(): Promise<void> {
    const scanner = new VaultScanner(this.app);
    const validator = new VaultValidator();
    const index = await scanner.scanVault();
    const issues = validator.validateVault(index);
    await this.showValidateResults(issues);

    if (issues.length === 0) {
      new Notice("AI Knowledge vault validation passed: no issues found.");
      return;
    }

    const blockers = countBySeverity(issues, ValidationSeverity.Blocker);
    const errors = countBySeverity(issues, ValidationSeverity.Error);
    const warnings = countBySeverity(issues, ValidationSeverity.Warning);
    const infos = countBySeverity(issues, ValidationSeverity.Info);

    new Notice(
      `AI Knowledge vault validation found ${issues.length} issue(s): ` +
        `${blockers} blocker, ${errors} error, ${warnings} warning, ${infos} info.`
    );
  }

  private async addDirectTask(): Promise<void> {
    let draft: DirectTaskInput | undefined;

    for (;;) {
      const input = await collectDirectTaskInput(this.app, draft);

      if (!input) {
        return;
      }

      draft = input;
      const decision = await this.previewAndExecuteDirectPlan(buildDirectTaskPlan(input), true);

      if (decision !== PlanPreviewDecision.Back) {
        return;
      }
    }
  }

  private async addDirectGeneralTask(): Promise<void> {
    let draft: DirectGeneralTaskInput | undefined;

    for (;;) {
      const input = await collectDirectGeneralTaskInput(this.app, draft);

      if (!input) {
        return;
      }

      draft = input;
      const decision = await this.previewAndExecuteDirectPlan(buildDirectGeneralTaskPlan(input), true);

      if (decision !== PlanPreviewDecision.Back) {
        return;
      }
    }
  }

  private async addDirectWorkflow(): Promise<void> {
    let draft: DirectWorkflowInput | undefined;

    for (;;) {
      const input = await collectDirectWorkflowInput(this.app, draft);

      if (!input) {
        return;
      }

      draft = input;
      const decision = await this.previewAndExecuteDirectPlan(buildDirectWorkflowPlan(input), true);

      if (decision !== PlanPreviewDecision.Back) {
        return;
      }
    }
  }

  private async previewAndExecuteDirectPlan(
    plan: Parameters<PlanExecutor["previewPlanExecution"]>[0],
    canGoBack = false
  ): Promise<PlanPreviewDecision> {
    const executor = new PlanExecutor(this.app, { vaultRoot: this.settings.vaultRoot });
    const preview = await executor.previewPlanExecution(plan);
    const decision = await showPlanPreview(this.app, plan, preview, { canGoBack });

    if (decision === PlanPreviewDecision.Back) {
      return decision;
    }

    if (decision !== PlanPreviewDecision.Confirm) {
      new Notice("Plan execution cancelled.");
      return decision;
    }

    if (!preview.canExecute) {
      new Notice("Plan has blocking dry-run issues and was not executed.");
      return decision;
    }

    const result = await executor.executePlan(plan, PlanExecutionConfirmation.Confirmed);

    if (!result.executed) {
      new Notice(result.error ?? "Plan execution blocked.");
      return decision;
    }

    new Notice(`Plan executed. Validation issues: ${result.validationIssues.length}.`);
    return decision;
  }

  private buildTodoBoardActions() {
    return {
      openTasks: async () => this.activateTodoBoard(),
      openProjects: async () => this.activateProjects(),
      openFaq: async () => this.activateFaq(),
      validateVault: async () => this.validateVault(),
      createWorkflow: async () => this.addDirectWorkflow(),
      addTask: async () => this.addDirectTask(),
      addGeneralTask: async () => this.addDirectGeneralTask(),
      completeTask: async () => this.completeTask(),
      openDoneArchive: async () => this.openDoneArchive(),
      copyTaskToAgent: async (task: BoardTask) => this.copyTaskToAgent(task),
      openTaskInAgent: async (task: BoardTask) => this.openTaskInAgent(task),
      openTaskInCodexApp: async (task: BoardTask) => this.openTaskInCodexApp(task),
      openWpsChat: Platform.isMacOS ? async (target: BoardTaskWpsTarget) => this.openWpsChat(target) : undefined,
      runSkillAction: async (actionId: SkillActionId) => this.runSkillAction(actionId),
      openAiAgentInVault: async () => this.openAiAgentInVault(),
      openSettings: () => this.openSettings()
    };
  }

  private buildFaqViewActions() {
    return {
      openTasks: async () => this.activateTodoBoard(),
      openProjects: async () => this.activateProjects(),
      openFaq: async () => this.activateFaq()
    };
  }

  private buildProjectViewActions() {
    return {
      openTasks: async () => this.activateTodoBoard(),
      openProjects: async () => this.activateProjects(),
      openFaq: async () => this.activateFaq(),
      openProjectInCodex: async (project: ProjectCardEntry) => this.openProjectInCodex(project),
      openProjectInCustomCli: async (project: ProjectCardEntry) => this.openProjectInCustomCli(project)
    };
  }

  private async completeTask(): Promise<void> {
    const completer = new TaskCompleter(this.app);
    const tasks = await completer.listCompletableTasks();

    if (tasks.length === 0) {
      new Notice("No incomplete doing/todo/pending release tasks found.");
      return;
    }

    const task = await selectCompletableTask(this.app, tasks);

    if (!task) {
      return;
    }

    const preview = completer.createPreview(task);
    const decision = await confirmTaskCompletion(this.app, preview);

    if (decision !== CompleteTaskDecision.Confirm) {
      new Notice("Task completion cancelled.");
      return;
    }

    try {
      await completer.completeTask(task);
      new Notice("Task archived to completed tasks.");
      await this.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Complete Task failed: ${message}`);
      console.error("AI Knowledge: Complete Task failed", error);
    }
  }

  private async runSkillAction(actionId: SkillActionId): Promise<void> {
    await new SkillActions(this.app, {
      settings: this.settings,
      validateVault: async () => this.validateVault()
    }).run(actionId);
  }

  private async openAiAgentInVault(): Promise<void> {
    if (this.aiWorkspaceLaunchInProgress) {
      new Notice("AI workspace is already opening.");
      return;
    }

    this.aiWorkspaceLaunchInProgress = true;

    const agent = getConfiguredAiAgent(this.settings);

    if (!agent) {
      new Notice("Configure AI agent in AI Knowledge Workflow settings before opening a terminal.");
      this.aiWorkspaceLaunchInProgress = false;
      return;
    }

    try {
      await new AiWorkspaceLauncher(this.app).openVaultInTerminal(
        agent.command,
        this.settings.terminalApp,
        this.settings.vaultRoot,
        TASK_BOARD_PATH
      );
      new Notice("Opened AI agent in vault.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open AI workspace: ${message}`);
      console.error("AI Knowledge: Open AI Agent in Vault failed", error);
    } finally {
      window.setTimeout(() => {
        this.aiWorkspaceLaunchInProgress = false;
      }, 1500);
    }
  }

  private async copyTaskToAgent(task: BoardTask): Promise<void> {
    await copyTextToClipboard(buildAgentPromptForBoardTask(task, this.settings.vaultRoot));
    new Notice("Copied task prompt for AI agent.");
  }

  private async openTaskInAgent(task: BoardTask): Promise<void> {
    if (this.aiWorkspaceLaunchInProgress) {
      new Notice("AI workspace is already opening.");
      return;
    }

    const agent = getConfiguredAiAgent(this.settings);

    if (!agent) {
      new Notice("Configure AI agent in AI Knowledge Workflow settings before opening a terminal.");
      return;
    }

    const target = this.resolveTaskAgentTarget(task);
    const file = this.app.vault.getAbstractFileByPath(target.filePath);

    if (!(file instanceof TFile)) {
      new Notice(`Task entry file is missing: ${target.filePath}`);
      return;
    }

    this.aiWorkspaceLaunchInProgress = true;

    try {
      const result = await new AiWorkspaceLauncher(this.app).openInTerminal({
        file,
        command: agent.command,
        terminalApp: this.settings.terminalApp,
        includeFileReference: true,
        submitCommand: false,
        vaultRootOverride: this.settings.vaultRoot,
        workspacePathOverride: target.workspacePath,
        fileReferenceOverride: target.fileReference,
        sourceEntryPath: target.filePath,
        title: task.text.split("\n")[0]?.replace(/\[\[.*?\]\]/g, "").replace(/\[.*?\]\(.*?\)/g, "").trim()
      });
      await this.openFileInBoardLeaf(file);
      this.focusLatestTerminalLeaf();
      new Notice(`Opened AI agent for task: ${result.workspacePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open AI task workspace: ${message}`);
      console.error("AI Knowledge: Open Task in Agent failed", error);
    } finally {
      window.setTimeout(() => {
        this.aiWorkspaceLaunchInProgress = false;
      }, 1500);
    }
  }

  private async openTaskInCodexApp(task: BoardTask): Promise<void> {
    if (this.aiWorkspaceLaunchInProgress) {
      new Notice("AI workspace is already opening.");
      return;
    }

    const target = this.resolveTaskAgentTarget(task);
    const file = this.app.vault.getAbstractFileByPath(target.filePath);

    if (!(file instanceof TFile)) {
      new Notice(`Task entry file is missing: ${target.filePath}`);
      return;
    }

    const absoluteVaultRoot = this.getConfiguredVaultRoot();
    const absoluteWorkspacePath = target.workspacePath
      ? `${absoluteVaultRoot}/${target.workspacePath}`
      : absoluteVaultRoot;

    this.aiWorkspaceLaunchInProgress = true;

    try {
      await openCodexAppForTask({
        absoluteWorkspacePath,
        fileReference: target.fileReference
      });
      new Notice(`Opened new Codex chat for task: ${target.workspacePath || "."}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open Codex App: ${message}`);
      console.error("AI Knowledge: Open Task in Codex App failed", error);
    } finally {
      window.setTimeout(() => {
        this.aiWorkspaceLaunchInProgress = false;
      }, 1500);
    }
  }

  private async openProjectInCodex(project: ProjectCardEntry): Promise<void> {
    try {
      await openCodexAppForProject({ absoluteWorkspacePath: this.resolveProjectWorkspacePath(project.path) });
      new Notice(`Opened Codex App for project: ${project.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open Codex App: ${message}`);
      console.error("AI Knowledge: Open Project in Codex App failed", error);
    }
  }

  private async openProjectInCustomCli(project: ProjectCardEntry): Promise<void> {
    if (!this.settings.customCliPath.trim()) {
      new Notice("Configure custom CLI command in AI Knowledge Workflow settings before opening a project terminal.");
      return;
    }
    try {
      await new AiWorkspaceLauncher(this.app).openAbsolutePathInTerminal(
        this.resolveProjectWorkspacePath(project.path),
        this.settings.customCliPath,
        this.settings.terminalApp,
        project.name,
        this.resolveProjectMainFilePath(project.path)
      );
      new Notice(`Opened Custom CLI for project: ${project.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open Custom CLI: ${message}`);
      console.error("AI Knowledge: Open Project in Custom CLI failed", error);
    }
  }

  private resolveProjectWorkspacePath(projectPath: string): string {
    return `${this.getConfiguredVaultRoot()}/${projectPath}`;
  }

  private resolveProjectMainFilePath(projectPath: string): string {
    const agentsPath = `${projectPath}/AGENTS.md`;
    const indexPath = `${projectPath}/index.md`;

    if (this.app.vault.getAbstractFileByPath(agentsPath) instanceof TFile) {
      return agentsPath;
    }

    return indexPath;
  }

  private async openWpsChat(target: BoardTaskWpsTarget): Promise<void> {
    try {
      const result = await openWpsChatTarget(target);
      new Notice(
        result.copiedSearchText
          ? result.filledSearchText
            ? `已打开 WPS 协作，并填入搜索词：${target.label}`
            : `已打开 WPS 协作，并复制搜索词：${target.label}`
          : `已打开 WPS 协作：${target.label}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`打开 WPS 协作失败：${message}`);
      console.error("AI Knowledge: Open WPS chat failed", error);
    }
  }

  private async copyActiveFileToAgent(): Promise<void> {
    const file = this.app.workspace.getActiveFile();

    if (!file) {
      new Notice("No active file to copy.");
      return;
    }

    await this.copyFileToAgent(file);
  }

  private async validateActiveTaskForDevelopment(): Promise<void> {
    const file = this.app.workspace.getActiveFile();

    if (!file) {
      new Notice("No active task file to validate.");
      return;
    }

    const content = await this.app.vault.adapter.read(file.path);
    const issues = getDevelopmentReadinessIssues(file.path, content);

    if (issues.length === 0) {
      new Notice("Active task is ready for source development.");
      return;
    }

    await copyTextToClipboard(issues.map((issue) => `- ${issue}`).join("\n"));
    new Notice(`Active task is not ready for source development: ${issues.length} issue(s). Details copied.`);
  }

  private resolveTaskAgentTarget(task: BoardTask): {
    filePath: string;
    workspacePath: string;
    fileReference: string;
  } {
    if (task.taskScope === TaskScope.Workflow) {
      const workflowLink = task.links.find((link) => link.target.startsWith("20-workflows/"))?.target;
      const filePath = normalizeWorkflowEntryPath(workflowLink);
      return {
        filePath,
        workspacePath: parentPath(filePath),
        fileReference: basename(filePath)
      };
    }

    if (task.taskScope === TaskScope.Project) {
      const projectLink = task.links.find((link) => link.target.startsWith("30-projects/"))?.target;
      const filePath = normalizeProjectTaskEntryPath(projectLink);
      return {
        filePath,
        workspacePath: parentPath(filePath),
        fileReference: basename(filePath)
      };
    }

    return {
      filePath: TASK_BOARD_PATH,
      workspacePath: "",
      fileReference: `${TASK_BOARD_PATH}:${task.line}`
    };
  }

  private async openFileInBoardLeaf(file: TFile): Promise<void> {
    await this.openFileInDocumentLeaf(file);
  }

  private async openDoneArchive(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(TASK_DONE_PATH);
    if (!(file instanceof TFile)) {
      new Notice(`Completed task archive is missing: ${TASK_DONE_PATH}`);
      return;
    }

    await this.openFileInDocumentLeaf(file);
  }

  private async openFileInDocumentLeaf(
    file: TFile,
    openState?: Parameters<WorkspaceLeaf["openFile"]>[1]
  ): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, openState);
    if (requireApiVersion("1.7.2")) {
      await this.app.workspace.revealLeaf(leaf);
    } else {
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  private getConfiguredVaultRoot(): string {
    const configuredRoot = this.settings.vaultRoot.trim();

    if (configuredRoot) {
      return configuredRoot.replace(/\/+$/, "");
    }

    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const basePath = adapter.getBasePath?.();

    if (!basePath) {
      throw new Error("Vault root path is unavailable. Configure Vault root in plugin settings.");
    }

    return basePath.replace(/\/+$/, "");
  }

  private async activateTodoBoard(): Promise<void> {
    await this.activatePluginView(TODO_BOARD_VIEW_TYPE);
  }

  private async activateProjects(): Promise<void> {
    await this.activatePluginView(PROJECT_VIEW_TYPE);
  }

  private async activateFaq(): Promise<void> {
    await this.activatePluginView(FAQ_VIEW_TYPE);
  }

  private async activatePluginView(viewType: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) {
      await leaf.setViewState({ type: viewType, active: true });
    }
    if (requireApiVersion("1.7.2")) {
      await this.app.workspace.revealLeaf(leaf);
    } else {
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  private async showValidateResults(
    issues: ValidationIssue[]
  ): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VALIDATE_RESULT_VIEW_TYPE);
    let leaf: WorkspaceLeaf;

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      const rightLeaf = this.app.workspace.getRightLeaf(false);
      if (!rightLeaf) {
        new Notice("Unable to open validation result view.");
        return;
      }
      leaf = rightLeaf;
      await leaf.setViewState({ type: VALIDATE_RESULT_VIEW_TYPE, active: true });
    }

    const view = leaf.view;
    if (view instanceof ValidateResultView) {
      view.setIssues(issues);
    }
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    this.addTextNoteMenuItems(menu, file);
    this.addInboxOrganizeMenuItems(menu, file);
    this.addAiWorkspaceMenuItems(menu, file);
    this.addCopyToAgentMenuItems(menu, file);
    if (file instanceof TFile) {
      menu.addItem((item) => item
        .setTitle("Open with system default app")
        .setIcon("external-link")
        .onClick(async () => {
          try {
            await new DefaultAppOpener(this.app).openFile(file);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to open file with default app: ${message}`);
          }
        }));
    }
  }

  private addInboxOrganizeMenuItems(menu: Menu, file: TAbstractFile): void {
    if (!isInboxOrganizeTarget(file)) {
      return;
    }

    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(file instanceof TFolder ? "Organize This Inbox Folder with Agent" : "Organize This Inbox with Agent")
        .setIcon("terminal")
        .onClick(() => {
          void this.organizeInboxTargetWithAgent(file);
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(file instanceof TFolder ? "Organize This Inbox Folder with Codex App" : "Organize This Inbox with Codex App")
        .setIcon("app-window")
        .onClick(() => {
          void this.organizeInboxTargetWithCodexApp(file);
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(file instanceof TFolder ? "Copy Inbox Folder Organize Prompt" : "Copy Inbox Organize Prompt")
        .setIcon("copy")
        .onClick(() => {
          void this.copyInboxOrganizePrompt(file);
        });
    });
  }

  private addCopyToAgentMenuItems(menu: Menu, file: TAbstractFile): void {
    if (!(file instanceof TFile)) {
      return;
    }

    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("Copy this task to agent")
        .setIcon("copy")
        .onClick(() => {
          void this.copyFileToAgent(file);
        });
    });
  }

  private focusLatestTerminalLeaf(): void {
    const terminalLeaves = this.app.workspace.getLeavesOfType(WorkspaceViewType.Terminal);
    const terminalLeaf = terminalLeaves[terminalLeaves.length - 1];

    if (!terminalLeaf) {
      return;
    }

    this.app.workspace.setActiveLeaf(terminalLeaf, { focus: true });
    const terminal = (terminalLeaf.view as unknown as {
      emulator?: {
        terminal?: {
          focus(): void;
        };
      };
    }).emulator?.terminal;
    terminal?.focus();
  }

  private async copyFileToAgent(file: TFile): Promise<void> {
    await copyTextToClipboard(buildAgentPromptForFile(file, this.settings.vaultRoot));
    new Notice("Copied file prompt for AI agent.");
  }

  private async repairTaskContextStructure(): Promise<void> {
    try {
      const index = await new VaultScanner(this.app).scanVault();
      let updatedProjectLinks = 0;
      let updatedProjectTasks = 0;
      let updatedWorkflows = 0;
      let createdExecutionFiles = 0;

      for (const project of index.projects) {
        if (project.hasLinks) {
          const linksPath = `${project.path}/links.md`;
          const nextLinksContent = repairProjectLinksContent(project.linksContent);

          if (nextLinksContent !== project.linksContent) {
            await this.app.vault.adapter.write(linksPath, nextLinksContent);
            updatedProjectLinks += 1;
          }
        }

        for (const inputIndexFile of project.inputIndexFiles) {
          const nextContent = repairProjectTaskContent(inputIndexFile.content);

          if (nextContent !== inputIndexFile.content) {
            await this.app.vault.adapter.write(inputIndexFile.path, nextContent);
            updatedProjectTasks += 1;
          }

          if (await this.ensureExecutionFile(parentPath(inputIndexFile.path))) {
            createdExecutionFiles += 1;
          }
        }
      }

      for (const workflow of index.workflows) {
        if (!workflow.hasAgents) {
          continue;
        }

        const agentsPath = `${workflow.path}/AGENTS.md`;
        const nextContent = repairWorkflowAgentsContent(workflow.agentsContent);

        if (nextContent !== workflow.agentsContent) {
          await this.app.vault.adapter.write(agentsPath, nextContent);
          updatedWorkflows += 1;
        }

        if (await this.ensureExecutionFile(workflow.path)) {
          createdExecutionFiles += 1;
        }
      }

      new Notice(
        `Repaired context structure: ${updatedProjectLinks} project links, ${updatedProjectTasks} project task(s), ${updatedWorkflows} workflow(s), ${createdExecutionFiles} execution file(s).`
      );
      await this.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Repair task context structure failed: ${message}`);
      console.error("AI Knowledge: Repair Task Context Structure failed", error);
    }
  }

  private async ensureExecutionFile(folderPath: string): Promise<boolean> {
    const executionPath = `${folderPath}/execution.md`;

    if (await this.app.vault.adapter.exists(executionPath)) {
      return false;
    }

    await this.app.vault.adapter.write(executionPath, renderExecutionFile());
    return true;
  }

  private addTextNoteMenuItems(menu: Menu, file: TAbstractFile): void {
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("新建 txt 笔记")
        .setIcon("file-plus")
        .onClick(() => {
          void this.createTextNote(file);
        });
    });
  }

  private addAiWorkspaceMenuItems(menu: Menu, file: TAbstractFile): void {
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("Open AI agent here in terminal")
        .setIcon("terminal")
        .onClick(() => {
          void this.openAiWorkspace(file);
        });
    });

    if (file instanceof TFile) {
      menu.addItem((item) => {
        item
          .setTitle("Open AI agent here with @ this file")
          .setIcon("file-terminal")
          .onClick(() => {
            void this.openAiWorkspace(file, true);
          });
      });
    }
  }

  private async openAiWorkspace(
    file: TAbstractFile,
    includeFileReference = false
  ): Promise<void> {
    if (this.aiWorkspaceLaunchInProgress) {
      new Notice("AI workspace is already opening.");
      return;
    }

    this.aiWorkspaceLaunchInProgress = true;

    const agent = getConfiguredAiAgent(this.settings);

    if (!agent) {
      new Notice("Configure AI agent in AI Knowledge Workflow settings before opening a terminal.");
      this.aiWorkspaceLaunchInProgress = false;
      return;
    }

    try {
      const result = await new AiWorkspaceLauncher(this.app).openInTerminal({
        file,
        command: agent.command,
        terminalApp: this.settings.terminalApp,
        includeFileReference,
        submitCommand: !includeFileReference,
        vaultRootOverride: this.settings.vaultRoot
      });
      new Notice(`Opened AI agent workspace: ${result.workspacePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open AI workspace: ${message}`);
      console.error("AI Knowledge: Open AI Workspace failed", error);
    } finally {
      window.setTimeout(() => {
        this.aiWorkspaceLaunchInProgress = false;
      }, 1500);
    }
  }

  private async organizeInboxFolderWithAgent(): Promise<void> {
    const folder = await this.selectInboxFolder();
    if (folder) {
      await this.organizeInboxTargetWithAgent(folder);
    }
  }

  private async organizeInboxFolderWithCodexApp(): Promise<void> {
    const folder = await this.selectInboxFolder();
    if (folder) {
      await this.organizeInboxTargetWithCodexApp(folder);
    }
  }

  private async copyInboxFolderOrganizePrompt(): Promise<void> {
    const folder = await this.selectInboxFolder();
    if (folder) {
      await this.copyInboxOrganizePrompt(folder);
    }
  }

  private async organizeInboxTargetWithAgent(target: TAbstractFile): Promise<void> {
    if (this.aiWorkspaceLaunchInProgress) {
      new Notice("AI workspace is already opening.");
      return;
    }

    const agent = getConfiguredAiAgent(this.settings);

    if (!agent) {
      new Notice("Configure AI agent in AI Knowledge Workflow settings before opening a terminal.");
      return;
    }

    const prompt = this.buildInboxOrganizePromptForTarget(target);
    await copyTextToClipboard(prompt);
    this.aiWorkspaceLaunchInProgress = true;

    try {
      const result = await new AiWorkspaceLauncher(this.app).openInTerminal({
        file: target,
        command: agent.command,
        terminalApp: this.settings.terminalApp,
        includeFileReference: false,
        submitCommand: false,
        vaultRootOverride: this.settings.vaultRoot,
        workspacePathOverride: target instanceof TFolder ? target.path : parentPath(target.path),
        sourceEntryPath: target.path,
        title: `Organize ${target.name}`
      });
      new Notice(`Opened AI agent for inbox organize. Prompt copied: ${result.workspacePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open AI agent: ${message}`);
      console.error("AI Knowledge: Organize Inbox with Agent failed", error);
    } finally {
      window.setTimeout(() => {
        this.aiWorkspaceLaunchInProgress = false;
      }, 1500);
    }
  }

  private async organizeInboxTargetWithCodexApp(target: TAbstractFile): Promise<void> {
    if (this.aiWorkspaceLaunchInProgress) {
      new Notice("AI workspace is already opening.");
      return;
    }

    const prompt = this.buildInboxOrganizePromptForTarget(target);
    const absoluteVaultRoot = this.getConfiguredVaultRoot();
    const workspacePath = target instanceof TFolder ? target.path : parentPath(target.path);
    const absoluteWorkspacePath = workspacePath ? `${absoluteVaultRoot}/${workspacePath}` : absoluteVaultRoot;
    this.aiWorkspaceLaunchInProgress = true;

    try {
      await openCodexAppWithPrompt({
        absoluteWorkspacePath,
        prompt
      });
      new Notice(`Opened Codex App for inbox organize: ${workspacePath || "."}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to open Codex App: ${message}`);
      console.error("AI Knowledge: Organize Inbox with Codex App failed", error);
    } finally {
      window.setTimeout(() => {
        this.aiWorkspaceLaunchInProgress = false;
      }, 1500);
    }
  }

  private async copyInboxOrganizePrompt(target: TAbstractFile): Promise<void> {
    await copyTextToClipboard(this.buildInboxOrganizePromptForTarget(target));
    new Notice("Copied inbox organize prompt.");
  }

  private buildInboxOrganizePromptForTarget(target: TAbstractFile): string {
    const isFolder = target instanceof TFolder;
    return buildInboxOrganizePrompt({
      vaultRoot: this.settings.vaultRoot,
      inboxPath: target.path,
      mode: isFolder ? "folder" : "file",
      fileList: isFolder ? this.listInboxFolderFiles(target) : undefined
    });
  }

  private listInboxFolderFiles(folder: TFolder): string[] {
    const prefix = folder.path.endsWith("/") ? folder.path : `${folder.path}/`;
    return this.app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b));
  }

  private selectInboxFolder(): Promise<TFolder | null> {
    const folders = this.getInboxFolders();

    if (folders.length === 0) {
      new Notice("No inbox folders found.");
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      new InboxFolderSuggestModal(this.app, folders, resolve).open();
    });
  }

  private getInboxFolders(): TFolder[] {
    const folders = new Map<string, TFolder>();
    const inboxRoot = this.app.vault.getAbstractFileByPath(INBOX_ROOT_PATH.replace(/\/$/, ""));

    if (inboxRoot instanceof TFolder) {
      folders.set(inboxRoot.path, inboxRoot);
    }

    for (const file of this.app.vault.getFiles()) {
      if (!file.path.startsWith(INBOX_ROOT_PATH)) {
        continue;
      }

      const folderPath = parentPath(file.path);
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) {
        folders.set(folder.path, folder);
      }
    }

    return [...folders.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  private async createTextNote(file: TAbstractFile): Promise<void> {
    const result = await askTextNoteName(this.app);

    if (result.kind !== TextNoteModalResultKind.Submitted) {
      return;
    }

    try {
      const created = await new TextNoteCreator(this.app).createAndOpen({
        target: file,
        fileName: result.fileName
      });
      new Notice(created.openError
        ? `Created txt note: ${created.vaultPath}. Could not open it: ${created.openError}`
        : `Created txt note: ${created.vaultPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to create txt note: ${message}`);
      console.error("AI Knowledge: Create txt note failed", error);
    }
  }

  private openSettings(): void {
    const setting = (this.app as { setting?: { open(): void; openTabById(id: string): void } })
      .setting;

    if (!setting) {
      new Notice("Obsidian settings API is unavailable.");
      return;
    }

    setting.open();
    setting.openTabById(this.manifest.id);
  }
}

function normalizeWorkflowEntryPath(link: string | undefined): string {
  if (!link) {
    return TASK_BOARD_PATH;
  }

  const withoutExtension = link.replace(/\.md$/, "");

  if (/^20-workflows\/[^/]+$/.test(withoutExtension)) {
    return `${withoutExtension}/AGENTS.md`;
  }

  return `${withoutExtension}.md`;
}

function normalizeProjectTaskEntryPath(link: string | undefined): string {
  if (!link) {
    return TASK_BOARD_PATH;
  }

  const withoutExtension = link.replace(/\.md$/, "");

  if (/^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+$/.test(withoutExtension)) {
    return `${withoutExtension}/AGENTS.md`;
  }

  return `${withoutExtension}.md`;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function repairProjectLinksContent(content: string): string {
  return appendMissingSections(content, [
    {
      heading: "源码仓库",
      body: [
        "| 项 | 值 |",
        "|---|---|",
        "| 源码项目 | `待填写` |",
        "| 默认开发分支 | `待填写` |",
        "| 主要模块 | 待填写 |",
        "| 启动模块 | 待填写 |",
        "| 常用构建命令 | `待填写` |",
        "| 常用验证命令 | `待填写` |",
        "",
        "任务开发时以任务目录作为上下文根，再按本节源码项目路径进入真实源码仓库。"
      ].join("\n")
    }
  ]);
}

function repairProjectTaskContent(content: string): string {
  return appendMissingSections(content, [
    {
      heading: "AI 上下文根",
      body: "本任务目录是 AI 开发上下文根；源码仓库不是本目录，必须从“源码定位”或关联项目 `links.md` 进入。"
    },
    {
      heading: "源码定位",
      body: [
        "- 源码仓库：待从关联项目 `links.md` 读取",
        "- 目标模块：待填写",
        "- 预计修改范围：待填写"
      ].join("\n")
    },
    {
      heading: "按需资料",
      body: [
        "- 本任务入口。",
        "- 需要项目稳定知识时读取关联项目 `AGENTS.md`。",
        "- 需要源码路径或文档入口时读取关联项目 `links.md`。",
        "- 只读取与本任务直接相关的源码文件。"
      ].join("\n")
    },
    {
      heading: "禁止读取",
      body: [
        "- 不递归扫描整个 vault。",
        "- 不读取无关 workflow。",
        "- 不读取无关项目 inputs。",
        "- 不读取 `70-vault-optimization/`，除非任务目标就是优化 vault、插件或自动化流程。"
      ].join("\n")
    }
  ]);
}

function repairWorkflowAgentsContent(content: string): string {
  return appendMissingSections(content, [
    {
      heading: "AI 上下文根",
      body: "本 workflow 目录是 AI 开发上下文根；源码仓库不是本目录，必须从关联项目 `links.md` 或本 workflow 明确记录的源码绝对路径进入。"
    },
    {
      heading: "源码定位",
      body: [
        "- 源码仓库：待从关联项目 `links.md` 读取",
        "- 目标模块：待填写",
        "- 预计修改范围：待填写"
      ].join("\n")
    },
    {
      heading: "按需资料",
      body: [
        "- 本 workflow 的 `AGENTS.md` 和任务说明文件。",
        "- 需要项目稳定知识时读取关联项目 `AGENTS.md`。",
        "- 需要源码路径或文档入口时读取关联项目 `links.md`。",
        "- 只读取与本任务直接相关的输入材料和源码文件。"
      ].join("\n")
    },
    {
      heading: "禁止读取",
      body: [
        "- 不递归扫描整个 vault。",
        "- 不读取无关 workflow。",
        "- 不读取无关项目 inputs。",
        "- 不读取 `70-vault-optimization/`，除非任务目标就是优化 vault、插件或自动化流程。"
      ].join("\n")
    }
  ]);
}

function appendMissingSections(content: string, sections: { heading: string; body: string }[]): string {
  const additions = sections
    .filter((section) => !hasMarkdownHeading(content, section.heading))
    .map((section) => `## ${section.heading}\n\n${section.body}`);

  if (additions.length === 0) {
    return content;
  }

  const trimmedContent = content.trimEnd();
  return `${trimmedContent}\n\n${additions.join("\n\n")}\n`;
}

function hasMarkdownHeading(content: string, heading: string): boolean {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}\\s+${escapedHeading}\\s*$`, "m").test(content);
}

function getDevelopmentReadinessIssues(path: string, content: string): string[] {
  const issues: string[] = [];
  const isProjectTask = /^30-projects\/[^/]+\/inputs\/\d{4}\/\d{2}\/[^/]+\/(?:AGENTS|index)\.md$/.test(path);
  const isWorkflow = /^20-workflows\/[^/]+\/AGENTS\.md$/.test(path);

  if (!isProjectTask && !isWorkflow) {
    return ["当前文件不是项目任务 AGENTS.md 或 workflow AGENTS.md。"];
  }

  if (!content.includes("关联项目")) {
    issues.push("缺少关联项目。");
  }

  if (!hasFilledDevelopmentBranch(content)) {
    issues.push("目标分支为空或仍为 `待填写`。");
  }

  for (const heading of ["当前任务", "路由", "门槛"]) {
    if (!hasMarkdownHeading(content, heading)) {
      issues.push(`缺少 ${heading} section。`);
    }
  }

  if (hasMarkdownHeading(content, "执行结果")) {
    issues.push("AGENTS.md 包含执行结果 section，应迁移到 execution.md。");
  }

  if (content.length > 3 * 1024) {
    issues.push("AGENTS.md 超过 3KB，建议拆分到 overview.md、execution.md、todo.md 或 risk.md。");
  }

  return issues;
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

class InboxFolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: import("obsidian").App,
    private readonly folders: TFolder[],
    private readonly resolveFolder: (folder: TFolder | null) => void
  ) {
    super(app);
    this.setPlaceholder("Select an inbox folder to organize");
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.resolveFolder(folder);
  }

  onClose(): void {
    super.onClose();
    this.resolveFolder(null);
  }
}

function isInboxOrganizeTarget(file: TAbstractFile): boolean {
  return file.path === INBOX_ROOT_PATH.replace(/\/$/, "") || file.path.startsWith(INBOX_ROOT_PATH);
}

function hasFilledDevelopmentBranch(content: string): boolean {
  const branchListPattern = /^-\s*目标(?:开发)?分支[：:]\s*(.+?)\s*$/;

  return content
    .split(/\r?\n/)
    .some((line) => {
      const listMatch = line.trim().match(branchListPattern);
      if (listMatch) {
        return isFilledDevelopmentBranchValue(listMatch[1]);
      }

      if (!line.includes("|")) {
        return false;
      }

      const parts = line
        .replace(/`/g, "")
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length < 2 || parts.includes("项目") || parts.includes("目标开发分支")) {
        return false;
      }

      return isFilledDevelopmentBranchValue(parts[parts.length - 1]);
    });
}

function isFilledDevelopmentBranchValue(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized !== "待填写" && !/^-+$/.test(normalized);
}

function countBySeverity(
  issues: { severity: ValidationSeverity }[],
  severity: ValidationSeverity
): number {
  return issues.filter((issue) => issue.severity === severity).length;
}

async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
