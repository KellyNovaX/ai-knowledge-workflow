import { App, SuggestModal } from "obsidian";
import { TASK_STATUS_ORDER, TASK_STATUS_TITLES } from "../constants";
import { BoardTask } from "../vault/TaskBoard";
import { TaskStatus } from "../types";

const PAGE_SIZE = 15;

export function selectTask(
  app: App,
  tasks: BoardTask[]
): Promise<BoardTask | null> {
  return new Promise((resolve) => {
    new TaskSuggestModal(app, tasks, resolve).open();
  });
}

class TaskSuggestModal extends SuggestModal<BoardTask> {
  private settled = false;
  private activeTab: TaskStatus | "all" = TaskStatus.Doing;
  private tabEl: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private currentPage = 0;
  private filteredTasks: BoardTask[] = [];
  private readonly statusCounts = new Map<TaskStatus | "all", number>();

  constructor(
    app: App,
    private readonly allTasks: BoardTask[],
    private readonly resolveTask: (task: BoardTask | null) => void
  ) {
    super(app);
    this.limit = PAGE_SIZE;
    this.setPlaceholder("搜索任务…");

    this.statusCounts.set("all", allTasks.length);
    for (const status of TASK_STATUS_ORDER) {
      this.statusCounts.set(status, allTasks.filter((t) => t.status === status).length);
    }
  }

  onOpen(): void {
    super.onOpen();
    this.renderTabs();
    this.computeFiltered();
    this.rerender();
  }

  onClose(): void {
    this.tabEl?.remove();
    this.pageEl?.remove();
    setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        this.resolveTask(null);
      }
    }, 0);
    super.onClose();
  }

  getSuggestions(query: string): BoardTask[] {
    this.computeFiltered();

    let results = this.filteredTasks;
    if (query) {
      const q = query.toLowerCase();
      results = results.filter((t) => {
        const text = t.text.split("\n")[0]
          .replace(/\[\[.*?\]\]/g, "")
          .replace(/\[.*?\]\(.*?\)/g, "")
          .trim()
          .toLowerCase();
        return text.includes(q);
      });
    }

    const start = this.currentPage * PAGE_SIZE;
    return results.slice(start, start + PAGE_SIZE);
  }

  renderSuggestion(task: BoardTask, el: HTMLElement): void {
    const raw = task.text.split("\n")[0]
      .replace(/\[\[.*?\]\]/g, "")
      .replace(/\[.*?\]\(.*?\)/g, "")
      .trim();
    const title = raw.length > 15 ? raw.substring(0, 15) + "…" : raw;
    el.createSpan({ text: title });
    const statusKey = task.status as TaskStatus;
    const statusLabel = TASK_STATUS_TITLES[statusKey] ?? task.status;
    el.createSpan({ cls: `ai-knowledge-task-status-badge ai-knowledge-status-${statusKey}`, text: statusLabel });
  }

  onChooseSuggestion(task: BoardTask): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveTask(task);
    }
  }

  private computeFiltered(): void {
    this.filteredTasks = this.activeTab === "all"
      ? this.allTasks
      : this.allTasks.filter((t) => t.status === this.activeTab);
  }

  private renderTabs(): void {
    this.tabEl?.remove();
    this.tabEl = this.modalEl.createDiv({ cls: "ai-knowledge-task-tabs" });
    this.modalEl.prepend(this.tabEl);

    const tabs: Array<{ key: TaskStatus | "all"; label: string }> = [
      { key: "all", label: "全部" },
      ...TASK_STATUS_ORDER.map((s) => ({
        key: s,
        label: TASK_STATUS_TITLES[s]
      }))
    ];

    for (const tab of tabs) {
      const count = this.statusCounts.get(tab.key) ?? 0;
      if (tab.key !== "all" && count === 0) continue;

      const btn = this.tabEl.createEl("button", {
        cls: "ai-knowledge-task-tab" + (this.activeTab === tab.key ? " is-active" : ""),
        text: `${tab.label} (${count})`
      });
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.activeTab = tab.key;
        this.currentPage = 0;
        this.computeFiltered();
        this.renderTabs();
        this.rerender();
        this.inputEl.value = "";
      });
    }
  }

  private renderPagination(): void {
    this.pageEl?.remove();
    this.pageEl = null;

    const totalPages = Math.ceil(this.filteredTasks.length / PAGE_SIZE);
    if (totalPages <= 1) return;

    this.pageEl = this.modalEl.createDiv({ cls: "ai-knowledge-task-pagination" });

    const prevBtn = this.pageEl.createEl("button", {
      cls: "ai-knowledge-pagination-button",
      text: "上一页"
    });
    prevBtn.disabled = this.currentPage === 0;
    prevBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (this.currentPage > 0) {
        this.currentPage--;
        this.rerender();
      }
    });

    this.pageEl.createSpan({
      cls: "ai-knowledge-pagination-summary",
      text: `${this.currentPage + 1} / ${totalPages}`
    });

    const nextBtn = this.pageEl.createEl("button", {
      cls: "ai-knowledge-pagination-button",
      text: "下一页"
    });
    nextBtn.disabled = this.currentPage >= totalPages - 1;
    nextBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (this.currentPage < totalPages - 1) {
        this.currentPage++;
        this.rerender();
      }
    });
  }

  private rerender(): void {
    const start = this.currentPage * PAGE_SIZE;
    const page = this.filteredTasks.slice(start, start + PAGE_SIZE);
    const container = this.resultContainerEl;
    if (!container) return;
    container.empty();

    if (page.length === 0) {
      container.createDiv({ cls: "ai-knowledge-muted", text: "无匹配任务" });
    } else {
      for (const item of page) {
        const el = container.createDiv({ cls: "suggestion-item mod-complex" });
        this.renderSuggestion(item, el);
        el.addEventListener("click", () => {
          this.onChooseSuggestion(item);
          this.close();
        });
      }
    }

    this.renderPagination();
  }
}
