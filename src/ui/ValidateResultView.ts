import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { PLUGIN_NAME } from "../constants";
import { ValidationIssue, ValidationSeverity } from "../types";

export const VALIDATE_RESULT_VIEW_TYPE = "ai-knowledge-validate-results";

export class ValidateResultView extends ItemView {
  private issues: ValidationIssue[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VALIDATE_RESULT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `${PLUGIN_NAME}: Validate`;
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  setIssues(issues: ValidationIssue[]): void {
    this.issues = issues;
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ai-knowledge-validate-view");

    container.createEl("h2", { text: "Validate results" });

    if (this.issues.length === 0) {
      container.createEl("p", {
        text: "No validation issues found.",
        cls: "ai-knowledge-muted"
      });
      return;
    }

    const summary = this.buildSummaryText();
    container.createEl("p", { text: summary, cls: "ai-knowledge-muted" });

    const list = container.createDiv({ cls: "ai-knowledge-issue-list" });
    for (const issue of this.issues) {
      const row = list.createDiv({
        cls: `ai-knowledge-issue ai-knowledge-severity-${issue.severity}`
      });
      row.createDiv({
        text: `${issue.severity.toUpperCase()} · ${issue.code}`,
        cls: "ai-knowledge-issue-meta"
      });
      row.createDiv({
        text: issue.message,
        cls: "ai-knowledge-issue-message"
      });

      if (issue.path) {
        const issuePath = issue.path;
        const button = row.createEl("button", {
          text: issuePath,
          cls: "ai-knowledge-link-button"
        });
        button.addEventListener("click", () => {
          void this.openIssuePath(issuePath);
        });
      }
    }
  }

  private buildSummaryText(): string {
    const counts = new Map<ValidationSeverity, number>();
    for (const issue of this.issues) {
      counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1);
    }

    return `${this.issues.length} issue(s): ${counts.get(ValidationSeverity.Blocker) ?? 0} blocker, ${
      counts.get(ValidationSeverity.Error) ?? 0
    } error, ${counts.get(ValidationSeverity.Warning) ?? 0} warning, ${
      counts.get(ValidationSeverity.Info) ?? 0
    } info.`;
  }

  private async openIssuePath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      return;
    }

    new Notice(`No file found for ${path}.`);
  }
}
