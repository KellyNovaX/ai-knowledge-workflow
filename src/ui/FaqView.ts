import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import {
  FaqCategory,
  FaqEntry,
  FaqRepository
} from "../vault/FaqRepository";
import {
  collectFaqDraft,
  FaqDraftResultKind
} from "./FaqModal";
import { ConfirmDecision, confirmAction } from "./ConfirmModal";

export const FAQ_VIEW_TYPE = "ai-knowledge-faq";

export enum FaqFilterMode {
  All = "all",
  Project = "project",
  General = "card-system"
}

const FAQ_FILTER_LABELS: Record<FaqFilterMode, string> = {
  [FaqFilterMode.All]: "全部",
  [FaqFilterMode.Project]: "项目 FAQ",
  [FaqFilterMode.General]: "通用 FAQ"
};

export interface FaqViewActions {
  openTasks(): Promise<void>;
  openProjects(): Promise<void>;
  openFaq(): Promise<void>;
}

export class FaqView extends ItemView {
  private filterMode = FaqFilterMode.All;
  private searchText = "";
  private isRefreshing = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly actions: FaqViewActions
  ) {
    super(leaf);
  }

  getViewType(): string {
    return FAQ_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI 知识 FAQ";
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
      const entries = await new FaqRepository(this.app).listFaqEntries();
      this.renderFaq(entries);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`FAQ 刷新失败：${message}`);
      this.renderError(message);
    } finally {
      this.isRefreshing = false;
    }
  }

  private renderLoading(): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ai-knowledge-faq-view");
    container.createEl("p", { text: "刷新中...", cls: "ai-knowledge-muted" });
  }

  private renderError(message: string): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ai-knowledge-faq-view");
    container.createEl("p", { text: message, cls: "ai-knowledge-error" });
  }

  private renderFaq(entries: FaqEntry[]): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ai-knowledge-faq-view");

    this.renderMainTabs(container);

    const header = container.createDiv({ cls: "ai-knowledge-faq-header" });
    const title = header.createDiv({ cls: "ai-knowledge-faq-title" });
    title.createEl("h2", { text: "FAQ" });
    title.createEl("p", {
      text: "项目 FAQ 与通用 FAQ 独立管理，不写入任务板。",
      cls: "ai-knowledge-muted"
    });

    const actions = header.createDiv({ cls: "ai-knowledge-faq-actions" });
    this.addHeaderButton(actions, "新增通用 FAQ", "badge-plus", () => this.addGeneralFaq());
    this.addHeaderButton(actions, "新增项目 FAQ", "folder-plus", () => this.addProjectFaq());
    this.addHeaderButton(actions, "刷新", "refresh-cw", () => this.refresh());

    this.renderControls(container);

    const visibleEntries = entries
      .filter((entry) => matchesFilter(entry, this.filterMode))
      .filter((entry) => matchesSearch(entry, this.searchText));

    this.renderMetrics(container, entries, visibleEntries.length);
    this.renderEntryList(container, visibleEntries);
  }

  private renderMainTabs(container: Element): void {
    const tabs = container.createDiv({ cls: "ai-knowledge-main-tabs" });
    const tasksButton = tabs.createEl("button", { text: "Tasks" });
    const projectsButton = tabs.createEl("button", { text: "Projects" });
    const faqButton = tabs.createEl("button", { text: "FAQ" });
    tasksButton.addEventListener("click", () => {
      void this.actions.openTasks();
    });
    projectsButton.addEventListener("click", () => {
      void this.actions.openProjects();
    });
    faqButton.addClass("mod-cta");
  }

  private renderControls(container: Element): void {
    const controls = container.createDiv({ cls: "ai-knowledge-faq-controls" });
    const filterGroup = controls.createDiv({ cls: "ai-knowledge-type-filter-group" });
    filterGroup.createEl("span", { text: "分类:", cls: "ai-knowledge-sort-label" });
    const filterSelect = filterGroup.createEl("select", {
      cls: "ai-knowledge-faq-filter-mode",
      attr: {
        "aria-label": "FAQ 分类筛选",
        title: "FAQ 分类筛选"
      }
    });

    for (const mode of Object.values(FaqFilterMode)) {
      filterSelect.createEl("option", { text: FAQ_FILTER_LABELS[mode], value: mode });
    }

    filterSelect.value = this.filterMode;
    filterSelect.addEventListener("change", () => {
      this.filterMode = filterSelect.value as FaqFilterMode;
      void this.refresh();
    });

    const searchInput = controls.createEl("input", {
      cls: "ai-knowledge-faq-search",
      type: "search",
      attr: {
        placeholder: "搜索问题、回答、项目",
        "aria-label": "搜索 FAQ"
      }
    });
    searchInput.value = this.searchText;
    searchInput.addEventListener("input", () => {
      this.searchText = searchInput.value;
      void this.refresh();
    });
  }

  private renderMetrics(
    container: Element,
    entries: FaqEntry[],
    visibleCount: number
  ): void {
    const metrics = container.createDiv({ cls: "ai-knowledge-faq-metrics" });
    this.renderMetric(metrics, "当前显示", visibleCount.toString());
    this.renderMetric(metrics, "全部 FAQ", entries.length.toString());
    this.renderMetric(metrics, "通用 FAQ", entries.filter((entry) => entry.category === FaqCategory.General).length.toString());
    this.renderMetric(metrics, "项目 FAQ", entries.filter((entry) => entry.category === FaqCategory.Project).length.toString());
  }

  private renderMetric(parent: Element, label: string, value: string): void {
    const item = parent.createDiv({ cls: "ai-knowledge-metric" });
    item.createEl("div", { text: value, cls: "ai-knowledge-metric-value" });
    item.createEl("div", { text: label, cls: "ai-knowledge-metric-label" });
  }

  private renderEntryList(container: Element, entries: FaqEntry[]): void {
    const list = container.createDiv({ cls: "ai-knowledge-faq-list" });

    if (entries.length === 0) {
      list.createEl("p", { text: "暂无 FAQ。", cls: "ai-knowledge-muted" });
      return;
    }

    for (const entry of entries) {
      this.renderEntryCard(list, entry);
    }
  }

  private renderEntryCard(parent: Element, entry: FaqEntry): void {
    const card = parent.createDiv({ cls: "ai-knowledge-faq-card" });
    const top = card.createDiv({ cls: "ai-knowledge-faq-card-top" });
    const badges = top.createDiv({ cls: "ai-knowledge-faq-badges" });
    badges.createEl("span", {
      text: entry.category === FaqCategory.General ? "通用" : "项目",
      cls: `ai-knowledge-faq-badge ai-knowledge-faq-${entry.category}`
    });

    const iconActions = top.createDiv({ cls: "ai-knowledge-faq-icon-actions" });

    const openButton = iconActions.createEl("button", {
      cls: "ai-knowledge-task-link-icon",
      attr: {
        "aria-label": `打开 FAQ：${entry.question}`,
        title: "打开 FAQ"
      }
    });
    setIcon(openButton, "external-link");
    openButton.addEventListener("click", () => {
      void this.openEntry(entry);
    });

    const editButton = iconActions.createEl("button", {
      cls: "ai-knowledge-task-link-icon",
      attr: {
        "aria-label": `编辑 FAQ：${entry.question}`,
        title: "编辑 FAQ"
      }
    });
    setIcon(editButton, "pencil");
    editButton.addEventListener("click", () => {
      void this.editEntry(entry);
    });

    const deleteButton = iconActions.createEl("button", {
      cls: "ai-knowledge-task-link-icon",
      attr: {
        "aria-label": `删除 FAQ：${entry.question}`,
        title: "删除 FAQ"
      }
    });
    setIcon(deleteButton, "trash-2");
    deleteButton.addEventListener("click", () => {
      void this.deleteEntry(entry);
    });

    card.createEl("h3", { text: entry.question, cls: "ai-knowledge-faq-question" });
    card.createEl("p", { text: entry.answer, cls: "ai-knowledge-faq-answer" });

    const meta = card.createDiv({ cls: "ai-knowledge-faq-meta" });
    meta.createEl("span", { text: entry.project ?? "通用" });
    meta.createEl("span", { text: entry.updatedAt ? `更新：${entry.updatedAt}` : "未记录更新时间" });
    meta.createEl("span", { text: entry.path });
  }

  private addHeaderButton(
    parent: Element,
    label: string,
    icon: string,
    action: () => Promise<void>
  ): void {
    const button = parent.createEl("button", {
      cls: "ai-knowledge-faq-action-button",
      attr: { title: label }
    });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      void action();
    });
  }

  private async addProjectFaq(): Promise<void> {
    const repository = new FaqRepository(this.app);
    const projects = await repository.listProjects();

    if (projects.length === 0) {
      new Notice("未找到项目目录。");
      return;
    }

    await this.addFaq(FaqCategory.Project, undefined, projects);
  }

  private async addGeneralFaq(): Promise<void> {
    await this.addFaq(FaqCategory.General);
  }

  private async addFaq(
    category: FaqCategory,
    project?: string,
    projects: string[] = []
  ): Promise<void> {
    const result = await collectFaqDraft(this.app, category, project, projects);

    if (result.kind !== FaqDraftResultKind.Submitted) {
      return;
    }

    try {
      const path = await new FaqRepository(this.app).appendFaq(result.draft);
      new Notice(`FAQ 已保存：${path}`);
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`保存 FAQ 失败：${message}`);
      console.error("AI Knowledge: save FAQ failed", error);
    }
  }

  private async editEntry(entry: FaqEntry): Promise<void> {
    const result = await collectFaqDraft(
      this.app,
      entry.category,
      entry.project ?? undefined,
      [],
      {
        category: entry.category,
        project: entry.project ?? undefined,
        question: entry.question,
        answer: entry.answer
      }
    );

    if (result.kind !== FaqDraftResultKind.Submitted) {
      return;
    }

    try {
      const path = await new FaqRepository(this.app).updateFaq(entry, result.draft);
      new Notice(`FAQ 已更新：${path}`);
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`更新 FAQ 失败：${message}`);
      console.error("AI Knowledge: update FAQ failed", error);
    }
  }

  private async deleteEntry(entry: FaqEntry): Promise<void> {
    const decision = await confirmAction(
      this.app,
      "删除 FAQ",
      `确认删除“${entry.question}”？此操作会从 ${entry.path} 中移除该条 FAQ。`,
      "删除"
    );

    if (decision !== ConfirmDecision.Confirm) {
      return;
    }

    try {
      await new FaqRepository(this.app).deleteFaq(entry);
      new Notice("FAQ 已删除。");
      await this.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`删除 FAQ 失败：${message}`);
      console.error("AI Knowledge: delete FAQ failed", error);
    }
  }

  private async openEntry(entry: FaqEntry): Promise<void> {
    try {
      await new FaqRepository(this.app).openFaq(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`打开 FAQ 失败：${message}`);
      console.error("AI Knowledge: open FAQ failed", error);
    }
  }
}

function matchesFilter(entry: FaqEntry, mode: FaqFilterMode): boolean {
  switch (mode) {
    case FaqFilterMode.All:
      return true;
    case FaqFilterMode.Project:
      return entry.category === FaqCategory.Project;
    case FaqFilterMode.General:
      return entry.category === FaqCategory.General;
  }
}

function matchesSearch(entry: FaqEntry, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return [
    entry.question,
    entry.answer,
    entry.project ?? "",
    entry.path
  ].some((value) => value.toLowerCase().includes(needle));
}
