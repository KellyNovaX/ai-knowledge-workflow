import { App, ItemView, Menu, Modal, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { ConfirmDecision, confirmAction } from "./ConfirmModal";
import {
  TASK_PRIORITY_ORDER,
  TASK_SOURCE_APP_LABELS,
  TASK_SCOPE_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_STATUS_TITLES
} from "../constants";
import { SkillActionId } from "../skills/SkillActions";
import {
  TaskPriority,
  TaskSourceApp,
  TaskScope,
  TaskStatus,
  ValidationIssue,
  ValidationSeverity,
  VaultIndex
} from "../types";
import {
  BoardTask,
  BoardTaskWpsTarget,
  sortBoardTasks,
  TaskBoard,
  TASK_BOARD_PATH,
  TASK_DONE_PATH,
  TaskManualMoveDirection,
  TaskBoardSortMode
} from "../vault/TaskBoard";
import { ProjectRepository } from "../vault/ProjectRepository";
import { TaskAttachmentUploader } from "../vault/TaskAttachmentUploader";
import { VaultScanner } from "../vault/VaultScanner";
import { VaultValidator } from "../vault/VaultValidator";

export const TODO_BOARD_VIEW_TYPE = "ai-knowledge-todo-board";

enum DueDateFilterMode {
  Any = "any",
  None = "none",
  On = "on",
  By = "by",
  From = "from",
  Between = "between"
}

enum TaskScopeFilterMode {
  Any = "any",
  General = "general",
  Project = "project",
  Workflow = "workflow"
}

const DUE_DATE_FILTER_LABELS: Record<DueDateFilterMode, string> = {
  [DueDateFilterMode.Any]: "全部日期",
  [DueDateFilterMode.None]: "未设置日期",
  [DueDateFilterMode.On]: "当天",
  [DueDateFilterMode.By]: "截止到",
  [DueDateFilterMode.From]: "从日期开始",
  [DueDateFilterMode.Between]: "日期范围"
};

const TASK_SCOPE_FILTER_LABELS: Record<TaskScopeFilterMode, string> = {
  [TaskScopeFilterMode.Any]: "全部类型",
  [TaskScopeFilterMode.General]: "通用",
  [TaskScopeFilterMode.Project]: "项目",
  [TaskScopeFilterMode.Workflow]: "工作流"
};

const TASK_PRIORITY_DISPLAY: Record<TaskPriority, string> = {
  [TaskPriority.P0]: "P0 紧急",
  [TaskPriority.P1]: "P1 高",
  [TaskPriority.P2]: "P2 中",
  [TaskPriority.P3]: "P3 普通",
  [TaskPriority.P4]: "P4 低"
};

const TASK_SCOPE_DISPLAY: Record<TaskScope, string> = {
  [TaskScope.General]: "通用",
  [TaskScope.Project]: "项目",
  [TaskScope.Workflow]: "工作流"
};

const TASKS_PER_COLUMN_PAGE = 10;

export interface TodoBoardActions {
  openTasks(): Promise<void>;
  openProjects(): Promise<void>;
  openFaq(): Promise<void>;
  validateVault(): Promise<void>;
  createWorkflow(): Promise<void>;
  addTask(): Promise<void>;
  addGeneralTask(): Promise<void>;
  completeTask(): Promise<void>;
  openDoneArchive(): Promise<void>;
  copyTaskToAgent?(task: BoardTask): Promise<void>;
  openTaskInAgent?(task: BoardTask): Promise<void>;
  openTaskInCodexApp?(task: BoardTask): Promise<void>;
  getTaskSourceApp(): TaskSourceApp;
  canOpenTaskSource(): boolean;
  openTaskSource(target: BoardTaskWpsTarget): Promise<void>;
  runSkillAction?(actionId: SkillActionId): Promise<void>;
  openAiAgentInVault?(): Promise<void>;
  openSettings(): void;
}

export class TodoBoardView extends ItemView {
  private sortMode = TaskBoardSortMode.Priority;
  private taskScopeFilterMode = TaskScopeFilterMode.Any;
  private dueDateFilterMode = DueDateFilterMode.Any;
  private dueDateFilterStart = "";
  private dueDateFilterEnd = "";
  private isRefreshing = false;
  private searchDraft = "";
  private searchQuery = "";
  private projectSearchDraft = "";
  private projectSearchQuery = "";
  private readonly columnPages = new Map<TaskStatus, number>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly actions: TodoBoardActions
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TODO_BOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI 知识任务板";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    this.renderLoading();

    try {
      const taskBoard = new TaskBoard(this.app);
      const [activeTasks, doneTasks, index] = await Promise.all([
        taskBoard.listTasks(),
        taskBoard.listDoneTasks(),
        new VaultScanner(this.app).scanVault()
      ]);
      const issues = new VaultValidator().validateVault(index);
      this.renderBoard([...activeTasks, ...doneTasks], index, issues);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`任务板刷新失败：${message}`);
      this.renderError(message);
    } finally {
      this.isRefreshing = false;
    }
  }

  private renderLoading(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ai-knowledge-todo-board");
    container.createEl("p", { text: "刷新中...", cls: "ai-knowledge-muted" });
  }

  private renderError(message: string): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ai-knowledge-todo-board");
    container.createEl("p", { text: message, cls: "ai-knowledge-error" });
  }

  private renderBoard(
    tasks: BoardTask[],
    index: VaultIndex,
    issues: ValidationIssue[]
  ): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ai-knowledge-todo-board");

    // Close any open more-menus on outside click
    container.addEventListener("click", () => {
      container.findAll(".ai-knowledge-task-more-menu.is-open").forEach((m) => m.removeClass("is-open"));
    });

    this.renderMainTabs(container);

    const header = container.createDiv({ cls: "ai-knowledge-todo-header" });
    const title = header.createDiv({ cls: "ai-knowledge-todo-title" });
    const titleBar = title.createDiv({ cls: "ai-knowledge-todo-title-bar" });
    titleBar.createEl("h2", { text: "任务板" });
    this.renderOpenAiAgentButton(titleBar);
    this.renderMoreActionsButton(titleBar);
    this.renderStatusStrip(title, tasks.length, index, issues);

    this.renderWorkflowActions(container);
    this.renderBoardControls(container);

    const visibleTasks = tasks
      .filter((task) => matchesSearch(task, this.searchQuery))
      .filter((task) => matchesProjectSearch(task, this.projectSearchQuery))
      .filter((task) => matchesTaskScopeFilter(task, this.taskScopeFilterMode))
      .filter((task) =>
        matchesDueDateFilter(task, this.dueDateFilterMode, this.dueDateFilterStart, this.dueDateFilterEnd)
      );

    const columns = container.createDiv({ cls: "ai-knowledge-kanban" });
    for (const status of TASK_STATUS_ORDER) {
      this.renderColumn(
        columns,
        status,
        sortBoardTasks(
          visibleTasks.filter((task) => task.status === status),
          this.sortMode
        )
      );
    }
  }

  private renderMainTabs(container: HTMLElement): void {
    const tabs = container.createDiv({ cls: "ai-knowledge-main-tabs" });
    const tasksButton = tabs.createEl("button", { text: "Tasks" });
    const projectsButton = tabs.createEl("button", { text: "Projects" });
    const faqButton = tabs.createEl("button", { text: "FAQ" });
    tasksButton.addClass("mod-cta");
    projectsButton.addEventListener("click", () => {
      void this.actions.openProjects();
    });
    faqButton.addEventListener("click", () => {
      void this.actions.openFaq();
    });
  }

  private renderWorkflowActions(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "ai-knowledge-todo-actions-panel" });
    const workflowGroup = panel.createDiv({ cls: "ai-knowledge-action-group" });
    workflowGroup.createEl("h3", { text: "工作流" });
    const workflowActions = workflowGroup.createDiv({ cls: "ai-knowledge-action-row" });

    this.addActionButton(workflowActions, "创建项目任务", "创建项目小任务。", () =>
      this.actions.addTask()
    );
    this.addActionButton(workflowActions, "创建工作流", "创建复杂任务 workflow。", () =>
      this.actions.createWorkflow()
    );
    this.addActionButton(workflowActions, "添加通用待办", "添加提醒、会议、沟通等非项目待办。", () =>
      this.actions.addGeneralTask()
    );
    this.addActionButton(workflowActions, "校验", "只读检查 vault 结构、任务板和 workflow 链接。", () =>
      this.actions.validateVault()
    );
  }

  private renderOpenAiAgentButton(parent: HTMLElement): void {
    const button = parent.createEl("button", {
      cls: "ai-knowledge-open-agent-button",
      attr: {
        "aria-label": "Open AI agent in vault",
        title: "Open AI agent in vault"
      }
    });
    setIcon(button.createSpan({ cls: "ai-knowledge-open-agent-icon" }), "terminal");
    button.createSpan({ text: "Open AI agent in vault" });

    button.addEventListener("click", () => {
      void this.openAiAgentInVault();
    });
  }

  private renderMoreActionsButton(parent: HTMLElement): void {
    const button = parent.createEl("button", {
      cls: "ai-knowledge-more-actions-button",
      attr: {
        "aria-label": "更多操作",
        title: "更多操作"
      }
    });
    button.createSpan({ text: "更多操作" });
    setIcon(button.createSpan({ cls: "ai-knowledge-more-actions-icon" }), "chevron-down");

    button.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle("打开已完成记录")
          .setIcon("archive")
          .onClick(() => {
            void this.actions.openDoneArchive();
          });
      });
      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle("生成项目知识库")
          .setIcon("book-open")
          .onClick(() => {
            void this.runSkillAction(SkillActionId.GenerateProjectKnowledge);
          });
      });
      menu.addItem((item) => {
        item
          .setTitle("生成周报")
          .setIcon("calendar-days")
          .onClick(() => {
            void this.runSkillAction(SkillActionId.GenerateWeeklySummary);
          });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private async openAiAgentInVault(): Promise<void> {
    if (!this.actions.openAiAgentInVault) {
      new Notice("Open AI agent in vault is unavailable.");
      return;
    }

    await this.actions.openAiAgentInVault();
  }

  private async runSkillAction(actionId: SkillActionId): Promise<void> {
    if (!this.actions.runSkillAction) {
      await notifySkillActionsUnavailable();
      return;
    }

    await this.actions.runSkillAction(actionId);
    await this.refresh();
  }

  private addActionButton(
    parent: HTMLElement,
    label: string,
    description: string,
    action: () => Promise<void>
  ): void {
    const button = parent.createEl("button", { cls: "ai-knowledge-action-button" });
    button.createSpan({ text: label, cls: "ai-knowledge-action-title" });
    button.createSpan({ text: description, cls: "ai-knowledge-action-desc" });
    button.addEventListener("click", () => {
      void action().then(() => this.refresh());
    });
  }

  private renderStatusStrip(
    container: HTMLElement,
    taskCount: number,
    index: VaultIndex,
    issues: ValidationIssue[]
  ): void {
    const strip = container.createDiv({ cls: "ai-knowledge-status-strip" });
    this.renderStatusItem(strip, "任务", taskCount.toString());
    this.renderStatusItem(strip, "工作流", index.workflows.length.toString());
    this.renderStatusItem(strip, "校验", summarizeIssues(issues));
  }

  private renderStatusItem(parent: HTMLElement, label: string, value: string): void {
    const item = parent.createSpan();
    item.createEl("strong", { text: value });
    item.appendText(` ${label}`);
  }

  private renderBoardControls(container: HTMLElement): void {
    const header = container.createDiv({ cls: "ai-knowledge-board-controls" });
    header.createEl("h3", { text: "任务" });
    const controls = header.createDiv({ cls: "ai-knowledge-board-control-actions" });
    this.renderToolbar(controls);
  }

  private renderToolbar(parent: HTMLElement): void {
    const searchWrap = parent.createDiv({ cls: "ai-knowledge-task-search-wrap" });
    const searchInput = searchWrap.createEl("input", {
      cls: "ai-knowledge-task-card-search",
      type: "search",
      attr: {
        placeholder: "搜索任务",
        "aria-label": "搜索任务"
      }
    });
    const clearBtn = searchWrap.createEl("button", {
      cls: "ai-knowledge-search-clear",
      attr: { title: "清除搜索", "aria-label": "清除搜索" }
    });
    setIcon(clearBtn, "x");
    clearBtn.toggleClass("ai-knowledge-hidden", !this.searchDraft);
    searchInput.value = this.searchDraft;
    searchInput.addEventListener("input", () => {
      this.searchDraft = searchInput.value;
      clearBtn.toggleClass("ai-knowledge-hidden", !this.searchDraft);
      if (this.searchDraft.trim() === "" && this.searchQuery !== "") {
        this.searchQuery = "";
        void this.refresh();
      }
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) {
        return;
      }
      this.searchDraft = searchInput.value;
      this.searchQuery = searchInput.value;
      void this.refresh();
    });
    clearBtn.addEventListener("click", () => {
      this.searchDraft = "";
      this.searchQuery = "";
      searchInput.value = "";
      clearBtn.addClass("ai-knowledge-hidden");
      void this.refresh();
    });
    const projectSearchWrap = parent.createDiv({ cls: "ai-knowledge-task-search-wrap" });
    const projectSearchInput = projectSearchWrap.createEl("input", {
      cls: "ai-knowledge-task-card-search ai-knowledge-project-name-search",
      type: "search",
      attr: {
        placeholder: "搜索项目名称",
        "aria-label": "搜索项目名称"
      }
    });
    const projectClearBtn = projectSearchWrap.createEl("button", {
      cls: "ai-knowledge-search-clear",
      attr: { title: "清除项目搜索", "aria-label": "清除项目搜索" }
    });
    setIcon(projectClearBtn, "x");
    projectClearBtn.toggleClass("ai-knowledge-hidden", !this.projectSearchDraft);
    projectSearchInput.value = this.projectSearchDraft;
    projectSearchInput.addEventListener("input", () => {
      this.projectSearchDraft = projectSearchInput.value;
      projectClearBtn.toggleClass("ai-knowledge-hidden", !this.projectSearchDraft);
      if (this.projectSearchDraft.trim() === "" && this.projectSearchQuery !== "") {
        this.projectSearchQuery = "";
        void this.refresh();
      }
    });
    projectSearchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) {
        return;
      }
      this.projectSearchDraft = projectSearchInput.value;
      this.projectSearchQuery = projectSearchInput.value;
      void this.refresh();
    });
    projectClearBtn.addEventListener("click", () => {
      this.projectSearchDraft = "";
      this.projectSearchQuery = "";
      projectSearchInput.value = "";
      projectClearBtn.addClass("ai-knowledge-hidden");
      void this.refresh();
    });
    const sortGroup = parent.createDiv({ cls: "ai-knowledge-sort-group" });
    sortGroup.createSpan({ text: "排序:", cls: "ai-knowledge-sort-label" });
    const priorityButton = sortGroup.createEl("button", { text: "优先级" });
    const manualButton = sortGroup.createEl("button", { text: "手动" });
    const typeGroup = parent.createDiv({ cls: "ai-knowledge-type-filter-group" });
    typeGroup.createSpan({ text: "类型:", cls: "ai-knowledge-sort-label" });
    const typeSelect = typeGroup.createEl("select", {
      cls: "ai-knowledge-type-filter-mode",
      attr: {
        "aria-label": "任务类型筛选",
        title: "任务类型筛选"
      }
    });
    const dateGroup = parent.createDiv({ cls: "ai-knowledge-date-filter-group" });
    dateGroup.createSpan({ text: "日期:", cls: "ai-knowledge-sort-label" });
    const modeSelect = dateGroup.createEl("select", {
      cls: "ai-knowledge-date-filter-mode",
      attr: {
        "aria-label": "日期筛选方式",
        title: "日期筛选方式"
      }
    });
    const startDateInput = dateGroup.createEl("input", {
      cls: "ai-knowledge-task-date-filter",
      type: "date",
      attr: {
        "aria-label": "开始日期",
        title: "开始日期"
      }
    });
    const endDateInput = dateGroup.createEl("input", {
      cls: "ai-knowledge-task-date-filter",
      type: "date",
      attr: {
        "aria-label": "结束日期",
        title: "结束日期"
      }
    });
    const refreshButton = parent.createEl("button", { text: "刷新" });

    for (const mode of Object.values(DueDateFilterMode)) {
      modeSelect.createEl("option", { text: DUE_DATE_FILTER_LABELS[mode], value: mode });
    }

    for (const mode of Object.values(TaskScopeFilterMode)) {
      typeSelect.createEl("option", { text: TASK_SCOPE_FILTER_LABELS[mode], value: mode });
    }

    priorityButton.toggleClass("mod-cta", this.sortMode === TaskBoardSortMode.Priority);
    manualButton.toggleClass("mod-cta", this.sortMode === TaskBoardSortMode.Manual);

    priorityButton.addEventListener("click", () => {
      this.sortMode = TaskBoardSortMode.Priority;
      void this.refresh();
    });
    manualButton.addEventListener("click", () => {
      this.sortMode = TaskBoardSortMode.Manual;
      void this.refresh();
    });
    typeSelect.value = this.taskScopeFilterMode;
    typeSelect.addEventListener("change", () => {
      this.taskScopeFilterMode = typeSelect.value as TaskScopeFilterMode;
      this.resetColumnPages();
      void this.refresh();
    });
    modeSelect.value = this.dueDateFilterMode;
    startDateInput.value = this.dueDateFilterStart;
    endDateInput.value = this.dueDateFilterEnd;
    updateDateFilterInputs(this.dueDateFilterMode, startDateInput, endDateInput);
    modeSelect.addEventListener("change", () => {
      this.dueDateFilterMode = modeSelect.value as DueDateFilterMode;
      updateDateFilterInputs(this.dueDateFilterMode, startDateInput, endDateInput);
      this.resetColumnPages();
      void this.refresh();
    });
    startDateInput.addEventListener("change", () => {
      this.dueDateFilterStart = startDateInput.value;
      this.resetColumnPages();
      void this.refresh();
    });
    endDateInput.addEventListener("change", () => {
      this.dueDateFilterEnd = endDateInput.value;
      this.resetColumnPages();
      void this.refresh();
    });
    refreshButton.addEventListener("click", () => {
      void this.refresh();
    });
  }

  private renderColumn(parent: HTMLElement, status: TaskStatus, tasks: BoardTask[]): void {
    const totalPages = Math.max(1, Math.ceil(tasks.length / TASKS_PER_COLUMN_PAGE));
    const currentPage = clampPage(this.columnPages.get(status) ?? 1, totalPages);
    this.columnPages.set(status, currentPage);
    const pageStart = (currentPage - 1) * TASKS_PER_COLUMN_PAGE;
    const pageTasks = tasks.slice(pageStart, pageStart + TASKS_PER_COLUMN_PAGE);

    const column = parent.createDiv({ cls: "ai-knowledge-kanban-column" });
    const header = column.createDiv({ cls: "ai-knowledge-kanban-column-header" });
    const title = header.createDiv({ cls: "ai-knowledge-kanban-column-heading" });
    title.createSpan({
      text: TASK_STATUS_TITLES[status],
      cls: "ai-knowledge-kanban-column-title"
    });
    title.createSpan({
      text: TASK_STATUS_LABELS[status],
      cls: "ai-knowledge-kanban-column-subtitle"
    });
    header.createSpan({ text: tasks.length.toString(), cls: "ai-knowledge-kanban-count" });

    const list = column.createDiv({ cls: "ai-knowledge-kanban-cards" });

    if (tasks.length === 0) {
      list.createEl("p", { text: "无任务", cls: "ai-knowledge-muted" });
      return;
    }

    for (const task of pageTasks) {
      this.renderTaskCard(list, task);
    }

    this.renderColumnPagination(column, status, currentPage, totalPages, tasks.length);
  }

  private resetColumnPages(): void {
    this.columnPages.clear();
  }

  private renderColumnPagination(
    parent: HTMLElement,
    status: TaskStatus,
    currentPage: number,
    totalPages: number,
    totalTasks: number
  ): void {
    if (totalTasks === 0) {
      return;
    }

    const footer = parent.createDiv({ cls: "ai-knowledge-kanban-pagination" });
    const previousButton = footer.createEl("button", {
      text: "上一页",
      cls: "ai-knowledge-pagination-button"
    });
    footer.createSpan({
      text: `第 ${currentPage} / ${totalPages} 页 · 共 ${totalTasks} 个`,
      cls: "ai-knowledge-pagination-summary"
    });
    const nextButton = footer.createEl("button", {
      text: "下一页",
      cls: "ai-knowledge-pagination-button"
    });

    previousButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= totalPages;

    previousButton.addEventListener("click", () => {
      this.columnPages.set(status, Math.max(1, currentPage - 1));
      void this.refresh();
    });
    nextButton.addEventListener("click", () => {
      this.columnPages.set(status, Math.min(totalPages, currentPage + 1));
      void this.refresh();
    });
  }

  private renderTaskCard(parent: HTMLElement, task: BoardTask): void {
    const isArchived = task.status === TaskStatus.Done;
    const card = parent.createDiv({
      cls: `ai-knowledge-task-card ai-knowledge-priority-${task.priority.toLowerCase()}`
    });

    const titleText = formatTaskTitle(task);
    const calloutLines = extractCalloutLines(task.rawLines);
    const firstLink = task.links[0] ?? null;

    const top = card.createDiv({ cls: "ai-knowledge-task-card-top" });
    const identity = top.createDiv({ cls: "ai-knowledge-task-identity" });
    identity.createSpan({
      text: task.priority,
      cls: `ai-knowledge-priority-badge ai-knowledge-priority-badge-${task.priority.toLowerCase()}`,
      attr: { title: `优先级：${TASK_PRIORITY_DISPLAY[task.priority]}` }
    });
    identity.createSpan({
      text: TASK_SCOPE_DISPLAY[task.taskScope],
      cls: `ai-knowledge-task-type-badge ai-knowledge-task-type-${task.taskScope}`,
      attr: {
        title: `任务类型：${TASK_SCOPE_LABELS[task.taskScope]}`
      }
    });

    const actions = top.createDiv({ cls: "ai-knowledge-task-card-actions" });

    const openCodexAppButton = createTaskIconButton(
      actions,
      "app-window",
      `用 Codex App 打开：${titleText}`,
      "用 Codex App 打开"
    );
    openCodexAppButton.addEventListener("click", () => {
      void this.openTaskInCodexApp(task);
    });

    const openAgentButton = createTaskIconButton(
      actions,
      "terminal",
      `用 Agent 打开：${titleText}`,
      "用 Agent 打开"
    );
    openAgentButton.addEventListener("click", () => {
      void this.openTaskInAgent(task);
    });

    if (!isArchived) {
      const deleteButton = createTaskIconButton(
        actions,
        "trash-2",
        `删除任务：${titleText}`,
        "删除任务",
        "ai-knowledge-task-danger-icon"
      );
      deleteButton.addEventListener("click", () => {
        void this.deleteTask(task);
      });
    }

    const dueDateInput = isArchived
      ? null
      : card.createEl("input", {
          cls: "ai-knowledge-task-hidden-date-input",
          type: "date",
          attr: {
            "aria-label": "任务日期"
          }
        });
    if (dueDateInput) {
      dueDateInput.value = task.dueDate ?? "";
      dueDateInput.addEventListener("change", () => {
        void this.updateTaskDueDate(task, dueDateInput.value || null);
      });
    }

    const moreWrapper = actions.createDiv({ cls: "ai-knowledge-task-more-wrapper" });
    const moreButton = createTaskIconButton(moreWrapper, "more-vertical", "更多操作", "更多操作");
    const moreMenu = moreWrapper.createDiv({ cls: "ai-knowledge-task-more-menu" });

    if (task.status !== TaskStatus.Done) {
      const completeItem = moreMenu.createDiv({ cls: "ai-knowledge-task-more-item", attr: { "aria-label": `完成任务：${titleText}`, title: "完成任务" } });
      setIcon(completeItem.createSpan(), "check");
      completeItem.createSpan({ text: " 完成", cls: "ai-knowledge-task-more-item-text" });
      completeItem.addEventListener("click", (e) => {
        e.stopPropagation();
        moreMenu.removeClass("is-open");
        void this.moveTask(task, TaskStatus.Done);
      });
    }

    const copyItem = moreMenu.createDiv({ cls: "ai-knowledge-task-more-item", attr: { "aria-label": `复制给 Agent：${titleText}`, title: "复制给 Agent" } });
    setIcon(copyItem.createSpan(), "copy");
    copyItem.createSpan({ text: " 复制给 Agent", cls: "ai-knowledge-task-more-item-text" });
    copyItem.addEventListener("click", (e) => {
      e.stopPropagation();
      moreMenu.removeClass("is-open");
      void this.copyTaskToAgent(task);
    });

    moreButton.addEventListener("click", (e) => {
      e.stopPropagation();
      moreMenu.toggleClass("is-open", !moreMenu.hasClass("is-open"));
    });

    if (!isArchived && this.sortMode === TaskBoardSortMode.Manual) {
      const moveUpButton = createTaskIconButton(
        actions,
        "arrow-up",
        `上移任务：${titleText}`,
        "上移"
      );
      moveUpButton.addEventListener("click", () => {
        void this.moveTaskManually(task, TaskManualMoveDirection.Up);
      });

      const moveDownButton = createTaskIconButton(
        actions,
        "arrow-down",
        `下移任务：${titleText}`,
        "下移"
      );
      moveDownButton.addEventListener("click", () => {
        void this.moveTaskManually(task, TaskManualMoveDirection.Down);
      });
    }

    const titleRow = card.createDiv({ cls: "ai-knowledge-task-title-row" });
    titleRow.createDiv({ text: titleText, cls: "ai-knowledge-task-card-title" });
    if (!isArchived) {
      const editTitleButton = createTaskIconButton(
        titleRow,
        "pencil",
        `编辑任务名称：${titleText}`,
        "编辑任务名称",
        "ai-knowledge-task-title-edit"
      );
      editTitleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.startTitleEditing(card, task, titleText);
      });
    }

    const summary = card.createDiv({ cls: "ai-knowledge-task-summary" });
    const dueDateChip = summary.createEl("button", {
      text: task.dueDate ? `截止 ${formatCompactDate(task.dueDate)}` : "未设置日期",
      cls: "ai-knowledge-task-summary-chip ai-knowledge-task-date-chip",
      attr: {
        title: task.dueDate ? `修改日期：${task.dueDate}` : "设置日期",
        "aria-label": "设置任务日期"
      }
    });
    if (dueDateInput) {
      dueDateChip.addEventListener("click", (event) => {
        event.stopPropagation();
        dueDateInput.showPicker?.();
        dueDateInput.focus();
        dueDateInput.click();
      });
    }
    const noteTag = summary.createSpan({
      text: "说明",
      cls: "ai-knowledge-task-note-tag" + (calloutLines.length === 0 ? " ai-knowledge-task-tag-empty" : ""),
      attr: { title: "单击查看 / 双击编辑" }
    });

    const sourceLabel = TASK_SOURCE_APP_LABELS[this.actions.getTaskSourceApp()];
    const sourceTag = summary.createSpan({
      text: task.wpsTargets.length > 0
        ? `${sourceLabel}:${task.wpsTargets.map(t => t.label.length > 10 ? t.label.slice(0, 10) + "…" : t.label).join(",")}`
        : sourceLabel,
      cls: "ai-knowledge-task-wps-tag" + (task.wpsTargets.length === 0 ? " ai-knowledge-task-tag-empty" : ""),
      attr: { title: task.wpsTargets.length > 0 ? "单击查看 / 编辑" : "单击编辑" }
    });
    if (task.taskScope === TaskScope.Workflow || task.taskScope === TaskScope.Project) {
      renderProjectTag(
        summary,
        task.projects.length > 0 ? task.projects : task.project ? [task.project] : []
      );
    }

    const summaryTools = summary.createDiv({ cls: "ai-knowledge-task-summary-tools" });
    if (firstLink) {
      const openLink = createTaskIconButton(
        summaryTools,
        "external-link",
        `打开 ${shortLinkLabel(firstLink.label || firstLink.target)}`,
        "定位到文件",
        "ai-knowledge-task-meta-icon"
      );
      openLink.addEventListener("click", () => {
        void this.app.workspace.openLinkText(firstLink.target, TASK_BOARD_PATH);
      });
    }
    const lineLink = createTaskIconButton(
      summaryTools,
      "text-cursor-input",
      `定位到任务第 ${task.line} 行`,
      "定位到任务行",
      "ai-knowledge-task-meta-icon"
    );
    lineLink.addEventListener("click", () => {
      void this.openTaskLine(task);
    });

    const noteBlock = card.createDiv({ cls: "ai-knowledge-task-note-block" });
    for (const line of calloutLines) {
      noteBlock.createDiv({ text: line, cls: "ai-knowledge-task-note-line" });
    }

    noteTag.addEventListener("click", (e) => {
      e.stopPropagation();
      if (calloutLines.length > 0) {
        noteBlock.classList.toggle("ai-knowledge-task-note-expanded");
        noteTag.classList.toggle("ai-knowledge-task-note-active");
      }
    });

    if (!isArchived) {
      noteTag.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startNoteEditing(card, task, calloutLines);
      });
    }

    const sourceBlock = card.createDiv({ cls: "ai-knowledge-task-wps-block" });
    if (task.wpsTargets.length > 0) {
      const targetLine = sourceBlock.createDiv({ cls: "ai-knowledge-task-wps-detail" });
      targetLine.createSpan({ text: task.wpsTargets.map((target) => target.label).join("，") });
      if (this.actions.canOpenTaskSource()) {
        const openTaskSourceButton = createTaskIconButton(
          targetLine,
          "message-circle",
          `打开 ${sourceLabel}：${task.wpsTargets[0].label}`,
          `${sourceLabel}：${task.wpsTargets[0].label}`,
          "ai-knowledge-task-meta-icon"
        );
        openTaskSourceButton.addEventListener("click", () => {
          void this.openTaskSource(task.wpsTargets[0]);
        });
      }
    }
    if (!isArchived) {
      const editSourceButton = sourceBlock.createEl("button", {
        text: `编辑 ${sourceLabel}`,
        cls: "ai-knowledge-task-inline-button"
      });
      editSourceButton.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startSourceEditing(card, task);
      });
    }

    sourceTag.addEventListener("click", (e) => {
      e.stopPropagation();
      if (task.wpsTargets.length > 0) {
        sourceBlock.classList.toggle("ai-knowledge-task-wps-expanded");
        sourceTag.classList.toggle("ai-knowledge-task-wps-active");
      } else if (!isArchived) {
        this.startSourceEditing(card, task);
      }
    });

    if (!isArchived) {
      sourceTag.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startSourceEditing(card, task);
      });
    }

    const detailButton = card.createEl("button", {
      cls: "ai-knowledge-task-detail-toggle",
      attr: {
        "aria-expanded": "false",
        title: "展开任务详情"
      }
    });
    setIcon(detailButton.createSpan({ cls: "ai-knowledge-task-detail-icon" }), "chevron-down");
    detailButton.createSpan({ text: "详情" });

    const details = card.createDiv({ cls: "ai-knowledge-task-detail-panel" });
    if (!isArchived) {
      const controlsRow = details.createDiv({ cls: "ai-knowledge-task-detail-controls" });
      this.renderTaskControls(controlsRow, task);
    }

    const detailMeta = details.createDiv({ cls: "ai-knowledge-task-detail-meta" });
    if (task.taskId) {
      detailMeta.createSpan({ text: `ID:${task.taskId}`, cls: "ai-knowledge-task-id-tag" });
    }
    if (task.createdAt) {
      detailMeta.createSpan({ text: `创建:${task.createdAt}`, cls: "ai-knowledge-task-created-tag" });
    }
    if (task.dueDate) {
      detailMeta.createSpan({ text: `截止:${task.dueDate}`, cls: "ai-knowledge-task-due-tag" });
    }

    detailButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const isExpanded = details.hasClass("is-open");
      details.toggleClass("is-open", !isExpanded);
      detailButton.setAttr("aria-expanded", String(!isExpanded));
      detailButton.toggleClass("is-open", !isExpanded);
    });
  }

  private renderTaskControls(parent: HTMLElement, task: BoardTask): void {
    const prioritySelect = parent.createEl("select", {
      cls: "ai-knowledge-task-select",
      attr: { "aria-label": "任务优先级" }
    });
    const statusSelect = parent.createEl("select", {
      cls: "ai-knowledge-task-select",
      attr: { "aria-label": "任务状态" }
    });
    for (const priority of TASK_PRIORITY_ORDER) {
      prioritySelect.createEl("option", { text: TASK_PRIORITY_DISPLAY[priority], value: priority });
    }
    prioritySelect.value = task.priority;
    prioritySelect.addEventListener("change", () => {
      void this.updateTaskPriority(task, prioritySelect.value as TaskPriority);
    });

    for (const status of TASK_STATUS_ORDER) {
      statusSelect.createEl("option", { text: TASK_STATUS_TITLES[status], value: status });
    }
    statusSelect.value = task.status;
    statusSelect.addEventListener("change", () => {
      void this.moveTask(task, statusSelect.value as TaskStatus);
    });

    if (task.project && task.taskScope === TaskScope.Project) {
      const projectSelect = parent.createEl("select", {
        cls: "ai-knowledge-task-select ai-knowledge-task-project-select",
        attr: { "aria-label": "关联项目" }
      });
      void this.populateProjectSelect(projectSelect, task);
      projectSelect.addEventListener("change", () => {
        void this.confirmAndUpdateProject(task, projectSelect.value);
      });
    }

    if (task.taskScope === TaskScope.Workflow) {
      const workflowProjectsButton = parent.createEl("button", {
        text: "关联项目",
        cls: "ai-knowledge-task-inline-button"
      });
      workflowProjectsButton.addEventListener("click", () => {
        void this.openWorkflowProjectsModal(task);
      });
    }

    const uploadButton = parent.createEl("button", {
      text: "上传到 inputs",
      cls: "ai-knowledge-task-inline-button"
    });
    uploadButton.addEventListener("click", () => {
      this.openTaskUploadModal(task);
    });
  }

  private async moveTask(task: BoardTask, status: TaskStatus): Promise<void> {
    try {
      await new TaskBoard(this.app).moveTask({ task, toStatus: status });
      new Notice(`任务已移动到 ${TASK_STATUS_TITLES[status]}。`);
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`移动任务失败：${message}`);
      console.error("AI Knowledge: move task failed", error);
    }
  }

  private async updateTaskPriority(task: BoardTask, priority: TaskPriority): Promise<void> {
    try {
      await new TaskBoard(this.app).updateTaskPriority({ task, priority });
      new Notice(`任务优先级已设为 ${priority}。`);
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`更新优先级失败：${message}`);
      console.error("AI Knowledge: update task priority failed", error);
    }
  }

  private async updateTaskDueDate(task: BoardTask, dueDate: string | null): Promise<void> {
    try {
      await new TaskBoard(this.app).updateTaskDueDate({ task, dueDate });
      new Notice(dueDate ? `任务日期已设为 ${dueDate}。` : "任务日期已清空。");
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`更新任务日期失败：${message}`);
      console.error("AI Knowledge: update task due date failed", error);
    }
  }

  private startTitleEditing(card: HTMLDivElement, task: BoardTask, currentTitle: string): void {
    const existingEditor = card.querySelector(".ai-knowledge-task-title-editor");
    if (existingEditor) return;

    const titleRow = card.querySelector<HTMLElement>(".ai-knowledge-task-title-row");
    titleRow?.addClass("ai-knowledge-hidden");

    const editor = card.createDiv({ cls: "ai-knowledge-task-title-editor" });
    const input = editor.createEl("input", {
      cls: "ai-knowledge-task-title-input",
      attr: { type: "text", "aria-label": "编辑任务名称", placeholder: "任务名称" }
    });
    input.value = currentTitle;
    input.focus();
    input.select();

    const actions = editor.createDiv({ cls: "ai-knowledge-task-note-actions" });
    const saveButton = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    const cancelButton = actions.createEl("button", { text: "取消" });

    const save = () => {
      const title = input.value.trim();
      void this.updateTaskTitle(task, title);
    };

    saveButton.addEventListener("click", save);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
      if (event.key === "Escape") {
        editor.remove();
        titleRow?.removeClass("ai-knowledge-hidden");
      }
    });

    cancelButton.addEventListener("click", () => {
      editor.remove();
      titleRow?.removeClass("ai-knowledge-hidden");
    });
  }

  private async updateTaskTitle(task: BoardTask, title: string): Promise<void> {
    try {
      await new TaskBoard(this.app).updateTaskTitle({ task, title });
      new Notice("任务名称已更新。");
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`更新任务名称失败：${message}`);
      console.error("AI Knowledge: update task title failed", error);
    }
  }

  private startNoteEditing(card: HTMLDivElement, task: BoardTask, currentNotes: string[]): void {
    const existingEditor = card.querySelector(".ai-knowledge-task-note-editor");
    if (existingEditor) return;

    const noteBlock = card.querySelector<HTMLElement>(".ai-knowledge-task-note-block");
    noteBlock?.addClass("ai-knowledge-hidden");

    const editor = card.createDiv({ cls: "ai-knowledge-task-note-editor" });
    const textarea = editor.createEl("textarea", {
      cls: "ai-knowledge-task-note-textarea",
      attr: { "aria-label": "编辑说明", rows: "4", placeholder: "每行一条说明…" }
    });
    textarea.value = currentNotes.join("\n");

    const actions = editor.createDiv({ cls: "ai-knowledge-task-note-actions" });
    const saveButton = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    const cancelButton = actions.createEl("button", { text: "取消" });

    saveButton.addEventListener("click", () => {
      const notes = textarea.value.split("\n").filter((l) => l.trim());
      void this.updateTaskNotes(task, notes);
    });

    cancelButton.addEventListener("click", () => {
      editor.remove();
      noteBlock?.removeClass("ai-knowledge-hidden");
    });
  }

  private async updateTaskNotes(task: BoardTask, notes: string[]): Promise<void> {
    try {
      await new TaskBoard(this.app).updateTaskNotes({ task, notes });
      new Notice(notes.length > 0 ? "说明已更新。" : "说明已清空。");
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`更新说明失败：${message}`);
      console.error("AI Knowledge: update task notes failed", error);
    }
  }

  private startSourceEditing(card: HTMLDivElement, task: BoardTask): void {
    const existingEditor = card.querySelector(".ai-knowledge-task-wps-editor");
    if (existingEditor) return;

    const sourceBlock = card.querySelector<HTMLElement>(".ai-knowledge-task-wps-block");
    sourceBlock?.addClass("ai-knowledge-hidden");

    const sourceLabel = TASK_SOURCE_APP_LABELS[this.actions.getTaskSourceApp()];
    const editor = card.createDiv({ cls: "ai-knowledge-task-wps-editor" });
    const input = editor.createEl("input", {
      cls: "ai-knowledge-task-wps-input",
      attr: { type: "text", "aria-label": `编辑 ${sourceLabel} 名称`, placeholder: `${sourceLabel} 名称` }
    });
    input.value = task.wpsTargets[0]?.label ?? "";

    const actions = editor.createDiv({ cls: "ai-knowledge-task-note-actions" });
    const saveButton = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    const cancelButton = actions.createEl("button", { text: "取消" });

    saveButton.addEventListener("click", () => {
      const label = input.value.trim();
      const original = task.wpsTargets[0];
      const remaining = task.wpsTargets.slice(1);
      const targets = label
        ? [{ label, url: label === original?.label ? original.url : null }, ...remaining]
        : remaining;
      void this.updateTaskWpsTargets(task, targets);
    });

    cancelButton.addEventListener("click", () => {
      editor.remove();
      sourceBlock?.removeClass("ai-knowledge-hidden");
    });
  }

  private async updateTaskWpsTargets(task: BoardTask, wpsTargets: BoardTaskWpsTarget[]): Promise<void> {
    try {
      await new TaskBoard(this.app).updateTaskWpsTargets({ task, wpsTargets });
      new Notice("任务来源已更新。");
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`更新任务来源失败：${message}`);
      console.error("AI Knowledge: update task source failed", error);
    }
  }

  private async moveTaskManually(
    task: BoardTask,
    direction: TaskManualMoveDirection
  ): Promise<void> {
    try {
      await new TaskBoard(this.app).moveTaskManually({ task, direction });
      new Notice(direction === TaskManualMoveDirection.Up ? "任务已上移。" : "任务已下移。");
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`手动排序失败：${message}`);
      console.error("AI Knowledge: manual task move failed", error);
    }
  }

  private async openTaskLine(task: BoardTask): Promise<void> {
    const taskPath = task.status === TaskStatus.Done ? TASK_DONE_PATH : TASK_BOARD_PATH;
    const file = this.app.vault.getAbstractFileByPath(taskPath);

    if (!(file instanceof TFile)) {
      new Notice(`未找到任务文件：${taskPath}`);
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(file, {
      active: true,
      eState: { line: Math.max(0, task.line - 1) }
    });
  }

  private async deleteTask(task: BoardTask): Promise<void> {
    const decision = await confirmAction(
      this.app,
      "删除任务",
      `确认删除任务"${formatTaskTitle(task)}"？此操作将从任务板中移除该任务。`,
      "删除"
    );

    if (decision !== ConfirmDecision.Confirm) {
      return;
    }

    try {
      await new TaskBoard(this.app).deleteTask(task);
      new Notice("任务已删除。");
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`删除任务失败：${message}`);
      console.error("AI Knowledge: delete task failed", error);
    }
  }

  private async copyTaskToAgent(task: BoardTask): Promise<void> {
    if (!this.actions.copyTaskToAgent) {
      new Notice("Copy task to agent is unavailable.");
      return;
    }

    await this.actions.copyTaskToAgent(task);
  }

  private async openTaskInAgent(task: BoardTask): Promise<void> {
    if (!this.actions.openTaskInAgent) {
      new Notice("Open task in agent is unavailable.");
      return;
    }

    await this.actions.openTaskInAgent(task);
  }

  private async openTaskInCodexApp(task: BoardTask): Promise<void> {
    if (!this.actions.openTaskInCodexApp) {
      new Notice("Open task in Codex app is unavailable.");
      return;
    }

    await this.actions.openTaskInCodexApp(task);
  }

  private async openTaskSource(target: BoardTaskWpsTarget): Promise<void> {
    if (!this.actions.canOpenTaskSource()) {
      new Notice("当前平台不支持打开所选来源应用。");
      return;
    }

    await this.actions.openTaskSource(target);
  }

  private async populateProjectSelect(select: HTMLSelectElement, task: BoardTask): Promise<void> {
    const projects = await new ProjectRepository(this.app).listProjects();
    select.empty();
    for (const project of projects) {
      const option = select.createEl("option", { text: project.name, value: project.name });
      if (project.name === task.project) {
        option.selected = true;
      }
    }
  }

  private async confirmAndUpdateProject(task: BoardTask, newProject: string): Promise<void> {
    if (!newProject || newProject === task.project) {
      return;
    }

    const decision = await confirmAction(
      this.app,
      "切换关联项目",
      `将任务从"${task.project}"移动到"${newProject}"？此操作会搬迁任务文件夹并更新所有关联链接。`,
      "确认切换"
    );

    if (decision !== ConfirmDecision.Confirm) {
      await this.refresh();
      return;
    }

    try {
      await new TaskBoard(this.app).updateTaskProject({ task, project: newProject });
      new Notice(`任务已切换到项目"${newProject}"。`);
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`切换项目失败：${message}`);
      console.error("AI Knowledge: update task project failed", error);
    }
  }

  private async openWorkflowProjectsModal(task: BoardTask): Promise<void> {
    const projects = await new ProjectRepository(this.app).listProjects();
    const selectedProjects = task.projects.length > 0
      ? task.projects
      : task.project
        ? [task.project]
        : [];

    new ProjectMultiSelectModal(
      this.app,
      projects.map((project) => project.name),
      selectedProjects,
      (nextProjects) => {
        void this.confirmAndUpdateWorkflowProjects(task, nextProjects);
      }
    ).open();
  }

  private async confirmAndUpdateWorkflowProjects(task: BoardTask, projects: string[]): Promise<void> {
    const nextProjects = normalizeProjectNames(projects);
    if (nextProjects.length === 0) {
      new Notice("Workflow 至少需要保留一个关联项目。");
      return;
    }

    const currentProjects = normalizeProjectNames(task.projects.length > 0 ? task.projects : task.project ? [task.project] : []);
    if (currentProjects.join("\u0000") === nextProjects.join("\u0000")) {
      return;
    }

    const decision = await confirmAction(
      this.app,
      "修改 workflow 关联项目",
      `将 workflow 关联项目改为：${nextProjects.join("、")}？此操作会更新 workflow 入口和任务板文本，不会移动 workflow 目录。`,
      "确认修改"
    );

    if (decision !== ConfirmDecision.Confirm) {
      return;
    }

    try {
      await new TaskBoard(this.app).updateWorkflowProjects({ task, projects: nextProjects });
      new Notice("Workflow 关联项目已更新。");
      await this.refresh();
      await this.actions.validateVault();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`修改 workflow 关联项目失败：${message}`);
      console.error("AI Knowledge: update workflow projects failed", error);
    }
  }

  private openTaskUploadModal(task: BoardTask): void {
    new TaskUploadModal(this.app, async (files) => {
      try {
        const result = await new TaskAttachmentUploader(this.app).uploadFiles(task, files);
        new Notice(`已复制 ${result.copiedFiles} 个文件到 ${result.targetRoot}。`);
        await this.refresh();
        await this.actions.validateVault();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`上传失败：${message}`);
        console.error("AI Knowledge: upload task attachment failed", error);
      }
    }).open();
  }
}

export function compareTaskPriority(left: BoardTask, right: BoardTask): number {
  return TASK_PRIORITY_ORDER.indexOf(left.priority) - TASK_PRIORITY_ORDER.indexOf(right.priority);
}

function matchesDueDateFilter(
  task: BoardTask,
  mode: DueDateFilterMode,
  startDate: string,
  endDate: string
): boolean {
  const dueDate = task.dueDate;

  switch (mode) {
    case DueDateFilterMode.Any:
      return true;
    case DueDateFilterMode.None:
      return !dueDate;
    case DueDateFilterMode.On:
      return startDate ? dueDate === startDate : true;
    case DueDateFilterMode.By:
      return startDate ? dueDate !== null && dueDate <= startDate : true;
    case DueDateFilterMode.From:
      return startDate ? dueDate !== null && dueDate >= startDate : true;
    case DueDateFilterMode.Between:
      if (!dueDate) {
        return false;
      }

      if (startDate && endDate) {
        return dueDate >= startDate && dueDate <= endDate;
      }

      if (startDate) {
        return dueDate >= startDate;
      }

      if (endDate) {
        return dueDate <= endDate;
      }

      return true;
  }
}

function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) {
    return 1;
  }

  return Math.min(Math.max(1, Math.floor(page)), totalPages);
}

function updateDateFilterInputs(
  mode: DueDateFilterMode,
  startDateInput: HTMLInputElement,
  endDateInput: HTMLInputElement
): void {
  const needsStart = mode === DueDateFilterMode.On || mode === DueDateFilterMode.By || mode === DueDateFilterMode.From || mode === DueDateFilterMode.Between;
  const needsEnd = mode === DueDateFilterMode.Between;

  startDateInput.toggleClass("ai-knowledge-hidden", !needsStart);
  endDateInput.toggleClass("ai-knowledge-hidden", !needsEnd);
}

function matchesTaskScopeFilter(task: BoardTask, mode: TaskScopeFilterMode): boolean {
  switch (mode) {
    case TaskScopeFilterMode.Any:
      return true;
    case TaskScopeFilterMode.General:
      return task.taskScope === TaskScope.General;
    case TaskScopeFilterMode.Project:
      return task.taskScope === TaskScope.Project;
    case TaskScopeFilterMode.Workflow:
      return task.taskScope === TaskScope.Workflow;
  }
}

function createTaskIconButton(
  parent: HTMLElement,
  icon: string,
  ariaLabel: string,
  title: string,
  extraClass = ""
): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: extraClass ? `ai-knowledge-task-link-icon ${extraClass}` : "ai-knowledge-task-link-icon",
    attr: {
      "aria-label": ariaLabel,
      title
    }
  });
  setIcon(button, icon);
  return button;
}

function extractCalloutLines(rawLines: string[]): string[] {
  const lines: string[] = [];
  let inCallout = false;
  for (const raw of rawLines) {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith(">")) {
      inCallout = true;
      const content = trimmed.replace(/^>\s*/, "");
      if (content && !content.startsWith("[!")) {
        lines.push(content.replace(/^-\s*/, ""));
      }
    } else if (inCallout && trimmed === "") {
      inCallout = false;
    }
  }
  return lines;
}

function formatTaskTitle(task: BoardTask): string {
  return (task.text.split("\n")[0] ?? task.text)
    .replace(/\[\[[^\]]+]]/g, "")
    .replace(/\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\s*(输入|workflow|Workflow|链接|link)?\s*[：:]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortLinkLabel(label: string): string {
  const clean = label.replace(/\\/g, "/").replace(/\/+$/, "");
  const fileName = clean.split("/").pop() ?? clean;
  return fileName.replace(/\.md$/i, "");
}

function formatCompactDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[2]}-${match[3]}` : date;
}

function summarizeIssues(issues: ValidationIssue[]): string {
  const blockerOrError = issues.filter(
    (issue) =>
      issue.severity === ValidationSeverity.Blocker ||
      issue.severity === ValidationSeverity.Error
  ).length;

  return blockerOrError > 0 ? `${blockerOrError} blocking` : `${issues.length} issues`;
}

function notifySkillActionsUnavailable(): Promise<void> {
  new Notice("Skill actions are not wired.");
  return Promise.resolve();
}

function matchesSearch(task: BoardTask, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return task.text.toLowerCase().includes(needle)
    || (task.taskId ?? "").toLowerCase().includes(needle)
    || (task.dueDate ?? "").includes(needle);
}

function matchesProjectSearch(task: BoardTask, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [task.project ?? "", ...task.projects]
    .some((project) => project.toLowerCase().includes(needle));
}

function renderProjectTag(parent: HTMLElement, projects: string[]): void {
  const projectTag = parent.createSpan({
    cls: "ai-knowledge-task-meta-tag" + (projects.length === 0 ? " ai-knowledge-task-tag-empty" : ""),
    attr: {
      title: projects.length > 0 ? `关联项目：${projects.join("、")}` : "未关联项目"
    }
  });

  projectTag.createSpan({
    text: "项目",
    cls: "ai-knowledge-task-meta-label"
  });

  projectTag.createSpan({
    text: projects.length > 0 ? projects[0] : "未关联",
    cls: "ai-knowledge-task-meta-value"
  });

  if (projects.length > 1) {
    projectTag.createSpan({
      text: `+${projects.length - 1}`,
      cls: "ai-knowledge-task-meta-count"
    });
  }
}

function normalizeProjectNames(projects: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawProject of projects) {
    const project = rawProject.trim();
    if (!project || seen.has(project)) {
      continue;
    }
    seen.add(project);
    result.push(project);
  }

  return result;
}

class TaskUploadModal extends Modal {
  constructor(
    app: App,
    private readonly onUpload: (files: FileList) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ai-knowledge-wps-modal");
    contentEl.createEl("h2", { text: "上传到任务 inputs" });
    contentEl.createEl("p", {
      text: "选择本机文件或文件夹，插件会复制到当前任务的 inputs/ 目录。"
    });

    const fileInput = createHiddenFileInput(contentEl, false);
    const folderInput = createHiddenFileInput(contentEl, true);

    const footer = contentEl.createDiv({ cls: "ai-knowledge-wps-modal-footer" });
    const fileButton = footer.createEl("button", { text: "选择文件", cls: "mod-cta" });
    const folderButton = footer.createEl("button", { text: "选择文件夹" });
    const cancelButton = footer.createEl("button", { text: "取消" });

    const handleFiles = (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      this.close();
      void this.onUpload(files);
    };

    fileButton.addEventListener("click", () => fileInput.click());
    folderButton.addEventListener("click", () => folderInput.click());
    fileInput.addEventListener("change", () => handleFiles(fileInput.files));
    folderInput.addEventListener("change", () => handleFiles(folderInput.files));

    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }
}

function createHiddenFileInput(parent: HTMLElement, directory: boolean): HTMLInputElement {
  const input = parent.createEl("input", {
    attr: {
      type: "file",
      multiple: "true"
    }
  });
  input.addClass("ai-knowledge-hidden");
  if (directory) {
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }
  return input;
}

class ProjectMultiSelectModal extends Modal {
  private readonly selectedProjects: Set<string>;

  constructor(
    app: App,
    private readonly projects: string[],
    selectedProjects: string[],
    private readonly onSave: (projects: string[]) => void
  ) {
    super(app);
    this.selectedProjects = new Set(selectedProjects);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ai-knowledge-wps-modal");
    contentEl.createEl("h2", { text: "编辑 workflow 关联项目" });

    const search = contentEl.createEl("input", {
      cls: "ai-knowledge-project-search",
      attr: { type: "search", placeholder: "搜索项目", "aria-label": "搜索项目" }
    });
    const selected = contentEl.createDiv({ cls: "ai-knowledge-project-selected" });
    const results = contentEl.createDiv({ cls: "ai-knowledge-project-results" });

    const render = () => {
      selected.setText(`已选：${Array.from(this.selectedProjects).join("、") || "无"}`);
      results.empty();
      const query = search.value.trim().toLowerCase();
      const matches = this.projects.filter((project) => project.toLowerCase().includes(query));

      for (const project of matches.slice(0, 80)) {
        const label = results.createEl("label", { cls: "ai-knowledge-project-checkbox" });
        const checkbox = label.createEl("input", { type: "checkbox" });
        checkbox.checked = this.selectedProjects.has(project);
        label.createSpan({ text: project });
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            this.selectedProjects.add(project);
          } else {
            this.selectedProjects.delete(project);
          }
          render();
        });
      }
    };

    search.addEventListener("input", render);
    render();

    const footer = contentEl.createDiv({ cls: "ai-knowledge-wps-modal-footer" });
    const saveButton = footer.createEl("button", { text: "保存", cls: "mod-cta" });
    const cancelButton = footer.createEl("button", { text: "取消" });

    saveButton.addEventListener("click", () => {
      this.onSave(Array.from(this.selectedProjects));
      this.close();
    });

    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }
}
