import { App, SuggestModal } from "obsidian";
import { ProjectCardEntry } from "../vault/ProjectRepository";

const PAGE_SIZE = 15;

export function selectProject(
  app: App,
  projects: ProjectCardEntry[]
): Promise<ProjectCardEntry | null> {
  return new Promise((resolve) => {
    new ProjectSuggestModal(app, projects, resolve).open();
  });
}

class ProjectSuggestModal extends SuggestModal<ProjectCardEntry> {
  private settled = false;
  private pageEl: HTMLElement | null = null;
  private currentPage = 0;
  private filteredProjects: ProjectCardEntry[] = [];

  constructor(
    app: App,
    private readonly allProjects: ProjectCardEntry[],
    private readonly resolveProject: (project: ProjectCardEntry | null) => void
  ) {
    super(app);
    this.limit = PAGE_SIZE;
    this.setPlaceholder("搜索项目…");
  }

  onOpen(): void {
    super.onOpen();
    this.filteredProjects = this.allProjects;
    this.currentPage = 0;
    this.rerender();
  }

  onClose(): void {
    this.pageEl?.remove();
    setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        this.resolveProject(null);
      }
    }, 0);
    super.onClose();
  }

  getSuggestions(query: string): ProjectCardEntry[] {
    this.filteredProjects = this.allProjects;
    if (query) {
      const q = query.toLowerCase();
      this.filteredProjects = this.filteredProjects.filter((p) =>
        p.name.toLowerCase().includes(q)
      );
    }

    const start = this.currentPage * PAGE_SIZE;
    return this.filteredProjects.slice(start, start + PAGE_SIZE);
  }

  renderSuggestion(project: ProjectCardEntry, el: HTMLElement): void {
    el.createSpan({ text: project.name });
  }

  onChooseSuggestion(project: ProjectCardEntry): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveProject(project);
    }
  }

  private renderPagination(): void {
    this.pageEl?.remove();
    this.pageEl = null;

    const totalPages = Math.ceil(this.filteredProjects.length / PAGE_SIZE);
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
    const page = this.filteredProjects.slice(start, start + PAGE_SIZE);
    const container = this.resultContainerEl;
    if (!container) return;
    container.empty();

    if (page.length === 0) {
      container.createDiv({ cls: "ai-knowledge-muted", text: "无匹配项目" });
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
