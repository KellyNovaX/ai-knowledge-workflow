import { App, Modal, Notice, Setting } from "obsidian";
import { FaqCategory, FaqDraft } from "../vault/FaqRepository";

const PROJECT_PICKER_RESULT_LIMIT = 30;

export enum FaqDraftResultKind {
  Submitted = "submitted",
  Cancelled = "cancelled"
}

export type FaqDraftResult =
  | { kind: FaqDraftResultKind.Submitted; draft: FaqDraft }
  | { kind: FaqDraftResultKind.Cancelled };

export function collectFaqDraft(
  app: App,
  category: FaqCategory,
  project?: string,
  projects: string[] = [],
  initialDraft?: Partial<FaqDraft>
): Promise<FaqDraftResult> {
  return new Promise((resolve) => {
    new FaqDraftModal(app, category, project, projects, initialDraft, resolve).open();
  });
}

class FaqDraftModal extends Modal {
  private settled = false;
  private question: string;
  private answer: string;
  private selectedProject = "";

  constructor(
    app: App,
    private readonly category: FaqCategory,
    private readonly project: string | undefined,
    private readonly projects: string[],
    private readonly initialDraft: Partial<FaqDraft> | undefined,
    private readonly resolveResult: (result: FaqDraftResult) => void
  ) {
    super(app);
    this.question = initialDraft?.question ?? "";
    this.answer = initialDraft?.answer ?? "";
    this.selectedProject = project ?? initialDraft?.project ?? projects[0] ?? "";
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ai-knowledge-faq-modal");
    this.contentEl.createEl("h2", {
      text: `${this.initialDraft ? "编辑" : "新增"}${this.category === FaqCategory.General ? "通用" : "项目"} FAQ`
    });

    if (this.category === FaqCategory.Project) {
      if (this.project) {
        this.contentEl.createEl("p", {
          text: `项目：${this.project}`,
          cls: "ai-knowledge-muted"
        });
      } else {
        renderSingleProjectPicker(this.contentEl, {
          projects: this.projects,
          selectedProject: this.selectedProject,
          onChange: (project) => {
            this.selectedProject = project;
          }
        });
      }
    }

    new Setting(this.contentEl)
      .setName("问题")
      .addTextArea((text) => {
        text.inputEl.rows = 2;
        text.setPlaceholder("输入问题");
        text.setValue(this.question);
        text.onChange((value) => {
          this.question = value;
        });
      });

    new Setting(this.contentEl)
      .setName("回答")
      .addTextArea((text) => {
        text.inputEl.rows = 7;
        text.setPlaceholder("输入回答");
        text.setValue(this.answer);
        text.onChange((value) => {
          this.answer = value;
        });
      });

    const actionSetting = new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("取消")
          .onClick(() => this.finish({ kind: FaqDraftResultKind.Cancelled }))
      )
      .addButton((button) =>
        button
          .setButtonText(this.initialDraft ? "更新 FAQ" : "保存 FAQ")
          .setCta()
          .onClick(() => {
            const question = this.question.trim();
            const answer = this.answer.trim();
            const project = this.category === FaqCategory.Project ? this.selectedProject.trim() : undefined;

            if (!question || !answer) {
              new Notice("问题和回答必填。");
              return;
            }

            if (this.category === FaqCategory.Project && !project) {
              new Notice("请选择项目。");
              return;
            }

            this.finish({
              kind: FaqDraftResultKind.Submitted,
              draft: {
                category: this.category,
                project,
                question,
                answer
              }
            });
          })
      );
    actionSetting.settingEl.addClass("ai-knowledge-faq-modal-actions");
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveResult({ kind: FaqDraftResultKind.Cancelled });
    }

    this.contentEl.empty();
  }

  private finish(result: FaqDraftResult): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.resolveResult(result);
    this.close();
  }
}

interface SingleProjectPickerOptions {
  projects: string[];
  selectedProject: string;
  onChange(project: string): void;
}

function renderSingleProjectPicker(parent: HTMLElement, options: SingleProjectPickerOptions): void {
  const group = parent.createDiv({ cls: "ai-knowledge-project-picker" });
  group.createEl("h3", { text: "Project" });
  group.createEl("p", {
    text: "从 30-projects/ 读取，FAQ 会写入所选项目的 faq.md。",
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
    const matches = filterProjects(options.projects, search.value);
    results.empty();

    if (matches.length === 0) {
      options.selectedProject = "";
      options.onChange("");
      selected.setText("未选择项目");
      results.createEl("p", { text: "无匹配项目", cls: "ai-knowledge-muted" });
      return;
    }

    if (!matches.includes(options.selectedProject)) {
      options.selectedProject = matches[0];
      options.onChange(options.selectedProject);
      selected.setText(`已选：${options.selectedProject}`);
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
