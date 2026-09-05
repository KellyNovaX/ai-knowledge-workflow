import { App, Modal, Setting, TFolder } from "obsidian";
import { ACTIVE_TASK_STATUS_ORDER, TASK_STATUS_LABELS, TASK_STATUS_TITLES, WORKFLOW_TYPE_LABELS } from "../constants";
import {
  PlanAction,
  PlanConfidence,
  PlanDecision,
  TaskScope,
  TaskStatus,
  WorkflowPlan,
  WorkflowType
} from "../types";

const PROJECT_ROOT_PATH = "30-projects";
const PROJECT_PICKER_RESULT_LIMIT = 30;

export interface DirectTaskInput {
  title: string;
  description: string;
  project: string;
  type: WorkflowType;
  status: TaskStatus;
}

export interface DirectGeneralTaskInput {
  title: string;
  description: string;
  status: TaskStatus;
  dueDate: string;
  tags: string;
}

export interface DirectWorkflowInput {
  title: string;
  slug: string;
  type: WorkflowType;
  projects: string[];
  description: string;
  status: TaskStatus;
}

export function collectDirectTaskInput(
  app: App,
  initialInput?: DirectTaskInput
): Promise<DirectTaskInput | null> {
  return new Promise((resolve) => {
    new DirectTaskModal(app, resolve, initialInput).open();
  });
}

export function collectDirectGeneralTaskInput(
  app: App,
  initialInput?: DirectGeneralTaskInput
): Promise<DirectGeneralTaskInput | null> {
  return new Promise((resolve) => {
    new DirectGeneralTaskModal(app, resolve, initialInput).open();
  });
}

export function collectDirectWorkflowInput(
  app: App,
  initialInput?: DirectWorkflowInput
): Promise<DirectWorkflowInput | null> {
  return new Promise((resolve) => {
    new DirectWorkflowModal(app, resolve, initialInput).open();
  });
}

export function buildDirectTaskPlan(input: DirectTaskInput): WorkflowPlan {
  const description = input.description.trim();
  const taskText = description ? `${input.title}\n${description}` : input.title;

  return {
    decision: PlanDecision.Ready,
    action: PlanAction.CreateTask,
    task_scope: TaskScope.Project,
    project: input.project,
    related_projects: [input.project],
    workflow_type: input.type,
    workflow_slug: null,
    task_status: input.status,
    confidence: PlanConfidence.High,
    reason: "用户直接输入项目小任务。",
    questions: [],
    moves: [],
    tasks: [
      {
        text: taskText,
        link: buildProjectInputTaskPath(input.project, input.title)
      }
    ]
  };
}

export function buildDirectGeneralTaskPlan(input: DirectGeneralTaskInput): WorkflowPlan {
  return {
    decision: PlanDecision.Ready,
    action: PlanAction.CreateGeneralTask,
    task_scope: TaskScope.General,
    project: null,
    related_projects: [],
    workflow_type: null,
    workflow_slug: null,
    task_status: input.status,
    confidence: PlanConfidence.High,
    reason: "用户直接输入通用待办，不关联项目或 workflow。",
    questions: [],
    moves: [],
    tasks: [
      {
        text: buildGeneralTaskText(input),
        link: buildGeneralTaskPath(input.title)
      }
    ]
  };
}

export function buildDirectWorkflowPlan(input: DirectWorkflowInput): WorkflowPlan {
  const primaryProject = input.projects[0] ?? null;
  const description = input.description.trim();
  const taskText = description ? `${input.title}\n${description}` : input.title;

  return {
    decision: PlanDecision.Ready,
    action: PlanAction.CreateWorkflow,
    task_scope: TaskScope.Workflow,
    project: primaryProject,
    related_projects: input.projects,
    workflow_type: input.type,
    workflow_slug: input.slug,
    task_status: input.status,
    confidence: PlanConfidence.High,
    reason: "用户直接输入复杂任务 workflow。",
    questions: [],
    moves: [],
    tasks: [
      {
        text: taskText,
        link: `20-workflows/${input.slug}/AGENTS.md`
      }
    ]
  };
}

export function createWorkflowSlug(title: string): string {
  const slugPart = title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slugPart || "workflow";
}

class DirectTaskModal extends Modal {
  private title = "";
  private description = "";
  private project = "";
  private type = WorkflowType.Feature;
  private status = TaskStatus.Todo;
  private settled = false;

  constructor(
    app: App,
    private readonly resolveInput: (input: DirectTaskInput | null) => void,
    initialInput?: DirectTaskInput
  ) {
    super(app);
    if (initialInput) {
      this.title = initialInput.title;
      this.description = initialInput.description;
      this.project = initialInput.project;
      this.type = initialInput.type;
      this.status = initialInput.status;
    }
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Create Project Task" });
    const projects = listProjectNames(this.app);
    if (!this.project || !projects.includes(this.project)) {
      this.project = projects[0] ?? "";
    }

    new Setting(this.contentEl)
      .setName("Task title")
      .setDesc("任务板上显示的简短标题。")
      .addText((text) => {
        text.setValue(this.title);
        text.onChange((value) => (this.title = value.trim()));
      });

    new Setting(this.contentEl)
      .setName("Task type")
      .addDropdown((dropdown) => {
        addWorkflowTypeOptions(dropdown);
        dropdown
          .setValue(this.type)
          .onChange((value) => (this.type = value as WorkflowType));
      });

    renderSingleProjectPicker(this.contentEl, {
      projects,
      selectedProject: this.project,
      onChange: (project) => {
        this.project = project;
      }
    });

    new Setting(this.contentEl)
      .setName("Description")
      .setDesc("可选，写入任务板文本，作为项目任务背景摘要。")
      .addTextArea((text) => {
        text.setValue(this.description);
        text.onChange((value) => (this.description = value.trim()));
      });

    new Setting(this.contentEl)
      .setName("Status")
      .addDropdown((dropdown) => {
        addTaskStatusOptions(dropdown);
        dropdown.setValue(this.status);
        dropdown.onChange((value) => (this.status = value as TaskStatus));
      });

    this.renderFooter(projects.length === 0);
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveInput(null);
    }
    this.contentEl.empty();
  }

  private renderFooter(noProjects: boolean): void {
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(null)))
      .addButton((button) =>
        button
          .setButtonText("Preview")
          .setCta()
          .setDisabled(noProjects)
          .onClick(() => {
            if (!this.title || !this.project) {
              return;
            }

            this.finish({
              title: this.title,
              description: this.description,
              project: this.project,
              type: this.type,
              status: this.status
            });
          })
      );
  }

  private finish(input: DirectTaskInput | null): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveInput(input);
    this.close();
  }
}

class DirectGeneralTaskModal extends Modal {
  private title = "";
  private description = "";
  private status = TaskStatus.Todo;
  private dueDate = "";
  private tags = "";
  private settled = false;

  constructor(
    app: App,
    private readonly resolveInput: (input: DirectGeneralTaskInput | null) => void,
    initialInput?: DirectGeneralTaskInput
  ) {
    super(app);
    if (initialInput) {
      this.title = initialInput.title;
      this.description = initialInput.description;
      this.status = initialInput.status;
      this.dueDate = initialInput.dueDate;
      this.tags = initialInput.tags;
    }
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Add General Task" });

    new Setting(this.contentEl)
      .setName("Task title")
      .setDesc("提醒、会议、沟通跟进等不绑定项目的待办。")
      .addText((text) => {
        text.setValue(this.title);
        text.onChange((value) => (this.title = value.trim()));
      });

    new Setting(this.contentEl)
      .setName("Description")
      .setDesc("可选，作为任务说明写入 note。")
      .addTextArea((text) => {
        text.setValue(this.description);
        text.onChange((value) => (this.description = value.trim()));
      });

    new Setting(this.contentEl)
      .setName("Due date")
      .setDesc("可选，格式 YYYY-MM-DD。")
      .addText((text) => {
        text.setPlaceholder("2026-05-27");
        text.setValue(this.dueDate);
        text.onChange((value) => (this.dueDate = value.trim()));
      });

    new Setting(this.contentEl)
      .setName("Tags")
      .setDesc("可选，空格分隔，例如 #meeting。")
      .addText((text) => {
        text.setValue(this.tags);
        text.onChange((value) => (this.tags = value.trim()));
      });

    new Setting(this.contentEl)
      .setName("Status")
      .addDropdown((dropdown) => {
        addTaskStatusOptions(dropdown);
        dropdown.setValue(this.status);
        dropdown.onChange((value) => (this.status = value as TaskStatus));
      });

    this.renderFooter();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveInput(null);
    }
    this.contentEl.empty();
  }

  private renderFooter(): void {
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(null)))
      .addButton((button) =>
        button
          .setButtonText("Preview")
          .setCta()
          .onClick(() => {
            if (!this.title || (this.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(this.dueDate))) {
              return;
            }

            this.finish({
              title: this.title,
              description: this.description,
              status: this.status,
              dueDate: this.dueDate,
              tags: this.tags
            });
          })
      );
  }

  private finish(input: DirectGeneralTaskInput | null): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveInput(input);
    this.close();
  }
}

class DirectWorkflowModal extends Modal {
  private title = "";
  private slug = "";
  private type = WorkflowType.Feature;
  private selectedProjects = new Set<string>();
  private description = "";
  private status = TaskStatus.Todo;
  private settled = false;
  private slugEdited = false;

  constructor(
    app: App,
    private readonly resolveInput: (input: DirectWorkflowInput | null) => void,
    initialInput?: DirectWorkflowInput
  ) {
    super(app);
    if (initialInput) {
      this.title = initialInput.title;
      this.slug = initialInput.slug;
      this.type = initialInput.type;
      this.selectedProjects = new Set(initialInput.projects);
      this.description = initialInput.description;
      this.status = initialInput.status;
    }
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Create Workflow" });
    const projects = listProjectNames(this.app);

    let slugInput: import("obsidian").TextComponent | null = null;

    new Setting(this.contentEl)
      .setName("Workflow title")
      .setDesc("复杂任务标题。")
      .addText((text) =>
        text.setValue(this.title).onChange((value) => {
          this.title = value.trim();
          if (!this.slugEdited) {
            this.slug = createWorkflowSlug(this.title);
            slugInput?.setValue(this.slug);
          }
        })
      );

    new Setting(this.contentEl)
      .setName("Workflow slug")
      .setDesc("将创建 20-workflows/<slug>/，可修改。")
      .addText((text) => {
        slugInput = text;
        text.setPlaceholder(createWorkflowSlug("workflow"));
        text.setValue(this.slug);
        text.onChange((value) => {
          this.slug = value.trim();
          this.slugEdited = this.slug !== "" && this.slug !== createWorkflowSlug(this.title);
        });
      });

    new Setting(this.contentEl)
      .setName("Workflow type")
      .addDropdown((dropdown) => {
        addWorkflowTypeOptions(dropdown);
        dropdown
          .setValue(this.type)
          .onChange((value) => (this.type = value as WorkflowType));
      });

    renderMultiProjectPicker(this.contentEl, {
      projects,
      selectedProjects: this.selectedProjects,
      onChange: (project, selected) => {
        if (selected) {
          this.selectedProjects.add(project);
        } else {
          this.selectedProjects.delete(project);
        }
      }
    });

    new Setting(this.contentEl)
      .setName("Description")
      .setDesc("可选，写入任务板文本，作为 workflow 背景摘要。")
      .addTextArea((text) => {
        text.setValue(this.description);
        text.onChange((value) => (this.description = value.trim()));
      });

    new Setting(this.contentEl)
      .setName("Status")
      .addDropdown((dropdown) => {
        addTaskStatusOptions(dropdown);
        dropdown.setValue(this.status);
        dropdown.onChange((value) => (this.status = value as TaskStatus));
      });

    this.renderFooter(projects.length === 0);
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveInput(null);
    }
    this.contentEl.empty();
  }

  private renderFooter(noProjects: boolean): void {
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(null)))
      .addButton((button) =>
        button
          .setButtonText("Preview")
          .setCta()
          .setDisabled(noProjects)
          .onClick(() => {
            const slug = this.slug || createWorkflowSlug(this.title);
            const projects = Array.from(this.selectedProjects);

            if (!this.title || !slug || projects.length === 0) {
              return;
            }

            this.finish({
              title: this.title,
              slug,
              type: this.type,
              projects,
              description: this.description,
              status: this.status
            });
          })
      );
  }

  private finish(input: DirectWorkflowInput | null): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveInput(input);
    this.close();
  }
}

function listProjectNames(app: App): string[] {
  const projectRoot = app.vault.getAbstractFileByPath(PROJECT_ROOT_PATH);

  if (!(projectRoot instanceof TFolder)) {
    return [];
  }

  return projectRoot.children
    .filter((child): child is TFolder => child instanceof TFolder)
    .map((child) => child.name)
    .sort();
}

interface SingleProjectPickerOptions {
  projects: string[];
  selectedProject: string;
  onChange(project: string): void;
}

interface MultiProjectPickerOptions {
  projects: string[];
  selectedProjects: Set<string>;
  onChange(project: string, selected: boolean): void;
}

function renderSingleProjectPicker(parent: HTMLElement, options: SingleProjectPickerOptions): void {
  const group = parent.createDiv({ cls: "ai-knowledge-project-picker" });
  group.createEl("h3", { text: "Project" });
  group.createEl("p", {
    text: "从 30-projects/ 读取，任务会链接到这个项目入口。",
    cls: "ai-knowledge-muted"
  });

  const search = group.createEl("input", {
    cls: "ai-knowledge-project-search",
    type: "search",
    attr: {
      placeholder: "搜索项目...",
      "aria-label": "搜索项目"
    }
  });
  const selected = group.createEl("div", {
    cls: "ai-knowledge-project-selected",
    text: options.selectedProject ? `已选：${options.selectedProject}` : "未选择项目"
  });
  const results = group.createDiv({ cls: "ai-knowledge-project-results" });

  const renderResults = () => {
    const query = search.value;
    const matches = filterProjects(options.projects, query);
    results.empty();

    if (matches.length === 0) {
      results.createEl("p", { text: "无匹配项目", cls: "ai-knowledge-muted" });
      return;
    }

    for (const project of matches.slice(0, PROJECT_PICKER_RESULT_LIMIT)) {
      const button = results.createEl("button", {
        text: project,
        cls: "ai-knowledge-project-option"
      });
      button.toggleClass("is-selected", project === options.selectedProject);
      button.addEventListener("click", () => {
        options.selectedProject = project;
        options.onChange(project);
        selected.setText(`已选：${project}`);
        renderResults();
      });
    }

    renderProjectLimitHint(results, matches.length);
  };

  search.addEventListener("input", renderResults);
  renderResults();
}

function renderMultiProjectPicker(parent: HTMLElement, options: MultiProjectPickerOptions): void {
  const group = parent.createDiv({ cls: "ai-knowledge-project-picker" });
  group.createEl("h3", { text: "Related projects" });
  group.createEl("p", {
    text: "可多选；第一个选中的项目作为当前 plan 的主项目。",
    cls: "ai-knowledge-muted"
  });

  const search = group.createEl("input", {
    cls: "ai-knowledge-project-search",
    type: "search",
    attr: {
      placeholder: "搜索项目...",
      "aria-label": "搜索项目"
    }
  });
  const selected = group.createEl("div", { cls: "ai-knowledge-project-selected" });
  const results = group.createDiv({ cls: "ai-knowledge-project-results" });

  const renderSelected = () => {
    const selectedProjects = Array.from(options.selectedProjects);
    selected.setText(
      selectedProjects.length > 0
        ? `已选 ${selectedProjects.length} 个：${selectedProjects.join(", ")}`
        : "未选择项目"
    );
  };

  const renderResults = () => {
    const query = search.value;
    const matches = filterProjects(options.projects, query);
    results.empty();

    if (matches.length === 0) {
      results.createEl("p", { text: "无匹配项目", cls: "ai-knowledge-muted" });
      return;
    }

    for (const project of matches.slice(0, PROJECT_PICKER_RESULT_LIMIT)) {
      const label = results.createEl("label", { cls: "ai-knowledge-project-checkbox" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = options.selectedProjects.has(project);
      label.createEl("span", { text: project });
      checkbox.addEventListener("change", () => {
        options.onChange(project, checkbox.checked);
        renderSelected();
      });
    }

    renderProjectLimitHint(results, matches.length);
  };

  search.addEventListener("input", renderResults);
  renderSelected();
  renderResults();
}

function filterProjects(projects: string[], query: string): string[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return projects;
  }

  return projects.filter((project) => {
    const normalized = project.toLowerCase();
    return tokens.every((token) => fuzzyIncludes(normalized, token));
  });
}

function fuzzyIncludes(value: string, query: string): boolean {
  let cursor = 0;

  for (const char of query) {
    cursor = value.indexOf(char, cursor);

    if (cursor === -1) {
      return false;
    }

    cursor += 1;
  }

  return true;
}

function renderProjectLimitHint(parent: HTMLElement, matchCount: number): void {
  if (matchCount <= PROJECT_PICKER_RESULT_LIMIT) {
    return;
  }

  parent.createEl("p", {
    text: `显示前 ${PROJECT_PICKER_RESULT_LIMIT} 个，共 ${matchCount} 个匹配；继续输入可缩小范围。`,
    cls: "ai-knowledge-project-limit-hint"
  });
}

function buildGeneralTaskText(input: DirectGeneralTaskInput): string {
  const firstLineParts = [input.title.trim()];
  const dueDate = input.dueDate.trim();
  const tags = input.tags
    .split(/\s+/)
    .filter((tag) => tag && tag !== "#general")
    .join(" ");

  if (dueDate) {
    firstLineParts.push(`due:${dueDate}`);
  }

  if (tags) {
    firstLineParts.push(tags);
  }

  const description = input.description.trim();
  return description ? `${firstLineParts.join(" ")}\n${description}` : firstLineParts.join(" ");
}

function buildProjectInputTaskPath(project: string, title: string, date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${PROJECT_ROOT_PATH}/${project}/inputs/${year}/${month}/${createFileSlug(title)}/AGENTS.md`;
}

function buildGeneralTaskPath(title: string, date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `10-tasks/items/${year}/${month}/${createFileSlug(title)}.md`;
}

function createFileSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "task";
}

function addTaskStatusOptions(dropdown: { addOption(value: string, display: string): unknown }): void {
  for (const status of ACTIVE_TASK_STATUS_ORDER) {
    dropdown.addOption(status, `${TASK_STATUS_TITLES[status]} / ${TASK_STATUS_LABELS[status]}`);
  }
}

function addWorkflowTypeOptions(dropdown: { addOption(value: string, display: string): unknown }): void {
  for (const type of Object.values(WorkflowType)) {
    dropdown.addOption(type, WORKFLOW_TYPE_LABELS[type]);
  }
}
