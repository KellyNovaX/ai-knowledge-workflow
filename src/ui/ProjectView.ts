import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import {
  ProjectCardEntry,
  ProjectRepository
} from "../vault/ProjectRepository";

export const PROJECT_VIEW_TYPE = "ai-knowledge-projects";

export interface ProjectViewActions {
  openTasks(): Promise<void>;
  openProjects(): Promise<void>;
  openFaq(): Promise<void>;
  openProjectInCodex(project: ProjectCardEntry): Promise<void>;
  openProjectInCustomCli(project: ProjectCardEntry): Promise<void>;
}

export class ProjectView extends ItemView {
  private searchDraft = "";
  private searchQuery = "";
  private isRefreshing = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly actions: ProjectViewActions
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PROJECT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI 知识项目";
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
      const projects = await new ProjectRepository(this.app).listProjects();
      this.renderProjects(projects);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`项目刷新失败：${message}`);
      this.renderError(message);
    } finally {
      this.isRefreshing = false;
    }
  }

  private renderLoading(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ai-knowledge-project-view");
    container.createEl("p", { text: "刷新中...", cls: "ai-knowledge-muted" });
  }

  private renderError(message: string): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ai-knowledge-project-view");
    container.createEl("p", { text: message, cls: "ai-knowledge-error" });
  }

  private renderProjects(
    projects: ProjectCardEntry[],
    options: { focusSearch?: boolean } = {}
  ): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ai-knowledge-project-view");

    this.renderMainTabs(container);

    const header = container.createDiv({ cls: "ai-knowledge-project-header" });
    const titleRow = header.createDiv({ cls: "ai-knowledge-project-title" });
    titleRow.createEl("h2", { text: "Projects" });
    titleRow.createSpan({ text: projects.length.toString(), cls: "ai-knowledge-kanban-count" });
    header.createEl("p", {
      text: "从项目 links.md 读取源码目录。",
      cls: "ai-knowledge-muted"
    });

    const controls = container.createDiv({ cls: "ai-knowledge-project-controls" });
    const searchWrap = controls.createDiv({ cls: "ai-knowledge-project-search-wrap" });
    const searchInput = searchWrap.createEl("input", {
      cls: "ai-knowledge-project-card-search",
      type: "search",
      attr: {
        placeholder: "搜索项目名或路径",
        "aria-label": "搜索项目"
      }
    });
    const clearBtn = searchWrap.createEl("button", {
      cls: "ai-knowledge-search-clear",
      attr: { title: "清除搜索", "aria-label": "清除搜索" }
    });
    setIcon(clearBtn, "x");
    clearBtn.toggleClass("ai-knowledge-hidden", !this.searchDraft);
    const refreshButton = controls.createEl("button", {
      cls: "ai-knowledge-project-refresh",
      attr: { title: "刷新项目" }
    });
    setIcon(refreshButton.createSpan(), "refresh-cw");
    refreshButton.createSpan({ text: "刷新" });
    refreshButton.addEventListener("click", () => {
      void this.refresh();
    });
    searchInput.value = this.searchDraft;
    searchInput.addEventListener("input", () => {
      this.searchDraft = searchInput.value;
      clearBtn.toggleClass("ai-knowledge-hidden", !this.searchDraft);

      if (this.searchDraft.trim() === "" && this.searchQuery !== "") {
        this.searchQuery = "";
        this.renderProjects(projects, { focusSearch: true });
      }
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) {
        return;
      }

      this.searchDraft = searchInput.value;
      this.searchQuery = searchInput.value;
      this.renderProjects(projects, { focusSearch: true });
    });
    clearBtn.addEventListener("click", () => {
      this.searchDraft = "";
      this.searchQuery = "";
      searchInput.value = "";
      clearBtn.addClass("ai-knowledge-hidden");
      this.renderProjects(projects, { focusSearch: true });
    });
    if (options.focusSearch) {
      window.setTimeout(() => {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }, 0);
    }

    const visibleProjects = projects.filter((project) => matchesSearch(project, this.searchQuery));
    const list = container.createDiv({ cls: "ai-knowledge-project-card-list" });

    if (visibleProjects.length === 0) {
      list.createEl("p", { text: "暂无匹配项目。", cls: "ai-knowledge-muted" });
      return;
    }

    for (const project of visibleProjects) {
      this.renderProjectCard(list, project);
    }
  }

  private renderMainTabs(container: HTMLElement): void {
    const tabs = container.createDiv({ cls: "ai-knowledge-main-tabs" });
    const tasksButton = tabs.createEl("button", { text: "Tasks" });
    const projectsButton = tabs.createEl("button", { text: "Projects" });
    const faqButton = tabs.createEl("button", { text: "FAQ" });
    tasksButton.addEventListener("click", () => {
      void this.actions.openTasks();
    });
    projectsButton.addClass("mod-cta");
    faqButton.addEventListener("click", () => {
      void this.actions.openFaq();
    });
  }

  private renderProjectCard(parent: HTMLElement, project: ProjectCardEntry): void {
    const card = parent.createDiv({
      cls: "ai-knowledge-task-card ai-knowledge-priority-p4 ai-knowledge-project-card"
    });
    const top = card.createDiv({ cls: "ai-knowledge-task-card-top" });
    const badges = top.createDiv({ cls: "ai-knowledge-task-card-badges" });
    badges.createSpan({
      text: "项目",
      cls: "ai-knowledge-task-type-badge ai-knowledge-task-type-project"
    });

    const actions = top.createDiv({ cls: "ai-knowledge-task-icon-actions" });
    const indexButton = actions.createEl("button", {
      cls: "ai-knowledge-task-link-icon",
      attr: {
        "aria-label": `打开 Index：${project.name}`,
        title: `打开 ${project.path}/index.md`
      }
    });
    setIcon(indexButton, "book-open");
    indexButton.addEventListener("click", () => {
      void this.app.workspace.openLinkText(`${project.path}/index.md`, "").catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`打开项目失败：${message}`);
      });
    });
    this.renderActionButton(actions, "Codex", "app-window", project, () =>
      this.actions.openProjectInCodex(project)
    );
    this.renderActionButton(actions, "Custom CLI", "terminal", project, () =>
      this.actions.openProjectInCustomCli(project)
    );

    card.createDiv({ text: project.name, cls: "ai-knowledge-task-card-title" });

    const meta = card.createDiv({ cls: "ai-knowledge-task-card-meta" });
    meta.createSpan({
      text: project.path,
      cls: "ai-knowledge-task-meta-tag"
    });
    meta.createSpan({
      text: project.sourcePath ?? "未记录源码路径",
      cls: project.sourcePath ? "ai-knowledge-task-meta-tag" : "ai-knowledge-project-source-missing"
    });
  }

  private renderActionButton(
    parent: HTMLElement,
    label: string,
    icon: string,
    project: ProjectCardEntry,
    action: () => Promise<void>
  ): void {
    const button = parent.createEl("button", {
      cls: "ai-knowledge-task-link-icon",
      attr: {
        "aria-label": `${label}: ${project.name}`,
        title: `${label}: ${project.path}`
      }
    });
    setIcon(button, icon);
    button.addEventListener("click", () => {
      void action();
    });
  }
}

function matchesSearch(project: ProjectCardEntry, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return [
    project.name,
    project.path,
    project.linksPath,
    project.sourcePath ?? ""
  ].some((value) => value.toLowerCase().includes(needle));
}
